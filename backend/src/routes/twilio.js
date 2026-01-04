const express = require('express');
const twilio = require('twilio');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Twilio webhook - handles incoming calls (no auth required for webhooks)
router.post('/voice/incoming', async (req, res) => {
  try {
    const { CallSid, From, To, CallStatus } = req.body;

    // Find user by Twilio phone number
    const settingsResult = await query(
      `SELECT s.*, u.id as user_id, u.practice_name
       FROM settings s
       JOIN users u ON s.user_id = u.id
       WHERE s.twilio_phone = $1`,
      [To]
    );

    if (settingsResult.rows.length === 0) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, this number is not configured. Goodbye.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const settings = settingsResult.rows[0];
    const greeting = settings.ai_greeting || `Hello! Thank you for calling ${settings.practice_name}. How can I help you today?`;

    // Create call record
    await query(
      `INSERT INTO calls (user_id, twilio_call_sid, caller_phone, status)
       VALUES ($1, $2, $3, $4)`,
      [settings.user_id, CallSid, From, 'in-progress']
    );

    // Generate TwiML response
    const twiml = new twilio.twiml.VoiceResponse();

    // Greet the caller
    twiml.say({ voice: 'Polly.Joanna' }, greeting);

    // Record the call for transcription
    twiml.record({
      transcribe: true,
      transcribeCallback: '/api/twilio/transcription',
      maxLength: 300,
      playBeep: false,
      action: '/api/twilio/voice/handle-recording',
      recordingStatusCallback: '/api/twilio/recording-status'
    });

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('Incoming call error:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('We are experiencing technical difficulties. Please try again later.');
    res.type('text/xml').send(twiml.toString());
  }
});

// Handle recording completion
router.post('/voice/handle-recording', async (req, res) => {
  try {
    const { CallSid, RecordingUrl, RecordingDuration } = req.body;

    // Update call with recording info
    await query(
      `UPDATE calls
       SET recording_url = $1, duration = $2
       WHERE twilio_call_sid = $3`,
      [RecordingUrl, parseInt(RecordingDuration) || 0, CallSid]
    );

    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: 'Polly.Joanna' }, 'Thank you for your message. We will get back to you shortly. Goodbye!');
    twiml.hangup();

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('Handle recording error:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// Handle transcription callback
router.post('/transcription', async (req, res) => {
  try {
    const { CallSid, TranscriptionText, TranscriptionStatus } = req.body;

    if (TranscriptionStatus === 'completed' && TranscriptionText) {
      // Update call with transcription
      const callResult = await query(
        `UPDATE calls
         SET transcription = $1, status = 'completed'
         WHERE twilio_call_sid = $2
         RETURNING *`,
        [TranscriptionText, CallSid]
      );

      if (callResult.rows.length > 0) {
        const call = callResult.rows[0];

        // Auto-create lead from transcription
        // Extract potential caller info from transcription
        const callerName = extractName(TranscriptionText);
        const reason = extractReason(TranscriptionText);

        await query(
          `INSERT INTO leads (user_id, call_id, name, phone, reason, status)
           VALUES ($1, $2, $3, $4, $5, 'new')`,
          [call.user_id, call.id, callerName || 'Unknown Caller', call.caller_phone, reason]
        );
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Transcription callback error:', error);
    res.status(500).send('Error');
  }
});

// Recording status callback
router.post('/recording-status', async (req, res) => {
  try {
    const { CallSid, RecordingStatus, RecordingUrl } = req.body;

    if (RecordingStatus === 'completed') {
      await query(
        `UPDATE calls SET recording_url = $1 WHERE twilio_call_sid = $2`,
        [RecordingUrl, CallSid]
      );
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Recording status error:', error);
    res.status(500).send('Error');
  }
});

// Call status callback
router.post('/call-status', async (req, res) => {
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

// Helper functions for extracting info from transcription
function extractName(text) {
  // Simple pattern matching for names
  const patterns = [
    /my name is ([A-Z][a-z]+ [A-Z][a-z]+)/i,
    /this is ([A-Z][a-z]+ [A-Z][a-z]+)/i,
    /I'm ([A-Z][a-z]+ [A-Z][a-z]+)/i,
    /I am ([A-Z][a-z]+ [A-Z][a-z]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return null;
}

function extractReason(text) {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('appointment') || lowerText.includes('schedule') || lowerText.includes('book')) {
    return 'Appointment Request';
  }
  if (lowerText.includes('cleaning') || lowerText.includes('checkup') || lowerText.includes('check-up')) {
    return 'Cleaning/Checkup';
  }
  if (lowerText.includes('pain') || lowerText.includes('hurt') || lowerText.includes('ache') || lowerText.includes('emergency')) {
    return 'Emergency/Pain';
  }
  if (lowerText.includes('crown') || lowerText.includes('filling') || lowerText.includes('root canal')) {
    return 'Dental Procedure';
  }
  if (lowerText.includes('insurance') || lowerText.includes('cost') || lowerText.includes('price')) {
    return 'Insurance/Billing';
  }
  if (lowerText.includes('cancel') || lowerText.includes('reschedule')) {
    return 'Reschedule/Cancel';
  }

  return 'General Inquiry';
}

module.exports = router;
