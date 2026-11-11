const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Contact = require('../models/Contact');
const ContactRequest = require('../models/ContactRequest');
const presence = require('../presence');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many searches. Please slow down.' },
});

const pub = (u) => ({ id: u._id.toString(), name: u.name, email: u.email });
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const validId = (id) => mongoose.isValidObjectId(id);

// Tell connected clients to reload their contacts / requests / blocked lists
const refresh = (req, ...userIds) => {
  const io = req.app.get('io');
  if (io) userIds.forEach((id) => io.to(`user:${id}`).emit('contacts:updated'));
};

// Both directions, so a contact is always mutual
async function makeContacts(a, b) {
  await Promise.all(
    [
      [a, b],
      [b, a],
    ].map(([owner, contact]) =>
      Contact.updateOne({ owner, contact }, { $setOnInsert: { owner, contact } }, { upsert: true })
    )
  );
}

async function isBlockedEitherWay(meId, otherId) {
  const users = await User.find({ _id: { $in: [meId, otherId] } }).select('blocked');
  const me = users.find((u) => u.id === meId);
  const other = users.find((u) => u.id === otherId);
  return {
    byMe: !!me && me.blocked.some((x) => x.toString() === otherId),
    byThem: !!other && other.blocked.some((x) => x.toString() === meId),
  };
}

// ---- Contacts (accepted, mutual) -----------------------------------------
router.get('/', async (req, res) => {
  const docs = await Contact.find({ owner: req.user.id }).populate('contact', 'name email').sort({ createdAt: -1 });
  res.json({
    contacts: docs
      .filter((d) => d.contact)
      .map((d) => ({ id: d._id.toString(), user: pub(d.contact), online: presence.isOnline(d.contact._id.toString()) })),
  });
});

// ---- Search for people to send a request to ------------------------------
// Matches a name (contains) or an exact email. Hides yourself and anyone who blocked you.
router.get('/search', searchLimiter, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const me = req.user.id;

    const meDoc = await User.findById(me).select('blocked');
    const found = await User.find({
      _id: { $ne: me },
      blocked: { $ne: me },
      emailVerified: { $ne: false },
      $or: [{ email: q.toLowerCase() }, { name: new RegExp(escapeRegex(q), 'i') }],
    })
      .select('name email')
      .limit(10);

    const ids = found.map((u) => u._id);
    const [contacts, requests] = await Promise.all([
      Contact.find({ owner: me, contact: { $in: ids } }).select('contact'),
      ContactRequest.find({ $or: [{ from: me, to: { $in: ids } }, { to: me, from: { $in: ids } }] }),
    ]);
    const contactSet = new Set(contacts.map((c) => c.contact.toString()));
    const sent = new Set(requests.filter((r) => r.from.toString() === me).map((r) => r.to.toString()));
    const received = new Set(requests.filter((r) => r.to.toString() === me).map((r) => r.from.toString()));
    const blocked = new Set(meDoc.blocked.map(String));

    res.json({
      results: found.map((u) => ({
        ...pub(u),
        relation: blocked.has(u.id)
          ? 'blocked'
          : contactSet.has(u.id)
          ? 'contact'
          : sent.has(u.id)
          ? 'sent'
          : received.has(u.id)
          ? 'received'
          : 'none',
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Search failed' });
  }
});

// ---- Requests --------------------------------------------------------------
router.get('/requests', async (req, res) => {
  const me = req.user.id;
  const [incoming, outgoing] = await Promise.all([
    ContactRequest.find({ to: me }).populate('from', 'name email').sort({ createdAt: -1 }),
    ContactRequest.find({ from: me }).populate('to', 'name email').sort({ createdAt: -1 }),
  ]);
  res.json({
    incoming: incoming.filter((r) => r.from).map((r) => ({ id: r._id.toString(), user: pub(r.from), createdAt: r.createdAt })),
    outgoing: outgoing.filter((r) => r.to).map((r) => ({ id: r._id.toString(), user: pub(r.to), createdAt: r.createdAt })),
  });
});

// Send a request. Calls only become possible once the other person accepts.
router.post('/requests', async (req, res) => {
  try {
    const me = req.user.id;
    const { userId } = req.body;
    if (!validId(userId)) return res.status(400).json({ message: 'Pick a person to send the request to' });
    if (userId === me) return res.status(400).json({ message: "You can't add yourself" });

    const target = await User.findById(userId).select('name email');
    if (!target) return res.status(404).json({ message: 'User not found' });

    const blocked = await isBlockedEitherWay(me, userId);
    if (blocked.byMe) return res.status(400).json({ message: 'Unblock this person first' });
    // If they blocked me, pretend it went through so a block never reveals itself
    if (blocked.byThem) return res.status(201).json({ status: 'sent' });

    if (await Contact.exists({ owner: me, contact: userId })) {
      return res.status(409).json({ message: 'Already in your contacts' });
    }
    if (await ContactRequest.exists({ from: me, to: userId })) {
      return res.status(409).json({ message: 'Request already sent' });
    }

    // They already asked me: sending one back means "yes"
    const reverse = await ContactRequest.findOne({ from: userId, to: me });
    if (reverse) {
      await makeContacts(me, userId);
      await reverse.deleteOne();
      refresh(req, me, userId);
      return res.status(201).json({ status: 'accepted' });
    }

    await ContactRequest.create({ from: me, to: userId });
    refresh(req, me, userId);
    res.status(201).json({ status: 'sent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not send the request' });
  }
});

router.post('/requests/:id/accept', async (req, res) => {
  try {
    const me = req.user.id;
    if (!validId(req.params.id)) return res.status(404).json({ message: 'Request not found' });
    const reqDoc = await ContactRequest.findOne({ _id: req.params.id, to: me });
    if (!reqDoc) return res.status(404).json({ message: 'Request not found' });

    const from = reqDoc.from.toString();
    const blocked = await isBlockedEitherWay(me, from);
    if (blocked.byMe || blocked.byThem) {
      await reqDoc.deleteOne();
      refresh(req, me, from);
      return res.status(400).json({ message: 'This request is no longer valid' });
    }

    await makeContacts(me, from);
    await reqDoc.deleteOne();
    refresh(req, me, from);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not accept the request' });
  }
});

// Decline an incoming request (the sender isn't told) or cancel one I sent
router.post('/requests/:id/decline', async (req, res) => {
  if (!validId(req.params.id)) return res.json({ ok: true });
  const doc = await ContactRequest.findOneAndDelete({ _id: req.params.id, to: req.user.id });
  if (doc) refresh(req, req.user.id, doc.from.toString());
  res.json({ ok: true });
});

router.delete('/requests/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.json({ ok: true });
  const doc = await ContactRequest.findOneAndDelete({ _id: req.params.id, from: req.user.id });
  if (doc) refresh(req, req.user.id, doc.to.toString());
  res.json({ ok: true });
});

// ---- Blocking ------------------------------------------------------------
router.get('/blocked', async (req, res) => {
  const me = await User.findById(req.user.id).populate('blocked', 'name email');
  res.json({ blocked: (me?.blocked || []).filter(Boolean).map(pub) });
});

// Blocking also removes the contact and any pending requests, both ways
router.post('/blocked', async (req, res) => {
  try {
    const me = req.user.id;
    const { userId } = req.body;
    if (!validId(userId) || userId === me) return res.status(400).json({ message: 'Invalid user' });
    if (!(await User.exists({ _id: userId }))) return res.status(404).json({ message: 'User not found' });

    await User.updateOne({ _id: me }, { $addToSet: { blocked: userId } });
    await Promise.all([
      Contact.deleteMany({ $or: [{ owner: me, contact: userId }, { owner: userId, contact: me }] }),
      ContactRequest.deleteMany({ $or: [{ from: me, to: userId }, { from: userId, to: me }] }),
    ]);
    refresh(req, me, userId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not block this person' });
  }
});

// Unblocking does not bring the contact back: they need to send a new request
router.delete('/blocked/:userId', async (req, res) => {
  if (!validId(req.params.userId)) return res.json({ ok: true });
  await User.updateOne({ _id: req.user.id }, { $pull: { blocked: req.params.userId } });
  refresh(req, req.user.id);
  res.json({ ok: true });
});

// ---- Remove a contact (removes it for both people) -----------------------
router.delete('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.json({ ok: true });
  const doc = await Contact.findOne({ _id: req.params.id, owner: req.user.id });
  if (doc) {
    const other = doc.contact.toString();
    await Contact.deleteMany({
      $or: [
        { owner: req.user.id, contact: other },
        { owner: other, contact: req.user.id },
      ],
    });
    refresh(req, req.user.id, other);
  }
  res.json({ ok: true });
});

module.exports = router;
