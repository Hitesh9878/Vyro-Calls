const express = require('express');
const Call = require('../models/Call');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Recent calls (newest first) plus how many missed calls haven't been looked at yet
router.get('/', async (req, res) => {
  try {
    const me = req.user.id;

    const [docs, user] = await Promise.all([
      Call.find({ $or: [{ caller: me }, { callee: me }] })
        .sort({ startedAt: -1 })
        .limit(50)
        .populate('caller callee', 'name email'),
      User.findById(me).select('lastCallsSeenAt'),
    ]);

    const since = user?.lastCallsSeenAt || new Date(0);
    const missedUnseen = await Call.countDocuments({
      callee: me,
      status: 'missed',
      createdAt: { $gt: since },
    });

    const calls = docs
      .filter((d) => d.caller && d.callee) // skip calls with deleted users
      .map((d) => {
        const outgoing = d.caller._id.toString() === me;
        const other = outgoing ? d.callee : d.caller;
        return {
          id: d._id.toString(),
          direction: outgoing ? 'outgoing' : 'incoming',
          status: d.status,
          callType: d.callType,
          duration: d.duration,
          isGroup: !!d.isGroup,
          startedAt: d.startedAt,
          peer: { id: other._id.toString(), name: other.name, email: other.email },
        };
      });

    res.json({ calls, missedUnseen });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load call history' });
  }
});

// The user has looked at their history: clear the missed-call badge
router.post('/seen', async (req, res) => {
  try {
    await User.updateOne({ _id: req.user.id }, { lastCallsSeenAt: new Date() });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not update' });
  }
});

module.exports = router;
