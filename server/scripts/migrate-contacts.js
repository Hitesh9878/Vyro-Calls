// One-off: contacts used to be one-way ("phone book"). Calls now need a mutual,
// accepted contact. This turns every legacy one-way contact into a pending request
// so the other person can accept it. Run once:  node scripts/migrate-contacts.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Contact = require('../models/Contact');
const ContactRequest = require('../models/ContactRequest');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const all = await Contact.find({});
  const key = (a, b) => `${a}:${b}`;
  const have = new Set(all.map((c) => key(c.owner, c.contact)));
  let converted = 0;

  for (const c of all) {
    if (have.has(key(c.contact, c.owner))) continue; // already mutual
    await ContactRequest.updateOne(
      { from: c.owner, to: c.contact },
      { $setOnInsert: { from: c.owner, to: c.contact } },
      { upsert: true }
    );
    await c.deleteOne();
    converted += 1;
  }
  console.log(`Converted ${converted} one-way contact(s) into pending requests.`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
