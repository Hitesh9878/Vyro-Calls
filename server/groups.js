const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('./models/User');
const Contact = require('./models/Contact');
const { saveCall } = require('./services/callLog');
const { sendGroupInvite } = require('./services/mailer');

// Group calls are a "mesh": every participant keeps a direct WebRTC connection to every
// other participant. That works well for small groups; the server only relays signalling.
const MAX_PARTICIPANTS = Number(process.env.GROUP_MAX_PARTICIPANTS) || 6; // including the host
const INVITE_TIMEOUT_MS = Number(process.env.GROUP_INVITE_TIMEOUT_MS) || 60000;
const EMAIL_COOLDOWN_MS = Number(process.env.CALL_EMAIL_COOLDOWN_MS) || 60 * 1000;

// room: { id, host, hostName, callType, startedAt, members: Map(userId -> member) }
// member: { name, status: pending|joined|declined|missed|left, joinedAt, timer }
const rooms = new Map();
const userRoom = new Map(); // userId -> roomId of the room they are currently in
const lastInviteEmail = new Map();

const isBusy = (userId) => userRoom.has(userId);
const userTarget = (io, id) => io.to(`user:${id}`);
const appLink = () => (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');

const memberList = (room) =>
  [...room.members].map(([id, m]) => ({ id, name: m.name, status: m.status }));

function emitToJoined(io, room, event, payload, exceptId) {
  for (const [id, m] of room.members) {
    if (m.status === 'joined' && id !== exceptId) userTarget(io, id).emit(event, payload);
  }
}

function announce(io, room, userId) {
  const m = room.members.get(userId);
  emitToJoined(io, room, 'group:member', { roomId: room.id, userId, name: m.name, status: m.status }, userId);
}

const logRecord = (room, userId, extra = {}) => ({
  caller: room.host,
  callee: userId,
  callType: room.callType,
  startedAt: room.startedAt,
  answeredAt: null,
  isGroup: true,
  ...extra,
});

function expireInvite(io, room, userId) {
  const m = room.members.get(userId);
  if (!m || m.status !== 'pending') return;
  clearTimeout(m.timer);
  m.status = 'missed';
  userTarget(io, userId).emit('group:invite-ended', { roomId: room.id });
  announce(io, room, userId);
  saveCall(io, logRecord(room, userId), 'missed'); // also sends the missed-call email
}

function endRoom(io, room) {
  for (const userId of room.members.keys()) expireInvite(io, room, userId); // anyone who never joined
  rooms.delete(room.id);
}

function leave(io, userId) {
  const roomId = userRoom.get(userId);
  const room = rooms.get(roomId);
  userRoom.delete(userId);
  if (!room) return;

  const m = room.members.get(userId);
  if (!m) return;
  m.status = 'left';
  if (userId !== room.host && m.joinedAt) {
    saveCall(io, logRecord(room, userId, { startedAt: m.joinedAt, answeredAt: m.joinedAt }), 'completed');
  }
  announce(io, room, userId);

  const stillIn = [...room.members.values()].filter((x) => x.status === 'joined').length;
  if (stillIn === 0) endRoom(io, room);
}

async function emailInvite(host, invitee, callType) {
  try {
    const key = `${host.id}:${invitee.id}`;
    if (Date.now() - (lastInviteEmail.get(key) || 0) < EMAIL_COOLDOWN_MS) return;
    lastInviteEmail.set(key, Date.now());
    await sendGroupInvite({
      to: invitee.email,
      name: invitee.name,
      hostName: host.name,
      callType,
      link: appLink(),
    });
  } catch (err) {
    console.error('Group invite email failed:', err.message);
  }
}

// `isBusyOneToOne(userId)` tells us whether somebody is in a normal 1:1 call
function register(io, socket, { isBusyOneToOne }) {
  const me = socket.user;
  const err = (message) => socket.emit('group:error', { message });

  socket.on('group:create', async ({ invitees, callType } = {}) => {
    const type = callType === 'video' ? 'video' : 'audio';
    if (isBusy(me.id) || isBusyOneToOne(me.id)) return err('You are already in a call.');

    const ids = [...new Set((Array.isArray(invitees) ? invitees : []).map(String))].filter(
      (id) => id !== me.id && mongoose.isValidObjectId(id)
    );
    if (ids.length < 1) return err('Pick at least one contact.');
    if (ids.length > MAX_PARTICIPANTS - 1) return err(`A group call can have up to ${MAX_PARTICIPANTS} people.`);

    try {
      const [meDoc, others, links] = await Promise.all([
        User.findById(me.id).select('name email blocked'),
        User.find({ _id: { $in: ids } }).select('name email blocked'),
        Contact.find({
          $or: [
            { owner: me.id, contact: { $in: ids } },
            { owner: { $in: ids }, contact: me.id },
          ],
        }).select('owner contact'),
      ]);
      if (!meDoc) return;

      const linked = new Map(); // otherId -> how many of the two Contact rows exist
      links.forEach((l) => {
        const other = l.owner.toString() === me.id ? l.contact.toString() : l.owner.toString();
        linked.set(other, (linked.get(other) || 0) + 1);
      });
      const myBlocked = meDoc.blocked.map(String);

      const allowed = [];
      const skipped = [];
      others.forEach((u) => {
        const okay =
          linked.get(u.id) === 2 && !myBlocked.includes(u.id) && !u.blocked.map(String).includes(me.id);
        (okay ? allowed : skipped).push(u);
      });
      if (allowed.length < 1) return err('None of those people can be invited.');

      // Someone may have started another call while we were checking
      if (isBusy(me.id) || isBusyOneToOne(me.id)) return err('You are already in a call.');

      const room = {
        id: crypto.randomUUID(),
        host: me.id,
        hostName: meDoc.name,
        callType: type,
        startedAt: new Date(),
        members: new Map(),
      };
      room.members.set(me.id, { name: meDoc.name, status: 'joined', joinedAt: new Date() });
      rooms.set(room.id, room);
      userRoom.set(me.id, room.id);

      socket.emit('group:created', {
        roomId: room.id,
        callType: type,
        host: me.id,
        members: [], // filled in below, after the invitees are added
        skipped: skipped.map((u) => u.name),
      });

      allowed.forEach((u) => {
        const timer = setTimeout(() => expireInvite(io, room, u.id), INVITE_TIMEOUT_MS);
        room.members.set(u.id, { name: u.name, status: 'pending', timer });
        userTarget(io, u.id).emit('group:invite', {
          roomId: room.id,
          from: { id: me.id, name: meDoc.name },
          callType: type,
          size: allowed.length + 1,
        });
        emailInvite(meDoc, u, type); // online or offline, they get an email
      });

      socket.emit('group:members', { roomId: room.id, members: memberList(room) });
    } catch (e) {
      console.error('group:create failed:', e.message);
      err('Could not start the group call.');
    }
  });

  // The client is listening: hand over any invitations that arrived while it was offline
  socket.on('group:ready', () => {
    for (const room of rooms.values()) {
      const m = room.members.get(me.id);
      if (m && m.status === 'pending') {
        socket.emit('group:invite', {
          roomId: room.id,
          from: { id: room.host, name: room.hostName },
          callType: room.callType,
          size: room.members.size,
        });
      }
    }
  });

  socket.on('group:join', ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    const m = room && room.members.get(me.id);
    if (!room || !m || !['pending', 'left'].includes(m.status)) {
      socket.emit('group:invite-ended', { roomId });
      return err('This group call is no longer available.');
    }
    if (isBusy(me.id) || isBusyOneToOne(me.id)) return err('You are already in a call.');
    const inside = [...room.members.values()].filter((x) => x.status === 'joined').length;
    if (inside >= MAX_PARTICIPANTS) return err('This group call is full.');

    clearTimeout(m.timer);
    m.status = 'joined';
    m.joinedAt = new Date();
    userRoom.set(me.id, room.id);

    socket.to(`user:${me.id}`).emit('group:handled', { roomId }); // stop ringing in my other tabs
    socket.emit('group:joined', {
      roomId: room.id,
      callType: room.callType,
      host: room.host,
      members: memberList(room),
    });
    announce(io, room, me.id);
  });

  socket.on('group:decline', ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    const m = room && room.members.get(me.id);
    if (!m || m.status !== 'pending') return;
    clearTimeout(m.timer);
    m.status = 'declined';
    socket.to(`user:${me.id}`).emit('group:handled', { roomId });
    announce(io, room, me.id);
    saveCall(io, logRecord(room, me.id), 'declined');
  });

  // Relay WebRTC offers / answers / ICE candidates between two people in the same room
  socket.on('group:signal', ({ roomId, to, data } = {}) => {
    if (!data || userRoom.get(me.id) !== roomId || userRoom.get(to) !== roomId) return;
    userTarget(io, to).emit('group:signal', { roomId, from: me.id, data });
  });

  socket.on('group:leave', () => leave(io, me.id));
}

// Called when the user has no open sockets left
function onUserOffline(io, userId) {
  if (userRoom.has(userId)) leave(io, userId);
}

module.exports = { register, isBusy, onUserOffline };
