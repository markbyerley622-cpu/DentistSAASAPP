const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db/config');

// Require JWT_SECRET in production - fail fast if not set
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: JWT_SECRET environment variable is required in production');
  process.exit(1);
}

// Use a development-only fallback (never used in production due to check above)
const SECRET = JWT_SECRET || 'dev-only-secret-not-for-production';

// Token expiry times
const ACCESS_TOKEN_EXPIRES = '15m'; // Short-lived access token
const REFRESH_TOKEN_EXPIRES = '7d'; // Long-lived refresh token
const REFRESH_TOKEN_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

/**
 * Generate access token (short-lived JWT)
 */
const generateToken = (userId) => {
  return jwt.sign({ userId, type: 'access' }, SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES });
};

/**
 * Generate refresh token (random string stored in database)
 */
const generateRefreshToken = async (userId) => {
  const token = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS);

  // Store in database (will need migration)
  await query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
     SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
    [userId, token, expiresAt]
  );

  return { token, expiresAt };
};

/**
 * Validate refresh token and return user ID if valid
 */
const validateRefreshToken = async (token) => {
  const result = await query(
    `SELECT user_id FROM refresh_tokens
     WHERE token = $1 AND expires_at > NOW()`,
    [token]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].user_id;
};

/**
 * Revoke refresh token (for logout)
 */
const revokeRefreshToken = async (userId) => {
  await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
};

// Verify JWT token
const verifyToken = (token) => {
  return jwt.verify(token, SECRET);
};

// Auth middleware - protects routes
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'No token provided' } });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = verifyToken(token);

      // Fetch user from database (include is_admin)
      const result = await query(
        'SELECT id, email, practice_name, phone, timezone, is_admin, created_at FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: { message: 'User not found' } });
      }

      req.user = result.rows[0];
      next();
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ error: { message: 'Token expired', code: 'TOKEN_EXPIRED' } });
      }
      return res.status(401).json({ error: { message: 'Invalid token', code: 'INVALID_TOKEN' } });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: { message: 'Authentication error' } });
  }
};

// Admin middleware - requires admin role (must be used after authenticate)
const authenticateAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: { message: 'Authentication required' } });
  }

  if (!req.user.is_admin) {
    return res.status(403).json({ error: { message: 'Admin access required' } });
  }

  next();
};

// Optional auth - attaches user if token exists, but doesn't require it
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = verifyToken(token);
      const result = await query(
        'SELECT id, email, practice_name, phone, timezone FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (result.rows.length > 0) {
        req.user = result.rows[0];
      }
    } catch (jwtError) {
      // Token invalid, but that's okay for optional auth
    }

    next();
  } catch (error) {
    next();
  }
};

module.exports = {
  generateToken,
  generateRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  verifyToken,
  authenticate,
  authenticateAdmin,
  optionalAuth
};
