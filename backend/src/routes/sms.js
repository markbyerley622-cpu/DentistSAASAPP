/**
 * SMS Webhook Handler
 *
 * Handles inbound SMS messages from CellCast and manages the booking conversation.
 * This replaces the Twilio SMS webhook functionality.
 *
 * Webhook URL: https://your-app.com/api/sms/incoming
 * Configure this URL in your CellCast dashboard for inbound SMS.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, getClient } = require('../db/config');
const { decrypt } = require('../utils/crypto');
const cellcast = require('../services/cellcast');

const router = express.Router();

// Rate limiter for webhook protection
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false
});

router.use(webhookLimiter);

// =====================================================
// INBOUND SMS WEBHOOK (FROM CELLCAST)
// =====================================================

/**
 * CellCast inbound SMS webhook
 *
 * POST /api/sms/incoming
 *
 * CellCast sends:
 * {
 *   "from": "+61412345678",
 *   "to": "+61481073412",
 *   "message": "Hello!",
 *   "message_id": "abc123"
 * }
 */
router.post('/incoming', async (req, res) => {
  try {
    console.log('Inbound SMS webhook received:', JSON.stringify(req.body));

    // Parse the incoming message
    const parsed = cellcast.parseInboundWebhook(req.body);
    const { from: callerPhone, to: smsNumber, message: messageBody, messageId } = parsed;

    if (!callerPhone || !messageBody) {
      console.log('Invalid inbound SMS webhook - missing from or body:', req.body);
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`Inbound SMS from ${callerPhone}: ${messageBody}`);

    const normalizedCaller = cellcast.normalizePhoneNumber(callerPhone);
    let settings = null;

    // CellCast doesn't include 'to' field, so find user by:
    // 1. Most recent active conversation with this caller
    // 2. Or by SMS reply number if provided
    if (smsNumber) {
      const settingsResult = await query(
        `SELECT s.*, u.id as user_id, u.practice_name
         FROM settings s
         JOIN users u ON s.user_id = u.id
         WHERE s.sms_reply_number = $1`,
        [smsNumber]
      );
      settings = settingsResult.rows[0];
    }

    // If no 'to' field or no match, find by most recent conversation
    if (!settings) {
      const recentConv = await query(
        `SELECT s.*, u.id as user_id, u.practice_name
         FROM conversations c
         JOIN users u ON c.user_id = u.id
         JOIN settings s ON s.user_id = u.id
         WHERE c.caller_phone = $1
           AND c.channel = 'sms'
           AND c.status IN ('active', 'awaiting_response', 'awaiting_time_selection', 'callback_requested')
         ORDER BY c.created_at DESC
         LIMIT 1`,
        [normalizedCaller]
      );
      settings = recentConv.rows[0];
    }

    if (!settings) {
      console.log(`No user/conversation found for caller: ${callerPhone}`);
      return res.json({ status: 'ok', action: 'no_user' });
    }

    console.log(`Found user ${settings.user_id} (${settings.practice_name}) for caller ${callerPhone}`);

    // Find or create conversation for this phone number
    let conversationResult = await query(
      `SELECT * FROM conversations
       WHERE user_id = $1 AND caller_phone = $2 AND status IN ('active', 'awaiting_response', 'awaiting_time_selection', 'callback_requested')
       ORDER BY created_at DESC LIMIT 1`,
      [settings.user_id, normalizedCaller]
    );

    let conversationId;

    if (conversationResult.rows.length === 0) {
      // Create new conversation
      const newConversation = await query(
        `INSERT INTO conversations (user_id, caller_phone, channel, direction, status)
         VALUES ($1, $2, 'sms', 'inbound', 'active')
         RETURNING id`,
        [settings.user_id, normalizedCaller]
      );
      conversationId = newConversation.rows[0].id;

      // Create a lead for this new conversation
      await query(
        `INSERT INTO leads (user_id, conversation_id, name, phone, status, source)
         VALUES ($1, $2, 'SMS Inquiry', $3, 'new', 'sms')`,
        [settings.user_id, conversationId, normalizedCaller]
      );
    } else {
      conversationId = conversationResult.rows[0].id;
    }

    // Store the incoming message
    await query(
      `INSERT INTO messages (conversation_id, sender, content, message_type, delivered)
       VALUES ($1, 'caller', $2, 'text', true)`,
      [conversationId, messageBody]
    );

    // Handle conversation with state machine
    const aiResponse = await handleConversation(conversationId, messageBody, settings);

    // Store AI response
    await query(
      `INSERT INTO messages (conversation_id, sender, content, message_type, delivered)
       VALUES ($1, 'ai', $2, 'text', true)`,
      [conversationId, aiResponse]
    );

    // Send response via CellCast
    const apiKey = settings.cellcast_api_key ? decrypt(settings.cellcast_api_key) : process.env.CELLCAST_API_KEY;
    const fromNumber = settings.sms_reply_number || process.env.CELLCAST_PHONE_NUMBER;

    if (apiKey) {
      const sendResult = await cellcast.sendSMS(apiKey, callerPhone, aiResponse, fromNumber);
      if (!sendResult.success) {
        console.error('Failed to send SMS response:', sendResult.error);
      }
    }

    res.json({ status: 'ok', action: 'responded' });
  } catch (error) {
    console.error('Inbound SMS error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// SMS DELIVERY STATUS WEBHOOK
// =====================================================

/**
 * CellCast delivery status webhook
 *
 * POST /api/sms/status
 */
router.post('/status', async (req, res) => {
  try {
    const { message_id, status, error_code, error_message } = req.body;

    if (error_code) {
      console.error(`SMS delivery failed: ${error_code} - ${error_message}`);
    } else {
      console.log(`SMS ${message_id} status: ${status}`);
    }

    res.json({ status: 'ok' });
  } catch (error) {
    console.error('SMS status webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// CONVERSATION STATE MACHINE
// (Migrated from twilio.js)
// =====================================================

/**
 * Detect user intent from their message using deterministic rules
 */
function detectIntent(message) {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (trimmed === '1' || lower === 'one' || lower === '1.') {
    return 'callback';
  }

  if (trimmed === '2' || lower === 'two' || lower === '2.') {
    return 'appointment';
  }

  if (lower === 'yes' || lower === 'yeah' || lower === 'yep' || lower === 'confirm' || lower === 'ok' || lower === 'okay') {
    return 'confirm';
  }

  if (lower.includes('call') || lower.includes('callback') || lower.includes('ring')) {
    return 'callback';
  }

  if (lower.includes('book') || lower.includes('appointment') || lower.includes('schedule')) {
    return 'appointment';
  }

  return 'freetext';
}

/**
 * Parse time selection from message
 */
function parseTimeSelection(message) {
  const trimmed = message.trim();
  const num = parseInt(trimmed);
  if (num >= 1 && num <= 3) return num - 1;

  const lower = trimmed.toLowerCase();
  if (lower.includes('first') || lower === '1' || lower.includes('one')) return 0;
  if (lower.includes('second') || lower === '2' || lower.includes('two')) return 1;
  if (lower.includes('third') || lower === '3' || lower.includes('three')) return 2;

  return -1;
}

/**
 * Find next available slot after a given time
 */
async function findNextAvailableSlot(userId, startTime, businessHours, maxDaysToCheck = 7) {
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  const defaultHours = {
    monday: { enabled: true, open: '09:00', close: '17:00' },
    tuesday: { enabled: true, open: '09:00', close: '17:00' },
    wednesday: { enabled: true, open: '09:00', close: '17:00' },
    thursday: { enabled: true, open: '09:00', close: '17:00' },
    friday: { enabled: true, open: '09:00', close: '17:00' },
    saturday: { enabled: false, open: '09:00', close: '13:00' },
    sunday: { enabled: false, open: '09:00', close: '13:00' }
  };

  const hours = businessHours && Object.keys(businessHours).length > 0 ? businessHours : defaultHours;
  let checkTime = new Date(startTime.getTime() + 30 * 60 * 1000);
  let daysChecked = 0;

  while (daysChecked < maxDaysToCheck) {
    const dayName = dayNames[checkTime.getDay()];
    const dayHours = hours[dayName];

    if (dayHours && dayHours.enabled) {
      const [openHour, openMin] = dayHours.open.split(':').map(Number);
      const [closeHour, closeMin] = dayHours.close.split(':').map(Number);

      const dayStart = new Date(checkTime);
      dayStart.setHours(openHour, openMin, 0, 0);

      const dayEnd = new Date(checkTime);
      dayEnd.setHours(closeHour, closeMin, 0, 0);

      if (checkTime < dayStart) {
        checkTime = new Date(dayStart);
      }

      while (checkTime < dayEnd) {
        const slotDate = checkTime.toISOString().split('T')[0];
        const slotTime = checkTime.toTimeString().slice(0, 5);

        const existing = await query(
          `SELECT id FROM appointments
           WHERE user_id = $1
             AND appointment_date = $2::date
             AND appointment_time = $3
             AND status NOT IN ('cancelled', 'no_show')
           LIMIT 1`,
          [userId, slotDate, slotTime]
        );

        if (existing.rows.length === 0) {
          return new Date(checkTime);
        }

        checkTime = new Date(checkTime.getTime() + 30 * 60 * 1000);
      }
    }

    checkTime = new Date(checkTime);
    checkTime.setDate(checkTime.getDate() + 1);
    checkTime.setHours(0, 0, 0, 0);
    daysChecked++;
  }

  return null;
}

/**
 * Generate available time slots from business hours
 */
function getAvailableSlotsFromBusinessHours(businessHours, numSlots = 3) {
  const now = new Date();

  const defaultHours = {
    monday: { enabled: true, open: '09:00', close: '17:00' },
    tuesday: { enabled: true, open: '09:00', close: '17:00' },
    wednesday: { enabled: true, open: '09:00', close: '17:00' },
    thursday: { enabled: true, open: '09:00', close: '17:00' },
    friday: { enabled: true, open: '09:00', close: '17:00' },
    saturday: { enabled: false, open: '09:00', close: '13:00' },
    sunday: { enabled: false, open: '09:00', close: '13:00' }
  };

  const hours = businessHours && Object.keys(businessHours).length > 0 ? businessHours : defaultHours;
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  function getSlotsForDay(date) {
    const dayName = dayNames[date.getDay()];
    const dayHours = hours[dayName];
    const daySlots = [];

    if (!dayHours || !dayHours.enabled) return daySlots;

    const [openHour, openMin] = dayHours.open.split(':').map(Number);
    const [closeHour, closeMin] = dayHours.close.split(':').map(Number);

    let slotTime = new Date(date);
    slotTime.setHours(openHour, openMin, 0, 0);

    const closeTime = new Date(date);
    closeTime.setHours(closeHour, closeMin, 0, 0);

    const isToday = date.toDateString() === now.toDateString();
    const minTime = isToday ? new Date(now.getTime() + 60 * 60 * 1000) : slotTime;

    while (slotTime < closeTime) {
      if (slotTime >= minTime) {
        daySlots.push(new Date(slotTime));
      }
      slotTime = new Date(slotTime.getTime() + 30 * 60 * 1000);
    }

    return daySlots;
  }

  const result = [];
  let daysChecked = 0;
  let firstDaySlots = [];
  let secondDaySlots = [];
  let firstDayFound = false;

  while (daysChecked < 14 && secondDaySlots.length === 0) {
    const checkDate = new Date(now);
    checkDate.setDate(now.getDate() + daysChecked);

    const daySlots = getSlotsForDay(checkDate);

    if (daySlots.length > 0) {
      if (!firstDayFound) {
        firstDaySlots = daySlots;
        firstDayFound = true;
      } else {
        secondDaySlots = daySlots;
      }
    }

    daysChecked++;
  }

  if (firstDaySlots.length >= 2) {
    result.push(firstDaySlots[0]);
    const laterIndex = Math.min(Math.floor(firstDaySlots.length / 2), firstDaySlots.length - 1);
    if (laterIndex !== 0) {
      result.push(firstDaySlots[laterIndex]);
    } else if (firstDaySlots.length > 1) {
      result.push(firstDaySlots[1]);
    }
  } else if (firstDaySlots.length === 1) {
    result.push(firstDaySlots[0]);
  }

  if (secondDaySlots.length > 0 && result.length < numSlots) {
    result.push(secondDaySlots[0]);
  }

  if (result.length < numSlots && firstDaySlots.length > 2) {
    for (let i = 1; i < firstDaySlots.length && result.length < numSlots; i++) {
      if (!result.some(r => r.getTime() === firstDaySlots[i].getTime())) {
        result.push(firstDaySlots[i]);
      }
    }
  }

  return result;
}

/**
 * Format slots for SMS
 */
function formatSlotsForSMS(slots) {
  return slots.map((slot) => {
    const day = slot.toLocaleDateString('en-US', { weekday: 'long' });
    const time = slot.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${time} ${day} CONFIRM`;
  }).join('\n');
}

// Typo tolerance for CONFIRM
const CONFIRM_TYPOS = [
  'confirm', 'comfirm', 'confrim', 'confrm', 'cofirm', 'confim', 'conferm',
  'comfrim', 'confrom', 'confiirm', 'confirn', 'confirme', 'confirmed',
  'konfirm', 'cunfirm', 'confir', 'confrirm', 'book', 'yes', 'yep', 'yeah',
  'ok', 'okay', 'sure', 'sounds good', 'perfect', 'great', 'thatworks', 'that works'
];

const DAY_CORRECTIONS = {
  'monday': 'monday', 'mon': 'monday', 'munday': 'monday', 'mondy': 'monday',
  'tuesday': 'tuesday', 'tue': 'tuesday', 'tues': 'tuesday', 'teusday': 'tuesday',
  'wednesday': 'wednesday', 'wed': 'wednesday', 'weds': 'wednesday', 'wensday': 'wednesday',
  'thursday': 'thursday', 'thu': 'thursday', 'thurs': 'thursday', 'thrusday': 'thursday',
  'friday': 'friday', 'fri': 'friday', 'firday': 'friday', 'frday': 'friday',
  'saturday': 'saturday', 'sat': 'saturday', 'saterday': 'saturday',
  'sunday': 'sunday', 'sun': 'sunday', 'sundy': 'sunday'
};

function hasConfirmIntent(message) {
  const lower = message.toLowerCase();
  return CONFIRM_TYPOS.some(typo => lower.includes(typo));
}

function extractDayFromMessage(message) {
  const lower = message.toLowerCase();
  for (const [typo, correct] of Object.entries(DAY_CORRECTIONS)) {
    if (lower.includes(typo)) return correct;
  }
  return null;
}

function extractTimeFromMessage(message) {
  const lower = message.toLowerCase().replace(/\./g, '');

  const patterns = [
    /(\d{1,2}):(\d{2})\s*(am|pm|a|p)/i,
    /(\d{1,2})(\d{2})\s*(am|pm|a|p)/i,
    /(\d{1,2})\s*:\s*(\d{2})\s*(am|pm|a|p)/i,
    /(\d{1,2})\s*(am|pm|a|p)/i,
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      let hour = parseInt(match[1]);
      let minutes = match[2] && match[2].length === 2 ? parseInt(match[2]) : 0;
      const meridiem = (match[3] || match[2]).toLowerCase();

      const isPM = meridiem.startsWith('p');
      const isAM = meridiem.startsWith('a');

      if (isPM && hour !== 12) hour += 12;
      if (isAM && hour === 12) hour = 0;

      return { hour, minutes };
    }
  }

  const justNumber = lower.match(/\b(\d{1,2})\b/);
  if (justNumber) {
    return { hour: parseInt(justNumber[1]), minutes: 0, ambiguous: true };
  }

  return null;
}

function parseConfirmResponse(message, suggestedSlots) {
  const lower = message.toLowerCase().trim();

  if (!hasConfirmIntent(lower)) return -1;

  const extractedDay = extractDayFromMessage(lower);
  const extractedTime = extractTimeFromMessage(lower);

  if (extractedDay) {
    for (let i = 0; i < suggestedSlots.length; i++) {
      const slotDay = suggestedSlots[i].toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

      if (slotDay === extractedDay) {
        if (extractedTime) {
          const slotHour = suggestedSlots[i].getHours();
          const slotMinutes = suggestedSlots[i].getMinutes();

          if (extractedTime.ambiguous) {
            if (extractedTime.hour === slotHour || extractedTime.hour + 12 === slotHour) return i;
          } else {
            if (extractedTime.hour === slotHour &&
                (extractedTime.minutes === slotMinutes || extractedTime.minutes === 0)) {
              return i;
            }
            if (extractedTime.hour === slotHour && extractedTime.minutes === 0 && slotMinutes === 30) {
              return i;
            }
          }
        } else {
          const slotsOnThisDay = suggestedSlots.filter(s =>
            s.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase() === extractedDay
          );
          if (slotsOnThisDay.length === 1) return i;
        }
      }
    }
  }

  if (extractedTime && !extractedTime.ambiguous) {
    for (let i = 0; i < suggestedSlots.length; i++) {
      const slotHour = suggestedSlots[i].getHours();
      const slotMinutes = suggestedSlots[i].getMinutes();

      if (extractedTime.hour === slotHour) {
        if (extractedTime.minutes === slotMinutes || extractedTime.minutes === 0) return i;
      }
    }
  }

  const numMatch = lower.match(/\b([123])\b/);
  if (numMatch) {
    const idx = parseInt(numMatch[1]) - 1;
    if (idx >= 0 && idx < suggestedSlots.length) return idx;
  }

  if (suggestedSlots.length === 1) return 0;

  return -1;
}

/**
 * Main conversation handler - state machine
 */
async function handleConversation(conversationId, incomingMessage, settings) {
  const practiceName = settings.practice_name || 'Our Practice';

  const convResult = await query(
    `SELECT * FROM conversations WHERE id = $1`,
    [conversationId]
  );

  if (convResult.rows.length === 0) {
    return `Thanks for your message! How can we help you today?`;
  }

  const conversation = convResult.rows[0];
  const currentStatus = conversation.status;
  const lower = incomingMessage.toLowerCase().trim();

  // Handle special keywords
  if (lower === 'stop' || lower === 'unsubscribe' || lower === 'cancel' || lower === 'quit') {
    await query(
      `UPDATE conversations SET status = 'completed', ended_at = NOW() WHERE id = $1`,
      [conversationId]
    );
    await query(
      `UPDATE leads SET status = 'not_interested', notes = 'Opted out via SMS' WHERE conversation_id = $1`,
      [conversationId]
    );
    return `You've been unsubscribed. Reply START to opt back in. Contact ${practiceName} directly if you need assistance.`;
  }

  if (lower === 'start' || lower === 'subscribe') {
    await query(
      `UPDATE conversations SET status = 'active' WHERE id = $1`,
      [conversationId]
    );
    return `Welcome back! Reply 1 for a callback, or 2 to schedule an appointment with ${practiceName}.`;
  }

  if (lower === 'help' || lower === 'info' || lower === '?') {
    return `${practiceName} SMS Booking:\n- Reply 1 for a callback\n- Reply 2 to book an appointment\n- Reply STOP to opt out\n\nNeed help? Call us directly!`;
  }

  // Handle based on current state
  switch (currentStatus) {
    case 'active':
    case 'awaiting_response': {
      const intent = detectIntent(incomingMessage);

      if (intent === 'freetext') {
        await query(
          `UPDATE leads SET status = 'qualified', reason = $1 WHERE conversation_id = $2`,
          [`Patient message: ${incomingMessage}`, conversationId]
        );

        await query(
          `UPDATE conversations SET status = 'callback_requested' WHERE id = $1`,
          [conversationId]
        );

        return `Thanks for the details! Someone from ${practiceName} will call you back shortly to help. Reply 1 if you'd like us to call you back, or 2 to schedule an appointment.`;
      }

      const businessHours = settings.business_hours || {};
      const slots = getAvailableSlotsFromBusinessHours(businessHours, 3);

      if (slots.length === 0) {
        await query(
          `UPDATE conversations SET status = 'callback_requested' WHERE id = $1`,
          [conversationId]
        );

        await query(
          `UPDATE leads SET status = 'qualified', preferred_time = 'Callback requested' WHERE conversation_id = $1`,
          [conversationId]
        );

        return `Thanks for getting back to us! We're currently fully booked, but we'll have someone from ${practiceName} call you back shortly to find a time that works.`;
      }

      await query(
        `UPDATE conversations SET status = 'awaiting_time_selection' WHERE id = $1`,
        [conversationId]
      );

      await query(
        `INSERT INTO messages (conversation_id, sender, content, message_type)
         VALUES ($1, 'system', $2, 'system')`,
        [conversationId, JSON.stringify({ suggested_times: slots, intent })]
      );

      await query(
        `UPDATE leads SET status = 'contacted', reason = $1 WHERE conversation_id = $2`,
        [intent === 'callback' ? 'Wants callback' : 'Wants appointment', conversationId]
      );

      const actionText = intent === 'callback' ? 'call you back' : 'book you in';
      const formattedTimes = formatSlotsForSMS(slots);

      return `Great! We can ${actionText} at these times. Reply with your choice to book:\n\n${formattedTimes}\n\nOr reply DIFFERENT for other options.`;
    }

    case 'awaiting_time_selection': {
      const systemMsgResult = await query(
        `SELECT content FROM messages
         WHERE conversation_id = $1 AND message_type = 'system'
         ORDER BY created_at DESC LIMIT 1`,
        [conversationId]
      );

      if (systemMsgResult.rows.length === 0) {
        await query(
          `UPDATE conversations SET status = 'active' WHERE id = $1`,
          [conversationId]
        );
        return `Sorry, something went wrong. Would you like us to call you back, or would you prefer to schedule an appointment?`;
      }

      const systemData = JSON.parse(systemMsgResult.rows[0].content);
      const suggestedTimes = systemData.suggested_times.map(t => new Date(t));
      const intent = systemData.intent || 'appointment';

      let selectedIndex = parseConfirmResponse(incomingMessage, suggestedTimes);

      if (selectedIndex === -1) {
        selectedIndex = parseTimeSelection(incomingMessage);
      }

      const userIntent = detectIntent(incomingMessage);
      if (userIntent === 'confirm' && suggestedTimes.length === 1 && systemData.original_choice_taken) {
        selectedIndex = 0;
      }

      if (selectedIndex === -1 || selectedIndex >= suggestedTimes.length) {
        if (lower.includes('different') || lower.includes('other') || lower.includes('none') ||
            lower.includes('call me') || lower.includes('callback') || lower.includes('call back')) {
          await query(
            `UPDATE conversations SET status = 'callback_requested' WHERE id = $1`,
            [conversationId]
          );

          await query(
            `UPDATE leads SET status = 'qualified', preferred_time = 'Requested different time' WHERE conversation_id = $1`,
            [conversationId]
          );

          return `No problem! We'll have someone from ${practiceName} call you to find a time that works better.`;
        }

        const formattedTimes = formatSlotsForSMS(suggestedTimes);
        const exampleSlot = suggestedTimes[0];
        const exampleDay = exampleSlot.toLocaleDateString('en-US', { weekday: 'long' });
        const exampleTime = exampleSlot.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

        return `No worries! Just copy and send one of these to book:\n\n${formattedTimes}\n\nExample: "${exampleTime} ${exampleDay} CONFIRM"\n\nOr reply CALL ME to request a callback.`;
      }

      // Valid selection - book appointment
      const selectedTime = suggestedTimes[selectedIndex];
      const appointmentDate = selectedTime.toISOString().split('T')[0];
      const appointmentTime = selectedTime.toTimeString().slice(0, 5);

      const client = await getClient();

      try {
        await client.query('BEGIN');
        await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

        const existingBooking = await client.query(
          `SELECT id FROM appointments
           WHERE user_id = $1
             AND appointment_date = $2::date
             AND appointment_time = $3
             AND status NOT IN ('cancelled', 'no_show')
           FOR UPDATE`,
          [settings.user_id, appointmentDate, appointmentTime]
        );

        if (existingBooking.rows.length > 0) {
          await client.query('ROLLBACK');
          client.release();

          const nextSlot = await findNextAvailableSlot(settings.user_id, selectedTime, settings.business_hours);

          if (nextSlot) {
            const nextDay = nextSlot.toLocaleDateString('en-US', { weekday: 'long' });
            const nextTime = nextSlot.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            const nextConfirmFormat = `${nextTime} ${nextDay} CONFIRM`;

            await query(
              `UPDATE messages SET content = $1
               WHERE conversation_id = $2 AND message_type = 'system'
               ORDER BY created_at DESC LIMIT 1`,
              [JSON.stringify({ suggested_times: [nextSlot], intent, original_choice_taken: true }), conversationId]
            );

            return `Sorry, that time was just booked! Next available:\n\n${nextConfirmFormat}\n\nReply with the above to book, or DIFFERENT for other options.`;
          } else {
            return `Sorry, that time was just booked and we're quite full. We'll have someone call you to find a time that works.`;
          }
        }

        const formattedTime = selectedTime.toLocaleString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });

        await client.query(
          `UPDATE conversations SET status = 'appointment_booked', ended_at = NOW() WHERE id = $1`,
          [conversationId]
        );

        await client.query(
          `UPDATE leads
           SET status = 'converted',
               appointment_booked = true,
               appointment_time = $1,
               preferred_time = $2,
               reason = $3
           WHERE conversation_id = $4`,
          [selectedTime.toISOString(), formattedTime, intent === 'callback' ? 'Callback scheduled' : 'Appointment scheduled', conversationId]
        );

        await client.query(
          `INSERT INTO appointments (user_id, lead_id, patient_name, patient_phone, appointment_date, appointment_time, reason, status)
           SELECT c.user_id, l.id, COALESCE(NULLIF(l.name, ''), 'SMS Booking'), c.caller_phone, $1::date, $2, $3, 'scheduled'
           FROM conversations c
           LEFT JOIN leads l ON l.conversation_id = c.id
           WHERE c.id = $4`,
          [appointmentDate, appointmentTime, intent, conversationId]
        );

        await client.query('COMMIT');
        client.release();

        const actionWord = intent === 'callback' ? 'CALLBACK' : 'APPOINTMENT';
        if (settings.booking_mode === 'auto') {
          return `SCHEDULED! Your ${actionWord.toLowerCase()} is booked for ${formattedTime} at ${practiceName}. See you then!`;
        } else {
          return `RECEIVED! Your ${actionWord.toLowerCase()} request for ${formattedTime} has been submitted. ${practiceName} will confirm shortly.`;
        }
      } catch (txError) {
        await client.query('ROLLBACK');
        client.release();

        if (txError.code === '40001') {
          return `That time slot was just booked by someone else. Please reply with a different time or we can call you to schedule.`;
        }

        console.error('Transaction error:', txError);
        return `We had a technical issue booking your appointment. Please reply again or call us directly.`;
      }
    }

    case 'appointment_booked': {
      if (lower.includes('cancel') || lower.includes('change') || lower.includes('reschedule')) {
        return `No problem! Please call ${practiceName} directly to make changes to your appointment, or reply here and we'll have someone call you back.`;
      }
      return `Thanks for your message! You already have an appointment scheduled. Is there anything else we can help you with?`;
    }

    case 'callback_requested': {
      if (lower.includes('thank')) {
        return `You're welcome! Someone from ${practiceName} will be in touch soon.`;
      }
      return `Thanks! We've noted your message. Someone from ${practiceName} will call you back as soon as possible.`;
    }

    default: {
      return `Thanks for your message! Would you like us to call you back, or would you prefer to schedule an appointment? Just let us know!`;
    }
  }
}

// =====================================================
// HEALTH CHECK
// =====================================================

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'sms-webhooks',
    provider: 'cellcast',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
