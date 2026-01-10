const express = require('express');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const notifyre = require('../services/notifyre');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// GET /api/settings - Get user settings
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT * FROM settings WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // Create default settings if they don't exist
      const newSettings = await query(
        `INSERT INTO settings (user_id) VALUES ($1) RETURNING *`,
        [userId]
      );
      return res.json({ settings: formatSettings(newSettings.rows[0]) });
    }

    res.json({ settings: formatSettings(result.rows[0]) });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch settings' } });
  }
});

// PUT /api/settings - Update settings
router.put('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      notificationEmail,
      notificationSms,
      bookingMode,
      businessHours,
      aiGreeting
    } = req.body;

    const result = await query(
      `UPDATE settings
       SET notification_email = COALESCE($1, notification_email),
           notification_sms = COALESCE($2, notification_sms),
           booking_mode = COALESCE($3, booking_mode),
           business_hours = COALESCE($4, business_hours),
           ai_greeting = COALESCE($5, ai_greeting)
       WHERE user_id = $6
       RETURNING *`,
      [
        notificationEmail,
        notificationSms,
        bookingMode,
        businessHours ? JSON.stringify(businessHours) : null,
        aiGreeting,
        userId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Settings not found' } });
    }

    res.json({ settings: formatSettings(result.rows[0]) });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: { message: 'Failed to update settings' } });
  }
});

// PUT /api/settings/forwarding - Update call forwarding phone only
router.put('/forwarding', async (req, res) => {
  try {
    const userId = req.user.id;
    const { forwardingPhone } = req.body;

    if (!forwardingPhone) {
      return res.status(400).json({
        error: { message: 'Forwarding phone number is required' }
      });
    }

    const result = await query(
      `UPDATE settings
       SET forwarding_phone = $1
       WHERE user_id = $2
       RETURNING *`,
      [forwardingPhone, userId]
    );

    res.json({
      message: 'Forwarding number updated',
      settings: formatSettings(result.rows[0])
    });
  } catch (error) {
    console.error('Update forwarding phone error:', error);
    res.status(500).json({ error: { message: 'Failed to update forwarding phone' } });
  }
});

// PUT /api/settings/notifications - Update notification settings
router.put('/notifications', async (req, res) => {
  try {
    const userId = req.user.id;
    const { notificationEmail, notificationSms } = req.body;

    const result = await query(
      `UPDATE settings
       SET notification_email = COALESCE($1, notification_email),
           notification_sms = COALESCE($2, notification_sms)
       WHERE user_id = $3
       RETURNING *`,
      [notificationEmail, notificationSms, userId]
    );

    res.json({ settings: formatSettings(result.rows[0]) });
  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({ error: { message: 'Failed to update notification settings' } });
  }
});

// PUT /api/settings/business-hours - Update business hours
router.put('/business-hours', validate(schemas.businessHours), async (req, res) => {
  try {
    const userId = req.user.id;
    const { businessHours } = req.body;

    const result = await query(
      `UPDATE settings
       SET business_hours = $1
       WHERE user_id = $2
       RETURNING *`,
      [JSON.stringify(businessHours), userId]
    );

    res.json({ settings: formatSettings(result.rows[0]) });
  } catch (error) {
    console.error('Update business hours error:', error);
    res.status(500).json({ error: { message: 'Failed to update business hours' } });
  }
});

// PUT /api/settings/ai-greeting - Update AI greeting
router.put('/ai-greeting', async (req, res) => {
  try {
    const userId = req.user.id;
    const { aiGreeting } = req.body;

    if (!aiGreeting) {
      return res.status(400).json({
        error: { message: 'AI greeting is required' }
      });
    }

    const result = await query(
      `UPDATE settings
       SET ai_greeting = $1
       WHERE user_id = $2
       RETURNING *`,
      [aiGreeting, userId]
    );

    res.json({ settings: formatSettings(result.rows[0]) });
  } catch (error) {
    console.error('Update AI greeting error:', error);
    res.status(500).json({ error: { message: 'Failed to update AI greeting' } });
  }
});

// POST /api/settings/sms/test - Test Notifyre SMS configuration
router.post('/sms/test', async (req, res) => {
  try {
    const userId = req.user.id;
    const { testPhone } = req.body;

    if (!testPhone) {
      return res.status(400).json({ error: { message: 'Test phone number is required' } });
    }

    // Check if Notifyre credentials are configured in environment
    if (!process.env.NOTIFYRE_ACCOUNT_ID || !process.env.NOTIFYRE_API_TOKEN) {
      return res.status(400).json({ error: { message: 'Notifyre credentials not configured' } });
    }

    // Get settings for user's SMS reply number
    const settingsResult = await query(
      'SELECT sms_reply_number FROM settings WHERE user_id = $1',
      [userId]
    );

    const fromNumber = settingsResult.rows[0]?.sms_reply_number || process.env.NOTIFYRE_FROM_NUMBER;

    if (!fromNumber) {
      return res.status(400).json({ error: { message: 'No SMS reply number configured' } });
    }

    // Send test SMS using Notifyre
    const result = await notifyre.sendSMS(
      process.env.NOTIFYRE_ACCOUNT_ID,
      process.env.NOTIFYRE_API_TOKEN,
      testPhone,
      'This is a test message from SmileDesk. Your SMS configuration is working!',
      fromNumber
    );

    if (result.success) {
      res.json({ success: true, message: 'Test SMS sent successfully' });
    } else {
      res.status(400).json({ error: { message: result.error || 'Failed to send test SMS' } });
    }
  } catch (error) {
    console.error('Test SMS error:', error);
    res.status(500).json({ error: { message: 'Failed to test SMS configuration' } });
  }
});

// Helper function to format settings for API response
function formatSettings(settings) {
  return {
    id: settings.id,
    // SMS number (admin sets this in Supabase)
    smsReplyNumber: settings.sms_reply_number,
    // Call forwarding (dentist sets this)
    forwardingPhone: settings.forwarding_phone,
    // Notifications
    notificationEmail: settings.notification_email,
    notificationSms: settings.notification_sms,
    // Booking
    bookingMode: settings.booking_mode,
    businessHours: settings.business_hours,
    aiGreeting: settings.ai_greeting,
    // Timestamps
    createdAt: settings.created_at,
    updatedAt: settings.updated_at
  };
}

module.exports = router;
