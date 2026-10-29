'use strict';

// Server-sent-events hub. One connection per browser tab, keyed by user id.
// Every realtime update in the app goes through here - no websockets.

const clients = new Map(); // userId -> Set<res>

function add(userId, res) {
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  set.add(res);
  return set.size === 1; // true when this user just came online
}

function remove(userId, res) {
  const set = clients.get(userId);
  if (!set) return false;
  set.delete(res);
  if (set.size === 0) {
    clients.delete(userId);
    return true; // user went offline
  }
  return false;
}

function isOnline(userId) {
  return clients.has(Number(userId));
}

function onlineIds() {
  return [...clients.keys()];
}

function write(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) {
    // client vanished mid-write; the close handler cleans up
  }
}

function sendTo(userIds, event, data) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  for (const id of ids) {
    const set = clients.get(Number(id));
    if (!set) continue;
    for (const res of set) write(res, event, data);
  }
}

function broadcast(event, data) {
  for (const set of clients.values()) {
    for (const res of set) write(res, event, data);
  }
}

module.exports = { add, remove, isOnline, onlineIds, sendTo, broadcast, write };
