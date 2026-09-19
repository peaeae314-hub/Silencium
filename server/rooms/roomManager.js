const rooms = {};

function joinRoom(roomId, socketId) {
  if (!rooms[roomId]) rooms[roomId] = [];

  // Idempotent: a repeated `join-room` from the same socket (e.g. the client's
  // connect handler plus an explicit re-join on resume) must not consume the
  // second seat with a duplicate id.
  if (rooms[roomId].includes(socketId)) {
    return { users: rooms[roomId] };
  }

  if (rooms[roomId].length >= 2) {
    return { error: 'Room is full' };
  }

  rooms[roomId].push(socketId);
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
  removeUser
};
