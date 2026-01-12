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
        -- Total counts
        (SELECT COUNT(*) FROM users WHERE is_admin = false) as total_clients,
        (SELECT COUNT(*) FROM calls) as total_calls,
        (SELECT COUNT(*) FROM calls WHERE is_missed = true) as missed_calls,
        (SELECT COUNT(*) FROM leads) as total_leads,
        (SELECT COUNT(*) FROM leads WHERE status = 'converted') as converted_leads,
        (SELECT COUNT(*) FROM leads WHERE appointment_booked = true) as booked_leads,
        (SELECT COUNT(*) FROM leads WHERE status = 'qualified') as qualified_leads,
        (SELECT COUNT(*) FROM leads WHERE status = 'handled') as handled_leads,
        (SELECT COUNT(*) FROM appointments) as total_appointments,
        (SELECT COUNT(*) FROM appointments WHERE status = 'scheduled' AND appointment_date >= CURRENT_DATE) as upcoming_appointments,

        -- Today's activity
        (SELECT COUNT(*) FROM calls WHERE is_missed = true AND created_at >= CURRENT_DATE) as missed_calls_today,
        (SELECT COUNT(*) FROM leads WHERE created_at >= CURRENT_DATE) as leads_today,
        (SELECT COUNT(*) FROM leads WHERE callback_type IS NOT NULL AND created_at >= CURRENT_DATE) as callbacks_requested_today,

        -- This week
        (SELECT COUNT(*) FROM calls WHERE is_missed = true AND created_at >= CURRENT_DATE - INTERVAL '7 days') as missed_calls_week,
        (SELECT COUNT(*) FROM leads WHERE callback_type IS NOT NULL AND created_at >= CURRENT_DATE - INTERVAL '7 days') as callbacks_week,

        -- Last week (for comparison)
        (SELECT COUNT(*) FROM calls WHERE is_missed = true AND created_at >= CURRENT_DATE - INTERVAL '14 days' AND created_at < CURRENT_DATE - INTERVAL '7 days') as missed_calls_last_week,

        -- Response metrics
        (SELECT COUNT(*) FROM calls WHERE is_missed = true AND handled_by_ai = true) as ai_handled_calls,
        (SELECT COUNT(*) FROM messages WHERE sender = 'ai' AND provider = 'notifyre') as sms_sent,
        (SELECT COUNT(*) FROM messages WHERE sender = 'patient') as sms_received,

        -- Active clients (activity in last 30 days)
        (SELECT COUNT(DISTINCT user_id) FROM calls WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as active_clients
    `);

    const stats = result.rows[0];
    const missedCalls = parseInt(stats.missed_calls) || 0;
    const aiHandledCalls = parseInt(stats.ai_handled_calls) || 0;
    const totalLeads = parseInt(stats.total_leads) || 0;
    const convertedLeads = parseInt(stats.converted_leads) || 0;
    const qualifiedLeads = parseInt(stats.qualified_leads) || 0;
    const handledLeads = parseInt(stats.handled_leads) || 0;

    res.json({
      stats: {
        // Totals
        totalClients: parseInt(stats.total_clients) || 0,
        activeClients: parseInt(stats.active_clients) || 0,
        totalCalls: parseInt(stats.total_calls) || 0,
        missedCalls: missedCalls,
        totalLeads: totalLeads,
        convertedLeads: convertedLeads,
        bookedLeads: parseInt(stats.booked_leads) || 0,
        qualifiedLeads: qualifiedLeads,
        handledLeads: handledLeads,
        totalAppointments: parseInt(stats.total_appointments) || 0,
        upcomingAppointments: parseInt(stats.upcoming_appointments) || 0,

        // Today
        missedCallsToday: parseInt(stats.missed_calls_today) || 0,
        leadsToday: parseInt(stats.leads_today) || 0,
        callbacksRequestedToday: parseInt(stats.callbacks_requested_today) || 0,

        // This week
        missedCallsWeek: parseInt(stats.missed_calls_week) || 0,
        callbacksWeek: parseInt(stats.callbacks_week) || 0,
        missedCallsLastWeek: parseInt(stats.missed_calls_last_week) || 0,

        // Response metrics
        aiHandledCalls: aiHandledCalls,
        smsSent: parseInt(stats.sms_sent) || 0,
        smsReceived: parseInt(stats.sms_received) || 0,

        // Calculated rates
        conversionRate: totalLeads > 0
          ? ((convertedLeads / totalLeads) * 100).toFixed(1)
          : 0,
        responseRate: missedCalls > 0
          ? ((aiHandledCalls / missedCalls) * 100).toFixed(1)
          : 0,
        weekOverWeekGrowth: parseInt(stats.missed_calls_last_week) > 0
          ? (((parseInt(stats.missed_calls_week) - parseInt(stats.missed_calls_last_week)) / parseInt(stats.missed_calls_last_week)) * 100).toFixed(1)
          : 0
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
        s.sms_reply_number,
        s.forwarding_phone,
        (SELECT COUNT(*) FROM calls c WHERE c.user_id = u.id) as total_calls,
        (SELECT COUNT(*) FROM calls c WHERE c.user_id = u.id AND c.is_missed = true) as missed_calls,
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
        smsNumber: client.sms_reply_number,
        forwardingPhone: client.forwarding_phone,
        createdAt: client.created_at,
        stats: {
          totalCalls: parseInt(client.total_calls) || 0,
          missedCalls: parseInt(client.missed_calls) || 0,
          totalLeads: parseInt(client.total_leads) || 0,
          convertedLeads: parseInt(client.converted_leads) || 0,
          bookedLeads: parseInt(client.booked_leads) || 0,
          totalAppointments: parseInt(client.total_appointments) || 0,
          upcomingAppointments: parseInt(client.upcoming_appointments) || 0
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
        s.sms_reply_number,
        s.forwarding_phone,
        s.business_hours,
        s.ai_greeting,
        s.booking_mode
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
          smsConfigured: !!client.sms_reply_number,
          smsNumber: client.sms_reply_number,
          forwardingPhone: client.forwarding_phone,
          businessHours: client.business_hours,
          aiGreeting: client.ai_greeting,
          bookingMode: client.booking_mode
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
