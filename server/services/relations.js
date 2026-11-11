const Contact = require('../models/Contact');
const User = require('../models/User');

const has = (list, id) => (list || []).some((x) => x.toString() === id);

// Can `callerId` ring `calleeId`? Both must be contacts of each other (the request was
// accepted) and neither may have blocked the other.
async function checkCallAllowed(callerId, calleeId) {
  const [users, links] = await Promise.all([
    User.find({ _id: { $in: [callerId, calleeId] } }).select('name email blocked'),
    Contact.countDocuments({
      $or: [
        { owner: callerId, contact: calleeId },
        { owner: calleeId, contact: callerId },
      ],
    }),
  ]);
  const caller = users.find((u) => u.id === callerId);
  const callee = users.find((u) => u.id === calleeId);
  if (!caller || !callee) return { ok: false, reason: 'not_found' };
  if (has(caller.blocked, calleeId)) return { ok: false, reason: 'blocked_by_me' };
  if (has(callee.blocked, callerId)) return { ok: false, reason: 'blocked' };
  if (links < 2) return { ok: false, reason: 'not_contacts' };
  return { ok: true, caller, callee };
}

module.exports = { checkCallAllowed, has };
