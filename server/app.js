const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const cors = require('cors');
const roomManager = require('./rooms/roomManager');

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

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: MAX_SOCKET_FRAME_BYTES
});


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

io.on('connection', (socket) => {
  devLog('🟢 New client connected:', socket.id);

  // 🏠 JOIN ROOM
  socket.on('join-room', ({ roomId }) => {
    if (!roomId || typeof roomId !== 'string') {
      socket.emit('join-error', 'Invalid room ID');
      return;
    }

    // If this socket is already in a different room, leave it first.
    // roomManager owns the rooms map, so route this through it (B9 fix:
    // app.js must never touch `rooms` directly).
    if (socket.data.roomId && socket.data.roomId !== roomId) {
      const prevRoomId = roomManager.leaveRoom(socket.id);
      if (prevRoomId) {
        socket.leave(prevRoomId);
        if (roomManager.getUsers(prevRoomId).length > 0) {
          io.to(prevRoomId).emit('room-destroyed', {
            message: 'A user left the room. Room has been destroyed.',
            leftUserId: socket.id
          });
          io.in(prevRoomId).socketsLeave(prevRoomId);
        }
        roomManager.deleteRoom(prevRoomId);
      }
    }

    const result = roomManager.joinRoom(roomId, socket.id);

    if (result.error) {
      socket.emit('join-error', result.error);
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    devLog(`🧑 ${socket.id} joined room ${roomId}`);
    devLog(`👥 Users in room ${roomId}:`, result.users);

    const msg = result.users.length === 1
      ? `🟢 ${socket.id} created the room`
      : `✅ ${socket.id} joined the room`;

    setTimeout(() => {
      io.to(roomId).emit('system-message', msg);
    }, 100);
  });

  // 🔐 ENCRYPTED IMAGE MESSAGE HANDLER
  socket.on('send-encrypted-image', (data) => {
    const roomId = data.roomId || socket.data.roomId;
    if (!roomId || !data.encrypted || !data.nonce) {
      console.warn(`❌ Invalid encrypted image data from ${socket.id}`);
      socket.emit('image-error', 'Image could not be sent. Please try again.');
      return;
    }

    // Binary frames arrive as Buffer/Uint8Array/ArrayBuffer; tolerate the legacy
    // number-array form too. `.byteLength` covers binary, `.length` the array.
    const byteLength = data.encrypted.byteLength ?? data.encrypted.length;
    if (byteLength > MAX_IMAGE_BYTES) {
      console.warn(`❌ Blocked oversized encrypted image from ${socket.id}: ${byteLength} bytes`);
      socket.emit('image-error', 'Image is too large to send. Please use a smaller image.');
      return;
    }

    try {
      devLog(`📤 Processing encrypted image from ${socket.id} in room ${roomId}`);
      devLog(`📊 Image size: ${byteLength} bytes`);

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
  socket.on('send-public-key', ({ roomId, publicKey }) => {
    if (!roomId || !publicKey) return;
    socket.to(roomId).emit('receive-public-key', {
      publicKey,
      theirSocketId: socket.id
    });
  });

  // 🔐 MESSAGE RELAY
  socket.on('send-message', ({ roomId, encrypted, nonce }) => {
    if (!roomId || !encrypted || !nonce) return;
    socket.to(roomId).emit('receive-message', { encrypted, nonce });
  });

  // 🚪 LEAVE ROOM
  socket.on('leave-room', ({ roomId }) => {
    devLog(`🚪 ${socket.id} manually left room ${roomId}`);
    
    // Remove user from room
    const actualRoomId = roomId || socket.data.roomId;
    if (actualRoomId) {
      const users = roomManager.getUsers(actualRoomId);
      const userIndex = users.indexOf(socket.id);
      if (userIndex !== -1) {
        users.splice(userIndex, 1);
        
        if (users.length === 0) {
          // No users left, delete the room
          roomManager.deleteRoom(actualRoomId);
        } else {
          // Notify remaining users and destroy the room
          devLog(`💥 Room ${actualRoomId} destroyed because user ${socket.id} left`);
          io.to(actualRoomId).emit('room-destroyed', {
            message: 'A user left the room. Room has been destroyed.',
            leftUserId: socket.id
          });
          // Remove all users from the room
          io.in(actualRoomId).socketsLeave(actualRoomId);
          // Clear the room
          roomManager.deleteRoom(actualRoomId);
        }
      }
    }
  });

  // ❌ DISCONNECT
  socket.on('disconnect', (reason) => {
  devLog(`🔴 ${socket.id} disconnected due to: ${reason}`);

  // Add a grace period for reconnection (5 seconds)
  setTimeout(() => {
    const roomId = roomManager.leaveRoom(socket.id);
    if (roomId) {
      const msg = `❌ ${socket.id} left the room`;
      io.to(roomId).emit('system-message', msg);

      const users = roomManager.getUsers(roomId);

      if (users.length === 0) {
        devLog(`💣 No users left in room ${roomId}`);
      } else {
        // Notify remaining users that someone left and destroy the room
        devLog(`💥 Room ${roomId} destroyed because user ${socket.id} left`);
        io.to(roomId).emit('room-destroyed', {
          message: 'A user left the room. Room has been destroyed.',
          leftUserId: socket.id
        });
        // Remove all users from the room
        io.in(roomId).socketsLeave(roomId);
        // Clear the room
        roomManager.deleteRoom(roomId);
      }

      devLog(`🔴 ${socket.id} left room ${roomId}`);
    }
  }, 5000); // 5 second grace period
});
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  devLog(`🚀 Silencium server running at http://localhost:${PORT}`);
});