// Room-id format — duplicated from the client shared module
// `client/src/utils/roomId.js` (ROOM_ID_PATTERN / isValidRoomId). The relay is
// CommonJS and cannot import that ESM file, so KEEP THE TWO IN SYNC. A room id
// is a join capability, so reject anything that is not 4–64 URL-safe chars.
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

const rooms = {};

/** True when `roomId` is exactly the accepted 4–64 char URL-safe format. */
function isValidRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_ID_PATTERN.test(roomId);
}

/** True when `roomId` is present and still has at least one held seat. */
function roomExists(roomId) {
  return (
    Object.prototype.hasOwnProperty.call(rooms, roomId) &&
    rooms[roomId].length > 0
  );
}

/**
 * Join (or create) a room.
 *
 * `options.intent === 'create'` is a create request from the client: if the
 * room already holds a member other than this socket — including a seat held
 * by the B14 reconnect grace — it is refused with `ROOM_OCCUPIED` and the room
 * is left untouched. Any other intent (or none) keeps the original
 * auto-create/join behaviour.
 *
 * @returns {{ users: string[] } | { error: string, code?: string }}
 */
function joinRoom(roomId, socketId, options = {}) {
  const intent = options.intent;
  const existing = rooms[roomId];

  if (existing) {
    // Idempotent: a repeated join, or a duplicate intent:'create' from the same
    // socket (the client's connect handler racing its first setup), must not
    // consume a second seat or look "occupied".
    if (existing.includes(socketId)) {
      return { users: existing };
    }

    if (intent === 'create') {
      return { error: 'Room ID is already taken', code: 'ROOM_OCCUPIED' };
    }

    if (existing.length >= 2) {
      return { error: 'Room is full', code: 'ROOM_FULL' };
    }

    existing.push(socketId);
    return { users: existing };
  }

  rooms[roomId] = [socketId];
  return { users: rooms[roomId] };
}

function leaveRoom(socketId) {
  for (const [roomId, users] of Object.entries(rooms)) {
    const index = users.indexOf(socketId);
    if (index !== -1) {
      users.splice(index, 1);
      if (users.length === 0) delete rooms[roomId];
      return roomId;
    }
  }
  return null;
}

// ✅ ADD THIS:
function getUsers(roomId) {
  return rooms[roomId] || [];
}

function deleteRoom(roomId) {
  if (rooms[roomId]) {
    delete rooms[roomId];
    return true;
  }
  return false;
}

// B14 — reclaim a held seat when a participant reconnects. This only swaps the
// stale socket id for the new one; it never creates or deletes a room, so the
// reconnect grace path cannot change room capacity or leak a seat.
function replaceUser(roomId, oldSocketId, newSocketId) {
  const users = rooms[roomId];
  if (!users) return false;

  const index = users.indexOf(oldSocketId);
  if (index === -1) return false;

  if (oldSocketId === newSocketId) return true;

  if (users.includes(newSocketId)) {
    // The new socket is already a member; just drop the stale duplicate.
    users.splice(index, 1);
    return true;
  }

  users[index] = newSocketId;
  return true;
}

// Remove one socket from a room without touching the other members. Unlike
// `leaveRoom` (which searches every room by socket id and returns the room it
// found), this is scoped to a known room so the manual-leave path can keep its
// "destroy immediately" semantics without scanning the whole map.
function removeUser(roomId, socketId) {
  const users = rooms[roomId];
  if (!users) return false;

  const index = users.indexOf(socketId);
  if (index === -1) return false;

  users.splice(index, 1);
  if (users.length === 0) delete rooms[roomId];
  return true;
}

module.exports = {
  joinRoom,
  leaveRoom,
  getUsers,  // ✅ export it here
  deleteRoom,
  replaceUser,
  removeUser,
  isValidRoomId,
  roomExists,
};
