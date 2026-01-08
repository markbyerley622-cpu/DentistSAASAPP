/**
 * PBX Webhook Handler
 *
 * Receives missed call notifications from various VoIP/PBX systems and triggers
 * SMS follow-up via CellCast. The dentist's PBX handles calls and voicemails -
 * this system only sends SMS when a caller doesn't leave a voicemail.
 *
 * Supported PBX Systems:
 * - 3CX (3cx.com)
 * - RingCentral (ringcentral.com)
 * - Vonage (vonage.com)
 * - FreePBX (freepbx.org)
 * - 8x8 (8x8.com)
 * - Zoom Phone (zoom.us)
 * - Generic/Custom webhooks
 *
 * Webhook Setup:
 * Configure your PBX to send a webhook when:
 * 1. Call is missed (no answer)
 * 2. Caller did NOT leave a voicemail (or voicemail < 3 seconds)
 *
 * URL: https://your-app.com/api/pbx/missed-call/{pbx-type}
 * Method: POST
 * Content-Type: application/json
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../db/config');
const { decrypt } = require('../utils/crypto');
const cellcast = require('../services/cellcast');

const router = express.Router();

// Rate limiter to prevent webhook abuse
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 webhooks per minute per IP
  message: { error: 'Too many webhook requests' },
  standardHeaders: true,
  legacyHeaders: false
});

router.use(webhookLimiter);

// SMS cooldown to prevent duplicate messages to the same caller
const SMS_COOLDOWN_MINUTES = 30;

/**
 * Check if we can send SMS (cooldown check)
 */
async function canSendSMS(userId, callerPhone) {
  const result = await query(
    `SELECT id FROM conversations
     WHERE user_id = $1
       AND caller_phone = $2
       AND channel = 'sms'
       AND created_at > NOW() - INTERVAL '1 minute' * $3
     LIMIT 1`,
    [userId, callerPhone, SMS_COOLDOWN_MINUTES]
  );
  return result.rows.length === 0;
}

/**
 * Send SMS follow-up for a missed call
 */
async function sendMissedCallSMS(settings, callerPhone, callId = null) {
  const practiceName = settings.practice_name || 'our practice';

  // Get CellCast API key
  const apiKey = settings.cellcast_api_key ? decrypt(settings.cellcast_api_key) : process.env.CELLCAST_API_KEY;

  if (!apiKey) {
    console.error('CellCast API key not configured for user:', settings.user_id);
    return { success: false, error: 'SMS not configured' };
  }

  // Get the reply number (CellCast dedicated number)
  const fromNumber = settings.sms_reply_number || process.env.CELLCAST_PHONE_NUMBER;

  // Get follow-up message
  const followUpMessage = settings.ai_greeting ||
    `Hi! This is ${practiceName}. We missed your call and want to make sure we help you. Reply 1 for us to call you back, or Reply 2 to schedule an appointment. Thanks!`;

  try {
    const result = await cellcast.sendSMS(apiKey, callerPhone, followUpMessage, fromNumber);

    if (result.success) {
      console.log(`SMS follow-up sent to ${callerPhone} via CellCast`);

      // Create conversation record
      const conversationResult = await query(
        `INSERT INTO conversations (user_id, call_id, caller_phone, channel, direction, status)
         VALUES ($1, $2, $3, 'sms', 'outbound', 'active')
         RETURNING id`,
        [settings.user_id, callId, callerPhone]
      );

      const conversationId = conversationResult.rows[0].id;

      // Store the outgoing message
      await query(
        `INSERT INTO messages (conversation_id, sender, content, message_type, delivered)
         VALUES ($1, 'ai', $2, 'text', true)`,
        [conversationId, followUpMessage]
      );

      // Update call with conversation link if we have a call ID
      if (callId) {
        await query(
          `UPDATE calls SET conversation_id = $1, followup_status = 'in_progress', followup_attempts = 1, last_followup_at = NOW()
           WHERE id = $2`,
          [conversationId, callId]
        );
      }

      // Create lead
      await query(
        `INSERT INTO leads (user_id, call_id, conversation_id, name, phone, status, source)
         VALUES ($1, $2, $3, 'Unknown Caller', $4, 'new', 'missed_call')`,
        [settings.user_id, callId, conversationId, callerPhone]
      );

      return { success: true, conversationId };
    } else {
      console.error('Failed to send SMS via CellCast:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('SMS send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Find user by forwarding phone number
 * The PBX forwards calls to our "virtual" number, which we track
 */
async function findUserByForwardingPhone(forwardingPhone) {
  const normalized = cellcast.normalizePhoneNumber(forwardingPhone);

  const result = await query(
    `SELECT s.*, u.id as user_id, u.practice_name, u.phone as user_phone
     FROM settings s
     JOIN users u ON s.user_id = u.id
     WHERE s.forwarding_phone = $1`,
    [normalized]
  );

  return result.rows[0] || null;
}

/**
 * Find user by their business phone number
 */
async function findUserByBusinessPhone(businessPhone) {
  const normalized = cellcast.normalizePhoneNumber(businessPhone);

  const result = await query(
    `SELECT s.*, u.id as user_id, u.practice_name, u.phone as user_phone
     FROM settings s
     JOIN users u ON s.user_id = u.id
     WHERE u.phone = $1 OR s.business_phone = $1`,
    [normalized]
  );

  return result.rows[0] || null;
}

/**
 * Find user by webhook secret (for authenticated webhooks)
 */
async function findUserByWebhookSecret(secret) {
  if (!secret) return null;

  const result = await query(
    `SELECT s.*, u.id as user_id, u.practice_name, u.phone as user_phone
     FROM settings s
     JOIN users u ON s.user_id = u.id
     WHERE s.pbx_webhook_secret = $1`,
    [secret]
  );

  return result.rows[0] || null;
}

// =====================================================
// GENERIC MISSED CALL WEBHOOK
// =====================================================

/**
 * Generic missed call webhook
 *
 * POST /api/pbx/missed-call
 *
 * Body:
 * {
 *   "caller_phone": "+61412345678",
 *   "called_number": "+61298765432",
 *   "voicemail_left": false,
 *   "voicemail_duration": 0,
 *   "call_id": "optional-unique-id",
 *   "timestamp": "2024-01-15T10:30:00Z"
 * }
 *
 * Headers:
 * - X-Webhook-Secret: your-webhook-secret (optional, for authentication)
 */
router.post('/missed-call', async (req, res) => {
  try {
    const {
      caller_phone,
      callerPhone,
      from,
      called_number,
      calledNumber,
      to,
      voicemail_left,
      voicemailLeft,
      has_voicemail,
      voicemail_duration,
      voicemailDuration,
      call_id,
      callId: externalCallIdAlt
    } = req.body;

    const webhookSecret = req.headers['x-webhook-secret'];
    const callerNum = caller_phone || callerPhone || from;
    const calledNum = called_number || calledNumber || to;
    const hasVoicemail = voicemail_left || voicemailLeft || has_voicemail || false;
    const vmDuration = parseInt(voicemail_duration || voicemailDuration || 0);
    const externalCallId = call_id || externalCallIdAlt;

    if (!callerNum) {
      return res.status(400).json({ error: 'Missing caller phone number' });
    }

    console.log(`Missed call webhook: ${callerNum} -> ${calledNum}, voicemail: ${hasVoicemail}, duration: ${vmDuration}s`);

    // Find the user - try webhook secret first, then by called number
    let settings = await findUserByWebhookSecret(webhookSecret);
    if (!settings && calledNum) {
      settings = await findUserByBusinessPhone(calledNum);
    }
    if (!settings && calledNum) {
      settings = await findUserByForwardingPhone(calledNum);
    }

    if (!settings) {
      console.error('No user found for missed call webhook');
      return res.status(404).json({ error: 'User not found for this phone number' });
    }

    // Check if voicemail was left (>= 3 seconds = voicemail, skip SMS)
    if (hasVoicemail || vmDuration >= 3) {
      console.log(`Voicemail left (${vmDuration}s), NOT sending SMS`);

      // Still log the call
      await query(
        `INSERT INTO calls (user_id, caller_phone, status, is_missed, followup_status)
         VALUES ($1, $2, 'no-answer', true, 'completed')`,
        [settings.user_id, cellcast.normalizePhoneNumber(callerNum)]
      );

      return res.json({ status: 'ok', action: 'voicemail_left', sms_sent: false });
    }

    // No voicemail - check cooldown and send SMS
    const normalizedCaller = cellcast.normalizePhoneNumber(callerNum);

    if (!(await canSendSMS(settings.user_id, normalizedCaller))) {
      console.log(`SMS cooldown active for ${callerNum}`);
      return res.json({ status: 'ok', action: 'cooldown_active', sms_sent: false });
    }

    // Create call record
    const callResult = await query(
      `INSERT INTO calls (user_id, caller_phone, status, is_missed, followup_status)
       VALUES ($1, $2, 'no-answer', true, 'pending')
       RETURNING id`,
      [settings.user_id, normalizedCaller]
    );

    const callId = callResult.rows[0].id;

    // Send SMS follow-up
    const smsResult = await sendMissedCallSMS(settings, normalizedCaller, callId);

    if (smsResult.success) {
      return res.json({ status: 'ok', action: 'sms_sent', sms_sent: true });
    } else {
      await query(
        `UPDATE calls SET followup_status = 'failed' WHERE id = $1`,
        [callId]
      );
      return res.status(500).json({ error: 'Failed to send SMS', details: smsResult.error });
    }
  } catch (error) {
    console.error('Missed call webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// 3CX WEBHOOK
// =====================================================

/**
 * 3CX missed call webhook
 *
 * 3CX sends webhooks with format:
 * {
 *   "event": "call.missed" or "call.completed",
 *   "call": {
 *     "id": "call-id",
 *     "from": "+61412345678",
 *     "to": "+61298765432",
 *     "duration": 0,
 *     "status": "missed"
 *   }
 * }
 */
router.post('/missed-call/3cx', async (req, res) => {
  try {
    const { event, call } = req.body;

    // Only handle missed calls
    if (event !== 'call.missed' && call?.status !== 'missed') {
      return res.json({ status: 'ok', action: 'ignored' });
    }

    const callerPhone = call?.from || req.body.from;
    const calledNumber = call?.to || req.body.to;
    const voicemailDuration = call?.voicemail_duration || 0;

    if (!callerPhone) {
      return res.status(400).json({ error: 'Missing caller phone' });
    }

    // Find user
    let settings = await findUserByBusinessPhone(calledNumber);
    if (!settings) {
      settings = await findUserByForwardingPhone(calledNumber);
    }

    if (!settings) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check for voicemail
    if (voicemailDuration >= 3) {
      await query(
        `INSERT INTO calls (user_id, caller_phone, status, is_missed, followup_status)
         VALUES ($1, $2, 'no-answer', true, 'completed')`,
        [settings.user_id, cellcast.normalizePhoneNumber(callerPhone)]
      );
      return res.json({ status: 'ok', action: 'voicemail_left', sms_sent: false });
    }

    // Send SMS
    const normalizedCaller = cellcast.normalizePhoneNumber(callerPhone);

    if (!(await canSendSMS(settings.user_id, normalizedCaller))) {
      return res.json({ status: 'ok', action: 'cooldown_active', sms_sent: false });
    }

    const callResult = await query(
      `INSERT INTO calls (user_id, caller_phone, status, is_missed, followup_status)
       VALUES ($1, $2, 'no-answer', true, 'pending')
       RETURNING id`,
      [settings.user_id, normalizedCaller]
    );

    const smsResult = await sendMissedCallSMS(settings, normalizedCaller, callResult.rows[0].id);
    res.json({ status: 'ok', action: 'sms_sent', sms_sent: smsResult.success });
  } catch (error) {
    console.error('3CX webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// RINGCENTRAL WEBHOOK
// =====================================================

/**
 * RingCentral missed call webhook
 *
 * RingCentral format:
 * {
 *   "uuid": "event-id",
 *   "event": "/restapi/v1.0/account/~/extension/~/presence/line",
 *   "body": {
 *     "telephonyStatus": "NoCall",
 *     "activeCalls": [{
 *       "direction": "Inbound",
 *       "from": "+61412345678",
 *       "to": "+61298765432",
 *       "telephonyStatus": "NoCall",
 *       "terminationType": "missed"
 *     }]
 *   }
 * }
 */
router.post('/missed-call/ringcentral', async (req, res) => {
  try {
    const { body: eventBody } = req.body;
    const activeCalls = eventBody?.activeCalls || [];

    // Find missed call
    const missedCall = activeCalls.find(c =>
      c.terminationType === 'missed' || c.result === 'Missed'
    );

    if (!missedCall) {
      return res.json({ status: 'ok', action: 'ignored' });
    }

    const callerPhone = missedCall.from;
    const calledNumber = missedCall.to;

    if (!callerPhone) {
      return res.status(400).json({ error: 'Missing caller phone' });
    }

    let settings = await findUserByBusinessPhone(calledNumber);
    if (!settings) {
      settings = await findUserByForwardingPhone(calledNumber);
    }

    if (!settings) {
      return res.status(404).json({ error: 'User not found' });
    }

    // RingCentral handles voicemail separately - if webhook fires, assume no voicemail
    const normalizedCaller = cellcast.normalizePhoneNumber(callerPhone);

    if (!(await canSendSMS(settings.user_id, normalizedCaller))) {
      return res.json({ status: 'ok', action: 'cooldown_active', sms_sent: false });
    }

    const callResult = await query(
      `INSERT INTO calls (user_id, caller_phone, status, is_missed, followup_status)
       VALUES ($1, $2, 'no-answer', true, 'pending')
       RETURNING id`,
      [settings.user_id, normalizedCaller]
    );

    const smsResult = await sendMissedCallSMS(settings, normalizedCaller, callResult.rows[0].id);
    res.json({ status: 'ok', action: 'sms_sent', sms_sent: smsResult.success });
  } catch (error) {
    console.error('RingCentral webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// VONAGE WEBHOOK
// =====================================================

/**
 * Vonage missed call webhook
 *
 * Vonage format:
 * {
 *   "conversation_uuid": "conv-id",
 *   "type": "call",
 *   "status": "unanswered",
 *   "from": "+61412345678",
 *   "to": "+61298765432",
 *   "duration": "0"
 * }
 */
router.post('/missed-call/vonage', async (req, res) => {
  try {
    const { status, from, to, direction } = req.body;

    // Only handle unanswered/missed inbound calls
    if (status !== 'unanswered' && status !== 'rejected' && status !== 'timeout') {
      return res.json({ status: 'ok', action: 'ignored' });
    }

    if (direction && direction !== 'inbound') {
      return res.json({ status: 'ok', action: 'ignored' });
    }

    const callerPhone = from;
    const calledNumber = to;

    if (!callerPhone) {
      return res.status(400).json({ error: 'Missing caller phone' });
    }

    let settings = await findUserByBusinessPhone(calledNumber);
    if (!settings) {
      settings = await findUserByForwardingPhone(calledNumber);
    }

    if (!settings) {
      return res.status(404).json({ error: 'User not found' });
    }

    const normalizedCaller = cellcast.normalizePhoneNumber(callerPhone);

    if (!(await canSendSMS(settings.user_id, normalizedCaller))) {
      return res.json({ status: 'ok', action: 'cooldown_active', sms_sent: false });
    }

    const callResult = await query(
      `INSERT INTO calls (user_id, caller_phone, status, is_missed, followup_status)
       VALUES ($1, $2, 'no-answer', true, 'pending')
       RETURNING id`,
      [settings.user_id, normalizedCaller]
    );

    const smsResult = await sendMissedCallSMS(settings, normalizedCaller, callResult.rows[0].id);
    res.json({ status: 'ok', action: 'sms_sent', sms_sent: smsResult.success });
  } catch (error) {
    console.error('Vonage webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// FREEPBX / ASTERISK WEBHOOK
// =====================================================

/**
 * FreePBX/Asterisk missed call webhook
 *
 * Typically custom webhook configured via dialplan AGI:
 * {
 *   "event": "missed_call",
 *   "callerid": "+61412345678",
 *   "extension": "100",
 *   "did": "+61298765432",
 *   "timestamp": "2024-01-15 10:30:00"
 * }
 */
router.post('/missed-call/freepbx', async (req, res) => {
  try {
    const { event, callerid, callerIdNum, from, did, extension, to } = req.body;

    if (event && event !== 'missed_call' && event !== 'noanswer') {
      return res.json({ status: 'ok', action: 'ignored' });
    }

    const callerPhone = callerid || callerIdNum || from;
    const calledNumber = did || to;

    if (!callerPhone) {
      return res.status(400).json({ error: 'Missing caller phone' });
    }

    let settings = await findUserByBusinessPhone(calledNumber);
    if (!settings) {
      settings = await findUserByForwardingPhone(calledNumber);
    }

    if (!settings) {
      return res.status(404).json({ error: 'User not found' });
    }

    const normalizedCaller = cellcast.normalizePhoneNumber(callerPhone);

    if (!(await canSendSMS(settings.user_id, normalizedCaller))) {
      return res.json({ status: 'ok', action: 'cooldown_active', sms_sent: false });
    }

    const callResult = await query(
      `INSERT INTO calls (user_id, caller_phone, status, is_missed, followup_status)
       VALUES ($1, $2, 'no-answer', true, 'pending')
       RETURNING id`,
      [settings.user_id, normalizedCaller]
    );

    const smsResult = await sendMissedCallSMS(settings, normalizedCaller, callResult.rows[0].id);
    res.json({ status: 'ok', action: 'sms_sent', sms_sent: smsResult.success });
  } catch (error) {
    console.error('FreePBX webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// 8x8 WEBHOOK
// =====================================================

/**
 * 8x8 missed call webhook
 *
 * 8x8 format:
 * {
 *   "eventType": "call.ended",
 *   "call": {
 *     "callId": "call-id",
 *     "direction": "inbound",
 *     "from": "+61412345678",
 *     "to": "+61298765432",
 *     "status": "missed",
 *     "duration": 0
 *   }
 * }
 */
router.post('/missed-call/8x8', async (req, res) => {
  try {
    const { eventType, call } = req.body;

    // Check for missed call
    if (call?.status !== 'missed' && call?.status !== 'no-answer' && call?.reason !== 'no_answer') {
      return res.json({ status: 'ok', action: 'ignored' });
    }

    const callerPhone = call?.from || req.body.from;
    const calledNumber = call?.to || req.body.to;

    if (!callerPhone) {
      return res.status(400).json({ error: 'Missing caller phone' });
    }

    let settings = await findUserByBusinessPhone(calledNumber);
    if (!settings) {
      settings = await findUserByForwardingPhone(calledNumber);
    }

    if (!settings) {
      return res.status(404).json({ error: 'User not found' });
    }

    const normalizedCaller = cellcast.normalizePhoneNumber(callerPhone);

    if (!(await canSendSMS(settings.user_id, normalizedCaller))) {
      return res.json({ status: 'ok', action: 'cooldown_active', sms_sent: false });
    }

    const callResult = await query(
      `INSERT INTO calls (user_id, caller_phone, status, is_missed, followup_status)
       VALUES ($1, $2, 'no-answer', true, 'pending')
       RETURNING id`,
      [settings.user_id, normalizedCaller]
    );

    const smsResult = await sendMissedCallSMS(settings, normalizedCaller, callResult.rows[0].id);
    res.json({ status: 'ok', action: 'sms_sent', sms_sent: smsResult.success });
  } catch (error) {
    console.error('8x8 webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// ZOOM PHONE WEBHOOK
// =====================================================

/**
 * Zoom Phone missed call webhook
 *
 * Zoom Phone format:
 * {
 *   "event": "phone.call_ended",
 *   "payload": {
 *     "object": {
 *       "call_id": "call-id",
 *       "direction": "inbound",
 *       "caller_number": "+61412345678",
 *       "callee_number": "+61298765432",
 *       "result": "missed"
 *     }
 *   }
 * }
 */
router.post('/missed-call/zoom', async (req, res) => {
  try {
    const { event, payload } = req.body;
    const callData = payload?.object;

    // Check for missed call
    if (callData?.result !== 'missed' && callData?.result !== 'no_answer') {
      return res.json({ status: 'ok', action: 'ignored' });
    }

    const callerPhone = callData?.caller_number || callData?.from;
    const calledNumber = callData?.callee_number || callData?.to;

    if (!callerPhone) {
      return res.status(400).json({ error: 'Missing caller phone' });
    }

    let settings = await findUserByBusinessPhone(calledNumber);
    if (!settings) {
      settings = await findUserByForwardingPhone(calledNumber);
    }

    if (!settings) {
      return res.status(404).json({ error: 'User not found' });
    }

    const normalizedCaller = cellcast.normalizePhoneNumber(callerPhone);

    if (!(await canSendSMS(settings.user_id, normalizedCaller))) {
      return res.json({ status: 'ok', action: 'cooldown_active', sms_sent: false });
    }

    const callResult = await query(
      `INSERT INTO calls (user_id, caller_phone, status, is_missed, followup_status)
       VALUES ($1, $2, 'no-answer', true, 'pending')
       RETURNING id`,
      [settings.user_id, normalizedCaller]
    );

    const smsResult = await sendMissedCallSMS(settings, normalizedCaller, callResult.rows[0].id);
    res.json({ status: 'ok', action: 'sms_sent', sms_sent: smsResult.success });
  } catch (error) {
    console.error('Zoom Phone webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// HEALTH CHECK
// =====================================================

/**
 * Health check endpoint for PBX webhooks
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pbx-webhooks',
    supported: ['3cx', 'ringcentral', 'vonage', 'freepbx', '8x8', 'zoom', 'generic'],
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
