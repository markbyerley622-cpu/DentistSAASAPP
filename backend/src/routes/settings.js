const express = require('express');
const crypto = require('crypto');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/crypto');
const { validate, schemas } = require('../middleware/validate');
const cellcast = require('../services/cellcast');

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
      twilioPhone,
      twilioAccountSid,
      twilioAuthToken,
      notificationEmail,
      notificationSms,
      bookingMode,
      businessHours,
      aiGreeting
    } = req.body;

    // Encrypt the auth token if provided
    const encryptedAuthToken = twilioAuthToken ? encrypt(twilioAuthToken) : null;

    const result = await query(
      `UPDATE settings
       SET twilio_phone = COALESCE($1, twilio_phone),
           twilio_account_sid = COALESCE($2, twilio_account_sid),
           twilio_auth_token = COALESCE($3, twilio_auth_token),
           notification_email = COALESCE($4, notification_email),
           notification_sms = COALESCE($5, notification_sms),
           booking_mode = COALESCE($6, booking_mode),
           business_hours = COALESCE($7, business_hours),
           ai_greeting = COALESCE($8, ai_greeting)
       WHERE user_id = $9
       RETURNING *`,
      [
        twilioPhone,
        twilioAccountSid,
        encryptedAuthToken,
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

// PUT /api/settings/twilio - Update Twilio settings only
router.put('/twilio', validate(schemas.twilioSettings), async (req, res) => {
  try {
    const userId = req.user.id;
    const { twilioPhone, forwardingPhone, twilioAccountSid, twilioAuthToken } = req.body;

    // Build dynamic query - only update auth token if provided
    let updateQuery;
    let params;

    if (twilioAuthToken) {
      // Encrypt the auth token before storing
      const encryptedAuthToken = encrypt(twilioAuthToken);
      updateQuery = `UPDATE settings
         SET twilio_phone = $1,
             forwarding_phone = $2,
             twilio_account_sid = $3,
             twilio_auth_token = $4
         WHERE user_id = $5
         RETURNING *`;
      params = [twilioPhone, forwardingPhone || null, twilioAccountSid, encryptedAuthToken, userId];
    } else {
      updateQuery = `UPDATE settings
         SET twilio_phone = $1,
             forwarding_phone = $2,
             twilio_account_sid = $3
         WHERE user_id = $4
         RETURNING *`;
      params = [twilioPhone, forwardingPhone || null, twilioAccountSid, userId];
    }

    const result = await query(updateQuery, params);

    res.json({
      message: 'Twilio settings updated',
      settings: formatSettings(result.rows[0])
    });
  } catch (error) {
    console.error('Update Twilio settings error:', error);
    res.status(500).json({ error: { message: 'Failed to update Twilio settings' } });
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

// PUT /api/settings/pbx - Update PBX/phone system settings
router.put('/pbx', async (req, res) => {
  try {
    const userId = req.user.id;
    const { businessPhone, pbxType, forwardingPhone } = req.body;

    // Generate webhook secret if not exists
    let webhookSecret = null;
    const existingSettings = await query(
      'SELECT pbx_webhook_secret FROM settings WHERE user_id = $1',
      [userId]
    );

    if (!existingSettings.rows[0]?.pbx_webhook_secret) {
      webhookSecret = crypto.randomBytes(32).toString('hex');
    }

    const result = await query(
      `UPDATE settings
       SET business_phone = COALESCE($1, business_phone),
           pbx_type = COALESCE($2, pbx_type),
           forwarding_phone = COALESCE($3, forwarding_phone),
           pbx_webhook_secret = COALESCE($4, pbx_webhook_secret)
       WHERE user_id = $5
       RETURNING *`,
      [businessPhone, pbxType, forwardingPhone, webhookSecret, userId]
    );

    res.json({
      message: 'Phone system settings updated',
      settings: formatSettings(result.rows[0])
    });
  } catch (error) {
    console.error('Update PBX settings error:', error);
    res.status(500).json({ error: { message: 'Failed to update phone system settings' } });
  }
});

// PUT /api/settings/sms - Update SMS settings (CellCast)
router.put('/sms', async (req, res) => {
  try {
    const userId = req.user.id;
    const { cellcastApiKey, smsReplyNumber } = req.body;

    // Encrypt API key if provided
    const encryptedApiKey = cellcastApiKey ? encrypt(cellcastApiKey) : null;

    const result = await query(
      `UPDATE settings
       SET cellcast_api_key = COALESCE($1, cellcast_api_key),
           sms_reply_number = COALESCE($2, sms_reply_number)
       WHERE user_id = $3
       RETURNING *`,
      [encryptedApiKey, smsReplyNumber, userId]
    );

    res.json({
      message: 'SMS settings updated',
      settings: formatSettings(result.rows[0])
    });
  } catch (error) {
    console.error('Update SMS settings error:', error);
    res.status(500).json({ error: { message: 'Failed to update SMS settings' } });
  }
});

// POST /api/settings/sms/test - Test CellCast SMS configuration
router.post('/sms/test', async (req, res) => {
  try {
    const userId = req.user.id;
    const { testPhone } = req.body;

    if (!testPhone) {
      return res.status(400).json({ error: { message: 'Test phone number is required' } });
    }

    // Get settings
    const settingsResult = await query(
      'SELECT cellcast_api_key, sms_reply_number FROM settings WHERE user_id = $1',
      [userId]
    );

    if (!settingsResult.rows[0]?.cellcast_api_key) {
      return res.status(400).json({ error: { message: 'CellCast API key not configured' } });
    }

    const apiKey = decrypt(settingsResult.rows[0].cellcast_api_key);
    const fromNumber = settingsResult.rows[0].sms_reply_number || process.env.CELLCAST_PHONE_NUMBER;

    // Send test SMS
    const result = await cellcast.sendSMS(
      apiKey,
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

// GET /api/settings/webhook-urls - Get webhook URLs for user's PBX
router.get('/webhook-urls', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get settings
    const settingsResult = await query(
      'SELECT pbx_type, pbx_webhook_secret FROM settings WHERE user_id = $1',
      [userId]
    );

    if (!settingsResult.rows[0]) {
      return res.status(404).json({ error: { message: 'Settings not found' } });
    }

    const { pbx_type, pbx_webhook_secret } = settingsResult.rows[0];
    const baseUrl = process.env.API_URL || 'https://your-app.com';

    // Generate webhook URLs based on PBX type
    const pbxEndpoint = pbx_type && pbx_type !== 'other' ? `/api/pbx/missed-call/${pbx_type}` : '/api/pbx/missed-call';

    res.json({
      webhooks: {
        missedCall: `${baseUrl}${pbxEndpoint}`,
        smsIncoming: `${baseUrl}/api/sms/incoming`,
        smsStatus: `${baseUrl}/api/sms/status`
      },
      webhookSecret: pbx_webhook_secret,
      pbxType: pbx_type,
      instructions: {
        header: 'X-Webhook-Secret',
        method: 'POST',
        contentType: 'application/json'
      }
    });
  } catch (error) {
    console.error('Get webhook URLs error:', error);
    res.status(500).json({ error: { message: 'Failed to get webhook URLs' } });
  }
});

// POST /api/settings/regenerate-webhook-secret - Regenerate webhook secret
router.post('/regenerate-webhook-secret', async (req, res) => {
  try {
    const userId = req.user.id;

    const newSecret = crypto.randomBytes(32).toString('hex');

    const result = await query(
      `UPDATE settings SET pbx_webhook_secret = $1 WHERE user_id = $2 RETURNING *`,
      [newSecret, userId]
    );

    res.json({
      message: 'Webhook secret regenerated',
      webhookSecret: newSecret
    });
  } catch (error) {
    console.error('Regenerate webhook secret error:', error);
    res.status(500).json({ error: { message: 'Failed to regenerate webhook secret' } });
  }
});

// Helper function to format settings for API response
function formatSettings(settings) {
  // Generate webhook URL
  const baseUrl = process.env.API_URL || 'https://your-app.com';
  const pbxType = settings.pbx_type || 'other';
  const pbxEndpoint = pbxType !== 'other' ? `/api/pbx/missed-call/${pbxType}` : '/api/pbx/missed-call';

  return {
    id: settings.id,
    // Legacy Twilio fields (will be deprecated)
    twilioPhone: settings.twilio_phone,
    twilioAccountSid: settings.twilio_account_sid ? '••••' + settings.twilio_account_sid.slice(-4) : null,
    twilioAuthToken: settings.twilio_auth_token ? '••••••••' : null,
    hasTwilioCredentials: !!(settings.twilio_account_sid && settings.twilio_auth_token),
    // Phone system settings
    businessPhone: settings.business_phone,
    forwardingPhone: settings.forwarding_phone,
    pbxType: settings.pbx_type || 'other',
    pbxWebhookSecret: settings.pbx_webhook_secret ? '••••' + settings.pbx_webhook_secret.slice(-8) : null,
    hasPbxWebhookSecret: !!settings.pbx_webhook_secret,
    // SMS settings (CellCast)
    smsReplyNumber: settings.sms_reply_number,
    hasCellcastCredentials: !!settings.cellcast_api_key,
    // Webhook URL (for display)
    webhookUrl: `${baseUrl}${pbxEndpoint}`,
    // Other settings
    notificationEmail: settings.notification_email,
    notificationSms: settings.notification_sms,
    bookingMode: settings.booking_mode,
    businessHours: settings.business_hours,
    aiGreeting: settings.ai_greeting,
    createdAt: settings.created_at,
    updatedAt: settings.updated_at
  };
}

module.exports = router;
