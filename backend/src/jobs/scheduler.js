/**
 * Scheduled Jobs Manager
 * Handles background tasks like auto-flagging stale leads
 */

const { query } = require('../db/config');
const { scheduler: log } = require('../utils/logger');

// Job registry
const jobs = new Map();

/**
 * Auto-flag calls and leads as 'no_response' after 45 minutes
 * This runs on a schedule instead of on every API request
 */
async function autoFlagStaleRecords() {
  const startTime = Date.now();
  log.info('Starting auto-flag job');

  try {
    // Flag calls as 'no_response' if pending/in_progress for 45+ minutes with no patient reply
    const callsResult = await query(
      `UPDATE calls
       SET followup_status = 'no_response'
       WHERE followup_status IN ('pending', 'in_progress')
         AND created_at < NOW() - INTERVAL '45 minutes'
         AND id NOT IN (
           SELECT DISTINCT c.id FROM calls c
           JOIN conversations conv ON conv.call_id = c.id
           JOIN messages m ON m.conversation_id = conv.id
           WHERE m.sender = 'patient' OR m.sender = 'caller'
         )
       RETURNING id`
    );

    const flaggedCalls = callsResult.rows.length;

    // Flag leads as 'lost' if 'new' status for 45+ minutes with no patient reply
    const leadsResult = await query(
      `UPDATE leads
       SET status = 'lost'
       WHERE status = 'new'
         AND created_at < NOW() - INTERVAL '45 minutes'
         AND (conversation_id IS NULL OR conversation_id NOT IN (
           SELECT DISTINCT conv.id FROM conversations conv
           JOIN messages m ON m.conversation_id = conv.id
           WHERE m.sender = 'patient' OR m.sender = 'caller'
         ))
       RETURNING id`
    );

    const flaggedLeads = leadsResult.rows.length;

    const duration = Date.now() - startTime;
    log.info({
      flaggedCalls,
      flaggedLeads,
      durationMs: duration
    }, 'Auto-flag job completed');

    return { flaggedCalls, flaggedLeads, duration };
  } catch (error) {
    log.error({ error: error.message }, 'Auto-flag job failed');
    throw error;
  }
}

/**
 * Cleanup expired OTP codes
 */
async function cleanupExpiredOTPs() {
  log.info('Starting OTP cleanup job');

  try {
    const result = await query(
      `DELETE FROM otp_codes WHERE expires_at < NOW() RETURNING id`
    );

    log.info({ deleted: result.rows.length }, 'OTP cleanup completed');
    return { deleted: result.rows.length };
  } catch (error) {
    log.error({ error: error.message }, 'OTP cleanup failed');
    throw error;
  }
}

/**
 * Cleanup expired refresh tokens
 */
async function cleanupExpiredTokens() {
  log.info('Starting token cleanup job');

  try {
    const result = await query(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW() RETURNING id`
    );

    log.info({ deleted: result.rows.length }, 'Token cleanup completed');
    return { deleted: result.rows.length };
  } catch (error) {
    log.error({ error: error.message }, 'Token cleanup failed');
    throw error;
  }
}

/**
 * Update delivery status for pending SMS messages
 * This would query Vonage for status updates (if configured)
 */
async function syncDeliveryStatuses() {
  log.info('Starting delivery status sync');

  try {
    // Get messages with unknown delivery status from last 24 hours
    const pendingMessages = await query(
      `SELECT id, external_message_id
       FROM messages
       WHERE external_message_id IS NOT NULL
         AND delivery_status = 'pending'
         AND created_at > NOW() - INTERVAL '24 hours'
       LIMIT 100`
    );

    // For now, just log - actual Vonage status check would go here
    log.info({ pendingCount: pendingMessages.rows.length }, 'Delivery status sync completed');

    return { checked: pendingMessages.rows.length };
  } catch (error) {
    log.error({ error: error.message }, 'Delivery status sync failed');
    throw error;
  }
}

/**
 * Register a job to run on an interval
 *
 * @param {string} name - Job name
 * @param {Function} fn - Job function
 * @param {number} intervalMs - Interval in milliseconds
 */
function registerJob(name, fn, intervalMs) {
  if (jobs.has(name)) {
    log.warn({ name }, 'Job already registered, skipping');
    return;
  }

  const intervalId = setInterval(async () => {
    try {
      await fn();
    } catch (error) {
      log.error({ name, error: error.message }, 'Scheduled job failed');
    }
  }, intervalMs);

  jobs.set(name, { fn, intervalId, intervalMs });
  log.info({ name, intervalMs }, 'Job registered');
}

/**
 * Unregister a job
 */
function unregisterJob(name) {
  const job = jobs.get(name);
  if (job) {
    clearInterval(job.intervalId);
    jobs.delete(name);
    log.info({ name }, 'Job unregistered');
  }
}

/**
 * Run a job immediately (for testing or manual trigger)
 */
async function runJob(name) {
  const job = jobs.get(name);
  if (job) {
    log.info({ name }, 'Running job manually');
    return await job.fn();
  }
  throw new Error(`Job ${name} not found`);
}

/**
 * Start all scheduled jobs
 */
function startScheduler() {
  log.info('Starting scheduler');

  // Auto-flag stale records every 5 minutes
  registerJob('auto-flag', autoFlagStaleRecords, 5 * 60 * 1000);

  // Cleanup expired OTPs every hour
  registerJob('cleanup-otps', cleanupExpiredOTPs, 60 * 60 * 1000);

  // Cleanup expired tokens every hour
  registerJob('cleanup-tokens', cleanupExpiredTokens, 60 * 60 * 1000);

  // Sync delivery statuses every 10 minutes
  registerJob('sync-delivery', syncDeliveryStatuses, 10 * 60 * 1000);

  // Run auto-flag immediately on startup
  autoFlagStaleRecords().catch(err => {
    log.error({ error: err.message }, 'Initial auto-flag failed');
  });

  log.info({ jobCount: jobs.size }, 'Scheduler started');
}

/**
 * Stop all scheduled jobs (for graceful shutdown)
 */
function stopScheduler() {
  log.info('Stopping scheduler');

  for (const [name] of jobs) {
    unregisterJob(name);
  }

  log.info('Scheduler stopped');
}

/**
 * Get scheduler status
 */
function getSchedulerStatus() {
  const status = {};
  for (const [name, job] of jobs) {
    status[name] = {
      intervalMs: job.intervalMs,
      intervalMinutes: job.intervalMs / 60000
    };
  }
  return status;
}

module.exports = {
  startScheduler,
  stopScheduler,
  registerJob,
  unregisterJob,
  runJob,
  getSchedulerStatus,
  // Export individual jobs for testing
  autoFlagStaleRecords,
  cleanupExpiredOTPs,
  cleanupExpiredTokens,
  syncDeliveryStatuses
};
