const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db/config');
const { generateToken, authenticate } = require('../middleware/auth');

const router = express.Router();

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

module.exports = router;
