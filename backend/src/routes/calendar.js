const express = require('express');
const { google } = require('googleapis');
const crypto = require('crypto');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * Per-User Google Calendar Integration
 *
 * Each user configures their own Google OAuth credentials via the Settings page.
 * This removes the need for deployment-time environment variables.
 *
 * Setup flow for users:
 * 1. Go to Google Cloud Console (console.cloud.google.com)
 * 2. Create a new project or select existing one
 * 3. Enable the Google Calendar API
 * 4. Create OAuth 2.0 credentials (Web application)
 * 5. Add authorized redirect URI: https://your-app.com/api/calendar/callback
 * 6. Copy Client ID and Client Secret to SmileDesk settings
 * 7. Click "Connect Calendar" to authorize
 *
 * Note: New OAuth apps are in "Testing" mode by default, limited to 100 users.
 * Users need to submit for verification to remove this limit.
 */

// Encryption key for storing credentials (should be in env vars in production)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex').slice(0, 32);
const IV_LENGTH = 16;

// Encrypt sensitive data
function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// Decrypt sensitive data
function decrypt(text) {
  if (!text) return null;
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
}

// Helper function to create OAuth2 client with user's credentials
async function getUserOAuth2Client(userId) {
  const result = await query(
    'SELECT google_client_id, google_client_secret FROM settings WHERE user_id = $1',
    [userId]
  );

  if (result.rows.length === 0 || !result.rows[0].google_client_id || !result.rows[0].google_client_secret) {
    return null;
  }

  const { google_client_id, google_client_secret } = result.rows[0];

  // Decrypt the client secret
  const decryptedSecret = decrypt(google_client_secret) || google_client_secret;

  // Determine the redirect URI based on environment
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
    (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL.replace(/\/$/, '')}/api/calendar/callback` :
    'http://localhost:3001/api/calendar/callback');

  return new google.auth.OAuth2(
    google_client_id,
    decryptedSecret,
    redirectUri
  );
}

/**
 * Get OAuth2 client with tokens and automatic refresh handling
 * This ensures tokens are refreshed when expired
 */
async function getAuthenticatedClient(userId) {
  const result = await query(
    'SELECT google_tokens, google_client_id, google_client_secret FROM settings WHERE user_id = $1 AND google_calendar_connected = true',
    [userId]
  );

  if (result.rows.length === 0 || !result.rows[0].google_tokens) {
    return { error: 'Calendar not connected' };
  }

  const oauth2Client = await getUserOAuth2Client(userId);
  if (!oauth2Client) {
    return { error: 'OAuth credentials not configured' };
  }

  let tokens = result.rows[0].google_tokens;

  // Parse tokens if they're a string
  if (typeof tokens === 'string') {
    try {
      tokens = JSON.parse(tokens);
    } catch (e) {
      return { error: 'Invalid token format' };
    }
  }

  oauth2Client.setCredentials(tokens);

  // Set up automatic token refresh
  oauth2Client.on('tokens', async (newTokens) => {
    console.log('Google OAuth tokens refreshed for user:', userId);

    // Merge new tokens with existing ones (refresh_token may not be in new tokens)
    const updatedTokens = {
      ...tokens,
      ...newTokens
    };

    // Save the refreshed tokens
    try {
      await query(
        `UPDATE settings SET google_tokens = $1 WHERE user_id = $2`,
        [JSON.stringify(updatedTokens), userId]
      );
    } catch (error) {
      console.error('Failed to save refreshed tokens:', error);
    }
  });

  // Check if access token is expired and refresh if needed
  if (tokens.expiry_date && Date.now() >= tokens.expiry_date - 60000) {
    // Token expires in less than 1 minute, refresh it
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      const updatedTokens = { ...tokens, ...credentials };

      await query(
        `UPDATE settings SET google_tokens = $1 WHERE user_id = $2`,
        [JSON.stringify(updatedTokens), userId]
      );

      oauth2Client.setCredentials(updatedTokens);
      console.log('Proactively refreshed tokens for user:', userId);
    } catch (error) {
      console.error('Token refresh failed:', error);
      // If refresh fails, the token might be revoked
      if (error.message?.includes('invalid_grant') || error.message?.includes('Token has been revoked')) {
        // Mark calendar as disconnected
        await query(
          `UPDATE settings SET google_calendar_connected = false, google_tokens = NULL WHERE user_id = $1`,
          [userId]
        );
        return { error: 'Calendar authorization expired. Please reconnect your calendar.' };
      }
      return { error: 'Failed to refresh calendar access. Please try reconnecting.' };
    }
  }

  return { client: oauth2Client };
}

// Apply authentication to all routes
router.use(authenticate);

// GET /api/calendar/credentials-status - Check if user has configured OAuth credentials
router.get('/credentials-status', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      'SELECT google_client_id, google_client_secret FROM settings WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ configured: false });
    }

    const settings = result.rows[0];
    const configured = !!(settings.google_client_id && settings.google_client_secret);

    res.json({ configured });
  } catch (error) {
    console.error('Get credentials status error:', error);
    res.status(500).json({ error: { message: 'Failed to check credentials status' } });
  }
});

// POST /api/calendar/credentials - Save user's Google OAuth credentials (encrypted)
router.post('/credentials', async (req, res) => {
  try {
    const userId = req.user.id;
    const { clientId, clientSecret } = req.body;

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        error: { message: 'Client ID and Client Secret are required' }
      });
    }

    // Validate the credentials format
    if (!clientId.endsWith('.apps.googleusercontent.com')) {
      return res.status(400).json({
        error: { message: 'Invalid Client ID format. It should end with .apps.googleusercontent.com' }
      });
    }

    // Encrypt the client secret before storing
    const encryptedSecret = encrypt(clientSecret);

    // Save credentials (client ID in plain text, secret encrypted)
    await query(
      `UPDATE settings
       SET google_client_id = $1, google_client_secret = $2
       WHERE user_id = $3`,
      [clientId, encryptedSecret, userId]
    );

    res.json({ message: 'Google OAuth credentials saved successfully' });
  } catch (error) {
    console.error('Save credentials error:', error);
    res.status(500).json({ error: { message: 'Failed to save credentials' } });
  }
});

// DELETE /api/calendar/credentials - Remove user's Google OAuth credentials
router.delete('/credentials', async (req, res) => {
  try {
    const userId = req.user.id;

    await query(
      `UPDATE settings
       SET google_client_id = NULL, google_client_secret = NULL,
           google_calendar_connected = false, google_tokens = NULL
       WHERE user_id = $1`,
      [userId]
    );

    res.json({ message: 'Google OAuth credentials removed successfully' });
  } catch (error) {
    console.error('Remove credentials error:', error);
    res.status(500).json({ error: { message: 'Failed to remove credentials' } });
  }
});

// GET /api/calendar/auth-url - Get Google OAuth URL
router.get('/auth-url', async (req, res) => {
  try {
    const userId = req.user.id;
    const oauth2Client = await getUserOAuth2Client(userId);

    if (!oauth2Client) {
      return res.status(400).json({
        error: {
          message: 'Google OAuth credentials not configured. Please add your Client ID and Client Secret in Settings first.',
          code: 'CREDENTIALS_NOT_CONFIGURED'
        }
      });
    }

    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: userId,
      prompt: 'consent'
    });

    res.json({ authUrl });
  } catch (error) {
    console.error('Get auth URL error:', error);
    res.status(500).json({ error: { message: 'Failed to generate auth URL' } });
  }
});

// GET /api/calendar/callback - Google OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code, state: userId, error: oauthError } = req.query;

    // Handle OAuth errors (user denied access, etc.)
    if (oauthError) {
      console.error('OAuth error from Google:', oauthError);
      return res.redirect(`${process.env.FRONTEND_URL}/settings?calendar=error&message=${encodeURIComponent(oauthError)}`);
    }

    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?calendar=error&message=No authorization code received`);
    }

    if (!userId) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?calendar=error&message=Invalid state parameter`);
    }

    // Get user's OAuth client
    const oauth2Client = await getUserOAuth2Client(userId);

    if (!oauth2Client) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?calendar=error&message=OAuth credentials not found`);
    }

    const { tokens } = await oauth2Client.getToken(code);

    // Save tokens to settings
    await query(
      `UPDATE settings
       SET google_calendar_connected = true, google_tokens = $1
       WHERE user_id = $2`,
      [JSON.stringify(tokens), userId]
    );

    res.redirect(`${process.env.FRONTEND_URL}/settings?calendar=success`);
  } catch (error) {
    console.error('Calendar callback error:', error);
    const errorMessage = error.message || 'Failed to connect calendar';
    res.redirect(`${process.env.FRONTEND_URL}/settings?calendar=error&message=${encodeURIComponent(errorMessage)}`);
  }
});

// GET /api/calendar/status - Check calendar connection status
router.get('/status', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      'SELECT google_calendar_connected, google_tokens, google_client_id, google_client_secret FROM settings WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        connected: false,
        credentialsConfigured: false
      });
    }

    const settings = result.rows[0];

    res.json({
      connected: settings.google_calendar_connected,
      hasTokens: !!settings.google_tokens,
      credentialsConfigured: !!(settings.google_client_id && settings.google_client_secret)
    });
  } catch (error) {
    console.error('Get calendar status error:', error);
    res.status(500).json({ error: { message: 'Failed to check calendar status' } });
  }
});

// POST /api/calendar/disconnect - Disconnect Google Calendar
router.post('/disconnect', async (req, res) => {
  try {
    const userId = req.user.id;

    await query(
      `UPDATE settings
       SET google_calendar_connected = false, google_tokens = null
       WHERE user_id = $1`,
      [userId]
    );

    res.json({ message: 'Calendar disconnected successfully' });
  } catch (error) {
    console.error('Disconnect calendar error:', error);
    res.status(500).json({ error: { message: 'Failed to disconnect calendar' } });
  }
});

// GET /api/calendar/events - Get calendar events
router.get('/events', async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    const { client: oauth2Client, error } = await getAuthenticatedClient(userId);

    if (error) {
      return res.status(400).json({ error: { message: error } });
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const events = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startDate || new Date().toISOString(),
      timeMax: endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    res.json({
      events: events.data.items.map(event => ({
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: event.start.dateTime || event.start.date,
        end: event.end.dateTime || event.end.date,
        attendees: event.attendees
      }))
    });
  } catch (error) {
    console.error('Get events error:', error);

    // Handle specific Google API errors
    if (error.code === 401 || error.message?.includes('invalid_grant')) {
      return res.status(401).json({
        error: { message: 'Calendar authorization expired. Please reconnect your calendar.' }
      });
    }

    res.status(500).json({ error: { message: 'Failed to fetch calendar events' } });
  }
});

// POST /api/calendar/events - Create calendar event
router.post('/events', async (req, res) => {
  try {
    const userId = req.user.id;
    const { summary, description, startTime, endTime, attendeeEmail } = req.body;

    if (!summary || !startTime || !endTime) {
      return res.status(400).json({
        error: { message: 'Summary, start time, and end time are required' }
      });
    }

    const { client: oauth2Client, error } = await getAuthenticatedClient(userId);

    if (error) {
      return res.status(400).json({ error: { message: error } });
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const event = {
      summary,
      description,
      start: {
        dateTime: startTime,
        timeZone: req.user.timezone || 'Australia/Sydney'
      },
      end: {
        dateTime: endTime,
        timeZone: req.user.timezone || 'Australia/Sydney'
      }
    };

    if (attendeeEmail) {
      event.attendees = [{ email: attendeeEmail }];
    }

    const createdEvent = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendUpdates: attendeeEmail ? 'all' : 'none'
    });

    res.status(201).json({
      event: {
        id: createdEvent.data.id,
        summary: createdEvent.data.summary,
        start: createdEvent.data.start.dateTime,
        end: createdEvent.data.end.dateTime,
        htmlLink: createdEvent.data.htmlLink
      }
    });
  } catch (error) {
    console.error('Create event error:', error);

    if (error.code === 401 || error.message?.includes('invalid_grant')) {
      return res.status(401).json({
        error: { message: 'Calendar authorization expired. Please reconnect your calendar.' }
      });
    }

    res.status(500).json({ error: { message: 'Failed to create calendar event' } });
  }
});

// GET /api/calendar/availability - Get available time slots
router.get('/availability', async (req, res) => {
  try {
    const userId = req.user.id;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: { message: 'Date is required' } });
    }

    // Get business hours
    const settingsResult = await query(
      'SELECT business_hours, google_tokens, google_calendar_connected FROM settings WHERE user_id = $1',
      [userId]
    );

    if (settingsResult.rows.length === 0) {
      return res.status(400).json({ error: { message: 'Settings not found' } });
    }

    const settings = settingsResult.rows[0];
    const businessHours = settings.business_hours;
    const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const dayHours = businessHours?.[dayOfWeek];

    if (!dayHours || !dayHours.enabled) {
      return res.json({ slots: [], message: 'Practice is closed on this day' });
    }

    // Generate time slots (30-minute intervals)
    const slots = [];
    const [openHour, openMin] = dayHours.open.split(':').map(Number);
    const [closeHour, closeMin] = dayHours.close.split(':').map(Number);

    let currentHour = openHour;
    let currentMin = openMin;

    while (currentHour < closeHour || (currentHour === closeHour && currentMin < closeMin)) {
      const time = `${currentHour.toString().padStart(2, '0')}:${currentMin.toString().padStart(2, '0')}`;
      slots.push({
        time,
        available: true
      });

      currentMin += 30;
      if (currentMin >= 60) {
        currentMin = 0;
        currentHour += 1;
      }
    }

    // If calendar is connected, filter out booked slots
    if (settings.google_calendar_connected && settings.google_tokens) {
      try {
        const { client: oauth2Client } = await getAuthenticatedClient(userId);
        if (oauth2Client) {
          const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

          // Get events for the requested date
          const startOfDay = new Date(date);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(date);
          endOfDay.setHours(23, 59, 59, 999);

          const events = await calendar.events.list({
            calendarId: 'primary',
            timeMin: startOfDay.toISOString(),
            timeMax: endOfDay.toISOString(),
            singleEvents: true,
            orderBy: 'startTime'
          });

          // Mark slots as unavailable if they overlap with events
          for (const slot of slots) {
            const slotStart = new Date(date);
            const [slotHour, slotMinute] = slot.time.split(':').map(Number);
            slotStart.setHours(slotHour, slotMinute, 0, 0);
            const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

            for (const event of events.data.items || []) {
              const eventStart = new Date(event.start.dateTime || event.start.date);
              const eventEnd = new Date(event.end.dateTime || event.end.date);

              // Check for overlap
              if (slotStart < eventEnd && slotEnd > eventStart) {
                slot.available = false;
                slot.blockedBy = event.summary || 'Busy';
                break;
              }
            }
          }
        }
      } catch (calendarError) {
        console.error('Error checking calendar for availability:', calendarError);
        // Continue without calendar filtering if there's an error
      }
    }

    res.json({ slots, businessHours: dayHours });
  } catch (error) {
    console.error('Get availability error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch availability' } });
  }
});

module.exports = router;
