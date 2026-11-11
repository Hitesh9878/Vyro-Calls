const express = require('express');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Otp = require('../models/Otp');
const { signToken, requireAuth } = require('../middleware/auth');
const { sendOtp } = require('../services/mailer');
const { issueOtp, checkOtp } = require('../services/otp');

const router = express.Router();

// Limits email-bombing and code guessing. (Behind a reverse proxy, set
// app.set('trust proxy', 1) in index.js so this sees the real client IP.)
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in a few minutes.' },
});

const normEmail = (v) => String(v || '').toLowerCase().trim();
const isCode = (v) => /^\d{6}$/.test(String(v || '').trim());

const OTP_ERRORS = {
  expired: 'This code has expired. Please request a new one.',
  locked: 'Too many wrong attempts. Please request a new code.',
  wrong: 'That code is not correct.',
};

// Creates a code and emails it. Returns an error message, or null when sent.
async function emailOtp(user, purpose) {
  const issued = await issueOtp(user.email, purpose);
  if (issued.wait) return { status: 429, message: `Please wait ${issued.wait}s before requesting another code.` };
  try {
    await sendOtp({ to: user.email, name: user.name, code: issued.code, purpose });
  } catch (err) {
    console.error('OTP email failed:', err.message);
    await Otp.deleteOne({ email: user.email, purpose }); // let them retry straight away
    return { status: 502, message: 'We could not send the email. Please try again shortly.' };
  }
  return null;
}

// ---- Sign up: step 1 – create the (unverified) account and email a code ----
router.post('/register', otpLimiter, async (req, res) => {
  try {
    const { name, password } = req.body;
    const email = normEmail(req.body.email);
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    let user = await User.findOne({ email });
    if (user && user.emailVerified !== false) {
      return res.status(409).json({ message: 'Email is already registered' });
    }

    if (user) {
      // Never finished verifying: let them start over with the details they typed now
      user.name = name;
      user.password = password;
      await user.save();
    } else {
      user = await User.create({ name, email, password, emailVerified: false });
    }

    const failed = await emailOtp(user, 'register');
    if (failed && failed.status !== 429) return res.status(failed.status).json({ message: failed.message });

    res.status(201).json({ email: user.email, message: 'We sent a 6-digit code to your email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Registration failed' });
  }
});

// ---- Sign up: step 2 – enter the code, account becomes active, user is signed in ----
router.post('/verify-email', otpLimiter, async (req, res) => {
  try {
    const email = normEmail(req.body.email);
    if (!email || !isCode(req.body.otp)) {
      return res.status(400).json({ message: 'Enter the 6-digit code from your email' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: OTP_ERRORS.expired });

    const result = await checkOtp(email, 'register', req.body.otp);
    if (!result.ok) return res.status(400).json({ message: OTP_ERRORS[result.reason] });

    user.emailVerified = true;
    await user.save();
    res.json({ token: signToken(user), user: user.toPublic() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not verify your email' });
  }
});

// Ask for a fresh sign-up code
router.post('/resend-otp', otpLimiter, async (req, res) => {
  try {
    const email = normEmail(req.body.email);
    const purpose = req.body.purpose === 'reset' ? 'reset' : 'register';
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email });
    // Same answer whether or not the account exists
    const eligible = user && (purpose === 'reset' || user.emailVerified === false);
    if (eligible) {
      const failed = await emailOtp(user, purpose);
      if (failed) return res.status(failed.status).json({ message: failed.message });
    }
    res.json({ message: 'If that email is eligible, a new code is on its way.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not resend the code' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { password } = req.body;
    const email = normEmail(req.body.email);
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (user.emailVerified === false) {
      // Right password but never verified: send a fresh code and route them to the code screen
      await emailOtp(user, 'register');
      return res.status(403).json({
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
        message: 'Please verify your email. We sent you a new 6-digit code.',
      });
    }

    res.json({ token: signToken(user), user: user.toPublic() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Login failed' });
  }
});

// ---- Forgot password: step 1 – email a 6-digit code ----
// Always answers the same way so it can't be used to discover which emails exist.
router.post('/forgot-password', otpLimiter, async (req, res) => {
  const email = normEmail(req.body.email);
  if (!email) return res.status(400).json({ message: 'Email is required' });

  try {
    const user = await User.findOne({ email });
    if (user) {
      const failed = await emailOtp(user, 'reset');
      if (failed && failed.status === 502) return res.status(502).json({ message: failed.message });
    }
    res.json({ message: 'If an account exists for that email, a 6-digit code is on its way.' });
  } catch (err) {
    console.error('forgot-password failed:', err.message);
    res.status(500).json({ message: 'Could not send the code' });
  }
});

// ---- Forgot password: step 2 – verify the code and set the new password ----
router.post('/reset-password', otpLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const email = normEmail(req.body.email);
    if (!email || !password || !isCode(req.body.otp)) {
      return res.status(400).json({ message: 'Email, 6-digit code and new password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: OTP_ERRORS.expired });

    const result = await checkOtp(email, 'reset', req.body.otp);
    if (!result.ok) return res.status(400).json({ message: OTP_ERRORS[result.reason] });

    user.password = password; // hashed by the pre-save hook
    user.emailVerified = true; // they just proved they own the inbox
    await user.save();

    res.json({ message: 'Password updated. You can now sign in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not reset password' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user: user.toPublic() });
});

module.exports = router;
