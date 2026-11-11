// Tracks which users currently have at least one open socket.
const sockets = new Map(); // userId -> Set<socketId>

function add(userId, socketId) {
  if (!sockets.has(userId)) sockets.set(userId, new Set());
  sockets.get(userId).add(socketId);
}

// Returns true when the user has no sockets left (went offline).
function remove(userId, socketId) {
  const set = sockets.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    sockets.delete(userId);
    return true;
  }
  return false;
}

function isOnline(userId) {
  return sockets.has(userId);
}

function onlineIds() {
  return [...sockets.keys()];
}

module.exports = { add, remove, isOnline, onlineIds };
