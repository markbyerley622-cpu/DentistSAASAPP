const express = require('express');
const twilio = require('twilio');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * SmileDesk Twilio Integration - SMS Only
 *
 * This module handles SMS-based patient communication:
 * 1. When a call is missed, the system sends an automatic SMS follow-up
 * 2. Patients can reply to SMS messages to interact with the AI
 * 3. All communication is text-based (no voice/call handling by AI)
 *
 * Flow:
 * 1. Patient calls practice number -> call goes unanswered (missed)
 * 2. Twilio detects missed call and triggers webhook
 * 3. SmileDesk sends instant SMS follow-up to the patient
 * 4. Patient replies via SMS -> AI responds via SMS
 * 5. Conversation continues until appointment is booked or resolved
 */

// Twilio webhook - handles incoming SMS messages (no auth required for webhooks)
router.post('/sms/incoming', async (req, res) => {
  try {
    const { MessageSid, From, To, Body } = req.body;

    // Find user by Twilio phone number
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

    // Generate AI response (simplified - in production would use actual AI)
    const aiResponse = generateAIResponse(Body, settings);

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
router.post('/call/missed', async (req, res) => {
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
      `Hi! We noticed we missed your call at ${practiceName}. How can we help you today? Reply to this message or let us know a good time to reach you.`;

    // Send SMS follow-up using Twilio client
    if (settings.twilio_account_sid && settings.twilio_auth_token) {
      const client = twilio(settings.twilio_account_sid, settings.twilio_auth_token);

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
router.post('/sms/status', async (req, res) => {
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
router.post('/call/status', async (req, res) => {
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
    const client = twilio(settings.twilio_account_sid, settings.twilio_auth_token);

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
    const client = twilio(settings.twilio_account_sid, settings.twilio_auth_token);

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

// Helper function to generate AI response (simplified)
function generateAIResponse(incomingMessage, settings) {
  const lowerMessage = incomingMessage.toLowerCase();
  const practiceName = settings.practice_name || 'our practice';

  // Simple keyword-based responses (in production, use actual AI/NLP)
  if (lowerMessage.includes('appointment') || lowerMessage.includes('book') || lowerMessage.includes('schedule')) {
    return `Great! We'd love to schedule an appointment for you at ${practiceName}. What day and time works best for you? Our hours are Monday-Friday 9am-5pm.`;
  }

  if (lowerMessage.includes('cancel') || lowerMessage.includes('reschedule')) {
    return `No problem! I can help you with that. Please provide your name and the date of your current appointment, and we'll take care of it.`;
  }

  if (lowerMessage.includes('emergency') || lowerMessage.includes('pain') || lowerMessage.includes('urgent')) {
    return `I'm sorry to hear you're in discomfort. For dental emergencies, please call our office directly. If it's after hours and you're experiencing severe pain, please visit your nearest emergency room.`;
  }

  if (lowerMessage.includes('cost') || lowerMessage.includes('price') || lowerMessage.includes('insurance')) {
    return `For questions about costs and insurance, our front desk team can provide detailed information. Would you like us to have someone call you back, or would you prefer to schedule a consultation?`;
  }

  if (lowerMessage.includes('hours') || lowerMessage.includes('open')) {
    return `${practiceName} is open Monday through Friday, 9am to 5pm. Would you like to schedule an appointment?`;
  }

  if (lowerMessage.includes('yes') || lowerMessage.includes('sure') || lowerMessage.includes('okay')) {
    return `Perfect! What day and time works best for you? We have availability throughout the week.`;
  }

  if (lowerMessage.includes('no') || lowerMessage.includes('not now') || lowerMessage.includes('later')) {
    return `No problem at all! Feel free to text us anytime when you're ready to schedule. We're here to help!`;
  }

  if (lowerMessage.includes('thank')) {
    return `You're welcome! Is there anything else I can help you with today?`;
  }

  // Default response
  return `Thanks for your message! How can we assist you today? We can help with scheduling appointments, answering questions about our services, or connecting you with our team.`;
}

module.exports = router;
