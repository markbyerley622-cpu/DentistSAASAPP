/**
 * SMS Routes - Vonage Two-Way SMS Integration
 * Handles inbound SMS webhooks and conversational booking flow
 *
 * Security Features:
 * - Signature validation (HMAC-SHA256)
 * - Per-phone rate limiting
 * - Idempotency protection
 * - Input sanitization
 *
 * Production Features:
 * - Structured logging
 * - Retry with exponential backoff
 * - Delivery tracking
 * - Error monitoring (Sentry)
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
         AND status NOT IN ('completed', 'appointment_booked')
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
// CONVERSATION STATE MACHINE
// ============================================

/**
 * Main conversation handler - numeric-only state machine
 * States:
 * - awaiting_initial_choice: User picks 1 (callback) or 2 (appointment)
 * - awaiting_slot_confirmation: Confirm offered slot (1=yes, 2=more options)
 * - awaiting_slot_selection: Choose from multiple slots (1,2,3,4)
 * - callback_requested: Flow complete - callback requested
 * - appointment_booked: Flow complete - appointment booked
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

  // Handle opt-in
  if (['start', 'subscribe', 'hi', 'hello'].includes(input)) {
    await updateConversationStatus(conversationId, 'awaiting_initial_choice', {});
    return `Hi! Thanks for contacting ${practiceName}.\n\nReply:\n1 - Request a callback\n2 - Book an appointment`;
  }

  // Handle help
  if (['help', 'info', '?'].includes(input)) {
    return `${practiceName} SMS Booking:\n\n1 - Request a callback\n2 - Book an appointment\n\nReply STOP to opt out.`;
  }

  // Process based on current state
  switch (currentStatus) {
    case 'active':
    case 'awaiting_initial_choice': {
      // First response - user picks 1 or 2
      if (trimmed === '1' || input === 'one' || input.includes('callback') || input.includes('call me')) {
        await updateConversationStatus(conversationId, 'callback_requested', { intent: 'callback' });
        await query(
          `UPDATE leads SET status = 'qualified', preferred_time = 'Callback requested' WHERE conversation_id = $1`,
          [conversationId]
        );
        return `Got it! Someone from ${practiceName} will call you back as soon as possible. Is there anything specific you'd like us to know?`;
      }

      if (trimmed === '2' || input === 'two' || input.includes('book') || input.includes('appointment')) {
        // Get available slots
        const slots = await getAvailableSlots(settings.user_id, settings.business_hours, 3);

        if (slots.length === 0) {
          await updateConversationStatus(conversationId, 'callback_requested', { intent: 'appointment_no_slots' });
          await query(
            `UPDATE leads SET status = 'qualified', preferred_time = 'No slots available' WHERE conversation_id = $1`,
            [conversationId]
          );
          return `We're currently fully booked. Someone from ${practiceName} will call you to find a time that works.`;
        }

        // Offer first available slot
        const firstSlot = slots[0];
        const formattedSlot = formatSlotForSMS(firstSlot);

        await updateConversationStatus(conversationId, 'awaiting_slot_confirmation', {
          intent: 'appointment',
          suggestedSlots: slots.map(s => s.toISOString()),
          currentSlotIndex: 0
        });

        return `Great! Our next available slot is:\n\n${formattedSlot}\n\nReply:\n1 - Book this time\n2 - See more options`;
      }

      // Didn't understand - prompt again
      return `Please reply:\n\n1 - Request a callback\n2 - Book an appointment`;
    }

    case 'awaiting_slot_confirmation': {
      const suggestedSlots = (stateData.suggestedSlots || []).map(s => new Date(s));
      const currentIndex = stateData.currentSlotIndex || 0;

      if (trimmed === '1' || input === 'yes' || input === 'book') {
        // Book the current slot
        const selectedSlot = suggestedSlots[currentIndex];
        if (!selectedSlot) {
          await updateConversationStatus(conversationId, 'awaiting_initial_choice', {});
          return `Sorry, something went wrong. Please reply 2 to try booking again.`;
        }

        const bookingResult = await bookAppointment(conversationId, selectedSlot, settings);

        if (bookingResult.success) {
          return `BOOKED! Your appointment at ${practiceName} is confirmed for:\n\n${formatSlotForSMS(selectedSlot)}\n\nSee you then!`;
        } else {
          // Slot was taken - offer alternative
          const newSlots = await getAvailableSlots(settings.user_id, settings.business_hours, 3);
          if (newSlots.length > 0) {
            await updateConversationStatus(conversationId, 'awaiting_slot_confirmation', {
              ...stateData,
              suggestedSlots: newSlots.map(s => s.toISOString()),
              currentSlotIndex: 0
            });
            return `Sorry, that time was just booked! Next available:\n\n${formatSlotForSMS(newSlots[0])}\n\nReply:\n1 - Book this time\n2 - See more options`;
          } else {
            await updateConversationStatus(conversationId, 'callback_requested', { intent: 'appointment_conflict' });
            return `Sorry, we're now fully booked. Someone will call you to schedule.`;
          }
        }
      }

      if (trimmed === '2' || input === 'more' || input === 'other') {
        // Show more options
        if (suggestedSlots.length <= 1) {
          // No more options - get fresh slots
          const newSlots = await getAvailableSlots(settings.user_id, settings.business_hours, 4);
          if (newSlots.length <= 1) {
            await updateConversationStatus(conversationId, 'callback_requested', { intent: 'no_suitable_slots' });
            return `We don't have many openings right now. Someone from ${practiceName} will call you to find a time.`;
          }

          await updateConversationStatus(conversationId, 'awaiting_slot_selection', {
            ...stateData,
            suggestedSlots: newSlots.map(s => s.toISOString())
          });

          const slotList = newSlots.slice(0, 4).map((s, i) => `${i + 1} - ${formatSlotForSMS(s)}`).join('\n');
          return `Available times:\n\n${slotList}\n\nReply with the number of your preferred time.`;
        }

        // Move to selection mode with existing slots
        await updateConversationStatus(conversationId, 'awaiting_slot_selection', stateData);

        const slotList = suggestedSlots.slice(0, 4).map((s, i) => `${i + 1} - ${formatSlotForSMS(s)}`).join('\n');
        return `Available times:\n\n${slotList}\n\nReply with the number of your preferred time.`;
      }

      return `Please reply:\n1 - Book this time\n2 - See more options`;
    }

    case 'awaiting_slot_selection': {
      const suggestedSlots = (stateData.suggestedSlots || []).map(s => new Date(s));
      const selection = parseInt(trimmed);

      if (selection >= 1 && selection <= suggestedSlots.length) {
        const selectedSlot = suggestedSlots[selection - 1];
        const bookingResult = await bookAppointment(conversationId, selectedSlot, settings);

        if (bookingResult.success) {
          return `BOOKED! Your appointment at ${practiceName} is confirmed for:\n\n${formatSlotForSMS(selectedSlot)}\n\nSee you then!`;
        } else {
          const newSlots = await getAvailableSlots(settings.user_id, settings.business_hours, 4);
          if (newSlots.length > 0) {
            await updateConversationStatus(conversationId, 'awaiting_slot_selection', {
              ...stateData,
              suggestedSlots: newSlots.map(s => s.toISOString())
            });
            const slotList = newSlots.slice(0, 4).map((s, i) => `${i + 1} - ${formatSlotForSMS(s)}`).join('\n');
            return `Sorry, that time was taken! Updated options:\n\n${slotList}\n\nReply with your choice.`;
          } else {
            await updateConversationStatus(conversationId, 'callback_requested', {});
            return `Sorry, we're now fully booked. Someone will call you.`;
          }
        }
      }

      // Handle "4" for more options or callback request
      if (trimmed === '4' || input.includes('call') || input.includes('other')) {
        await updateConversationStatus(conversationId, 'callback_requested', { intent: 'different_time' });
        await query(
          `UPDATE leads SET status = 'qualified', preferred_time = 'Requested different time' WHERE conversation_id = $1`,
          [conversationId]
        );
        return `No problem! Someone from ${practiceName} will call you to find a better time.`;
      }

      const slotList = suggestedSlots.slice(0, 4).map((s, i) => `${i + 1} - ${formatSlotForSMS(s)}`).join('\n');
      return `Please reply with a number:\n\n${slotList}\n\nOr reply CALL ME for a callback.`;
    }

    case 'callback_requested': {
      // Already requested callback - acknowledge any follow-up
      if (input.includes('thank')) {
        return `You're welcome! ${practiceName} will be in touch soon.`;
      }
      await query(
        `UPDATE leads SET notes = COALESCE(notes, '') || E'\n' || $1 WHERE conversation_id = $2`,
        [`Patient note: ${incomingMessage}`, conversationId]
      );
      return `Thanks for the info! We've noted it down. Someone will call you soon.`;
    }

    case 'appointment_booked': {
      if (input.includes('cancel') || input.includes('change') || input.includes('reschedule')) {
        return `To change your appointment, please call ${practiceName} directly or reply CALL ME and we'll reach out.`;
      }
      return `Thanks for your message! You have an appointment scheduled. Is there anything else we can help with?`;
    }

    default:
      await updateConversationStatus(conversationId, 'awaiting_initial_choice', {});
      return `Hi! Thanks for contacting ${practiceName}.\n\nReply:\n1 - Request a callback\n2 - Book an appointment`;
  }
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

/**
 * Get available appointment slots - OPTIMIZED
 * Queries all existing appointments in date range first, then filters in memory
 */
async function getAvailableSlots(userId, businessHours, numSlots = 3) {
  const now = new Date();
  const maxDays = 14;

  // Default business hours if not set
  const defaultHours = {
    monday: { enabled: true, open: '09:00', close: '17:00' },
    tuesday: { enabled: true, open: '09:00', close: '17:00' },
    wednesday: { enabled: true, open: '09:00', close: '17:00' },
    thursday: { enabled: true, open: '09:00', close: '17:00' },
    friday: { enabled: true, open: '09:00', close: '17:00' },
    saturday: { enabled: false },
    sunday: { enabled: false }
  };

  const hours = businessHours && Object.keys(businessHours).length > 0 ? businessHours : defaultHours;
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  // Calculate date range
  const startDate = now.toISOString().split('T')[0];
  const endDate = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Fetch ALL existing appointments in range (single query instead of N queries)
  const existingAppointments = await query(
    `SELECT appointment_date, appointment_time
     FROM appointments
     WHERE user_id = $1
       AND appointment_date BETWEEN $2 AND $3
       AND status NOT IN ('cancelled', 'no_show')`,
    [userId, startDate, endDate]
  );

  // Create a Set of booked slots for O(1) lookup
  const bookedSlots = new Set(
    existingAppointments.rows.map(row => {
      const date = row.appointment_date instanceof Date
        ? row.appointment_date.toISOString().split('T')[0]
        : row.appointment_date;
      return `${date}T${row.appointment_time}`;
    })
  );

  // Generate available slots
  const availableSlots = [];
  let checkDate = new Date(now);

  while (availableSlots.length < numSlots && checkDate <= new Date(endDate)) {
    const dayName = dayNames[checkDate.getDay()];
    const dayConfig = hours[dayName];

    if (dayConfig?.enabled) {
      const [openHour, openMin] = dayConfig.open.split(':').map(Number);
      const [closeHour, closeMin] = dayConfig.close.split(':').map(Number);

      // Start from opening time (or current time + 1 hour if today)
      let slotTime = new Date(checkDate);
      slotTime.setHours(openHour, openMin, 0, 0);

      const closeTime = new Date(checkDate);
      closeTime.setHours(closeHour, closeMin, 0, 0);

      const isToday = checkDate.toDateString() === now.toDateString();
      const minTime = isToday ? new Date(now.getTime() + 60 * 60 * 1000) : slotTime;

      while (slotTime < closeTime && availableSlots.length < numSlots) {
        if (slotTime >= minTime) {
          const slotDate = slotTime.toISOString().split('T')[0];
          const slotTimeStr = slotTime.toTimeString().slice(0, 5);
          const slotKey = `${slotDate}T${slotTimeStr}`;

          if (!bookedSlots.has(slotKey)) {
            availableSlots.push(new Date(slotTime));
          }
        }
        slotTime = new Date(slotTime.getTime() + 30 * 60 * 1000); // 30-minute slots
      }
    }

    checkDate.setDate(checkDate.getDate() + 1);
    checkDate.setHours(0, 0, 0, 0);
  }

  return availableSlots;
}

/**
 * Book an appointment with proper transaction handling
 * Uses SERIALIZABLE isolation to prevent double-booking
 */
async function bookAppointment(conversationId, slotTime, settings) {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    const appointmentDate = slotTime.toISOString().split('T')[0];
    const appointmentTime = slotTime.toTimeString().slice(0, 5);

    // Check for conflict with row lock
    const conflict = await client.query(
      `SELECT id FROM appointments
       WHERE user_id = $1
         AND appointment_date = $2
         AND appointment_time = $3
         AND status NOT IN ('cancelled', 'no_show')
       FOR UPDATE`,
      [settings.user_id, appointmentDate, appointmentTime]
    );

    if (conflict.rows.length > 0) {
      await client.query('ROLLBACK');
      log.warn({ appointmentDate, appointmentTime }, 'Slot conflict detected');
      return { success: false, reason: 'slot_taken' };
    }

    // Get conversation details for appointment
    const convResult = await client.query(
      `SELECT c.caller_phone, l.id as lead_id, l.name as lead_name
       FROM conversations c
       LEFT JOIN leads l ON l.conversation_id = c.id
       WHERE c.id = $1`,
      [conversationId]
    );

    const conv = convResult.rows[0];
    if (!conv) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'conversation_not_found' };
    }

    // Create appointment
    const appointmentResult = await client.query(
      `INSERT INTO appointments (user_id, lead_id, conversation_id, patient_name, patient_phone, appointment_date, appointment_time, status, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', 'SMS Booking')
       RETURNING id`,
      [settings.user_id, conv.lead_id, conversationId, conv.lead_name || 'SMS Booking', conv.caller_phone, appointmentDate, appointmentTime]
    );

    const appointmentId = appointmentResult.rows[0].id;

    // Update conversation
    await client.query(
      `UPDATE conversations SET status = 'appointment_booked', state_data = $1 WHERE id = $2`,
      [JSON.stringify({ appointmentId, bookedAt: new Date().toISOString() }), conversationId]
    );

    // Update lead
    const formattedTime = slotTime.toLocaleString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    await client.query(
      `UPDATE leads
       SET status = 'converted',
           appointment_booked = true,
           appointment_time = $1,
           appointment_id = $2
       WHERE conversation_id = $3`,
      [slotTime.toISOString(), appointmentId, conversationId]
    );

    await client.query('COMMIT');

    log.info({
      conversationId,
      appointmentId,
      appointmentDate,
      appointmentTime
    }, 'Appointment booked successfully');

    return { success: true, appointmentId };

  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '40001') {
      // Serialization failure - concurrent booking
      log.warn({ conversationId, error: error.message }, 'Serialization conflict');
      return { success: false, reason: 'concurrent_booking' };
    }

    log.error({ conversationId, error: error.message }, 'Booking failed');
    captureException(error, { context: 'book_appointment', conversationId });
    return { success: false, reason: 'error' };

  } finally {
    client.release();
  }
}

/**
 * Format a slot for SMS display
 */
function formatSlotForSMS(slot) {
  return slot.toLocaleString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

module.exports = router;
