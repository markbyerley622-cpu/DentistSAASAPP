/**
 * PBX Routes - Multi-PBX Missed Call Webhooks
 * Handles missed call notifications from various PBX systems
 *
 * Supported PBX Systems:
 * - 3CX
 * - RingCentral
 * - Vonage (voice)
 * - FreePBX/Asterisk
 * - 8x8
 * - Zoom Phone
 * - Generic webhook
 *
 * Security Features:
 * - Rate limiting per IP
 * - Phone number validation
 * - Cooldown to prevent spam
 */

const express = require('express');
const { query } = require('../db/config');
const vonage = require('../services/vonage');
const { pbx: log } = require('../utils/logger');
const { withSMSRetry } = require('../utils/retry');
const { captureException } = require('../utils/sentry');
const { webhookIPLimiter } = require('../middleware/vonageWebhook');

const router = express.Router();

// SMS cooldown in minutes - prevent spam to same number
const SMS_COOLDOWN_MINUTES = 30;

/**
 * Check if we can send SMS to this number (cooldown check)
 */
async function canSendSMS(userId, callerPhone) {
  const result = await query(
    `SELECT id FROM conversations
     WHERE user_id = $1
       AND caller_phone = $2
       AND channel = 'sms'
       AND (last_sms_at > NOW() - INTERVAL '1 minute' * $3
            OR created_at > NOW() - INTERVAL '1 minute' * $3)
     LIMIT 1`,
    [userId, callerPhone, SMS_COOLDOWN_MINUTES]
  );
  return result.rows.length === 0;
}

/**
 * Find user by their phone number (forwarding_phone or sms_reply_number)
 */
async function findUserByPhone(phone) {
  const normalized = vonage.normalizePhoneNumber(phone);

  // Try forwarding_phone first (most common)
  let result = await query(
    `SELECT s.*, u.id as user_id, u.practice_name
     FROM settings s
     JOIN users u ON s.user_id = u.id
     WHERE s.forwarding_phone = $1`,
    [normalized]
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  // Try sms_reply_number
  result = await query(
    `SELECT s.*, u.id as user_id, u.practice_name
     FROM settings s
     JOIN users u ON s.user_id = u.id
     WHERE s.sms_reply_number = $1`,
    [normalized]
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  // Try user's phone as last resort
  result = await query(
    `SELECT s.*, u.id as user_id, u.practice_name, u.phone
     FROM settings s
     JOIN users u ON s.user_id = u.id
     WHERE u.phone = $1`,
    [normalized]
  );

  return result.rows[0] || null;
}

/**
 * Process a missed call and send SMS follow-up
 */
async function processMissedCall(userId, callerPhone, settings, callSid = null, hasVoicemail = false) {
  const practiceName = settings.practice_name || 'Our Practice';

  log.info({
    userId,
    callerPhone,
    hasVoicemail,
    callSid
  }, 'Processing missed call');

  // If voicemail was left, don't send SMS (dentist will handle)
  if (hasVoicemail) {
    // Still record the call
    await query(
      `INSERT INTO calls (user_id, twilio_call_sid, caller_phone, status, is_missed, followup_status)
       VALUES ($1, $2, $3, 'no-answer', true, 'completed')`,
      [userId, callSid, callerPhone]
    );

    log.info({ callerPhone }, 'Voicemail left, skipping SMS');
    return { smsSent: false, reason: 'voicemail_left' };
  }

  // Check cooldown
  const canSend = await canSendSMS(userId, callerPhone);
  if (!canSend) {
    log.info({ callerPhone }, 'SMS cooldown active, skipping');
    return { smsSent: false, reason: 'cooldown' };
  }

  // Create call record
  const callResult = await query(
    `INSERT INTO calls (user_id, twilio_call_sid, caller_phone, status, is_missed, followup_status)
     VALUES ($1, $2, $3, 'no-answer', true, 'pending')
     RETURNING id`,
    [userId, callSid, callerPhone]
  );

  const callId = callResult.rows[0].id;

  // Create conversation
  const conversationResult = await query(
    `INSERT INTO conversations (user_id, call_id, caller_phone, channel, direction, status, last_activity_at)
     VALUES ($1, $2, $3, 'sms', 'outbound', 'awaiting_initial_choice', NOW())
     RETURNING id`,
    [userId, callId, callerPhone]
  );

  const conversationId = conversationResult.rows[0].id;

  // Create lead
  await query(
    `INSERT INTO leads (user_id, call_id, conversation_id, name, phone, status, source)
     VALUES ($1, $2, $3, 'Unknown Caller', $4, 'new', 'missed_call')`,
    [userId, callId, conversationId, callerPhone]
  );

  // Get SMS message
  const followUpMessage = settings.ai_greeting ||
    `Hi! This is ${practiceName}. We missed your call and want to help you.\n\nReply:\n1 - Request a callback\n2 - Book an appointment`;

  // Send SMS with retry
  const fromNumber = settings.sms_reply_number || process.env.VONAGE_FROM_NUMBER;

  if (!fromNumber) {
    log.error({ userId }, 'No SMS reply number configured');
    await query(
      `UPDATE calls SET followup_status = 'failed' WHERE id = $1`,
      [callId]
    );
    return { smsSent: false, reason: 'no_from_number' };
  }

  try {
    const sendResult = await withSMSRetry(
      () => vonage.sendSMS(
        process.env.VONAGE_API_KEY,
        process.env.VONAGE_API_SECRET,
        callerPhone,
        followUpMessage,
        fromNumber
      ),
      { context: `missed-call-followup-${callId}` }
    );

    if (sendResult.success) {
      // Store outbound message
      await query(
        `INSERT INTO messages (conversation_id, sender, content, message_type, external_message_id, delivery_status, provider)
         VALUES ($1, 'ai', $2, 'text', $3, 'sent', 'vonage')`,
        [conversationId, followUpMessage, sendResult.messageId]
      );

      // Update call status
      await query(
        `UPDATE calls
         SET conversation_id = $1, followup_status = 'in_progress', followup_attempts = 1, last_followup_at = NOW()
         WHERE id = $2`,
        [conversationId, callId]
      );

      // Update conversation
      await query(
        `UPDATE conversations SET last_sms_at = NOW() WHERE id = $1`,
        [conversationId]
      );

      log.info({ callId, conversationId, callerPhone }, 'SMS follow-up sent');
      return { smsSent: true, callId, conversationId };
    } else {
      await query(
        `UPDATE calls SET followup_status = 'failed' WHERE id = $1`,
        [callId]
      );
      log.error({ callId, error: sendResult.error }, 'SMS send failed');
      return { smsSent: false, reason: 'send_failed', error: sendResult.error };
    }
  } catch (error) {
    await query(
      `UPDATE calls SET followup_status = 'failed' WHERE id = $1`,
      [callId]
    );
    log.error({ callId, error: error.message }, 'SMS send error');
    captureException(error, { context: 'missed_call_sms', callId });
    return { smsSent: false, reason: 'error', error: error.message };
  }
}

/**
 * Generic missed call webhook
 * POST /api/pbx/missed-call
 */
router.post('/missed-call', webhookIPLimiter, async (req, res) => {
  try {
    const { callerPhone, calledPhone, callSid, hasVoicemail } = req.body;

    log.info({ callerPhone, calledPhone, callSid }, 'Generic missed call webhook');

    if (!callerPhone) {
      return res.status(400).json({ error: 'callerPhone is required' });
    }

    // Find user by the called number
    const settings = await findUserByPhone(calledPhone || callerPhone);

    if (!settings) {
      log.warn({ calledPhone, callerPhone }, 'No user found for phone number');
      return res.json({ status: 'ok', action: 'no_user_found' });
    }

    const result = await processMissedCall(
      settings.user_id,
      vonage.normalizePhoneNumber(callerPhone),
      settings,
      callSid,
      hasVoicemail === true || hasVoicemail === 'true'
    );

    return res.json({ status: 'ok', ...result });
  } catch (error) {
    log.error({ error: error.message }, 'Generic missed call error');
    captureException(error, { context: 'pbx_generic_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * 3CX missed call webhook
 * POST /api/pbx/missed-call/3cx
 */
router.post('/missed-call/3cx', webhookIPLimiter, async (req, res) => {
  try {
    // 3CX webhook format
    const {
      callernumber,
      callednumber,
      callid,
      dn,
      event,
      status
    } = req.body;

    const callerPhone = callernumber || req.body.CallerNumber;
    const calledPhone = callednumber || dn || req.body.CalledNumber;

    log.info({
      callerPhone,
      calledPhone,
      event,
      status,
      source: '3cx'
    }, '3CX missed call webhook');

    if (!callerPhone) {
      return res.status(400).json({ error: 'Caller number required' });
    }

    // 3CX events: Ringing, Connected, Terminated
    // Only process if the call was missed (no answer)
    if (event === 'Terminated' && status !== 'Answered') {
      const settings = await findUserByPhone(calledPhone);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const result = await processMissedCall(
        settings.user_id,
        vonage.normalizePhoneNumber(callerPhone),
        settings,
        callid
      );

      return res.json({ status: 'ok', ...result });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, '3CX webhook error');
    captureException(error, { context: 'pbx_3cx_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * RingCentral missed call webhook
 * POST /api/pbx/missed-call/ringcentral
 */
router.post('/missed-call/ringcentral', webhookIPLimiter, async (req, res) => {
  try {
    // RingCentral webhook format
    const { body: eventBody } = req.body;
    const data = eventBody || req.body;

    const callerPhone = data.from?.phoneNumber || data.callerNumber;
    const calledPhone = data.to?.phoneNumber || data.calledNumber;
    const result = data.result || data.callResult;

    log.info({
      callerPhone,
      calledPhone,
      result,
      source: 'ringcentral'
    }, 'RingCentral webhook');

    if (!callerPhone) {
      return res.status(400).json({ error: 'Caller number required' });
    }

    // RingCentral results: Missed, Voicemail, Accepted, etc.
    if (result === 'Missed' || result === 'No Answer') {
      const settings = await findUserByPhone(calledPhone);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const processResult = await processMissedCall(
        settings.user_id,
        vonage.normalizePhoneNumber(callerPhone),
        settings,
        data.id || data.sessionId,
        result === 'Voicemail'
      );

      return res.json({ status: 'ok', ...processResult });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, 'RingCentral webhook error');
    captureException(error, { context: 'pbx_ringcentral_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Vonage Voice missed call webhook
 * POST /api/pbx/missed-call/vonage
 */
router.post('/missed-call/vonage', webhookIPLimiter, async (req, res) => {
  try {
    // Vonage Voice webhook format
    const {
      from,
      to,
      uuid,
      status,
      direction
    } = req.body;

    log.info({
      from,
      to,
      status,
      direction,
      source: 'vonage'
    }, 'Vonage voice webhook');

    if (!from) {
      return res.status(400).json({ error: 'From number required' });
    }

    // Vonage statuses: started, ringing, answered, completed, busy, cancelled, timeout, failed, rejected
    if (['timeout', 'cancelled', 'busy', 'rejected', 'unanswered'].includes(status)) {
      const settings = await findUserByPhone(to);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const result = await processMissedCall(
        settings.user_id,
        vonage.normalizePhoneNumber(from),
        settings,
        uuid
      );

      return res.json({ status: 'ok', ...result });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, 'Vonage voice webhook error');
    captureException(error, { context: 'pbx_vonage_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * FreePBX/Asterisk missed call webhook
 * POST /api/pbx/missed-call/freepbx
 */
router.post('/missed-call/freepbx', webhookIPLimiter, async (req, res) => {
  try {
    // FreePBX/Asterisk AGI format
    const {
      callerid,
      calleridnum,
      dnid,
      extension,
      uniqueid,
      disposition
    } = req.body;

    const callerPhone = calleridnum || callerid;
    const calledPhone = dnid || extension;

    log.info({
      callerPhone,
      calledPhone,
      disposition,
      source: 'freepbx'
    }, 'FreePBX webhook');

    if (!callerPhone) {
      return res.status(400).json({ error: 'Caller number required' });
    }

    // Asterisk dispositions: ANSWERED, NO ANSWER, BUSY, FAILED
    if (['NO ANSWER', 'BUSY', 'FAILED', 'NOANSWER'].includes(disposition?.toUpperCase())) {
      const settings = await findUserByPhone(calledPhone);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const result = await processMissedCall(
        settings.user_id,
        vonage.normalizePhoneNumber(callerPhone),
        settings,
        uniqueid
      );

      return res.json({ status: 'ok', ...result });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, 'FreePBX webhook error');
    captureException(error, { context: 'pbx_freepbx_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * 8x8 missed call webhook
 * POST /api/pbx/missed-call/8x8
 */
router.post('/missed-call/8x8', webhookIPLimiter, async (req, res) => {
  try {
    const {
      caller_id,
      called_number,
      call_id,
      call_result,
      call_status
    } = req.body;

    log.info({
      caller_id,
      called_number,
      call_result,
      source: '8x8'
    }, '8x8 webhook');

    if (!caller_id) {
      return res.status(400).json({ error: 'Caller ID required' });
    }

    if (call_result === 'missed' || call_status === 'no_answer') {
      const settings = await findUserByPhone(called_number);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const result = await processMissedCall(
        settings.user_id,
        vonage.normalizePhoneNumber(caller_id),
        settings,
        call_id
      );

      return res.json({ status: 'ok', ...result });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, '8x8 webhook error');
    captureException(error, { context: 'pbx_8x8_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Zoom Phone missed call webhook
 * POST /api/pbx/missed-call/zoom
 */
router.post('/missed-call/zoom', webhookIPLimiter, async (req, res) => {
  try {
    const { payload, event } = req.body;
    const data = payload?.object || req.body;

    const callerPhone = data.caller_number || data.from;
    const calledPhone = data.callee_number || data.to;

    log.info({
      callerPhone,
      calledPhone,
      event,
      source: 'zoom'
    }, 'Zoom webhook');

    if (!callerPhone) {
      return res.status(400).json({ error: 'Caller number required' });
    }

    // Zoom events: phone.callee_missed, phone.callee_rejected
    if (event === 'phone.callee_missed' || data.result === 'missed') {
      const settings = await findUserByPhone(calledPhone);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const result = await processMissedCall(
        settings.user_id,
        vonage.normalizePhoneNumber(callerPhone),
        settings,
        data.call_id
      );

      return res.json({ status: 'ok', ...result });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, 'Zoom webhook error');
    captureException(error, { context: 'pbx_zoom_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Test missed call endpoint (requires auth)
 * POST /api/pbx/test-missed-call
 */
const { authenticate } = require('../middleware/auth');

router.post('/test-missed-call', authenticate, async (req, res) => {
  try {
    const { testPhone } = req.body;
    const userId = req.user.id;

    if (!testPhone) {
      return res.status(400).json({ error: { message: 'testPhone is required' } });
    }

    // Get user's settings
    const settingsResult = await query(
      `SELECT s.*, u.practice_name
       FROM settings s
       JOIN users u ON s.user_id = u.id
       WHERE s.user_id = $1`,
      [userId]
    );

    if (settingsResult.rows.length === 0) {
      return res.status(400).json({ error: { message: 'Settings not configured' } });
    }

    const settings = settingsResult.rows[0];
    settings.user_id = userId;

    // Process as missed call (skip voicemail)
    const result = await processMissedCall(
      userId,
      vonage.normalizePhoneNumber(testPhone),
      settings,
      `test-${Date.now()}`,
      false
    );

    return res.json({
      success: result.smsSent,
      ...result
    });
  } catch (error) {
    log.error({ error: error.message }, 'Test missed call error');
    return res.status(500).json({ error: { message: 'Test failed' } });
  }
});

/**
 * Health check
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pbx-webhooks',
    supportedSystems: ['generic', '3cx', 'ringcentral', 'vonage', 'freepbx', '8x8', 'zoom']
  });
});

module.exports = router;
