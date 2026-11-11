const Call = require('../models/Call');
const User = require('../models/User');
const { sendMissedCall } = require('./mailer');

const EMAIL_COOLDOWN_MS = Number(process.env.CALL_EMAIL_COOLDOWN_MS) || 60 * 1000;
const lastMissedEmail = new Map(); // "caller:callee" -> time of last missed-call email

const appLink = () => (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');

// "You missed a call from X" email. Fire-and-forget; a mail problem never affects calling.
async function notifyMissedByEmail(rec, when) {
  try {
    const key = `${rec.caller}:${rec.callee}`;
    if (Date.now() - (lastMissedEmail.get(key) || 0) < EMAIL_COOLDOWN_MS) return;
    lastMissedEmail.set(key, Date.now());

    const users = await User.find({ _id: { $in: [rec.caller, rec.callee] } }).select('name email');
    const caller = users.find((u) => u.id === String(rec.caller));
    const callee = users.find((u) => u.id === String(rec.callee));
    if (!caller || !callee) return;

    await sendMissedCall({
      to: callee.email,
      name: callee.name,
      callerName: caller.name,
      callType: rec.callType,
      isGroup: !!rec.isGroup,
      at: when,
      link: appLink(),
    });
  } catch (err) {
    console.error('Missed-call email failed:', err.message);
  }
}

// Persist a finished call, tell both people to refresh their history and, when the
// callee missed it, email them.
async function saveCall(io, rec, status) {
  const endedAt = new Date();
  const duration =
    status === 'completed' && rec.answeredAt
      ? Math.max(0, Math.round((endedAt - rec.answeredAt) / 1000))
      : 0;

  try {
    await Call.create({
      caller: rec.caller,
      callee: rec.callee,
      callType: rec.callType,
      status,
      startedAt: rec.startedAt,
      answeredAt: rec.answeredAt || undefined,
      endedAt,
      duration,
      isGroup: !!rec.isGroup,
    });
  } catch (err) {
    console.error('Could not save call record:', err.message);
  }
  io.to(`user:${rec.caller}`).to(`user:${rec.callee}`).emit('calls:updated');

  if (status === 'missed') notifyMissedByEmail(rec, rec.startedAt);
}

module.exports = { saveCall };
