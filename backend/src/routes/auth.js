const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { query } = require('../db/config');
const { generateToken, generateRefreshToken, validateRefreshToken, revokeRefreshToken, authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const notifyre = require('../services/notifyre');

const router = express.Router();

// Rate limiting for authentication endpoints to prevent brute force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 5 : 100, // Strict in prod, lenient in dev
  message: { error: { message: 'Too many attempts. Please try again in 15 minutes.' } },
  standardHeaders: true,
  legacyHeaders: false
});

// Stricter rate limit for password reset (OTP) to prevent SMS abuse
const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: process.env.NODE_ENV === 'production' ? 3 : 100, // 3 OTP requests per hour in prod
  message: { error: { message: 'Too many password reset requests. Please try again in an hour.' } },
  standardHeaders: true,
  legacyHeaders: false
});

// Generate 6-digit OTP
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// POST /api/auth/register
router.post('/register', authLimiter, validate(schemas.register), async (req, res) => {
  try {
    const { email, password, practiceName, phone, timezone } = req.body;

    // Check if user exists
    const existingUser = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: { message: 'An account with this email already exists' }
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const result = await query(
      `INSERT INTO users (email, password_hash, practice_name, phone, timezone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, practice_name, phone, timezone, created_at`,
      [email.toLowerCase(), passwordHash, practiceName, phone || null, timezone || 'Australia/Sydney']
    );

    const user = result.rows[0];

    // Create default settings for the user
    await query(
      'INSERT INTO settings (user_id) VALUES ($1)',
      [user.id]
    );

    // Generate tokens
    const accessToken = generateToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);

    res.status(201).json({
      message: 'Account created successfully',
      user: {
        id: user.id,
        email: user.email,
        practiceName: user.practice_name,
        phone: user.phone,
        timezone: user.timezone,
        isAdmin: false,
        createdAt: user.created_at
      },
      token: accessToken,
      refreshToken: refreshToken.token,
      expiresIn: 900 // 15 minutes in seconds
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: { message: 'Failed to create account' } });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, validate(schemas.login), async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const result = await query(
      'SELECT id, email, password_hash, practice_name, phone, timezone, is_admin, created_at FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: { message: 'Invalid email or password' }
      });
    }

    const user = result.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        error: { message: 'Invalid email or password' }
      });
    }

    // Generate tokens
    const accessToken = generateToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        practiceName: user.practice_name,
        phone: user.phone,
        timezone: user.timezone,
        isAdmin: user.is_admin || false,
        createdAt: user.created_at
      },
      token: accessToken,
      refreshToken: refreshToken.token,
      expiresIn: 900 // 15 minutes in seconds
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: { message: 'Login failed' } });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        practiceName: req.user.practice_name,
        phone: req.user.phone,
        timezone: req.user.timezone,
        isAdmin: req.user.is_admin || false,
        createdAt: req.user.created_at
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: { message: 'Failed to get user info' } });
  }
});

// PUT /api/auth/profile
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { practiceName, phone, timezone } = req.body;
    const userId = req.user.id;

    const result = await query(
      `UPDATE users
       SET practice_name = COALESCE($1, practice_name),
           phone = COALESCE($2, phone),
           timezone = COALESCE($3, timezone)
       WHERE id = $4
       RETURNING id, email, practice_name, phone, timezone, created_at`,
      [practiceName, phone, timezone, userId]
    );

    const user = result.rows[0];

    res.json({
      user: {
        id: user.id,
        email: user.email,
        practiceName: user.practice_name,
        phone: user.phone,
        timezone: user.timezone,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: { message: 'Failed to update profile' } });
  }
});

// PUT /api/auth/password
router.put('/password', authenticate, validate(schemas.updatePassword), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Get current password hash
    const userResult = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        error: { message: 'Current password is incorrect' }
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ error: { message: 'Failed to update password' } });
  }
});

// POST /api/auth/forgot-password - Request OTP for password reset
router.post('/forgot-password', otpLimiter, validate(schemas.forgotPassword), async (req, res) => {
  try {
    const { phone } = req.body;

    // Clean phone number (remove non-digits)
    const cleanPhone = phone.replace(/\D/g, '');

    // Find user by phone
    const userResult = await query(
      'SELECT id, phone, practice_name FROM users WHERE phone = $1',
      [cleanPhone]
    );

    // Don't reveal if user exists or not for security
    if (userResult.rows.length === 0) {
      // Still return success to prevent phone enumeration
      return res.json({
        message: 'If an account exists with this phone number, a verification code has been sent'
      });
    }

    const user = userResult.rows[0];

    // Delete any existing OTPs for this phone
    await query('DELETE FROM otp_codes WHERE phone = $1', [cleanPhone]);

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP
    await query(
      `INSERT INTO otp_codes (phone, code, expires_at)
       VALUES ($1, $2, $3)`,
      [cleanPhone, otp, expiresAt]
    );

    // Send OTP via Notifyre
    const notifyreAccountId = process.env.NOTIFYRE_ACCOUNT_ID;
    const notifyreApiToken = process.env.NOTIFYRE_API_TOKEN;

    // Get user's SMS reply number from settings
    const settingsResult = await query(
      'SELECT sms_reply_number FROM settings WHERE user_id = $1',
      [user.id]
    );
    const notifyreFromNumber = settingsResult.rows[0]?.sms_reply_number;

    if (notifyreAccountId && notifyreApiToken && notifyreFromNumber) {
      try {
        const formattedPhone = notifyre.normalizePhoneNumber(cleanPhone);
        const result = await notifyre.sendSMS(
          notifyreAccountId,
          notifyreApiToken,
          formattedPhone,
          `Your SmileDesk verification code is: ${otp}. This code expires in 10 minutes.`,
          notifyreFromNumber
        );
        if (result.success) {
          console.log(`OTP sent to ${formattedPhone}`);
        } else {
          console.error('Notifyre SMS error:', result.error);
        }
      } catch (notifyreError) {
        console.error('Notifyre SMS error:', notifyreError);
        // Don't fail the request, just log the error
      }
    } else {
      // Log OTP in development or when SMS not configured for this user
      console.log(`[DEV/NO-SMS] OTP for ${cleanPhone}: ${otp}`);
    }

    res.json({
      message: 'If an account exists with this phone number, a verification code has been sent'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: { message: 'Failed to send verification code' } });
  }
});

// POST /api/auth/verify-otp - Verify OTP and get reset token
router.post('/verify-otp', authLimiter, validate(schemas.verifyOtp), async (req, res) => {
  try {
    const { phone, code } = req.body;

    const cleanPhone = phone.replace(/\D/g, '');

    // Find valid OTP
    const otpResult = await query(
      `SELECT id, reset_token, attempts
       FROM otp_codes
       WHERE phone = $1 AND code = $2 AND verified = false AND expires_at > NOW()`,
      [cleanPhone, code]
    );

    if (otpResult.rows.length === 0) {
      // Check if there's an OTP with too many attempts
      const attemptsResult = await query(
        `SELECT attempts FROM otp_codes WHERE phone = $1 AND verified = false AND expires_at > NOW()`,
        [cleanPhone]
      );

      if (attemptsResult.rows.length > 0) {
        // Increment attempts
        await query(
          `UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1 AND verified = false`,
          [cleanPhone]
        );

        const attempts = attemptsResult.rows[0].attempts + 1;
        if (attempts >= 5) {
          // Delete OTP after too many attempts
          await query('DELETE FROM otp_codes WHERE phone = $1', [cleanPhone]);
          return res.status(400).json({
            error: { message: 'Too many failed attempts. Please request a new code.' }
          });
        }
      }

      return res.status(400).json({
        error: { message: 'Invalid or expired verification code' }
      });
    }

    const otpRecord = otpResult.rows[0];

    // Mark OTP as verified
    await query(
      'UPDATE otp_codes SET verified = true WHERE id = $1',
      [otpRecord.id]
    );

    res.json({
      message: 'Code verified successfully',
      resetToken: otpRecord.reset_token
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: { message: 'Failed to verify code' } });
  }
});

// POST /api/auth/reset-password - Reset password with token
router.post('/reset-password', authLimiter, validate(schemas.resetPassword), async (req, res) => {
  try {
    const { phone, resetToken, newPassword } = req.body;

    const cleanPhone = phone.replace(/\D/g, '');

    // Verify reset token
    const otpResult = await query(
      `SELECT id FROM otp_codes
       WHERE phone = $1 AND reset_token = $2 AND verified = true AND expires_at > NOW()`,
      [cleanPhone, resetToken]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({
        error: { message: 'Invalid or expired reset token. Please start over.' }
      });
    }

    // Find user
    const userResult = await query(
      'SELECT id FROM users WHERE phone = $1',
      [cleanPhone]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({
        error: { message: 'User not found' }
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update password
    await query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, userResult.rows[0].id]
    );

    // Delete used OTP
    await query('DELETE FROM otp_codes WHERE phone = $1', [cleanPhone]);

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: { message: 'Failed to reset password' } });
  }
});

// POST /api/auth/refresh - Refresh access token using refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: { message: 'Refresh token is required' }
      });
    }

    // Validate refresh token
    const userId = await validateRefreshToken(refreshToken);

    if (!userId) {
      return res.status(401).json({
        error: { message: 'Invalid or expired refresh token', code: 'REFRESH_TOKEN_INVALID' }
      });
    }

    // Generate new access token
    const accessToken = generateToken(userId);

    // Optionally rotate refresh token for extra security
    const newRefreshToken = await generateRefreshToken(userId);

    res.json({
      token: accessToken,
      refreshToken: newRefreshToken.token,
      expiresIn: 900 // 15 minutes in seconds
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: { message: 'Failed to refresh token' } });
  }
});

// POST /api/auth/logout - Revoke refresh token
router.post('/logout', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Revoke refresh token
    await revokeRefreshToken(userId);

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: { message: 'Failed to logout' } });
  }
});

module.exports = router;
