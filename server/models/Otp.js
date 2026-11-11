const mongoose = require('mongoose');

// One active code per (email, purpose). Only an HMAC of the 6-digit code is stored.
//   register – verifying the email when an account is created
//   reset    – authorising a password change
const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  purpose: { type: String, enum: ['register', 'reset'], required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, default: Date.now },
});

otpSchema.index({ email: 1, purpose: 1 }, { unique: true });
// MongoDB removes expired codes automatically
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Otp', otpSchema);
