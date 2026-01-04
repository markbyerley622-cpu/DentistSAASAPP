const express = require('express');
const { google } = require('googleapis');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Google OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/calendar/callback'
);

// Apply authentication to all routes
router.use(authenticate);

// GET /api/calendar/auth-url - Get Google OAuth URL
router.get('/auth-url', async (req, res) => {
  try {
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: req.user.id,
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
    const { code, state: userId } = req.query;

    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?calendar=error&message=No authorization code`);
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
    res.redirect(`${process.env.FRONTEND_URL}/settings?calendar=error&message=${encodeURIComponent(error.message)}`);
  }
});

// GET /api/calendar/status - Check calendar connection status
router.get('/status', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      'SELECT google_calendar_connected, google_tokens FROM settings WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ connected: false });
    }

    const settings = result.rows[0];

    res.json({
      connected: settings.google_calendar_connected,
      hasTokens: !!settings.google_tokens
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

    const result = await query(
      'SELECT google_tokens FROM settings WHERE user_id = $1 AND google_calendar_connected = true',
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].google_tokens) {
      return res.status(400).json({ error: { message: 'Calendar not connected' } });
    }

    const tokens = result.rows[0].google_tokens;
    oauth2Client.setCredentials(tokens);

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

    const result = await query(
      'SELECT google_tokens FROM settings WHERE user_id = $1 AND google_calendar_connected = true',
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].google_tokens) {
      return res.status(400).json({ error: { message: 'Calendar not connected' } });
    }

    const tokens = result.rows[0].google_tokens;
    oauth2Client.setCredentials(tokens);

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
    const dayHours = businessHours[dayOfWeek];

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
        available: true // Will be filtered based on existing events
      });

      currentMin += 30;
      if (currentMin >= 60) {
        currentMin = 0;
        currentHour += 1;
      }
    }

    // If calendar is connected, filter out booked slots
    if (settings.google_calendar_connected && settings.google_tokens) {
      // Fetch existing events and mark slots as unavailable
      // This is a simplified version - you'd want to do actual overlap checking
    }

    res.json({ slots, businessHours: dayHours });
  } catch (error) {
    console.error('Get availability error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch availability' } });
  }
});

module.exports = router;
