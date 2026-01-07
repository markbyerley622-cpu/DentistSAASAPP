const express = require('express');
const twilio = require('twilio');
const crypto = require('crypto');
const { query, getClient } = require('../db/config');
const { authenticate } = require('../middleware/auth');

// Decryption for Twilio auth tokens (must match settings.js encryption)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'dev-only-32-char-key-not-prod!!';
const IV_LENGTH = 16;

function decryptAuthToken(text) {
  if (!text) return null;
  try {
    // Check if it's encrypted (contains colon separator)
    if (!text.includes(':')) {
      // Not encrypted (legacy data), return as-is
      return text;
    }
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error('Auth token decryption error:', error.message);
    // Return original text if decryption fails (legacy unencrypted data)
    return text;
  }
}

const router = express.Router();

/**
 * Twilio Webhook Signature Validation Middleware
 * Validates that incoming webhook requests are actually from Twilio
 * by checking the X-Twilio-Signature header against the request body
 */
async function validateTwilioWebhook(req, res, next) {
  try {
    const signature = req.headers['x-twilio-signature'];

    // In development, skip validation if no signature (for testing)
    if (process.env.NODE_ENV !== 'production' && !signature) {
      console.log('[DEV] Skipping Twilio signature validation');
      return next();
    }

    if (!signature) {
      console.error('Missing X-Twilio-Signature header');
      return res.status(403).send('Forbidden: Missing signature');
    }

    // Get the Twilio number from request (To for incoming, could also be From for outgoing status)
    const twilioNumber = req.body.To || req.body.From || req.query.twilioNumber;

    if (!twilioNumber) {
      console.error('No Twilio number found in request');
      return res.status(400).send('Bad Request: Missing phone number');
    }

    // Look up the auth token for this Twilio number
    const settingsResult = await query(
      'SELECT twilio_auth_token FROM settings WHERE twilio_phone = $1',
      [twilioNumber]
    );

    // Also try the twilioNumber from query params (for dial-status callbacks)
    let encryptedAuthToken = settingsResult.rows[0]?.twilio_auth_token;

    if (!encryptedAuthToken && req.query.twilioNumber) {
      const altResult = await query(
        'SELECT twilio_auth_token FROM settings WHERE twilio_phone = $1',
        [req.query.twilioNumber]
      );
      encryptedAuthToken = altResult.rows[0]?.twilio_auth_token;
    }

    if (!encryptedAuthToken) {
      console.error('No auth token found for Twilio number:', twilioNumber);
      // Allow request to proceed - the handler will return appropriate error
      return next();
    }

    // Decrypt the auth token
    const authToken = decryptAuthToken(encryptedAuthToken);

    // Build the full URL that Twilio used to sign the request
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['host'];
    const originalUrl = req.originalUrl;
    const url = `${protocol}://${host}${originalUrl}`;

    // Validate the signature
    const isValid = twilio.validateRequest(
      authToken,
      signature,
      url,
      req.body
    );

    if (!isValid) {
      console.error('Invalid Twilio signature for URL:', url);
      return res.status(403).send('Forbidden: Invalid signature');
    }

    next();
  } catch (error) {
    console.error('Twilio webhook validation error:', error);
    // In case of validation errors, reject the request in production
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).send('Validation error');
    }
    next();
  }
}

/**
 * SmileDesk Twilio Integration - SMS Only
 *
 * This module handles SMS-based patient communication:
 * 1. When a call is missed, the system sends an automatic SMS follow-up
 * 2. Patients can reply to SMS messages to interact with the AI
 * 3. All communication is text-based (no voice/call handling by AI)
 *
 * Flow:
 * 1. Patient calls Twilio number
 * 2. Twilio forwards call to dentist's real phone (via /voice/incoming webhook)
 * 3. If dentist doesn't answer (missed), status callback fires
 * 4. SmileDesk sends instant SMS follow-up to the patient
 * 5. Patient replies via SMS -> AI responds via SMS
 * 6. Conversation continues until appointment is booked or resolved
 *
 * SETUP IN TWILIO CONSOLE:
 * For each phone number, configure:
 * - Voice: Webhook URL = https://your-app.com/api/twilio/voice/incoming (HTTP POST)
 * - Messaging: Webhook URL = https://your-app.com/api/twilio/sms/incoming (HTTP POST)
 */

// Twilio webhook - handles incoming VOICE calls (forwards to dentist's phone)
router.post('/voice/incoming', validateTwilioWebhook, async (req, res) => {
  try {
    const { CallSid, From, To, CallStatus } = req.body;

    console.log(`Incoming call from ${From} to ${To}`);

    // Find user by Twilio phone number
    const settingsResult = await query(
      `SELECT s.*, u.id as user_id, u.practice_name, u.phone as user_phone
       FROM settings s
       JOIN users u ON s.user_id = u.id
       WHERE s.twilio_phone = $1`,
      [To]
    );

    if (settingsResult.rows.length === 0) {
      // Number not configured - play message and hang up
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say({ voice: 'alice' }, 'Sorry, this number is not configured. Please try again later.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const settings = settingsResult.rows[0];
    const forwardingPhone = settings.forwarding_phone || settings.user_phone;

    if (!forwardingPhone) {
      // No forwarding number configured - play message
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say({ voice: 'alice' }, `Thank you for calling ${settings.practice_name || 'our practice'}. We are unable to take your call right now. Please leave a message or we will text you shortly.`);
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    // Create TwiML to forward the call to the dentist's phone
    const twiml = new twilio.twiml.VoiceResponse();

    // Dial the dentist's phone with a timeout
    // When call ends, status callback will fire and we'll know if it was missed
    const dial = twiml.dial({
      callerId: To, // Show the Twilio number as caller ID
      timeout: 25,  // Ring for 25 seconds before giving up
      action: `/api/twilio/voice/dial-status?originalFrom=${encodeURIComponent(From)}&twilioNumber=${encodeURIComponent(To)}`,
      method: 'POST'
    });

    dial.number(forwardingPhone);

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('Incoming voice call error:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: 'alice' }, 'We are experiencing technical difficulties. Please try again later.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// Twilio webhook - called after the dial attempt completes
router.post('/voice/dial-status', validateTwilioWebhook, async (req, res) => {
  try {
    const { DialCallStatus, CallSid } = req.body;
    const originalFrom = req.query.originalFrom;
    const twilioNumber = req.query.twilioNumber;

    console.log(`Dial status: ${DialCallStatus} for call from ${originalFrom}`);

    // If the call was NOT answered (missed), offer voicemail
    if (['no-answer', 'busy', 'failed', 'canceled'].includes(DialCallStatus)) {
      // Find user by Twilio phone number to get practice name
      const settingsResult = await query(
        `SELECT s.*, u.id as user_id, u.practice_name
         FROM settings s
         JOIN users u ON s.user_id = u.id
         WHERE s.twilio_phone = $1`,
        [twilioNumber]
      );

      const practiceName = settingsResult.rows.length > 0
        ? settingsResult.rows[0].practice_name || 'our practice'
        : 'our practice';

      // Offer voicemail option - if they leave one, no SMS; if they hang up, send SMS
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say({ voice: 'alice' }, `Sorry we missed your call at ${practiceName}. Please leave a message after the beep, or simply hang up and we'll text you shortly.`);

      // Record voicemail with callback to check if they actually left one
      // Enable transcription to classify caller intent
      twiml.record({
        action: `/api/twilio/voice/voicemail-complete?originalFrom=${encodeURIComponent(originalFrom)}&twilioNumber=${encodeURIComponent(twilioNumber)}&callSid=${encodeURIComponent(CallSid)}`,
        method: 'POST',
        maxLength: 120, // 2 minutes max
        timeout: 5, // 5 seconds of silence = done
        transcribe: true, // Enable transcription for intent classification
        transcribeCallback: `/api/twilio/voice/transcription-complete`,
        playBeep: true
      });

      // If they hang up before/during recording, this won't execute (Twilio calls the action URL)
      return res.type('text/xml').send(twiml.toString());
    }

    // Call was answered - just hang up gracefully
    const twiml = new twilio.twiml.VoiceResponse();
    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('Dial status error:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    res.type('text/xml').send(twiml.toString());
  }
});

// SMS cooldown in minutes - don't spam the same caller
const SMS_COOLDOWN_MINUTES = 30;

/**
 * Classify voicemail intent from transcription using keyword rules
 * No AI - pure deterministic matching
 */
function classifyVoicemailIntent(transcription) {
  if (!transcription) return 'other';
  const text = transcription.toLowerCase();

  // Emergency keywords - highest priority
  if (/emergency|pain|hurt|aching|urgent|bleeding|broken|cracked|swollen|abscess|infection/.test(text)) {
    return 'emergency';
  }

  // Appointment/booking keywords
  if (/appointment|book|schedule|available|slot|come in|visit|check.?up|cleaning|exam/.test(text)) {
    return 'appointment';
  }

  // Callback request keywords
  if (/call.*back|return.*call|callback|ring.*back|get back to|reach me|contact me/.test(text)) {
    return 'callback';
  }

  // General inquiry keywords
  if (/question|wondering|information|how much|cost|price|insurance|hours|open|location/.test(text)) {
    return 'inquiry';
  }

  return 'other';
}

/**
 * Get transcription from Twilio recording
 * Uses Twilio's built-in transcription or returns null
 */
async function getVoicemailTranscription(client, recordingSid) {
  try {
    // Twilio can provide transcription if enabled
    const transcription = await client.recordings(recordingSid)
      .transcriptions
      .list({ limit: 1 });

    if (transcription.length > 0) {
      return transcription[0].transcriptionText;
    }
    return null;
  } catch (error) {
    console.log('Transcription not available:', error.message);
    return null;
  }
}

/**
 * Check if we recently sent an SMS to this phone number (cooldown)
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
  return result.rows.length === 0; // Can send if no recent conversation
}

// Twilio webhook - called after voicemail recording completes (or caller hangs up)
router.post('/voice/voicemail-complete', validateTwilioWebhook, async (req, res) => {
  try {
    const { RecordingUrl, RecordingDuration, RecordingSid } = req.body;
    const originalFrom = req.query.originalFrom;
    const twilioNumber = req.query.twilioNumber;
    const callSid = req.query.callSid;

    const recordingDuration = parseInt(RecordingDuration) || 0;

    console.log(`Voicemail complete from ${originalFrom}, duration: ${recordingDuration}s`);

    // Find user by Twilio phone number
    const settingsResult = await query(
      `SELECT s.*, u.id as user_id, u.practice_name
       FROM settings s
       JOIN users u ON s.user_id = u.id
       WHERE s.twilio_phone = $1`,
      [twilioNumber]
    );

    if (settingsResult.rows.length === 0) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const settings = settingsResult.rows[0];

    // Create missed call record
    const callResult = await query(
      `INSERT INTO calls (user_id, twilio_call_sid, caller_phone, status, is_missed, followup_status, voicemail_url, voicemail_duration)
       VALUES ($1, $2, $3, 'no-answer', true, $4, $5, $6)
       RETURNING id`,
      [
        settings.user_id,
        callSid,
        originalFrom,
        recordingDuration >= 3 ? 'voicemail_left' : 'pending',
        RecordingUrl || null,
        recordingDuration
      ]
    );

    const callId = callResult.rows[0].id;

    // ===========================================
    // DETERMINISTIC SMS LOGIC:
    // 1. Voicemail left (3+ seconds) = NO SMS
    // 2. No voicemail + cooldown active = NO SMS
    // 3. No voicemail + no cooldown = SEND SMS
    // ===========================================

    if (recordingDuration >= 3) {
      // VOICEMAIL LEFT - Don't send SMS, dentist will listen and call back
      console.log(`Voicemail left (${recordingDuration}s), NOT sending SMS`);

      // Create lead for the voicemail so it shows in dashboard
      await query(
        `INSERT INTO leads (user_id, call_id, name, phone, status, source, reason)
         VALUES ($1, $2, 'Unknown Caller', $3, 'new', 'voicemail', 'Left voicemail')`,
        [settings.user_id, callId, originalFrom]
      );

      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say({ voice: 'alice' }, 'Thank you for your message. We will get back to you soon. Goodbye!');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    // NO VOICEMAIL - Check cooldown before sending SMS
    const canSend = await canSendSMS(settings.user_id, originalFrom);

    if (!canSend) {
      console.log(`SMS cooldown active for ${originalFrom}, NOT sending duplicate SMS`);

      // Update call to note we skipped SMS due to cooldown
      await query(
        `UPDATE calls SET followup_status = 'cooldown_skipped' WHERE id = $1`,
        [callId]
      );

      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say({ voice: 'alice' }, 'We will be in touch shortly. Goodbye!');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    // NO VOICEMAIL + NO COOLDOWN = Send SMS
    console.log(`No voicemail, no cooldown - sending SMS follow-up to ${originalFrom}`);

    if (settings.twilio_account_sid && settings.twilio_auth_token) {
      const decryptedToken = decryptAuthToken(settings.twilio_auth_token);
      const client = twilio(settings.twilio_account_sid, decryptedToken);

      const practiceName = settings.practice_name || 'our practice';
      const followUpMessage = settings.ai_greeting ||
        `Hi! This is ${practiceName}. We missed your call and want to make sure we help you. Reply 1 for us to call you back, or Reply 2 to schedule an appointment. Thanks!`;

      try {
        const message = await client.messages.create({
          body: followUpMessage,
          from: twilioNumber,
          to: originalFrom
        });

        // Create conversation
        const conversationResult = await query(
          `INSERT INTO conversations (user_id, call_id, caller_phone, channel, direction, status)
           VALUES ($1, $2, $3, 'sms', 'outbound', 'active')
           RETURNING id`,
          [settings.user_id, callId, originalFrom]
        );

        const conversationId = conversationResult.rows[0].id;

        // Store the outgoing message
        await query(
          `INSERT INTO messages (conversation_id, sender, content, message_type, twilio_sid, delivered)
           VALUES ($1, 'ai', $2, 'text', $3, true)`,
          [conversationId, followUpMessage, message.sid]
        );

        // Update call with conversation link
        await query(
          `UPDATE calls SET conversation_id = $1, followup_status = 'in_progress', followup_attempts = 1, last_followup_at = NOW()
           WHERE id = $2`,
          [conversationId, callId]
        );

        // Create lead
        await query(
          `INSERT INTO leads (user_id, call_id, conversation_id, name, phone, status, source)
           VALUES ($1, $2, $3, 'Unknown Caller', $4, 'new', 'missed_call')`,
          [settings.user_id, callId, conversationId, originalFrom]
        );

        console.log(`SMS follow-up sent to ${originalFrom}`);
      } catch (smsError) {
        console.error('Failed to send SMS follow-up:', smsError);
      }
    }

    // SMS sent successfully - tell them and hang up
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: 'alice' }, 'We will text you shortly. Goodbye!');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());

  } catch (error) {
    console.error('Voicemail complete error:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// Twilio webhook - called when voicemail transcription is ready
router.post('/voice/transcription-complete', validateTwilioWebhook, async (req, res) => {
  try {
    const { TranscriptionText, RecordingSid, RecordingUrl } = req.body;

    console.log(`Transcription received for recording ${RecordingSid}`);

    if (!TranscriptionText) {
      return res.status(200).send('OK');
    }

    // Classify intent from transcription
    const intent = classifyVoicemailIntent(TranscriptionText);

    console.log(`Voicemail intent classified as: ${intent}`);

    // Update the call record with transcription and intent
    await query(
      `UPDATE calls
       SET voicemail_transcription = $1, voicemail_intent = $2
       WHERE voicemail_url = $3 OR voicemail_url LIKE $4`,
      [TranscriptionText, intent, RecordingUrl, `%${RecordingSid}%`]
    );

    // Update lead reason based on intent
    const intentReasons = {
      emergency: 'URGENT: Patient in pain/emergency',
      appointment: 'Wants to book appointment',
      callback: 'Requested callback',
      inquiry: 'General inquiry',
      other: 'Left voicemail'
    };

    await query(
      `UPDATE leads
       SET reason = $1, priority = $2
       FROM calls c
       WHERE leads.call_id = c.id
         AND (c.voicemail_url = $3 OR c.voicemail_url LIKE $4)`,
      [intentReasons[intent], intent === 'emergency' ? 'high' : 'medium', RecordingUrl, `%${RecordingSid}%`]
    );

    res.status(200).send('OK');
  } catch (error) {
    console.error('Transcription callback error:', error);
    res.status(200).send('OK'); // Always return OK to Twilio
  }
});

// Twilio webhook - handles incoming SMS messages
router.post('/sms/incoming', validateTwilioWebhook, async (req, res) => {
  try {
    const { MessageSid, From, To, Body } = req.body;

    // Find user by Twilio phone number (include business_hours for slot generation)
    const settingsResult = await query(
      `SELECT s.*, u.id as user_id, u.practice_name
       FROM settings s
       JOIN users u ON s.user_id = u.id
       WHERE s.twilio_phone = $1`,
      [To]
    );

    if (settingsResult.rows.length === 0) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('Sorry, this number is not configured. Please contact the practice directly.');
      return res.type('text/xml').send(twiml.toString());
    }

    const settings = settingsResult.rows[0];

    // Find or create conversation for this phone number
    let conversationResult = await query(
      `SELECT * FROM conversations
       WHERE user_id = $1 AND caller_phone = $2 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [settings.user_id, From]
    );

    let conversationId;

    if (conversationResult.rows.length === 0) {
      // Create new conversation
      const newConversation = await query(
        `INSERT INTO conversations (user_id, caller_phone, channel, direction, status)
         VALUES ($1, $2, 'sms', 'inbound', 'active')
         RETURNING id`,
        [settings.user_id, From]
      );
      conversationId = newConversation.rows[0].id;
    } else {
      conversationId = conversationResult.rows[0].id;
    }

    // Store the incoming message
    await query(
      `INSERT INTO messages (conversation_id, sender, content, message_type, twilio_sid, delivered)
       VALUES ($1, 'caller', $2, 'text', $3, true)`,
      [conversationId, Body, MessageSid]
    );

    // Handle conversation with state machine
    const aiResponse = await handleConversation(conversationId, Body, settings);

    // Store AI response
    await query(
      `INSERT INTO messages (conversation_id, sender, content, message_type, delivered)
       VALUES ($1, 'ai', $2, 'text', true)`,
      [conversationId, aiResponse]
    );

    // Send response via TwiML
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(aiResponse);

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('Incoming SMS error:', error);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('We experienced a technical issue. Please try again or call the practice directly.');
    res.type('text/xml').send(twiml.toString());
  }
});

// Twilio webhook - handles missed calls (triggers SMS follow-up)
router.post('/call/missed', validateTwilioWebhook, async (req, res) => {
  try {
    const { CallSid, From, To, CallStatus } = req.body;

    // Only handle missed/no-answer/busy calls
    if (!['no-answer', 'busy', 'failed', 'canceled'].includes(CallStatus)) {
      return res.status(200).send('OK');
    }

    // Find user by Twilio phone number
    const settingsResult = await query(
      `SELECT s.*, u.id as user_id, u.practice_name
       FROM settings s
       JOIN users u ON s.user_id = u.id
       WHERE s.twilio_phone = $1`,
      [To]
    );

    if (settingsResult.rows.length === 0) {
      return res.status(200).send('OK');
    }

    const settings = settingsResult.rows[0];

    // Create missed call record
    const callResult = await query(
      `INSERT INTO calls (user_id, twilio_call_sid, caller_phone, status, is_missed, followup_status)
       VALUES ($1, $2, $3, $4, true, 'pending')
       RETURNING id`,
      [settings.user_id, CallSid, From, CallStatus]
    );

    const callId = callResult.rows[0].id;

    // Create conversation for follow-up
    const conversationResult = await query(
      `INSERT INTO conversations (user_id, call_id, caller_phone, channel, direction, status)
       VALUES ($1, $2, $3, 'sms', 'outbound', 'active')
       RETURNING id`,
      [settings.user_id, callId, From]
    );

    const conversationId = conversationResult.rows[0].id;

    // Get follow-up message (custom or default)
    const practiceName = settings.practice_name || 'our practice';
    const followUpMessage = settings.ai_greeting ||
      `Hi! This is ${practiceName}. We missed your call and want to make sure we help you. Reply 1 for us to call you back, or Reply 2 to schedule an appointment. Thanks!`;

    // Send SMS follow-up using Twilio client
    if (settings.twilio_account_sid && settings.twilio_auth_token) {
      const decryptedToken = decryptAuthToken(settings.twilio_auth_token);
      const client = twilio(settings.twilio_account_sid, decryptedToken);

      const message = await client.messages.create({
        body: followUpMessage,
        from: To, // Send from the practice's Twilio number
        to: From  // Send to the caller
      });

      // Store the outgoing message
      await query(
        `INSERT INTO messages (conversation_id, sender, content, message_type, twilio_sid, delivered)
         VALUES ($1, 'ai', $2, 'text', $3, true)`,
        [conversationId, followUpMessage, message.sid]
      );

      // Update call with conversation link and followup status
      await query(
        `UPDATE calls SET conversation_id = $1, followup_status = 'in_progress', followup_attempts = 1, last_followup_at = NOW()
         WHERE id = $2`,
        [conversationId, callId]
      );

      // Create lead from missed call
      await query(
        `INSERT INTO leads (user_id, call_id, conversation_id, name, phone, status, source)
         VALUES ($1, $2, $3, 'Unknown Caller', $4, 'new', 'missed_call')`,
        [settings.user_id, callId, conversationId, From]
      );
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Missed call handler error:', error);
    res.status(500).send('Error');
  }
});

// SMS delivery status callback
router.post('/sms/status', validateTwilioWebhook, async (req, res) => {
  try {
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;

    if (ErrorCode) {
      console.error(`SMS delivery failed: ${ErrorCode} - ${ErrorMessage}`);
    }

    // Update message delivery status
    await query(
      `UPDATE messages SET delivered = $1 WHERE twilio_sid = $2`,
      [MessageStatus === 'delivered', MessageSid]
    );

    res.status(200).send('OK');
  } catch (error) {
    console.error('SMS status callback error:', error);
    res.status(500).send('Error');
  }
});

// Call status callback (for tracking missed calls)
router.post('/call/status', validateTwilioWebhook, async (req, res) => {
  try {
    const { CallSid, CallStatus, CallDuration } = req.body;

    await query(
      `UPDATE calls
       SET status = $1, duration = COALESCE($2, duration)
       WHERE twilio_call_sid = $3`,
      [CallStatus, CallDuration ? parseInt(CallDuration) : null, CallSid]
    );

    res.status(200).send('OK');
  } catch (error) {
    console.error('Call status error:', error);
    res.status(500).send('Error');
  }
});

// Protected routes below
router.use(authenticate);

// POST /api/twilio/test - Test Twilio configuration
router.post('/test', async (req, res) => {
  try {
    const userId = req.user.id;

    const settingsResult = await query(
      'SELECT twilio_account_sid, twilio_auth_token, twilio_phone FROM settings WHERE user_id = $1',
      [userId]
    );

    if (settingsResult.rows.length === 0) {
      return res.status(400).json({ error: { message: 'Twilio not configured' } });
    }

    const settings = settingsResult.rows[0];

    if (!settings.twilio_account_sid || !settings.twilio_auth_token) {
      return res.status(400).json({ error: { message: 'Twilio credentials not set' } });
    }

    // Test Twilio connection
    const decryptedToken = decryptAuthToken(settings.twilio_auth_token);
    const client = twilio(settings.twilio_account_sid, decryptedToken);

    try {
      const account = await client.api.accounts(settings.twilio_account_sid).fetch();
      res.json({
        success: true,
        account: {
          friendlyName: account.friendlyName,
          status: account.status
        }
      });
    } catch (twilioError) {
      res.status(400).json({
        error: { message: 'Invalid Twilio credentials' }
      });
    }
  } catch (error) {
    console.error('Test Twilio error:', error);
    res.status(500).json({ error: { message: 'Failed to test Twilio connection' } });
  }
});

// POST /api/twilio/send-sms - Send a manual SMS to a patient
router.post('/send-sms', async (req, res) => {
  try {
    const userId = req.user.id;
    const { to, message, conversationId } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: { message: 'Recipient and message are required' } });
    }

    const settingsResult = await query(
      'SELECT twilio_account_sid, twilio_auth_token, twilio_phone FROM settings WHERE user_id = $1',
      [userId]
    );

    if (settingsResult.rows.length === 0 || !settingsResult.rows[0].twilio_account_sid) {
      return res.status(400).json({ error: { message: 'Twilio not configured' } });
    }

    const settings = settingsResult.rows[0];
    const decryptedToken = decryptAuthToken(settings.twilio_auth_token);
    const client = twilio(settings.twilio_account_sid, decryptedToken);

    const sentMessage = await client.messages.create({
      body: message,
      from: settings.twilio_phone,
      to: to
    });

    // Store message if conversation exists
    if (conversationId) {
      await query(
        `INSERT INTO messages (conversation_id, sender, content, message_type, twilio_sid, delivered)
         VALUES ($1, 'ai', $2, 'text', $3, true)`,
        [conversationId, message, sentMessage.sid]
      );
    }

    res.json({
      success: true,
      messageSid: sentMessage.sid,
      status: sentMessage.status
    });
  } catch (error) {
    console.error('Send SMS error:', error);
    res.status(500).json({ error: { message: 'Failed to send SMS' } });
  }
});

// ============================================
// SMS CONVERSATION STATE MACHINE
// ============================================

/**
 * Detect user intent from their message using deterministic rules
 * V1: Rules > AI - Simple keyword matching
 */
function detectIntent(message) {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // Check for "1" = callback
  if (trimmed === '1' || lower === 'one' || lower === '1.') {
    return 'callback';
  }

  // Check for "2" = appointment/booking
  if (trimmed === '2' || lower === 'two' || lower === '2.') {
    return 'appointment';
  }

  // Check for "YES" confirmation (for next available slot)
  if (lower === 'yes' || lower === 'yeah' || lower === 'yep' || lower === 'confirm' || lower === 'ok' || lower === 'okay') {
    return 'confirm';
  }

  // Keyword matching for callback
  if (lower.includes('call') || lower.includes('callback') || lower.includes('ring')) {
    return 'callback';
  }

  // Keyword matching for booking/appointment
  if (lower.includes('book') || lower.includes('appointment') || lower.includes('schedule')) {
    return 'appointment';
  }

  // If contains details/question, capture as free-text
  return 'freetext';
}

/**
 * Parse time selection from message (1, 2, 3, etc.)
 */
function parseTimeSelection(message) {
  const trimmed = message.trim();

  // Direct number
  const num = parseInt(trimmed);
  if (num >= 1 && num <= 3) {
    return num - 1; // Array index
  }

  // Word-based
  const lower = trimmed.toLowerCase();
  if (lower.includes('first') || lower === '1' || lower.includes('one')) return 0;
  if (lower.includes('second') || lower === '2' || lower.includes('two')) return 1;
  if (lower.includes('third') || lower === '3' || lower.includes('three')) return 2;

  return -1; // Couldn't parse
}

/**
 * Find the next available 30-minute slot after a given time
 * Checks against existing appointments to avoid double booking
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

  // Start checking from 30 minutes after the requested time
  let checkTime = new Date(startTime.getTime() + 30 * 60 * 1000);
  let daysChecked = 0;

  while (daysChecked < maxDaysToCheck) {
    const dayName = dayNames[checkTime.getDay()];
    const dayHours = hours[dayName];

    if (dayHours && dayHours.enabled) {
      const [openHour, openMin] = dayHours.open.split(':').map(Number);
      const [closeHour, closeMin] = dayHours.close.split(':').map(Number);

      // Set bounds for this day
      const dayStart = new Date(checkTime);
      dayStart.setHours(openHour, openMin, 0, 0);

      const dayEnd = new Date(checkTime);
      dayEnd.setHours(closeHour, closeMin, 0, 0);

      // If we're before opening, start at opening
      if (checkTime < dayStart) {
        checkTime = new Date(dayStart);
      }

      // Check 30-minute slots until closing
      while (checkTime < dayEnd) {
        const slotDate = checkTime.toISOString().split('T')[0];
        const slotTime = checkTime.toTimeString().slice(0, 5);

        // Check if this slot is available
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
          // Found an available slot!
          return new Date(checkTime);
        }

        // Move to next 30-minute slot
        checkTime = new Date(checkTime.getTime() + 30 * 60 * 1000);
      }
    }

    // Move to next day at midnight
    checkTime = new Date(checkTime);
    checkTime.setDate(checkTime.getDate() + 1);
    checkTime.setHours(0, 0, 0, 0);
    daysChecked++;
  }

  return null; // No available slots found
}

/**
 * Generate available time slots from business hours
 */
function getAvailableSlotsFromBusinessHours(businessHours, numSlots = 3) {
  const slots = [];
  const now = new Date();
  let daysChecked = 0;

  // Default business hours if not set
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

  while (slots.length < numSlots && daysChecked < 14) {
    const checkDate = new Date(now);
    checkDate.setDate(now.getDate() + daysChecked);

    const dayName = dayNames[checkDate.getDay()];
    const dayHours = hours[dayName];

    if (dayHours && dayHours.enabled) {
      const [openHour, openMin] = dayHours.open.split(':').map(Number);
      const [closeHour, closeMin] = dayHours.close.split(':').map(Number);

      // Generate morning and afternoon slots
      const morningSlot = new Date(checkDate);
      morningSlot.setHours(openHour, openMin, 0, 0);

      const afternoonSlot = new Date(checkDate);
      afternoonSlot.setHours(14, 0, 0, 0); // 2 PM

      // Skip times in the past
      const minTime = daysChecked === 0 ? new Date(now.getTime() + 60 * 60 * 1000) : morningSlot; // At least 1 hour from now

      // Check morning slot
      if (morningSlot >= minTime && slots.length < numSlots) {
        slots.push(new Date(morningSlot));
      }

      // Check afternoon slot
      if (afternoonSlot >= minTime && afternoonSlot.getHours() < closeHour && slots.length < numSlots) {
        slots.push(new Date(afternoonSlot));
      }
    }

    daysChecked++;
  }

  return slots;
}

/**
 * Format slots for SMS message
 */
function formatSlotsForSMS(slots) {
  return slots.map((slot, i) => {
    const day = slot.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const time = slot.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${i + 1}. ${day} at ${time}`;
  }).join('\n');
}

/**
 * Main conversation handler - state machine
 */
async function handleConversation(conversationId, incomingMessage, settings) {
  const practiceName = settings.practice_name || 'Our Practice';

  // Get conversation state
  const convResult = await query(
    `SELECT * FROM conversations WHERE id = $1`,
    [conversationId]
  );

  if (convResult.rows.length === 0) {
    return `Thanks for your message! How can we help you today?`;
  }

  const conversation = convResult.rows[0];
  const currentStatus = conversation.status;
  const lower = incomingMessage.toLowerCase();

  // Handle based on current state
  switch (currentStatus) {
    case 'active':
    case 'awaiting_response': {
      // First response - detect intent using deterministic rules
      const intent = detectIntent(incomingMessage);

      // Handle free-text (neither 1, 2, nor keywords) - capture details
      if (intent === 'freetext') {
        // Update lead with the details they provided
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

      // Get available slots from business hours
      const businessHours = settings.business_hours || {};
      const slots = getAvailableSlotsFromBusinessHours(businessHours, 3);

      if (slots.length === 0) {
        // No available times
        await query(
          `UPDATE conversations SET status = 'callback_requested' WHERE id = $1`,
          [conversationId]
        );

        // Update lead
        await query(
          `UPDATE leads SET status = 'qualified', preferred_time = 'Callback requested' WHERE conversation_id = $1`,
          [conversationId]
        );

        return `Thanks for getting back to us! We're currently fully booked, but we'll have someone from ${practiceName} call you back shortly to find a time that works.`;
      }

      // Store suggested times and update status
      await query(
        `UPDATE conversations SET status = 'awaiting_time_selection' WHERE id = $1`,
        [conversationId]
      );

      // Store the slots in a way we can retrieve them
      await query(
        `INSERT INTO messages (conversation_id, sender, content, message_type)
         VALUES ($1, 'system', $2, 'system')`,
        [conversationId, JSON.stringify({ suggested_times: slots, intent })]
      );

      // Update lead status
      await query(
        `UPDATE leads SET status = 'contacted', reason = $1 WHERE conversation_id = $2`,
        [intent === 'callback' ? 'Wants callback' : 'Wants appointment', conversationId]
      );

      const actionText = intent === 'callback' ? 'call you back' : 'schedule you';
      const formattedTimes = formatSlotsForSMS(slots);

      return `Great! We can ${actionText} at any of these times. Just reply with the number:\n\n${formattedTimes}\n\nOr let us know a different time that works!`;
    }

    case 'awaiting_time_selection': {
      // They're selecting a time
      const selectedIndex = parseTimeSelection(incomingMessage);

      // Get the suggested times from system message
      const systemMsgResult = await query(
        `SELECT content FROM messages
         WHERE conversation_id = $1 AND message_type = 'system'
         ORDER BY created_at DESC LIMIT 1`,
        [conversationId]
      );

      if (systemMsgResult.rows.length === 0) {
        // No suggested times found, restart
        await query(
          `UPDATE conversations SET status = 'active' WHERE id = $1`,
          [conversationId]
        );
        return `Sorry, something went wrong. Would you like us to call you back, or would you prefer to schedule an appointment?`;
      }

      const systemData = JSON.parse(systemMsgResult.rows[0].content);
      const suggestedTimes = systemData.suggested_times.map(t => new Date(t));
      const intent = systemData.intent || 'appointment';

      // Handle YES confirmation for "next available" single slot offer
      const userIntent = detectIntent(incomingMessage);
      if (userIntent === 'confirm' && suggestedTimes.length === 1 && systemData.original_choice_taken) {
        // They're confirming the next available slot we offered
        selectedIndex = 0;
      }

      if (selectedIndex === -1 || selectedIndex >= suggestedTimes.length) {
        // Check if they want a different time or callback
        if (lower.includes('different') || lower.includes('other') || lower.includes('none')) {
          await query(
            `UPDATE conversations SET status = 'callback_requested' WHERE id = $1`,
            [conversationId]
          );

          await query(
            `UPDATE leads SET status = 'qualified', preferred_time = 'Requested different time' WHERE conversation_id = $1`,
            [conversationId]
          );

          return `No problem! We'll have someone from ${practiceName} call you to find a time that works better. What's the best time to reach you?`;
        }

        // Didn't understand
        const formattedTimes = formatSlotsForSMS(suggestedTimes);
        return `I didn't catch which time you'd prefer. Could you reply with 1, 2, or 3?\n\n${formattedTimes}`;
      }

      // Valid selection!
      const selectedTime = suggestedTimes[selectedIndex];
      const appointmentDate = selectedTime.toISOString().split('T')[0];
      const appointmentTime = selectedTime.toTimeString().slice(0, 5);

      // Use transaction to prevent race conditions in appointment booking
      const client = await getClient();

      try {
        await client.query('BEGIN');
        await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

        // Check for double booking with row lock
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
          // Slot is taken! Rollback and find next available slot
          await client.query('ROLLBACK');
          client.release();

          console.log(`Double booking prevented for ${appointmentDate} ${appointmentTime}`);

          const nextSlot = await findNextAvailableSlot(settings.user_id, selectedTime, settings.business_hours);

          if (nextSlot) {
            const nextFormatted = nextSlot.toLocaleString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            });

            // Store the new suggested time for next response
            await query(
              `UPDATE messages SET content = $1
               WHERE conversation_id = $2 AND message_type = 'system'
               ORDER BY created_at DESC LIMIT 1`,
              [JSON.stringify({ suggested_times: [nextSlot], intent, original_choice_taken: true }), conversationId]
            );

            return `Sorry, that time was just booked! The next available slot is ${nextFormatted}. Reply YES to confirm, or let us know another time that works.`;
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

        // Update conversation to booked
        await client.query(
          `UPDATE conversations SET status = 'appointment_booked', ended_at = NOW() WHERE id = $1`,
          [conversationId]
        );

        // Update lead to converted with appointment time
        await client.query(
          `UPDATE leads
           SET status = 'converted',
               appointment_booked = true,
               appointment_time = $1,
               reason = $2
           WHERE conversation_id = $3`,
          [formattedTime, intent === 'callback' ? 'Callback scheduled' : 'Appointment scheduled', conversationId]
        );

        // Create appointment record
        await client.query(
          `INSERT INTO appointments (user_id, lead_id, patient_phone, appointment_date, appointment_time, reason, status)
           SELECT c.user_id, l.id, c.caller_phone, $1::date, $2, $3, 'scheduled'
           FROM conversations c
           LEFT JOIN leads l ON l.conversation_id = c.id
           WHERE c.id = $4`,
          [appointmentDate, appointmentTime, intent, conversationId]
        );

        await client.query('COMMIT');
        client.release();

        if (settings.booking_mode === 'auto') {
          return `Perfect! You're all set for ${formattedTime}. We look forward to seeing you at ${practiceName}!`;
        } else {
          return `Thanks! We've noted your preference for ${formattedTime}. Our team at ${practiceName} will confirm with you shortly!`;
        }
      } catch (txError) {
        await client.query('ROLLBACK');
        client.release();

        // Handle serialization failure (concurrent transaction conflict)
        if (txError.code === '40001') {
          console.log('Serialization conflict during appointment booking');
          return `That time slot was just booked by someone else. Please reply with a different time or we can call you to schedule.`;
        }

        console.error('Transaction error in appointment booking:', txError);
        return `We had a technical issue booking your appointment. Please reply again or call us directly.`;
      }
    }

    case 'appointment_booked': {
      // Already booked
      if (lower.includes('cancel') || lower.includes('change') || lower.includes('reschedule')) {
        return `No problem! Please call ${practiceName} directly to make changes to your appointment, or reply here and we'll have someone call you back.`;
      }
      return `Thanks for your message! You already have an appointment scheduled. Is there anything else we can help you with?`;
    }

    case 'callback_requested': {
      // They wanted a callback - just acknowledge
      if (lower.includes('thank')) {
        return `You're welcome! Someone from ${practiceName} will be in touch soon.`;
      }
      return `Thanks! We've noted your message. Someone from ${practiceName} will call you back as soon as possible.`;
    }

    default: {
      // Unknown state - offer help
      return `Thanks for your message! Would you like us to call you back, or would you prefer to schedule an appointment? Just let us know!`;
    }
  }
}

// Legacy simple response function (fallback)
function generateAIResponse(incomingMessage, settings) {
  const lowerMessage = incomingMessage.toLowerCase();
  const practiceName = settings.practice_name || 'our practice';

  if (lowerMessage.includes('emergency') || lowerMessage.includes('pain') || lowerMessage.includes('urgent')) {
    return `I'm sorry to hear you're in discomfort. For dental emergencies, please call ${practiceName} directly. If it's after hours and you're experiencing severe pain, please visit your nearest emergency room.`;
  }

  if (lowerMessage.includes('thank')) {
    return `You're welcome! Is there anything else I can help you with today?`;
  }

  // Default - prompt for intent
  return `Thanks for your message! Would you like us to call you back, or would you prefer to schedule an appointment? Just reply here!`;
}

module.exports = router;
