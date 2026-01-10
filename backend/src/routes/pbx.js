/**
 * PBX Routes - Multi-PBX Missed Call Webhooks
 * Handles missed call notifications from various PBX systems
 *
 * Architecture: All PBX systems forward missed calls to these webhooks.
 * We don't integrate with PBX APIs directly - we receive webhook events.
 *
 * Supported PBX Systems:
 *
 * Tier 1 - Cloud VoIP (Very Common):
 * - RingCentral    POST /api/pbx/missed-call/ringcentral
 * - 8x8            POST /api/pbx/missed-call/8x8
 * - Nextiva        POST /api/pbx/missed-call/nextiva
 * - Dialpad        POST /api/pbx/missed-call/dialpad
 * - Zoom Phone     POST /api/pbx/missed-call/zoom
 * - Vonage Voice   POST /api/pbx/missed-call/vonage
 * - GoTo Connect   POST /api/pbx/missed-call/goto
 * - Webex Calling  POST /api/pbx/missed-call/webex
 *
 * Tier 2 - Australian Telcos:
 * - Telstra        POST /api/pbx/missed-call/telstra (TIPT, Business Voice, Hosted PBX)
 * - Optus          POST /api/pbx/missed-call/optus (Loop, Business Voice)
 * - BroadSoft      POST /api/pbx/missed-call/broadsoft (MyNetFone, TPG, Symbio, etc.)
 *
 * Tier 3 - On-Prem / IT-Managed:
 * - 3CX            POST /api/pbx/missed-call/3cx
 * - FreePBX        POST /api/pbx/missed-call/freepbx (Asterisk, Elastix, Issabel)
 *
 * Generic (any system):
 * - Generic        POST /api/pbx/missed-call
 *
 * Security Features:
 * - Rate limiting per IP (200 req/min)
 * - Phone number validation & normalization
 * - 30-minute SMS cooldown to prevent spam
 * - Structured logging for debugging
 */

const express = require('express');
const { query } = require('../db/config');
const notifyre = require('../services/notifyre');
const { pbx: log } = require('../utils/logger');
const { withSMSRetry } = require('../utils/retry');
const { captureException } = require('../utils/sentry');
const { webhookIPLimiter } = require('../middleware/notifyreWebhook');

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
  const normalized = notifyre.normalizePhoneNumber(phone);

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
 * UPDATED: Both reply options result in callbacks (intent classification only)
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
      `INSERT INTO calls (user_id, twilio_call_sid, caller_phone, status, is_missed, followup_status, receptionist_status)
       VALUES ($1, $2, $3, 'no-answer', true, 'completed', 'pending')`,
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

  // Create call record with new fields
  const callResult = await query(
    `INSERT INTO calls (user_id, twilio_call_sid, caller_phone, status, is_missed, followup_status, receptionist_status, handled_by_ai)
     VALUES ($1, $2, $3, 'no-answer', true, 'pending', 'pending', false)
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

  // SMS MESSAGE - Simple classification, both options result in callback
  const followUpMessage = settings.ai_greeting ||
    `Hi! This is ${practiceName}. We missed your call.\n\nReply 1 for appointment or 2 for other. We'll call you back shortly.`;

  // Send SMS with retry using Notifyre
  const fromNumber = settings.sms_reply_number || process.env.NOTIFYRE_FROM_NUMBER;

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
      () => notifyre.sendSMS(
        process.env.NOTIFYRE_ACCOUNT_ID,
        process.env.NOTIFYRE_API_TOKEN,
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
         VALUES ($1, 'ai', $2, 'text', $3, 'sent', 'notifyre')`,
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
      notifyre.normalizePhoneNumber(callerPhone),
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
        notifyre.normalizePhoneNumber(callerPhone),
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
        notifyre.normalizePhoneNumber(callerPhone),
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
        notifyre.normalizePhoneNumber(from),
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
        notifyre.normalizePhoneNumber(callerPhone),
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
        notifyre.normalizePhoneNumber(caller_id),
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
        notifyre.normalizePhoneNumber(callerPhone),
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
 * Nextiva missed call webhook
 * POST /api/pbx/missed-call/nextiva
 */
router.post('/missed-call/nextiva', webhookIPLimiter, async (req, res) => {
  try {
    const {
      callerIdNumber,
      calledNumber,
      callId,
      callResult,
      direction
    } = req.body;

    const callerPhone = callerIdNumber || req.body.from;
    const calledPhone = calledNumber || req.body.to;

    log.info({
      callerPhone,
      calledPhone,
      callResult,
      source: 'nextiva'
    }, 'Nextiva webhook');

    if (!callerPhone) {
      return res.status(400).json({ error: 'Caller number required' });
    }

    // Nextiva call results: missed, answered, voicemail, busy
    if (['missed', 'no_answer', 'unanswered'].includes(callResult?.toLowerCase())) {
      const settings = await findUserByPhone(calledPhone);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const result = await processMissedCall(
        settings.user_id,
        notifyre.normalizePhoneNumber(callerPhone),
        settings,
        callId,
        callResult?.toLowerCase() === 'voicemail'
      );

      return res.json({ status: 'ok', ...result });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, 'Nextiva webhook error');
    captureException(error, { context: 'pbx_nextiva_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Dialpad missed call webhook
 * POST /api/pbx/missed-call/dialpad
 */
router.post('/missed-call/dialpad', webhookIPLimiter, async (req, res) => {
  try {
    const {
      call,
      event_type
    } = req.body;

    const data = call || req.body;
    const callerPhone = data.external_number || data.from_number || data.caller_id;
    const calledPhone = data.internal_number || data.to_number || data.target_id;

    log.info({
      callerPhone,
      calledPhone,
      event_type,
      source: 'dialpad'
    }, 'Dialpad webhook');

    if (!callerPhone) {
      return res.status(400).json({ error: 'Caller number required' });
    }

    // Dialpad events: call.missed, call.ended (with state=missed)
    const isMissed = event_type === 'call.missed' ||
                     data.state === 'missed' ||
                     data.disposition === 'missed';

    if (isMissed) {
      const settings = await findUserByPhone(calledPhone);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const result = await processMissedCall(
        settings.user_id,
        notifyre.normalizePhoneNumber(callerPhone),
        settings,
        data.call_id || data.id
      );

      return res.json({ status: 'ok', ...result });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, 'Dialpad webhook error');
    captureException(error, { context: 'pbx_dialpad_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GoTo Connect (formerly Jive) missed call webhook
 * POST /api/pbx/missed-call/goto
 */
router.post('/missed-call/goto', webhookIPLimiter, async (req, res) => {
  try {
    const {
      callerNumber,
      dialedNumber,
      callUuid,
      callResult,
      eventType
    } = req.body;

    const callerPhone = callerNumber || req.body.caller || req.body.from;
    const calledPhone = dialedNumber || req.body.called || req.body.to;

    log.info({
      callerPhone,
      calledPhone,
      callResult,
      eventType,
      source: 'goto'
    }, 'GoTo Connect webhook');

    if (!callerPhone) {
      return res.status(400).json({ error: 'Caller number required' });
    }

    // GoTo results: missed, answered, voicemail
    const isMissed = callResult === 'missed' ||
                     callResult === 'no_answer' ||
                     eventType === 'call.missed';

    if (isMissed) {
      const settings = await findUserByPhone(calledPhone);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const result = await processMissedCall(
        settings.user_id,
        notifyre.normalizePhoneNumber(callerPhone),
        settings,
        callUuid
      );

      return res.json({ status: 'ok', ...result });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, 'GoTo Connect webhook error');
    captureException(error, { context: 'pbx_goto_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Webex Calling missed call webhook
 * POST /api/pbx/missed-call/webex
 */
router.post('/missed-call/webex', webhookIPLimiter, async (req, res) => {
  try {
    const { data, event } = req.body;
    const callData = data || req.body;

    const callerPhone = callData.callingParty?.address ||
                        callData.remoteParty?.number ||
                        callData.from;
    const calledPhone = callData.calledParty?.address ||
                        callData.localParty?.number ||
                        callData.to;

    log.info({
      callerPhone,
      calledPhone,
      event,
      source: 'webex'
    }, 'Webex Calling webhook');

    if (!callerPhone) {
      return res.status(400).json({ error: 'Caller number required' });
    }

    // Webex events: callMissed, telephony_calls (with disposition=missed)
    const isMissed = event === 'callMissed' ||
                     callData.disposition === 'Missed' ||
                     callData.callResult === 'missed';

    if (isMissed) {
      const settings = await findUserByPhone(calledPhone);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const result = await processMissedCall(
        settings.user_id,
        notifyre.normalizePhoneNumber(callerPhone),
        settings,
        callData.callId || callData.id
      );

      return res.json({ status: 'ok', ...result });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, 'Webex Calling webhook error');
    captureException(error, { context: 'pbx_webex_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * BroadSoft / BroadWorks missed call webhook
 * Used by: Telstra, Optus, MyNetFone, TPG, and many AU providers
 * POST /api/pbx/missed-call/broadsoft
 */
router.post('/missed-call/broadsoft', webhookIPLimiter, async (req, res) => {
  try {
    // BroadWorks Call Event format
    const {
      eventType,
      call,
      callId,
      externalTrackingId
    } = req.body;

    const callData = call || req.body;
    const callerPhone = callData.remoteParty?.address ||
                        callData.callingParty ||
                        callData.from ||
                        callData.callerNumber;
    const calledPhone = callData.address ||
                        callData.calledParty ||
                        callData.to ||
                        callData.calledNumber;

    log.info({
      callerPhone,
      calledPhone,
      eventType,
      source: 'broadsoft'
    }, 'BroadSoft webhook');

    if (!callerPhone) {
      return res.status(400).json({ error: 'Caller number required' });
    }

    // BroadWorks events: Missed, Released (with reason=missed)
    const isMissed = eventType === 'Missed' ||
                     eventType === 'CallMissed' ||
                     callData.releaseReason === 'Missed' ||
                     callData.disposition === 'missed';

    if (isMissed) {
      const settings = await findUserByPhone(calledPhone);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const result = await processMissedCall(
        settings.user_id,
        notifyre.normalizePhoneNumber(callerPhone),
        settings,
        callId || externalTrackingId
      );

      return res.json({ status: 'ok', ...result });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, 'BroadSoft webhook error');
    captureException(error, { context: 'pbx_broadsoft_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Telstra Business Systems (TIPT, Business Voice, Hosted PBX)
 * Often use BroadSoft under the hood - alias endpoint
 * POST /api/pbx/missed-call/telstra
 */
router.post('/missed-call/telstra', webhookIPLimiter, async (req, res) => {
  // Telstra systems typically use BroadSoft/BroadWorks format
  // Forward to broadsoft handler with source tracking
  req.body._source = 'telstra';
  log.info({ source: 'telstra' }, 'Telstra webhook (routing to BroadSoft handler)');

  // Process with same logic as BroadSoft
  try {
    const callData = req.body.call || req.body;
    const callerPhone = callData.remoteParty?.address ||
                        callData.callingParty ||
                        callData.from ||
                        callData.callerNumber ||
                        callData.caller;
    const calledPhone = callData.address ||
                        callData.calledParty ||
                        callData.to ||
                        callData.calledNumber ||
                        callData.called;

    log.info({
      callerPhone,
      calledPhone,
      source: 'telstra'
    }, 'Telstra webhook');

    if (!callerPhone) {
      return res.status(400).json({ error: 'Caller number required' });
    }

    // Check for missed call indicators
    const eventType = req.body.eventType || req.body.event;
    const isMissed = eventType === 'Missed' ||
                     eventType === 'CallMissed' ||
                     eventType === 'missed' ||
                     callData.disposition === 'missed' ||
                     callData.result === 'missed' ||
                     callData.status === 'missed';

    if (isMissed) {
      const settings = await findUserByPhone(calledPhone);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const result = await processMissedCall(
        settings.user_id,
        notifyre.normalizePhoneNumber(callerPhone),
        settings,
        callData.callId || callData.id
      );

      return res.json({ status: 'ok', ...result });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, 'Telstra webhook error');
    captureException(error, { context: 'pbx_telstra_webhook' });
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Optus Business Systems (Loop, Business Voice)
 * POST /api/pbx/missed-call/optus
 */
router.post('/missed-call/optus', webhookIPLimiter, async (req, res) => {
  try {
    const callData = req.body.call || req.body;
    const callerPhone = callData.remoteParty?.address ||
                        callData.callingParty ||
                        callData.from ||
                        callData.callerNumber ||
                        callData.caller;
    const calledPhone = callData.address ||
                        callData.calledParty ||
                        callData.to ||
                        callData.calledNumber ||
                        callData.called;

    log.info({
      callerPhone,
      calledPhone,
      source: 'optus'
    }, 'Optus webhook');

    if (!callerPhone) {
      return res.status(400).json({ error: 'Caller number required' });
    }

    const eventType = req.body.eventType || req.body.event;
    const isMissed = eventType === 'Missed' ||
                     eventType === 'CallMissed' ||
                     eventType === 'missed' ||
                     callData.disposition === 'missed' ||
                     callData.result === 'missed' ||
                     callData.status === 'missed';

    if (isMissed) {
      const settings = await findUserByPhone(calledPhone);

      if (!settings) {
        return res.json({ status: 'ok', action: 'no_user_found' });
      }

      const result = await processMissedCall(
        settings.user_id,
        notifyre.normalizePhoneNumber(callerPhone),
        settings,
        callData.callId || callData.id
      );

      return res.json({ status: 'ok', ...result });
    }

    return res.json({ status: 'ok', action: 'event_ignored' });
  } catch (error) {
    log.error({ error: error.message }, 'Optus webhook error');
    captureException(error, { context: 'pbx_optus_webhook' });
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
      notifyre.normalizePhoneNumber(testPhone),
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
 * Health check and supported systems list
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pbx-webhooks',
    supportedSystems: {
      tier1_cloud: ['ringcentral', '8x8', 'nextiva', 'dialpad', 'zoom', 'vonage', 'goto', 'webex'],
      tier2_au_telcos: ['telstra', 'optus', 'broadsoft'],
      tier3_onprem: ['3cx', 'freepbx'],
      generic: ['generic']
    },
    endpoints: {
      generic: '/api/pbx/missed-call',
      ringcentral: '/api/pbx/missed-call/ringcentral',
      '8x8': '/api/pbx/missed-call/8x8',
      nextiva: '/api/pbx/missed-call/nextiva',
      dialpad: '/api/pbx/missed-call/dialpad',
      zoom: '/api/pbx/missed-call/zoom',
      vonage: '/api/pbx/missed-call/vonage',
      goto: '/api/pbx/missed-call/goto',
      webex: '/api/pbx/missed-call/webex',
      telstra: '/api/pbx/missed-call/telstra',
      optus: '/api/pbx/missed-call/optus',
      broadsoft: '/api/pbx/missed-call/broadsoft',
      '3cx': '/api/pbx/missed-call/3cx',
      freepbx: '/api/pbx/missed-call/freepbx'
    }
  });
});

module.exports = router;
