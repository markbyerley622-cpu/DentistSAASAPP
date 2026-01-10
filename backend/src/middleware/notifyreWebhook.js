/**
 * Notifyre Webhook Validation Middleware
 * Validates incoming webhooks using HMAC signature verification
 *
 * Notifyre signs webhooks with HMAC-SHA256 using your signature secret
 * https://docs.notifyre.com/api/webhooks
 */

const crypto = require('crypto');
const { webhook: log } = require('../utils/logger');

/**
 * Validate Notifyre webhook signature (HMAC-SHA256)
 */
function validateNotifyreSignature(req, res, next) {
  // Skip validation in development if no secret configured
  if (process.env.NODE_ENV !== 'production' && !process.env.NOTIFYRE_WEBHOOK_SECRET) {
    log.debug('Skipping Notifyre signature validation (dev mode, no secret)');
    return next();
  }

  const signatureSecret = process.env.NOTIFYRE_WEBHOOK_SECRET;

  // If no secret configured in production, log warning but allow (for initial setup)
  if (!signatureSecret) {
    log.warn('NOTIFYRE_WEBHOOK_SECRET not configured - webhook validation disabled');
    return next();
  }

  // Notifyre sends signature in x-notifyre-signature header
  const signature = req.headers['x-notifyre-signature'] ||
                    req.headers['x-signature'] ||
                    req.headers['x-hub-signature-256'];

  if (!signature) {
    log.warn({ ip: req.ip, path: req.path }, 'Missing Notifyre signature header');

    // In production, reject unsigned requests
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Missing signature' });
    }
    return next();
  }

  try {
    // For HMAC-SHA256 signature validation
    const rawBody = req.rawBody || JSON.stringify(req.body);

    // Calculate expected signature
    const expectedSignature = crypto
      .createHmac('sha256', signatureSecret)
      .update(rawBody)
      .digest('hex');

    // Handle different signature formats (with or without prefix)
    const providedSig = signature.replace('sha256=', '').replace('sha-256=', '');

    // Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(providedSig, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      log.warn({
        ip: req.ip,
        path: req.path,
        providedLength: signatureBuffer.length
      }, 'Invalid Notifyre signature');

      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Invalid signature' });
      }
    }

    log.debug('Notifyre signature validated successfully');
    next();
  } catch (error) {
    log.error({ error: error.message }, 'Notifyre signature validation error');

    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Signature validation failed' });
    }
    next();
  }
}

/**
 * Capture raw body for signature validation
 * Must be used before express.json() or as part of it
 */
function captureRawBody(req, res, buf) {
  req.rawBody = buf.toString();
}

/**
 * Rate limiter specifically for webhook endpoints
 * Limits by phone number to prevent per-number abuse
 */
const rateLimit = require('express-rate-limit');

const webhookPhoneLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Max 20 requests per phone per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Extract phone from various Notifyre webhook formats
    const phone = req.body?.from ||
                  req.body?.From ||
                  req.body?.sender ||
                  req.body?.msisdn ||
                  req.query?.from ||
                  req.ip;
    return `phone:${phone}`;
  },
  handler: (req, res) => {
    log.warn({
      phone: req.body?.from || req.body?.From,
      ip: req.ip
    }, 'Webhook rate limit exceeded');
    res.status(429).json({ error: 'Too many requests from this phone number' });
  }
});

/**
 * Combined webhook IP limiter (broader protection)
 */
const webhookIPLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // Max 200 requests per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    log.warn({ ip: req.ip }, 'Webhook IP rate limit exceeded');
    res.status(429).json({ error: 'Too many requests' });
  }
});

/**
 * Idempotency middleware for webhooks
 * Prevents duplicate processing of the same webhook
 */
const processedWebhooks = new Map();
const IDEMPOTENCY_TTL = 5 * 60 * 1000; // 5 minutes

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedWebhooks.entries()) {
    if (now - timestamp > IDEMPOTENCY_TTL) {
      processedWebhooks.delete(key);
    }
  }
}, 60 * 1000); // Run cleanup every minute

function idempotencyCheck(req, res, next) {
  // Extract message ID from various formats
  const messageId = req.body?.id ||
                    req.body?.MessageSid ||
                    req.body?.messageId ||
                    req.body?.message_id ||
                    req.query?.id;

  if (!messageId) {
    // No message ID, can't check idempotency
    return next();
  }

  const idempotencyKey = `msg:${messageId}`;

  if (processedWebhooks.has(idempotencyKey)) {
    log.info({ messageId }, 'Duplicate webhook detected, skipping');
    return res.json({ status: 'ok', action: 'duplicate_skipped' });
  }

  // Mark as processed
  processedWebhooks.set(idempotencyKey, Date.now());

  // Store in request for potential rollback
  req.idempotencyKey = idempotencyKey;

  next();
}

/**
 * Rollback idempotency on error (allow retry)
 */
function rollbackIdempotency(req) {
  if (req.idempotencyKey) {
    processedWebhooks.delete(req.idempotencyKey);
  }
}

module.exports = {
  validateNotifyreSignature,
  captureRawBody,
  webhookPhoneLimiter,
  webhookIPLimiter,
  idempotencyCheck,
  rollbackIdempotency
};
