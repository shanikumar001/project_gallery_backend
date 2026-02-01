import express from 'express';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';
import { sendOtpEmail } from '../services/email.js';

const router = express.Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

export function initPassport() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn('Google OAuth not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET). Sign in with Google disabled.');
    return;
  }
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/auth/google/callback`,
        scope: ['profile', 'email'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase().trim();
          const name = profile.displayName?.trim() || profile.name?.givenName || 'User';
          const photo = profile.photos?.[0]?.value;
          let user = await User.findOne({ googleId: profile.id });
          if (user) {
            return done(null, user);
          }
          user = await User.findOne({ email });
          if (user) {
            user.googleId = profile.id;
            if (photo) user.profilePhoto = photo;
            await user.save();
            return done(null, user);
          }
          const baseUsername = (email ? email.split('@')[0] : name.replace(/\s+/g, '_')).toLowerCase().replace(/[^a-z0-9_.]/g, '');
          let username = baseUsername.slice(0, 20) || 'user';
          let exists = await User.findOne({ username });
          let suffix = 0;
          while (exists) {
            suffix += 1;
            username = `${baseUsername.slice(0, 15)}${suffix}`;
            exists = await User.findOne({ username });
          }
          user = await User.create({
            name,
            username,
            email: email || `${profile.id}@google.placeholder`,
            googleId: profile.id,
            emailVerified: !!email,
            profilePhoto: photo || null,
          });
          return done(null, user);
        } catch (err) {
          return done(err, null);
        }
      }
    )
  );
}

// In-memory OTP store: { email: { otp, expiresAt } }
const otpStore = new Map();
const OTP_EXPIRY_MS = 10 * 60 * 1000;

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Send OTP for signup verification
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const normalized = email?.toLowerCase().trim();
    if (!normalized) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const otp = generateOtp();
    otpStore.set(normalized, { otp, expiresAt: Date.now() + OTP_EXPIRY_MS });

    const result = await sendOtpEmail({ toEmail: normalized, otp });
    if (!result.sent) {
      return res.status(503).json({ error: result.reason || 'Failed to send OTP email' });
    }

    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: err.message || 'Failed to send OTP' });
  }
});

router.post('/signup', async (req, res) => {
  try {
    const { name, username, email, password, otp } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username is required' });
    }
    const usernameNorm = username.trim().toLowerCase();
    if (usernameNorm.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    if (!/^[a-z0-9_.]+$/.test(usernameNorm)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, dots and underscores' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!otp || String(otp).length !== 6) {
      return res.status(400).json({ error: 'Valid 6-digit OTP is required' });
    }

    const emailNorm = email.toLowerCase().trim();
    const stored = otpStore.get(emailNorm);
    if (!stored) {
      return res.status(400).json({ error: 'OTP expired or not sent. Please request a new OTP.' });
    }
    if (Date.now() > stored.expiresAt) {
      otpStore.delete(emailNorm);
      return res.status(400).json({ error: 'OTP expired. Please request a new OTP.' });
    }
    if (stored.otp !== String(otp).trim()) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }
    otpStore.delete(emailNorm);

    const existingEmail = await User.findOne({ email: emailNorm });
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    const existingUsername = await User.findOne({ username: usernameNorm });
    if (existingUsername) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const user = await User.create({
      name: name.trim(),
      username: usernameNorm,
      email: emailNorm,
      password,
      emailVerified: true,
    });

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        username: user.username,
        email: user.email,
        profilePhoto: user.profilePhoto,
      },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: err.message || 'Signup failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;

    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: 'Email/username and password are required' });
    }

    const input = emailOrUsername.trim().toLowerCase();
    const isEmail = input.includes('@');
    const user = isEmail
      ? await User.findOne({ email: input })
      : await User.findOne({ username: input });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email/username or password' });
    }

    if (!user.password) {
      return res.status(401).json({ error: 'This account uses Google sign-in. Please sign in with Google.' });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email/username or password' });
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        username: user.username || (user.email && user.email.split('@')[0]) || '',
        email: user.email,
        profilePhoto: user.profilePhoto,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

// Google OAuth - redirect to Google
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google sign-in is not configured' });
  }
  passport.authenticate('google', { session: false })(req, res, next);
});

// Google OAuth callback - issue JWT and redirect to frontend
router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err) {
      return res.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent(err.message || 'Google sign-in failed')}`);
    }
    if (!user) {
      return res.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent('Google sign-in failed')}`);
    }
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    const userPayload = encodeURIComponent(
      JSON.stringify({
        id: user._id.toString(),
        name: user.name,
        username: user.username,
        email: user.email,
        profilePhoto: user.profilePhoto,
      })
    );
    res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}&user=${userPayload}`);
  })(req, res, next);
});

export default router;
