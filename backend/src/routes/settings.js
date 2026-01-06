const express = require('express');
const crypto = require('crypto');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Encryption key for Twilio credentials - require in production
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
  console.error('FATAL: ENCRYPTION_KEY environment variable is required in production for credential encryption');
  process.exit(1);
}

// Use a development-only fallback (32 bytes for AES-256)
const KEY = ENCRYPTION_KEY || 'dev-only-32-char-key-not-prod!!';
const IV_LENGTH = 16;

/**
 * Encrypt sensitive data (Twilio auth token)
 */
function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypt sensitive data
 */
function decrypt(text) {
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
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error('Decryption error:', error.message);
    // Return original text if decryption fails (legacy unencrypted data)
    return text;
  }
}

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
router.put('/twilio', async (req, res) => {
  try {
    const userId = req.user.id;
    const { twilioPhone, forwardingPhone, twilioAccountSid, twilioAuthToken } = req.body;

    if (!twilioPhone || !twilioAccountSid) {
      return res.status(400).json({
        error: { message: 'Twilio phone number and Account SID are required' }
      });
    }

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
router.put('/business-hours', async (req, res) => {
  try {
    const userId = req.user.id;
    const { businessHours } = req.body;

    if (!businessHours) {
      return res.status(400).json({
        error: { message: 'Business hours are required' }
      });
    }

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

// Helper function to format settings for API response
function formatSettings(settings) {
  return {
    id: settings.id,
    twilioPhone: settings.twilio_phone,
    forwardingPhone: settings.forwarding_phone,
    twilioAccountSid: settings.twilio_account_sid ? '••••' + settings.twilio_account_sid.slice(-4) : null,
    twilioAuthToken: settings.twilio_auth_token ? '••••••••' : null,
    hasTwilioCredentials: !!(settings.twilio_account_sid && settings.twilio_auth_token),
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
