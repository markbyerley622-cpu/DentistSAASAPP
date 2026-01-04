const express = require('express');
const bcrypt = require('bcryptjs');
const twilio = require('twilio');
const crypto = require('crypto');
const { query } = require('../db/config');
const { generateToken, authenticate } = require('../middleware/auth');

const router = express.Router();

// Initialize Twilio client for OTP (uses platform credentials from env)
const getTwilioClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return null;
  }
  return twilio(accountSid, authToken);
};

// Generate 6-digit OTP
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, practiceName, phone, timezone } = req.body;

    // Validation
    if (!email || !password || !practiceName) {
      return res.status(400).json({
        error: { message: 'Email, password, and practice name are required' }
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: { message: 'Password must be at least 8 characters' }
      });
    }

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

    // Generate token
    const token = generateToken(user.id);

    res.status(201).json({
      message: 'Account created successfully',
      user: {
        id: user.id,
        email: user.email,
        practiceName: user.practice_name,
        phone: user.phone,
        timezone: user.timezone,
        createdAt: user.created_at
      },
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: { message: 'Failed to create account' } });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: { message: 'Email and password are required' }
      });
    }

    // Find user
    const result = await query(
      'SELECT id, email, password_hash, practice_name, phone, timezone, created_at FROM users WHERE email = $1',
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

    // Generate token
    const token = generateToken(user.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        practiceName: user.practice_name,
        phone: user.phone,
        timezone: user.timezone,
        createdAt: user.created_at
      },
      token
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
router.put('/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: { message: 'Current password and new password are required' }
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        error: { message: 'New password must be at least 8 characters' }
      });
    }

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
router.post('/forgot-password', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        error: { message: 'Phone number is required' }
      });
    }

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

    // Send OTP via Twilio
    const twilioClient = getTwilioClient();
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

    if (twilioClient && twilioPhone) {
      try {
        await twilioClient.messages.create({
          body: `Your SmileDesk verification code is: ${otp}. This code expires in 10 minutes.`,
          from: twilioPhone,
          to: `+1${cleanPhone}` // Assuming US numbers, adjust as needed
        });
      } catch (twilioError) {
        console.error('Twilio SMS error:', twilioError);
        // Don't fail the request, just log the error
        // In production, you might want to handle this differently
      }
    } else {
      // Log OTP in development when Twilio isn't configured
      console.log(`[DEV] OTP for ${cleanPhone}: ${otp}`);
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
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({
        error: { message: 'Phone number and code are required' }
      });
    }

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
router.post('/reset-password', async (req, res) => {
  try {
    const { phone, resetToken, newPassword } = req.body;

    if (!phone || !resetToken || !newPassword) {
      return res.status(400).json({
        error: { message: 'Phone, reset token, and new password are required' }
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        error: { message: 'Password must be at least 8 characters' }
      });
    }

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

module.exports = router;
