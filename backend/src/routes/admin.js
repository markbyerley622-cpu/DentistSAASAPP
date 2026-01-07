const express = require('express');
const { query } = require('../db/config');
const { authenticate, authenticateAdmin } = require('../middleware/auth');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate);
router.use(authenticateAdmin);

// GET /api/admin/stats - Overall platform statistics
router.get('/stats', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE is_admin = false) as total_clients,
        (SELECT COUNT(*) FROM calls) as total_calls,
        (SELECT COUNT(*) FROM calls WHERE is_missed = true) as missed_calls,
        (SELECT COUNT(*) FROM calls WHERE voicemail_url IS NOT NULL AND voicemail_duration >= 3) as total_voicemails,
        (SELECT COUNT(*) FROM calls WHERE voicemail_intent = 'callback') as callback_requests,
        (SELECT COUNT(*) FROM leads) as total_leads,
        (SELECT COUNT(*) FROM leads WHERE status = 'converted') as converted_leads,
        (SELECT COUNT(*) FROM leads WHERE appointment_booked = true) as booked_leads,
        (SELECT COUNT(*) FROM appointments) as total_appointments,
        (SELECT COUNT(*) FROM appointments WHERE status = 'scheduled' AND appointment_date >= CURRENT_DATE) as upcoming_appointments
    `);

    const stats = result.rows[0];

    res.json({
      stats: {
        totalClients: parseInt(stats.total_clients),
        totalCalls: parseInt(stats.total_calls),
        missedCalls: parseInt(stats.missed_calls),
        totalVoicemails: parseInt(stats.total_voicemails),
        callbackRequests: parseInt(stats.callback_requests),
        totalLeads: parseInt(stats.total_leads),
        convertedLeads: parseInt(stats.converted_leads),
        bookedLeads: parseInt(stats.booked_leads),
        conversionRate: stats.total_leads > 0
          ? ((stats.converted_leads / stats.total_leads) * 100).toFixed(1)
          : 0,
        totalAppointments: parseInt(stats.total_appointments),
        upcomingAppointments: parseInt(stats.upcoming_appointments)
      }
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch admin stats' } });
  }
});

// GET /api/admin/clients - All clients with their stats
router.get('/clients', async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE u.is_admin = false';
    const params = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      whereClause += ` AND (u.email ILIKE $${paramCount} OR u.practice_name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM users u ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get clients with stats
    const result = await query(
      `SELECT
        u.id,
        u.email,
        u.practice_name,
        u.phone,
        u.timezone,
        u.created_at,
        s.twilio_phone,
        s.forwarding_phone,
        (SELECT COUNT(*) FROM calls c WHERE c.user_id = u.id) as total_calls,
        (SELECT COUNT(*) FROM calls c WHERE c.user_id = u.id AND c.is_missed = true) as missed_calls,
        (SELECT COUNT(*) FROM calls c WHERE c.user_id = u.id AND c.voicemail_url IS NOT NULL AND c.voicemail_duration >= 3) as total_voicemails,
        (SELECT COUNT(*) FROM calls c WHERE c.user_id = u.id AND c.voicemail_intent = 'callback') as callback_requests,
        (SELECT COUNT(*) FROM leads l WHERE l.user_id = u.id) as total_leads,
        (SELECT COUNT(*) FROM leads l WHERE l.user_id = u.id AND l.status = 'converted') as converted_leads,
        (SELECT COUNT(*) FROM leads l WHERE l.user_id = u.id AND l.appointment_booked = true) as booked_leads,
        (SELECT COUNT(*) FROM appointments a WHERE a.user_id = u.id) as total_appointments,
        (SELECT COUNT(*) FROM appointments a WHERE a.user_id = u.id AND a.status = 'scheduled' AND a.appointment_date >= CURRENT_DATE) as upcoming_appointments
       FROM users u
       LEFT JOIN settings s ON s.user_id = u.id
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    res.json({
      clients: result.rows.map(client => ({
        id: client.id,
        email: client.email,
        practiceName: client.practice_name,
        phone: client.phone,
        timezone: client.timezone,
        twilioPhone: client.twilio_phone,
        forwardingPhone: client.forwarding_phone,
        createdAt: client.created_at,
        stats: {
          totalCalls: parseInt(client.total_calls),
          missedCalls: parseInt(client.missed_calls),
          totalVoicemails: parseInt(client.total_voicemails),
          callbackRequests: parseInt(client.callback_requests),
          totalLeads: parseInt(client.total_leads),
          convertedLeads: parseInt(client.converted_leads),
          bookedLeads: parseInt(client.booked_leads),
          totalAppointments: parseInt(client.total_appointments),
          upcomingAppointments: parseInt(client.upcoming_appointments)
        }
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Admin clients error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch clients' } });
  }
});

// GET /api/admin/voicemails - All voicemails across all clients
router.get('/voicemails', async (req, res) => {
  try {
    const { page = 1, limit = 20, intent, clientId } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE c.voicemail_url IS NOT NULL AND c.voicemail_duration >= 3';
    const params = [];
    let paramCount = 0;

    if (intent && intent !== 'all') {
      paramCount++;
      whereClause += ` AND c.voicemail_intent = $${paramCount}`;
      params.push(intent);
    }

    if (clientId) {
      paramCount++;
      whereClause += ` AND c.user_id = $${paramCount}`;
      params.push(clientId);
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM calls c ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get voicemails
    const result = await query(
      `SELECT
        c.id,
        c.user_id,
        u.practice_name,
        u.email as client_email,
        c.caller_phone,
        c.caller_name,
        c.voicemail_url,
        c.voicemail_duration,
        c.voicemail_transcription,
        c.voicemail_intent,
        c.followup_status,
        c.created_at
       FROM calls c
       JOIN users u ON c.user_id = u.id
       ${whereClause}
       ORDER BY
         CASE c.voicemail_intent
           WHEN 'emergency' THEN 1
           WHEN 'appointment' THEN 2
           WHEN 'callback' THEN 3
           WHEN 'inquiry' THEN 4
           ELSE 5
         END,
         c.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    res.json({
      voicemails: result.rows.map(vm => ({
        id: vm.id,
        clientId: vm.user_id,
        clientName: vm.practice_name,
        clientEmail: vm.client_email,
        callerPhone: vm.caller_phone,
        callerName: vm.caller_name || 'Unknown Caller',
        voicemailUrl: vm.voicemail_url,
        duration: vm.voicemail_duration,
        transcription: vm.voicemail_transcription,
        intent: vm.voicemail_intent,
        followupStatus: vm.followup_status,
        createdAt: vm.created_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Admin voicemails error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch voicemails' } });
  }
});

// GET /api/admin/leads - All leads across all clients
router.get('/leads', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, clientId } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (status && status !== 'all') {
      paramCount++;
      whereClause += ` AND l.status = $${paramCount}`;
      params.push(status);
    }

    if (clientId) {
      paramCount++;
      whereClause += ` AND l.user_id = $${paramCount}`;
      params.push(clientId);
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM leads l ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get leads
    const result = await query(
      `SELECT
        l.id,
        l.user_id,
        u.practice_name,
        u.email as client_email,
        l.name,
        l.phone,
        l.email,
        l.reason,
        l.status,
        l.priority,
        l.source,
        l.appointment_booked,
        l.created_at
       FROM leads l
       JOIN users u ON l.user_id = u.id
       ${whereClause}
       ORDER BY l.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    res.json({
      leads: result.rows.map(lead => ({
        id: lead.id,
        clientId: lead.user_id,
        clientName: lead.practice_name,
        clientEmail: lead.client_email,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        reason: lead.reason,
        status: lead.status,
        priority: lead.priority,
        source: lead.source,
        appointmentBooked: lead.appointment_booked,
        createdAt: lead.created_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Admin leads error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch leads' } });
  }
});

// GET /api/admin/calls - All calls across all clients
router.get('/calls', async (req, res) => {
  try {
    const { page = 1, limit = 20, clientId } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (clientId) {
      paramCount++;
      whereClause += ` AND c.user_id = $${paramCount}`;
      params.push(clientId);
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM calls c ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get calls
    const result = await query(
      `SELECT
        c.id,
        c.user_id,
        u.practice_name,
        c.caller_phone,
        c.caller_name,
        c.status,
        c.duration,
        c.is_missed,
        c.voicemail_url,
        c.voicemail_intent,
        c.followup_status,
        c.created_at
       FROM calls c
       JOIN users u ON c.user_id = u.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    res.json({
      calls: result.rows.map(call => ({
        id: call.id,
        clientId: call.user_id,
        clientName: call.practice_name,
        callerPhone: call.caller_phone,
        callerName: call.caller_name,
        status: call.status,
        duration: call.duration,
        isMissed: call.is_missed,
        hasVoicemail: !!call.voicemail_url,
        voicemailIntent: call.voicemail_intent,
        followupStatus: call.followup_status,
        createdAt: call.created_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Admin calls error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch calls' } });
  }
});

// GET /api/admin/client/:id - Get single client details
router.get('/client/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT
        u.id,
        u.email,
        u.practice_name,
        u.phone,
        u.timezone,
        u.created_at,
        s.twilio_account_sid,
        s.twilio_phone,
        s.forwarding_phone,
        s.business_hours,
        s.ai_greeting
       FROM users u
       LEFT JOIN settings s ON s.user_id = u.id
       WHERE u.id = $1 AND u.is_admin = false`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Client not found' } });
    }

    const client = result.rows[0];

    // Get recent activity
    const [callsResult, leadsResult] = await Promise.all([
      query(
        `SELECT COUNT(*) as count FROM calls WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
        [id]
      ),
      query(
        `SELECT COUNT(*) as count FROM leads WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
        [id]
      )
    ]);

    res.json({
      client: {
        id: client.id,
        email: client.email,
        practiceName: client.practice_name,
        phone: client.phone,
        timezone: client.timezone,
        createdAt: client.created_at,
        settings: {
          twilioConfigured: !!client.twilio_account_sid,
          twilioPhone: client.twilio_phone,
          forwardingPhone: client.forwarding_phone,
          businessHours: client.business_hours,
          aiGreeting: client.ai_greeting
        },
        recentActivity: {
          callsLast30Days: parseInt(callsResult.rows[0].count),
          leadsLast30Days: parseInt(leadsResult.rows[0].count)
        }
      }
    });
  } catch (error) {
    console.error('Admin client detail error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch client details' } });
  }
});

module.exports = router;
