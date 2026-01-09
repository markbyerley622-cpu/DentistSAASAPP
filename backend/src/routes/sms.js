/**
 * SMS Routes - Vonage Two-Way SMS Integration
 * Handles inbound SMS webhooks and callback classification flow
 *
 * SIMPLIFIED FLOW (V2):
 * - Reply 1 = Appointment request callback
 * - Reply 2 = Other/general callback
 * - Both result in callbacks - we're just classifying intent for reporting
 *
 * Security Features:
 * - Signature validation (HMAC-SHA256)
 * - Per-phone rate limiting
 * - Idempotency protection
 * - Input sanitization
 */

const express = require('express');
const { query, getClient } = require('../db/config');
const vonage = require('../services/vonage');
const { sms: log } = require('../utils/logger');
const { withSMSRetry } = require('../utils/retry');
const { captureException } = require('../utils/sentry');
const {
  validateVonageSignature,
  webhookPhoneLimiter,
  webhookIPLimiter,
  idempotencyCheck,
  rollbackIdempotency
} = require('../middleware/vonageWebhook');

const router = express.Router();

// SMS cooldown in minutes - prevent spam to same number
const SMS_COOLDOWN_MINUTES = 30;

/**
 * Inbound SMS Webhook Handler
 * POST /api/sms/incoming (primary)
 * GET /api/sms/incoming (fallback for Vonage config)
 */
async function handleInboundSMS(req, res) {
  const startTime = Date.now();

  try {
    // Parse webhook data (Vonage sends different formats)
    const webhookData = req.method === 'GET' ? req.query : req.body;

    // Parse using Vonage service
    const parsed = vonage.parseInboundWebhook(webhookData);

    const { from: callerPhone, to: vonageNumber, message: messageBody, messageId } = parsed;

    log.info({
      from: callerPhone,
      to: vonageNumber,
      messageId,
      bodyLength: messageBody?.length
    }, 'Inbound SMS received');

    // Validate required fields
    if (!callerPhone || !messageBody) {
      log.warn({ webhookData }, 'Invalid webhook: missing phone or message');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Find user by their Vonage number (sms_reply_number in settings)
    const userResult = await query(
      `SELECT s.*, u.id as user_id, u.practice_name
       FROM settings s
       JOIN users u ON s.user_id = u.id
       WHERE s.sms_reply_number = $1`,
      [vonageNumber]
    );

    // Fallback: try to find by the normalized phone number
    let settings = userResult.rows[0];
    if (!settings) {
      const normalizedVonage = vonage.normalizePhoneNumber(vonageNumber);
      const fallbackResult = await query(
        `SELECT s.*, u.id as user_id, u.practice_name
         FROM settings s
         JOIN users u ON s.user_id = u.id
         WHERE s.sms_reply_number = $1`,
        [normalizedVonage]
      );
      settings = fallbackResult.rows[0];
    }

    // If still no match, try forwarding_phone as fallback
    if (!settings) {
      const forwardingResult = await query(
        `SELECT s.*, u.id as user_id, u.practice_name
         FROM settings s
         JOIN users u ON s.user_id = u.id
         WHERE s.forwarding_phone = $1
         LIMIT 1`,
        [vonage.normalizePhoneNumber(callerPhone)]
      );
      settings = forwardingResult.rows[0];
    }

    if (!settings) {
      log.warn({ vonageNumber, callerPhone }, 'No user found for Vonage number');
      return res.json({ status: 'ok', action: 'no_user_found' });
    }

    const userId = settings.user_id;
    const practiceName = settings.practice_name || 'Our Practice';

    // Find or create active conversation
    let conversationResult = await query(
      `SELECT * FROM conversations
       WHERE user_id = $1 AND caller_phone = $2
         AND status NOT IN ('completed', 'callback_confirmed')
       ORDER BY created_at DESC LIMIT 1`,
      [userId, callerPhone]
    );

    let conversation = conversationResult.rows[0];
    let conversationId;

    if (!conversation) {
      // Create new conversation
      const newConv = await query(
        `INSERT INTO conversations (user_id, caller_phone, channel, direction, status, state_data, last_activity_at)
         VALUES ($1, $2, 'sms', 'inbound', 'awaiting_initial_choice', '{}', NOW())
         RETURNING *`,
        [userId, callerPhone]
      );
      conversation = newConv.rows[0];
      conversationId = conversation.id;

      // Create lead for new conversation
      await query(
        `INSERT INTO leads (user_id, conversation_id, name, phone, status, source)
         VALUES ($1, $2, 'SMS Contact', $3, 'new', 'sms')`,
        [userId, conversationId, callerPhone]
      );

      log.info({ userId, conversationId, callerPhone }, 'New conversation created');
    } else {
      conversationId = conversation.id;
    }

    // Store inbound message with idempotency
    if (messageId) {
      const existingMsg = await query(
        `SELECT id FROM messages WHERE external_message_id = $1`,
        [messageId]
      );
      if (existingMsg.rows.length > 0) {
        log.info({ messageId }, 'Duplicate message, skipping');
        return res.json({ status: 'ok', action: 'duplicate_skipped' });
      }
    }

    await query(
      `INSERT INTO messages (conversation_id, sender, content, message_type, external_message_id, delivery_status, provider)
       VALUES ($1, 'patient', $2, 'text', $3, 'delivered', 'vonage')`,
      [conversationId, messageBody, messageId]
    );

    // Update conversation activity
    await query(
      `UPDATE conversations SET last_activity_at = NOW() WHERE id = $1`,
      [conversationId]
    );

    // Update lead status to contacted (they replied)
    await query(
      `UPDATE leads SET status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END
       WHERE conversation_id = $1`,
      [conversationId]
    );

    // Process conversation and generate response
    const aiResponse = await handleConversation(conversationId, messageBody, settings, conversation);

    // Send response with retry
    const sendResult = await withSMSRetry(
      () => vonage.sendSMS(
        process.env.VONAGE_API_KEY,
        process.env.VONAGE_API_SECRET,
        callerPhone,
        aiResponse,
        settings.sms_reply_number || process.env.VONAGE_FROM_NUMBER
      ),
      { context: `sms-reply-${conversationId}` }
    );

    // Store outbound message
    await query(
      `INSERT INTO messages (conversation_id, sender, content, message_type, external_message_id, delivery_status, provider)
       VALUES ($1, 'ai', $2, 'text', $3, $4, 'vonage')`,
      [conversationId, aiResponse, sendResult.messageId || null, sendResult.success ? 'sent' : 'failed']
    );

    // Update last SMS timestamp for cooldown tracking
    await query(
      `UPDATE conversations SET last_sms_at = NOW() WHERE id = $1`,
      [conversationId]
    );

    const duration = Date.now() - startTime;
    log.info({
      conversationId,
      callerPhone,
      responseLength: aiResponse.length,
      durationMs: duration,
      smsSent: sendResult.success
    }, 'Inbound SMS processed');

    return res.json({ status: 'ok', conversationId });

  } catch (error) {
    log.error({ error: error.message, stack: error.stack }, 'Inbound SMS processing failed');
    captureException(error, { context: 'inbound_sms' });

    // Rollback idempotency to allow retry
    rollbackIdempotency(req);

    // Don't fail the webhook - Vonage will retry
    return res.json({ status: 'error', message: 'Processing failed, will retry' });
  }
}

// Apply middleware and route handlers
router.post('/incoming',
  webhookIPLimiter,
  webhookPhoneLimiter,
  validateVonageSignature,
  idempotencyCheck,
  handleInboundSMS
);

// GET support for initial Vonage webhook verification (not recommended for production)
router.get('/incoming', handleInboundSMS);

/**
 * SMS Delivery Status Webhook
 * POST /api/sms/status
 */
router.post('/status', webhookIPLimiter, async (req, res) => {
  try {
    const {
      message_id: messageId,
      'message-id': messageIdAlt,
      status,
      'error-code': errorCode,
      'error-text': errorText
    } = req.body;

    const msgId = messageId || messageIdAlt;

    log.info({ messageId: msgId, status, errorCode }, 'SMS delivery status received');

    if (!msgId) {
      return res.json({ status: 'ok' });
    }

    // Map Vonage status to our status
    let deliveryStatus = 'unknown';
    if (status === 'delivered') deliveryStatus = 'delivered';
    else if (status === 'accepted' || status === 'buffered') deliveryStatus = 'sent';
    else if (status === 'failed' || status === 'rejected') deliveryStatus = 'failed';
    else if (status === 'expired') deliveryStatus = 'expired';

    // Update message delivery status
    await query(
      `UPDATE messages
       SET delivery_status = $1,
           delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END,
           delivery_error = $2
       WHERE external_message_id = $3`,
      [deliveryStatus, errorCode ? `${errorCode}: ${errorText}` : null, msgId]
    );

    return res.json({ status: 'ok' });
  } catch (error) {
    log.error({ error: error.message }, 'Delivery status processing failed');
    return res.json({ status: 'ok' }); // Don't retry status webhooks
  }
});

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    provider: 'vonage',
    configured: !!(process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET)
  });
});

// ============================================
// SIMPLIFIED CONVERSATION STATE MACHINE
// ============================================

/**
 * Main conversation handler - SIMPLIFIED for callback classification only
 *
 * States:
 * - awaiting_initial_choice: User picks 1 (appointment callback) or 2 (other callback)
 * - callback_pending: Intent classified, waiting for receptionist to call back
 * - callback_confirmed: Flow complete - receptionist marked as done
 *
 * NO APPOINTMENT BOOKING - both options result in callbacks
 */
async function handleConversation(conversationId, incomingMessage, settings, conversation) {
  const practiceName = settings.practice_name || 'Our Practice';
  const currentStatus = conversation.status;
  const stateData = conversation.state_data || {};

  const trimmed = incomingMessage.trim();
  const input = trimmed.toLowerCase();

  // Handle opt-out keywords
  if (['stop', 'unsubscribe', 'cancel', 'quit'].includes(input)) {
    await updateConversationStatus(conversationId, 'completed', {});
    await query(
      `UPDATE leads SET status = 'lost', notes = 'Opted out via SMS' WHERE conversation_id = $1`,
      [conversationId]
    );
    return `You've been unsubscribed. Reply START to opt back in. Contact ${practiceName} directly if you need help.`;
  }

  // Handle opt-in / restart
  if (['start', 'subscribe', 'hi', 'hello'].includes(input)) {
    await updateConversationStatus(conversationId, 'awaiting_initial_choice', {});
    return `Hi! This is ${practiceName}. We missed your call and want to make sure we help you.\n\nReply 1 if this is about an appointment, or 2 for another reason. We'll call you back shortly.`;
  }

  // Handle help
  if (['help', 'info', '?'].includes(input)) {
    return `${practiceName} Missed Call Follow-up:\n\nReply 1 - Appointment request\nReply 2 - Other enquiry\n\nWe'll call you back shortly.\n\nReply STOP to opt out.`;
  }

  // Process based on current state
  switch (currentStatus) {
    case 'active':
    case 'awaiting_initial_choice': {
      // Reply 1 = Appointment request callback
      if (trimmed === '1' || input === 'one' || input.includes('appointment') || input.includes('book')) {
        await classifyCallbackType(conversationId, 'appointment_request');
        return `Thank you! We received your request and will be in contact shortly. - ${practiceName}`;
      }

      // Reply 2 = General/other callback
      if (trimmed === '2' || input === 'two' || input.includes('other') || input.includes('question')) {
        await classifyCallbackType(conversationId, 'general_callback');
        return `Thank you! We received your request and will be in contact shortly. - ${practiceName}`;
      }

      // Handle any number as a valid response - classify as general
      const numericInput = parseInt(trimmed);
      if (!isNaN(numericInput)) {
        await classifyCallbackType(conversationId, 'general_callback');
        return `Thank you! We received your request and will be in contact shortly. - ${practiceName}`;
      }

      // If they send any text message, just classify as general and confirm
      if (trimmed.length > 0) {
        // Store their message as a note
        await query(
          `UPDATE leads SET notes = $1 WHERE conversation_id = $2`,
          [incomingMessage, conversationId]
        );
        await classifyCallbackType(conversationId, 'general_callback');
        return `Thank you! We received your request and will be in contact shortly. - ${practiceName}`;
      }

      return `Please reply 1 for appointment or 2 for other. We'll call you back shortly.`;
    }

    case 'callback_pending':
    case 'callback_confirmed':
    case 'completed': {
      // Already handled - simple acknowledgment
      return `Thanks for your message! We'll be in contact shortly. - ${practiceName}`;
    }

    default:
      // Unknown state - reset to initial
      await updateConversationStatus(conversationId, 'awaiting_initial_choice', {});
      return `Hi! This is ${practiceName}. We missed your call.\n\nReply 1 for appointment or 2 for other. We'll call you back shortly.`;
  }
}

/**
 * Classify the callback type and update all relevant records
 */
async function classifyCallbackType(conversationId, callbackType) {
  // Update conversation status
  await updateConversationStatus(conversationId, 'callback_pending', {
    callbackType,
    classifiedAt: new Date().toISOString()
  });

  // Update the call record with callback_type
  await query(
    `UPDATE calls
     SET callback_type = $1, handled_by_ai = true
     WHERE id = (SELECT call_id FROM conversations WHERE id = $2)`,
    [callbackType, conversationId]
  );

  // Update lead with callback type and status
  const preferredTime = callbackType === 'appointment_request'
    ? 'Callback requested (appointment)'
    : 'Callback requested (other)';

  await query(
    `UPDATE leads
     SET status = 'qualified',
         callback_type = $1,
         preferred_time = $2
     WHERE conversation_id = $3`,
    [callbackType, preferredTime, conversationId]
  );

  log.info({ conversationId, callbackType }, 'Callback classified');
}

/**
 * Update conversation status and state data
 */
async function updateConversationStatus(conversationId, status, stateData) {
  await query(
    `UPDATE conversations
     SET status = $1, state_data = $2, last_activity_at = NOW()
     WHERE id = $3`,
    [status, JSON.stringify(stateData), conversationId]
  );
}

module.exports = router;
