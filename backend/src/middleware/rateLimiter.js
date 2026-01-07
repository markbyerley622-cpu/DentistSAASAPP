const rateLimit = require('express-rate-limit');

/**
 * Rate limiters for different endpoint types
 * Protects against brute force, abuse, and DoS attacks
 */

// Strict limiter for auth endpoints (login, register)
// 5 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    error: {
      message: 'Too many attempts. Please try again in 15 minutes.',
      retryAfter: 15 * 60
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false // Count all requests
});

// Moderate limiter for sensitive operations (send SMS, etc)
// 20 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: {
    error: {
      message: 'Too many requests. Please slow down.',
      retryAfter: 60
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Generous limiter for Twilio webhooks
// 100 requests per minute per IP (Twilio may send bursts)
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip validation in development for testing
  skip: (req) => process.env.NODE_ENV !== 'production' && !req.headers['x-twilio-signature']
});

// General API limiter for authenticated routes
// 100 requests per minute per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: {
    error: {
      message: 'Rate limit exceeded. Please try again shortly.',
      retryAfter: 60
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  authLimiter,
  apiLimiter,
  webhookLimiter,
  generalLimiter
};
