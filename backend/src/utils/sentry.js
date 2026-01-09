/**
 * Sentry Error Monitoring Integration
 * Captures errors, performance, and custom events
 */

const Sentry = require('@sentry/node');
const { logger } = require('./logger');

let isInitialized = false;

/**
 * Initialize Sentry
 * Call this once at app startup
 */
function initSentry(app) {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    logger.info('Sentry DSN not configured, error monitoring disabled');
    return false;
  }

  if (isInitialized) {
    logger.warn('Sentry already initialized');
    return true;
  }

  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.npm_package_version || '1.0.0',

      // Performance monitoring
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

      // Only send errors in production (or if explicitly enabled)
      enabled: process.env.NODE_ENV === 'production' || process.env.SENTRY_ENABLED === 'true',

      // Don't send PII
      sendDefaultPii: false,

      // Before sending, filter sensitive data
      beforeSend(event) {
        // Remove sensitive headers
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
          delete event.request.headers['x-api-key'];
        }

        // Remove sensitive data from body
        if (event.request?.data) {
          const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'credential'];
          for (const field of sensitiveFields) {
            if (event.request.data[field]) {
              event.request.data[field] = '[REDACTED]';
            }
          }
        }

        return event;
      },

      // Ignore certain errors
      ignoreErrors: [
        // Ignore client disconnects
        'ECONNRESET',
        // Ignore aborted requests
        'ECONNABORTED',
        // Ignore common HTTP errors that aren't bugs
        /^Request failed with status code 4\d\d$/
      ],

      // Integrations
      integrations: [
        // HTTP integration for request tracking
        Sentry.httpIntegration({ tracing: true }),
        // Express integration
        ...(app ? [Sentry.expressIntegration({ app })] : [])
      ]
    });

    isInitialized = true;
    logger.info('Sentry initialized successfully');

    return true;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to initialize Sentry');
    return false;
  }
}

/**
 * Capture an exception with context
 */
function captureException(error, context = {}) {
  if (!isInitialized) {
    logger.error({ error: error.message, ...context }, 'Untracked error (Sentry not initialized)');
    return null;
  }

  return Sentry.captureException(error, {
    extra: context,
    tags: context.tags || {}
  });
}

/**
 * Capture a message (for non-error events)
 */
function captureMessage(message, level = 'info', context = {}) {
  if (!isInitialized) {
    logger[level]({ ...context }, message);
    return null;
  }

  return Sentry.captureMessage(message, {
    level,
    extra: context,
    tags: context.tags || {}
  });
}

/**
 * Set user context for error tracking
 */
function setUser(user) {
  if (!isInitialized) return;

  Sentry.setUser({
    id: user.id,
    email: user.email,
    // Don't include sensitive data like phone
  });
}

/**
 * Clear user context (on logout)
 */
function clearUser() {
  if (!isInitialized) return;
  Sentry.setUser(null);
}

/**
 * Add breadcrumb for debugging
 */
function addBreadcrumb(message, category = 'custom', level = 'info', data = {}) {
  if (!isInitialized) return;

  Sentry.addBreadcrumb({
    message,
    category,
    level,
    data
  });
}

/**
 * Start a transaction for performance monitoring
 */
function startTransaction(name, op = 'custom') {
  if (!isInitialized) return null;

  return Sentry.startSpan({
    name,
    op
  }, () => {});
}

/**
 * Express error handler middleware
 * Use as the last error handler
 */
function errorHandler() {
  if (!isInitialized) {
    return (err, req, res, next) => {
      logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');
      next(err);
    };
  }

  return Sentry.expressErrorHandler();
}

/**
 * Request handler middleware
 * Use at the start of middleware chain
 */
function requestHandler() {
  if (!isInitialized) {
    return (req, res, next) => next();
  }

  return Sentry.expressRequestHandler();
}

/**
 * Tracing handler for performance monitoring
 */
function tracingHandler() {
  if (!isInitialized) {
    return (req, res, next) => next();
  }

  return Sentry.expressTracingHandler();
}

/**
 * Flush pending events (for graceful shutdown)
 */
async function flush(timeout = 2000) {
  if (!isInitialized) return;

  try {
    await Sentry.flush(timeout);
    logger.info('Sentry flushed successfully');
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to flush Sentry');
  }
}

/**
 * Check if Sentry is initialized
 */
function isEnabled() {
  return isInitialized;
}

module.exports = {
  initSentry,
  captureException,
  captureMessage,
  setUser,
  clearUser,
  addBreadcrumb,
  startTransaction,
  errorHandler,
  requestHandler,
  tracingHandler,
  flush,
  isEnabled
};
