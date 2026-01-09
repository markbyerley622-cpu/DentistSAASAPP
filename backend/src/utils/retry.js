/**
 * Retry utility with exponential backoff
 * Used for SMS sending and other external API calls
 */

const { createModuleLogger } = require('./logger');
const log = createModuleLogger('retry');

// Vonage error codes that should trigger retry
const RETRYABLE_VONAGE_ERRORS = [
  '1',   // Throttled
  '5',   // Internal error
  '99'   // Temporary error
];

// Vonage error codes that should NOT retry (permanent failures)
const PERMANENT_VONAGE_ERRORS = [
  '2',   // Missing params
  '3',   // Invalid params
  '4',   // Invalid credentials
  '6',   // Invalid message
  '7',   // Number barred
  '8',   // Partner account barred
  '9',   // Partner quota exceeded
  '15',  // Invalid sender address
  '29'   // Non-whitelisted destination
];

/**
 * Execute a function with exponential backoff retry
 *
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 30000)
 * @param {Function} options.shouldRetry - Function to determine if error is retryable
 * @param {string} options.context - Context string for logging
 * @returns {Promise<any>}
 */
async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    shouldRetry = () => true,
    context = 'operation'
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();

      if (attempt > 0) {
        log.info({ context, attempt }, 'Retry succeeded');
      }

      return result;
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxRetries || !shouldRetry(error)) {
        log.error({
          context,
          attempt,
          maxRetries,
          error: error.message,
          willRetry: false
        }, 'Operation failed permanently');
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = baseDelay * Math.pow(2, attempt);
      const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
      const delay = Math.min(exponentialDelay + jitter, maxDelay);

      log.warn({
        context,
        attempt: attempt + 1,
        maxRetries,
        nextRetryMs: Math.round(delay),
        error: error.message
      }, 'Operation failed, retrying');

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * SMS-specific retry wrapper with Vonage error code handling
 *
 * @param {Function} sendFn - SMS send function
 * @param {Object} options - Additional options
 * @returns {Promise<Object>}
 */
async function withSMSRetry(sendFn, options = {}) {
  const { context = 'sms-send', ...retryOptions } = options;

  return withRetry(
    async () => {
      const result = await sendFn();

      // Check for Vonage-specific error codes in successful HTTP response
      if (!result.success && result.errorCode) {
        if (PERMANENT_VONAGE_ERRORS.includes(result.errorCode)) {
          // Create a non-retryable error
          const error = new Error(result.error || 'Permanent SMS failure');
          error.permanent = true;
          error.errorCode = result.errorCode;
          throw error;
        }

        if (RETRYABLE_VONAGE_ERRORS.includes(result.errorCode)) {
          // Create a retryable error
          const error = new Error(result.error || 'Temporary SMS failure');
          error.retryable = true;
          error.errorCode = result.errorCode;
          throw error;
        }
      }

      // If success is false but no error code, treat as retryable
      if (!result.success) {
        const error = new Error(result.error || 'SMS send failed');
        error.retryable = true;
        throw error;
      }

      return result;
    },
    {
      ...retryOptions,
      context,
      maxRetries: retryOptions.maxRetries || 3,
      baseDelay: retryOptions.baseDelay || 2000,
      shouldRetry: (error) => {
        // Don't retry permanent errors
        if (error.permanent) return false;
        // Retry if explicitly marked retryable
        if (error.retryable) return true;
        // Retry network errors
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
        // Default: don't retry unknown errors
        return false;
      }
    }
  );
}

/**
 * Sleep utility
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Circuit breaker state
 */
const circuitBreakers = new Map();

/**
 * Simple circuit breaker for external services
 *
 * @param {string} serviceName - Name of the service
 * @param {Function} fn - Function to execute
 * @param {Object} options - Circuit breaker options
 */
async function withCircuitBreaker(serviceName, fn, options = {}) {
  const {
    failureThreshold = 5,
    resetTimeout = 60000 // 1 minute
  } = options;

  // Get or create circuit state
  let circuit = circuitBreakers.get(serviceName);
  if (!circuit) {
    circuit = { failures: 0, lastFailure: 0, state: 'closed' };
    circuitBreakers.set(serviceName, circuit);
  }

  // Check if circuit is open
  if (circuit.state === 'open') {
    const timeSinceFailure = Date.now() - circuit.lastFailure;

    if (timeSinceFailure < resetTimeout) {
      log.warn({ serviceName, resetIn: resetTimeout - timeSinceFailure }, 'Circuit breaker open');
      throw new Error(`Service ${serviceName} temporarily unavailable (circuit breaker open)`);
    }

    // Try half-open
    circuit.state = 'half-open';
    log.info({ serviceName }, 'Circuit breaker half-open, attempting request');
  }

  try {
    const result = await fn();

    // Success - reset circuit
    if (circuit.state === 'half-open') {
      log.info({ serviceName }, 'Circuit breaker closed');
    }
    circuit.failures = 0;
    circuit.state = 'closed';

    return result;
  } catch (error) {
    circuit.failures++;
    circuit.lastFailure = Date.now();

    if (circuit.failures >= failureThreshold) {
      circuit.state = 'open';
      log.error({ serviceName, failures: circuit.failures }, 'Circuit breaker opened');
    }

    throw error;
  }
}

module.exports = {
  withRetry,
  withSMSRetry,
  withCircuitBreaker,
  sleep,
  RETRYABLE_VONAGE_ERRORS,
  PERMANENT_VONAGE_ERRORS
};
