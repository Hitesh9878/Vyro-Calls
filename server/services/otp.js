const crypto = require('crypto');
const Otp = require('../models/Otp');

const OTP_TTL_MS = 10 * 60 * 1000; // a code is valid for 10 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // minimum gap between two emails
const MAX_ATTEMPTS = 5; // wrong guesses before the code is burned

const hash = (email, purpose, code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${email}:${purpose}:${code}`).digest('hex');

// Creates (or replaces) the code for this email + purpose.
// Returns { code } or { wait: seconds } when asked again too quickly.
async function issueOtp(email, purpose) {
  const existing = await Otp.findOne({ email, purpose });
  if (existing) {
    const wait = Math.ceil((existing.lastSentAt.getTime() + RESEND_COOLDOWN_MS - Date.now()) / 1000);
    if (wait > 0) return { wait };
  }

  const code = String(crypto.randomInt(100000, 1000000)); // always 6 digits
  await Otp.findOneAndUpdate(
    { email, purpose },
    {
      codeHash: hash(email, purpose, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      attempts: 0,
      lastSentAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { code };
}

// Returns true when the code is right. A correct code is single-use.
async function checkOtp(email, purpose, code) {
  const rec = await Otp.findOne({ email, purpose });
  if (!rec || rec.expiresAt < new Date()) return { ok: false, reason: 'expired' };

  if (rec.attempts >= MAX_ATTEMPTS) {
    await rec.deleteOne();
    return { ok: false, reason: 'locked' };
  }

  const given = Buffer.from(hash(email, purpose, String(code || '').trim()));
  const real = Buffer.from(rec.codeHash);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    rec.attempts += 1;
    await rec.save();
    return { ok: false, reason: 'wrong' };
  }

  await rec.deleteOne(); // single use
  return { ok: true };
}

module.exports = { issueOtp, checkOtp, OTP_TTL_MS };
