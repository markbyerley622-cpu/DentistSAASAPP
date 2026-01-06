const jwt = require('jsonwebtoken');
const { query } = require('../db/config');

// Require JWT_SECRET in production - fail fast if not set
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: JWT_SECRET environment variable is required in production');
  process.exit(1);
}

// Use a development-only fallback (never used in production due to check above)
const SECRET = JWT_SECRET || 'dev-only-secret-not-for-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, SECRET, { expiresIn: JWT_EXPIRES_IN });
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

      // Fetch user from database
      const result = await query(
        'SELECT id, email, practice_name, phone, timezone, created_at FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: { message: 'User not found' } });
      }

      req.user = result.rows[0];
      next();
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ error: { message: 'Token expired' } });
      }
      return res.status(401).json({ error: { message: 'Invalid token' } });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: { message: 'Authentication error' } });
  }
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
  verifyToken,
  authenticate,
  optionalAuth
};
