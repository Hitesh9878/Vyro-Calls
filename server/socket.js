const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const presence = require('./presence');
const User = require('./models/User');
const { sendIncomingCall } = require('./services/mailer');
const { saveCall } = require('./services/callLog');
const { checkCallAllowed } = require('./services/relations');
const groups = require('./groups');

// How long a call may ring before it is treated as missed. An offline person needs
// longer: they have to read the email, open the app and sign in.
const RING_TIMEOUT_MS = Number(process.env.RING_TIMEOUT_MS) || 30000;
const OFFLINE_RING_TIMEOUT_MS = Number(process.env.OFFLINE_RING_TIMEOUT_MS) || 60000;

// "callerId:calleeId" -> time of the last "you are being called" email (stops email spam)
const lastCallEmail = new Map();
const CALL_EMAIL_COOLDOWN_MS = Number(process.env.CALL_EMAIL_COOLDOWN_MS) || 60 * 1000;

// userId -> peerId while a call is ringing or connected (used for "busy")
const activeCalls = new Map();
// userId -> call record, the same object for both people in the call.
// { caller, callerInfo, callee, callType, offer, startedAt, answeredAt, delivered, pendingIce, timer }
const records = new Map();

const isBusy = (userId) => activeCalls.has(userId) || groups.isBusy(userId);

function setupSocket(io) {
  // Authenticate every socket with the same JWT used by the REST API
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('Missing token'));
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.user;
    socket.join(`user:${me.id}`);
    presence.add(me.id, socket.id);

    // Tell this client who is online, and everyone else that I'm online
    socket.emit('presence:list', presence.onlineIds());
    socket.broadcast.emit('presence:update', { userId: me.id, online: true });

    const to = (userId) => io.to(`user:${userId}`);

    groups.register(io, socket, { isBusyOneToOne: (id) => activeCalls.has(id) });

    // ---- Call signalling -------------------------------------------------
    socket.on('call:invite', async ({ to: calleeId, offer, callType } = {}) => {
      if (!calleeId || !offer || calleeId === me.id || !mongoose.isValidObjectId(calleeId)) return;
      const type = callType === 'video' ? 'video' : 'audio';

      if (isBusy(me.id)) return socket.emit('call:busy', { userId: calleeId, self: true });

      // Only accepted contacts can call each other, and never across a block
      const check = await checkCallAllowed(me.id, calleeId);
      if (!check.ok) return socket.emit('call:not-allowed', { userId: calleeId, reason: check.reason });

      // Re-check: something may have started while we were looking the people up
      if (isBusy(me.id)) return socket.emit('call:busy', { userId: calleeId, self: true });

      // Email the callee right away, whether they are online, offline or busy
      notifyCalleeByEmail(me, check.callee, type);

      if (isBusy(calleeId)) {
        saveCall(io, { caller: me.id, callee: calleeId, callType: type, startedAt: new Date(), answeredAt: null }, 'missed');
        return socket.emit('call:busy', { userId: calleeId });
      }

      const online = presence.isOnline(calleeId);
      const rec = {
        caller: me.id,
        callerInfo: { id: me.id, name: me.name, email: me.email },
        callee: calleeId,
        callType: type,
        offer,
        startedAt: new Date(),
        answeredAt: null,
        delivered: false,
        pendingIce: [],
        timer: null,
      };
      activeCalls.set(me.id, calleeId);
      activeCalls.set(calleeId, me.id);
      records.set(me.id, rec);
      records.set(calleeId, rec);

      // Nobody picked up in time: end the call for both sides
      rec.timer = setTimeout(() => onRingTimeout(io, rec), online ? RING_TIMEOUT_MS : OFFLINE_RING_TIMEOUT_MS);

      if (online) {
        deliver(io, rec);
      } else {
        // Offline: keep ringing. The callee gets the call if they open the app in time.
        socket.emit('call:offline-ringing', { userId: calleeId });
      }
    });

    // The callee's client is listening: hand over a call that came in while they were offline
    socket.on('call:ready', () => {
      const rec = records.get(me.id);
      if (rec && rec.callee === me.id && !rec.delivered && !rec.answeredAt) deliver(io, rec);
    });

    socket.on('call:answer', ({ to: callerId, answer }) => {
      const rec = records.get(me.id);
      // Only the callee can answer, and only once
      if (activeCalls.get(me.id) !== callerId || !rec || rec.callee !== me.id || rec.answeredAt) return;

      rec.answeredAt = new Date();
      clearTimeout(rec.timer);

      // Stop ringing on my other open tabs
      socket.to(`user:${me.id}`).emit('call:handled');
      to(callerId).emit('call:answered', { from: me.id, answer });
    });

    socket.on('call:ice', ({ to: peerId, candidate }) => {
      if (activeCalls.get(me.id) !== peerId) return;
      const rec = records.get(me.id);
      // The callee isn't connected yet: keep the caller's candidates until they are
      if (rec && rec.caller === me.id && !rec.delivered) {
        if (rec.pendingIce.length < 60) rec.pendingIce.push(candidate);
        return;
      }
      to(peerId).emit('call:ice', { from: me.id, candidate });
    });

    socket.on('call:reject', ({ to: callerId }) => {
      const rec = records.get(me.id);
      if (activeCalls.get(me.id) !== callerId || !rec || rec.callee !== me.id || rec.answeredAt) return;

      clearCall(me.id);
      socket.to(`user:${me.id}`).emit('call:handled');
      to(callerId).emit('call:rejected', { from: me.id });
      saveCall(io, rec, 'declined');
    });

    socket.on('call:end', ({ to: peerId }) => {
      if (activeCalls.get(me.id) !== peerId) return;

      const rec = clearCall(me.id);
      to(peerId).emit('call:ended', { from: me.id });
      // Hung up after it was answered = a normal call; before = the callee missed it
      if (rec) saveCall(io, rec, rec.answeredAt ? 'completed' : 'missed');
    });

    // Tells the other person that I started/stopped recording (consent notice)
    socket.on('call:recording', ({ to: peerId, recording }) => {
      if (activeCalls.get(me.id) !== peerId) return;
      to(peerId).emit('call:recording', { from: me.id, recording: !!recording });
    });

    socket.on('disconnect', () => {
      const wentOffline = presence.remove(me.id, socket.id);
      if (!wentOffline) return;

      groups.onUserOffline(io, me.id);

      const peerId = activeCalls.get(me.id);
      if (peerId) {
        const rec = clearCall(me.id);
        to(peerId).emit('call:ended', { from: me.id });
        if (rec) saveCall(io, rec, rec.answeredAt ? 'completed' : 'missed');
      }
      socket.broadcast.emit('presence:update', { userId: me.id, online: false });
    });
  });
}

// Ring the callee: send the offer and any ICE candidates the caller has produced so far
function deliver(io, rec) {
  rec.delivered = true;
  io.to(`user:${rec.callee}`).emit('call:incoming', {
    from: rec.callerInfo,
    offer: rec.offer,
    callType: rec.callType,
  });
  rec.pendingIce.forEach((candidate) => io.to(`user:${rec.callee}`).emit('call:ice', { from: rec.caller, candidate }));
  rec.pendingIce = [];
  io.to(`user:${rec.caller}`).emit('call:ringing', { userId: rec.callee });
}

// "X is calling you, please pick up" email. Fire-and-forget: a mail problem
// must never delay or break the call itself.
async function notifyCalleeByEmail(caller, callee, callType) {
  try {
    const key = `${caller.id}:${callee.id}`;
    if (Date.now() - (lastCallEmail.get(key) || 0) < CALL_EMAIL_COOLDOWN_MS) return;
    lastCallEmail.set(key, Date.now());

    const base = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
    await sendIncomingCall({
      to: callee.email,
      name: callee.name,
      callerName: caller.name,
      callType,
      link: base,
    });
  } catch (err) {
    console.error('Call notification email failed:', err.message);
  }
}

// Forget a call (both directions) and return its record
function clearCall(userId) {
  const peerId = activeCalls.get(userId);
  const rec = records.get(userId);
  activeCalls.delete(userId);
  records.delete(userId);
  if (peerId) {
    activeCalls.delete(peerId);
    records.delete(peerId);
  }
  if (rec) clearTimeout(rec.timer);
  return rec;
}

function onRingTimeout(io, rec) {
  // Ignore if the call was already answered / ended in the meantime
  if (records.get(rec.caller) !== rec || rec.answeredAt) return;

  clearCall(rec.caller);
  io.to(`user:${rec.caller}`).to(`user:${rec.callee}`).emit('call:timeout');
  saveCall(io, rec, 'missed');
}

module.exports = setupSocket;
