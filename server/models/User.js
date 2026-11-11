const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, minlength: 6 },

    // Accounts can't sign in until the 6-digit emailed code has been entered
    // (no default: accounts created before OTP existed have no value and may still sign in)
    emailVerified: { type: Boolean },

    // People I have blocked: they can't call me, invite me or send me requests
    blocked: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Missed calls newer than this are "unseen" (drives the badge)
    lastCallsSeenAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.methods.toPublic = function () {
  return { id: this._id.toString(), name: this.name, email: this.email };
};

module.exports = mongoose.model('User', userSchema);
