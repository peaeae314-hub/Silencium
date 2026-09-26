const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const cors = require('cors');
const roomManager = require('./rooms/roomManager');
const rateLimit = require('./lib/rateLimit');

// Development logging helper
const isDev = process.env.NODE_ENV !== 'production';
const devLog = (...args) => {
  if (isDev) {
    console.log(...args);
  }
};

const app = express();
const server = http.createServer(app);

// Payload limits — kept aligned with the client (see ChatRoom.jsx):
//   client rejects encrypted images > 3 MB, so the relay accepts 4 MB and the
//   socket transport frame is 5 MB. This leaves headroom for Socket.IO framing
//   and means a valid client payload is never silently dropped by the transport.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_SOCKET_FRAME_BYTES = 5 * 1024 * 1024;
// B11 — encrypted text frame cap (ciphertext + overhead well under this).
const MAX_TEXT_BYTES = 64 * 1024;
// libsodium crypto_auth_BYTES
const AUTH_PROOF_BYTES = 32;

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: MAX_SOCKET_FRAME_BYTES
});

// ── B14 — reconnect grace ─────────────────────────────────────────────────────
// Android WebViews drop the Socket.IO transport when the app is backgrounded
// (e.g. the user switches apps to paste an invite link). The participant is
// still logically in the room, so a `disconnect` must NOT tear the room down
// right away: hold the membership seat for a grace window and release it only
// if the participant never comes back.
//
// The seat is held under the *old* socket id (so the room stays "alive" and
// keeps its 2-person capacity) until either
//   • a reconnecting socket re-joins the same room and reclaims it, or
//   • the grace window expires → leaveRoom + room-destroyed for the peer.
const DISCONNECT_GRACE_MS =
  Number(process.env.SILENCIUM_DISCONNECT_GRACE_MS) || 60 * 1000;

// old socket.id → { roomId, participantId, timer }
const pendingDisconnects = new Map();

function cancelPendingDisconnect(socketId) {
  const pending = pendingDisconnects.get(socketId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingDisconnects.delete(socketId);
  return true;
}

// Tear a room down (used by both the manual-leave path and an expired grace)
// and evict any sockets still in the Socket.IO room. Callers guarantee the
// leaving user is already out of `roomManager` membership.
function destroyRoom(roomId, leftSocketId) {
  devLog(`💥 Room ${roomId} destroyed because user ${leftSocketId} left`);
  io.to(roomId).emit('room-destroyed', {
    message: 'A user left the room. Room has been destroyed.',
    leftUserId: leftSocketId
  });
  // Remove all users from the room
  io.in(roomId).socketsLeave(roomId);
  // Clear the room
  roomManager.deleteRoom(roomId);
}

// Grace expired without a re-join: this is a true abandon. Release the held
// seat and apply the existing destroy-on-leave product rule.
function finalizeDisconnect(oldSocketId, roomId) {
  pendingDisconnects.delete(oldSocketId);

  const users = roomManager.getUsers(roomId);
  // The seat was already reclaimed (reconnect), released by a manual leave, or
  // the room is gone — there is nothing left to finalize.
  if (!users.includes(oldSocketId)) return;

  if (!roomManager.leaveRoom(oldSocketId)) return;

  io.to(roomId).emit('system-message', `❌ ${oldSocketId} left the room`);

  const remaining = roomManager.getUsers(roomId);
  if (remaining.length === 0) {
    devLog(`💣 No users left in room ${roomId}`);
    return;
  }

  destroyRoom(roomId, oldSocketId);
  devLog(`🔴 ${oldSocketId} left room ${roomId}`);
}

// A re-join for `roomId` within the grace window reclaims the held seat:
// cancel the pending destroy and swap the stale socket id for the new one.
// `participantId` (client-generated, stable across a resume) disambiguates
// which seat to reclaim when more than one is pending; clients that don't send
// one fall back to the sole/oldest pending seat for the room.
function reclaimPendingDisconnect(roomId, newSocketId, participantId) {
  const users = roomManager.getUsers(roomId);
  const candidates = [];

  for (const [oldSocketId, pending] of [...pendingDisconnects]) {
    if (pending.roomId !== roomId) continue;
    if (!users.includes(oldSocketId)) {
      // Seat already released or room destroyed — drop the stale bookkeeping.
      cancelPendingDisconnect(oldSocketId);
      continue;
    }
    candidates.push([oldSocketId, pending]);
  }

  if (candidates.length === 0) return null;

  const chosen = participantId
    ? candidates.find(([, pending]) => pending.participantId === participantId)
    : candidates[0];

  if (!chosen) return null;

  const [oldSocketId, pending] = chosen;
  clearTimeout(pending.timer);
  pendingDisconnects.delete(oldSocketId);

  if (!roomManager.replaceUser(roomId, oldSocketId, newSocketId)) return null;

  devLog(`♻️ ${newSocketId} reclaimed ${oldSocketId}'s seat in room ${roomId} (grace cancelled)`);
  return oldSocketId;
}

function byteLengthOf(value) {
  if (value == null) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value);
  return value.byteLength ?? value.length ?? 0;
}

/**
 * Passphrase / room key must NEVER reach the relay. Reject join payloads that
 * accidentally include them (server-side half of the weak-key / secret gate).
 * Entropy itself is enforced on the client — the server never sees the secret.
 */
function rejectsSecretFields(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const banned = ['passphrase', 'password', 'roomKey', 'secret'];
  return banned.some((k) => Object.prototype.hasOwnProperty.call(payload, k));
}

/**
 * Emit a join refusal. The English message stays the first argument so existing
 * clients (which only read that) keep working; new clients read the machine
 * code from the second argument and show a translated message.
 */
function emitJoinError(socket, message, code) {
  if (code) socket.emit('join-error', message, { code });
  else socket.emit('join-error', message);
}

app.use(cors());

// Liveness probe — works in both dev and production.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: isDev ? 'development' : 'production' });
});

// B5 — production static serving.
// `NODE_ENV=production node app.js` serves the built client (`client/dist`) from
// this same process, so there is no separate frontend server. Socket.IO is
// attached to the same HTTP server and handles /socket.io before Express sees
// the request, so the SPA fallback below never shadows it.
const CLIENT_DIST = path.resolve(__dirname, '..', 'client', 'dist');
const CLIENT_INDEX = path.join(CLIENT_DIST, 'index.html');

if (isDev) {
  app.get('/', (req, res) => res.send('Silencium server running'));
} else if (fs.existsSync(CLIENT_INDEX)) {
  // Hashed JS/CSS assets plus index.html.
  app.use(express.static(CLIENT_DIST));

  // SPA fallback: any unmatched GET (e.g. /chat?room=… on a hard refresh)
  // returns index.html so client-side routing can take over.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(CLIENT_INDEX, (err) => {
      if (err) next(err);
    });
  });

  devLog(`📦 Serving built client from ${CLIENT_DIST}`);
} else {
  console.warn(
    `⚠️  NODE_ENV=production but no client build found at ${CLIENT_DIST}.\n` +
      '   Run `cd client && npm run build`, then restart the server.'
  );
  app.get('/', (req, res) =>
    res.status(503).send('Client build missing. Run `cd client && npm run build`, then restart.')
  );
}

// ---------------------------------------------------------------------------
// ops/retained plaintext capture is OFF by default and is NOT wired into this
// relay. Any tooling under ops/retained/ is an explicit ops-only opt-in outside
// the normal server path — do not enable automatic plaintext retention here.
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  devLog('🟢 New client connected:', socket.id);

  // 🏠 JOIN ROOM
  socket.on('join-room', (payload = {}) => {
    if (rejectsSecretFields(payload)) {
      emitJoinError(socket, 'Do not send the room key to the server', 'SECRET_FIELD');
      return;
    }

    const { roomId, participantId, intent } = payload;
    // Format gate (create and join alike). Random 22-char base64url ids and old
    // invite links satisfy this; malformed ids are refused before any state.
    if (!roomId || typeof roomId !== 'string' || !roomManager.isValidRoomId(roomId)) {
      emitJoinError(socket, 'Invalid room ID', 'INVALID_ROOM_ID');
      return;
    }

    const limited = rateLimit.allowJoin(socket, roomId);
    if (!limited.ok) {
      emitJoinError(
        socket,
        'Too many join attempts. Slow down and try again.',
        'RATE_LIMITED'
      );
      return;
    }

    if (participantId && typeof participantId === 'string') {
      socket.data.participantId = participantId;
    }

    // If this socket is already in a different room, leave it first.
    // roomManager owns the rooms map, so route this through it (B9 fix:
    // app.js must never touch `rooms` directly).
    if (socket.data.roomId && socket.data.roomId !== roomId) {
      cancelPendingDisconnect(socket.id);
      const prevRoomId = roomManager.leaveRoom(socket.id);
      if (prevRoomId) {
        socket.leave(prevRoomId);
        if (roomManager.getUsers(prevRoomId).length > 0) {
          destroyRoom(prevRoomId, socket.id);
        } else {
          roomManager.deleteRoom(prevRoomId);
        }
      }
    }

    // B14 — if the same participant dropped and is now back within the grace
    // window, reclaim the held seat (and cancel the pending destroy) before
    // capacity is checked, so a resume never hits "Room is full".
    const reclaimedFrom = reclaimPendingDisconnect(roomId, socket.id, socket.data.participantId);

    // `intent:'create'` is only used to refuse creating over an occupied room;
    // a successful reclaim above already made this socket a member, so the
    // create intent is treated as an idempotent success by roomManager.
    const result = roomManager.joinRoom(roomId, socket.id, { intent });

    if (result.error) {
      emitJoinError(socket, result.error, result.code);
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    devLog(`🧑 ${socket.id} joined room ${roomId}`);
    devLog(`👥 Users in room ${roomId}:`, result.users);

    const msg = reclaimedFrom
      ? `✅ ${socket.id} reconnected to the room`
      : result.users.length === 1
        ? `🟢 ${socket.id} created the room`
        : `✅ ${socket.id} joined the room`;

    setTimeout(() => {
      io.to(roomId).emit('system-message', msg);
    }, 100);
  });

  // 🔐 ENCRYPTED IMAGE MESSAGE HANDLER
  socket.on('send-encrypted-image', (data = {}) => {
    const roomId = data.roomId || socket.data.roomId;
    if (!roomId || !data.encrypted || !data.nonce) {
      console.warn(`❌ Invalid encrypted image data from ${socket.id}`);
      socket.emit('image-error', 'Image could not be sent. Please try again.');
      return;
    }

    const limited = rateLimit.allowMessage(socket, roomId);
    if (!limited.ok) {
      socket.emit('image-error', 'Sending too fast. Slow down and try again.');
      return;
    }

    // Binary frames arrive as Buffer/Uint8Array/ArrayBuffer; tolerate the legacy
    // number-array form too. `.byteLength` covers binary, `.length` the array.
    const len = byteLengthOf(data.encrypted);
    if (len > MAX_IMAGE_BYTES) {
      console.warn(`❌ Blocked oversized encrypted image from ${socket.id}: ${len} bytes`);
      socket.emit('image-error', 'Image is too large to send. Please use a smaller image.');
      return;
    }

    try {
      devLog(`📤 Processing encrypted image from ${socket.id} in room ${roomId}`);
      devLog(`📊 Image size: ${len} bytes`);

      socket.to(roomId).emit('receive-encrypted-image', {
        encrypted: data.encrypted,
        nonce: data.nonce,
        name: data.name,
        type: data.type,
      });
      devLog(`✅ Encrypted image sent to room ${roomId}`);
    } catch (error) {
      console.error(`❌ Error processing encrypted image from ${socket.id}:`, error);
      socket.emit('image-error', 'Image could not be sent. Please try again.');
    }
  });


  // 🔐 PUBLIC KEY RELAY
  socket.on('send-public-key', ({ roomId, publicKey } = {}) => {
    if (!roomId || !publicKey) return;

    const limited = rateLimit.allowHandshake(socket, roomId);
    if (!limited.ok) {
      socket.emit('rate-limit', { event: 'send-public-key' });
      return;
    }

    const len = byteLengthOf(publicKey);
    // X25519 public key is 32 bytes; tolerate number-array form.
    if (len < 32 || len > 64) return;

    socket.to(roomId).emit('receive-public-key', {
      publicKey,
      theirSocketId: socket.id
    });
  });

  // 🔏 AUTH PROOF RELAY (B8 — passphrase-authenticated handshake)
  // Opaque MAC bytes only. The relay cannot forge these without the room key.
  socket.on('send-auth-proof', ({ roomId, proof } = {}) => {
    if (!roomId || !proof) return;

    const limited = rateLimit.allowHandshake(socket, roomId);
    if (!limited.ok) {
      socket.emit('rate-limit', { event: 'send-auth-proof' });
      return;
    }

    if (byteLengthOf(proof) !== AUTH_PROOF_BYTES) return;

    socket.to(roomId).emit('receive-auth-proof', {
      proof,
      theirSocketId: socket.id
    });
  });

  // 📡 WebRTC signaling relay (SDP/ICE only — no chat payloads)
  socket.on('webrtc-signal', ({ roomId, signal } = {}) => {
    const rid = roomId || socket.data.roomId;
    if (!rid || !signal || typeof signal !== 'object') return;

    const limited = rateLimit.allowHandshake(socket, rid);
    if (!limited.ok) return;

    socket.to(rid).emit('webrtc-signal', {
      signal,
      theirSocketId: socket.id
    });
  });

  // 🔐 MESSAGE RELAY
  socket.on('send-message', ({ roomId, encrypted, nonce } = {}) => {
    if (!roomId || !encrypted || !nonce) return;

    const limited = rateLimit.allowMessage(socket, roomId);
    if (!limited.ok) {
      socket.emit('rate-limit', { event: 'send-message' });
      return;
    }

    if (byteLengthOf(encrypted) > MAX_TEXT_BYTES) {
      socket.emit('rate-limit', { event: 'send-message', reason: 'too-large' });
      return;
    }

    socket.to(roomId).emit('receive-message', { encrypted, nonce });
  });

  // 🚪 LEAVE ROOM
  socket.on('leave-room', ({ roomId } = {}) => {
    devLog(`🚪 ${socket.id} manually left room ${roomId}`);

    // A manual leave is intentional, not a backgrounding drop — never hold the
    // seat for the B14 grace window.
    cancelPendingDisconnect(socket.id);

    const actualRoomId = roomId || socket.data.roomId;
    if (!actualRoomId) return;

    const removed = roomManager.removeUser(actualRoomId, socket.id);
    socket.leave(actualRoomId);
    socket.data.roomId = null;

    if (!removed) return;

    if (roomManager.getUsers(actualRoomId).length === 0) {
      // No users left, the room was already cleared by removeUser.
      devLog(`💣 No users left in room ${actualRoomId}`);
    } else {
      // Notify remaining users and destroy the room immediately.
      destroyRoom(actualRoomId, socket.id);
    }
  });

  // ❌ DISCONNECT
  socket.on('disconnect', (reason) => {
    devLog(`🔴 ${socket.id} disconnected due to: ${reason}`);

    const roomId = socket.data.roomId;
    if (!roomId) return;

    // B14 — hold the membership seat instead of leaving the room now. The app
    // may have been backgrounded (Android drops the WebView transport); only a
    // full grace window without a re-join counts as abandoning the room.
    cancelPendingDisconnect(socket.id);
    const timer = setTimeout(
      () => finalizeDisconnect(socket.id, roomId),
      DISCONNECT_GRACE_MS
    );
    if (typeof timer.unref === 'function') timer.unref();

    pendingDisconnects.set(socket.id, {
      roomId,
      participantId: socket.data.participantId,
      timer
    });

    devLog(
      `⏳ ${socket.id} held in room ${roomId} for ${DISCONNECT_GRACE_MS}ms reconnect grace`
    );
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  devLog(`🚀 Silencium server running at http://localhost:${PORT}`);
});
