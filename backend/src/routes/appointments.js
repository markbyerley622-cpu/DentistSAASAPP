const express = require('express');
const { query, getClient } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// GET /api/appointments - Get all appointments
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, startDate, endDate, limit = 50, offset = 0 } = req.query;

    let whereClause = 'WHERE a.user_id = $1';
    const params = [userId];

    if (status) {
      params.push(status);
      whereClause += ` AND a.status = $${params.length}`;
    }

    if (startDate) {
      params.push(startDate);
      whereClause += ` AND a.appointment_date >= $${params.length}`;
    }

    if (endDate) {
      params.push(endDate);
      whereClause += ` AND a.appointment_date <= $${params.length}`;
    }

    const result = await query(
      `SELECT
        a.*,
        l.name as lead_name,
        l.status as lead_status
       FROM appointments a
       LEFT JOIN leads l ON a.lead_id = l.id
       ${whereClause}
       ORDER BY a.appointment_date ASC, a.appointment_time ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM appointments a ${whereClause}`,
      params
    );

    res.json({
      appointments: result.rows.map(apt => ({
        id: apt.id,
        patientName: apt.patient_name,
        patientPhone: apt.patient_phone,
        patientEmail: apt.patient_email,
        appointmentDate: apt.appointment_date,
        appointmentTime: apt.appointment_time,
        durationMinutes: apt.duration_minutes,
        reason: apt.reason,
        notes: apt.notes,
        status: apt.status,
        googleEventId: apt.google_event_id,
        reminderSent: apt.reminder_sent,
        confirmedAt: apt.confirmed_at,
        createdAt: apt.created_at,
        lead: apt.lead_id ? {
          id: apt.lead_id,
          name: apt.lead_name,
          status: apt.lead_status
        } : null
      })),
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch appointments' } });
  }
});

// GET /api/appointments/today - Get today's appointments
router.get('/today', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT
        a.*,
        l.name as lead_name
       FROM appointments a
       LEFT JOIN leads l ON a.lead_id = l.id
       WHERE a.user_id = $1
         AND a.appointment_date = CURRENT_DATE
         AND a.status != 'cancelled'
       ORDER BY a.appointment_time ASC`,
      [userId]
    );

    res.json({
      appointments: result.rows.map(apt => ({
        id: apt.id,
        patientName: apt.patient_name,
        patientPhone: apt.patient_phone,
        appointmentTime: apt.appointment_time,
        durationMinutes: apt.duration_minutes,
        reason: apt.reason,
        status: apt.status,
        leadName: apt.lead_name
      }))
    });
  } catch (error) {
    console.error('Get today appointments error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch appointments' } });
  }
});

// GET /api/appointments/upcoming - Get upcoming appointments (next 7 days)
router.get('/upcoming', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT
        a.*,
        l.name as lead_name
       FROM appointments a
       LEFT JOIN leads l ON a.lead_id = l.id
       WHERE a.user_id = $1
         AND a.appointment_date >= CURRENT_DATE
         AND a.appointment_date <= CURRENT_DATE + INTERVAL '7 days'
         AND a.status != 'cancelled'
       ORDER BY a.appointment_date ASC, a.appointment_time ASC
       LIMIT 20`,
      [userId]
    );

    res.json({
      appointments: result.rows.map(apt => ({
        id: apt.id,
        patientName: apt.patient_name,
        patientPhone: apt.patient_phone,
        appointmentDate: apt.appointment_date,
        appointmentTime: apt.appointment_time,
        durationMinutes: apt.duration_minutes,
        reason: apt.reason,
        status: apt.status,
        leadName: apt.lead_name
      }))
    });
  } catch (error) {
    console.error('Get upcoming appointments error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch appointments' } });
  }
});

// GET /api/appointments/:id - Get single appointment
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await query(
      `SELECT
        a.*,
        l.name as lead_name,
        l.phone as lead_phone,
        l.email as lead_email,
        c.id as conversation_id
       FROM appointments a
       LEFT JOIN leads l ON a.lead_id = l.id
       LEFT JOIN conversations c ON a.conversation_id = c.id
       WHERE a.id = $1 AND a.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Appointment not found' } });
    }

    const apt = result.rows[0];

    res.json({
      appointment: {
        id: apt.id,
        patientName: apt.patient_name,
        patientPhone: apt.patient_phone,
        patientEmail: apt.patient_email,
        appointmentDate: apt.appointment_date,
        appointmentTime: apt.appointment_time,
        durationMinutes: apt.duration_minutes,
        reason: apt.reason,
        notes: apt.notes,
        status: apt.status,
        googleEventId: apt.google_event_id,
        reminderSent: apt.reminder_sent,
        confirmedAt: apt.confirmed_at,
        createdAt: apt.created_at,
        lead: apt.lead_id ? {
          id: apt.lead_id,
          name: apt.lead_name,
          phone: apt.lead_phone,
          email: apt.lead_email
        } : null,
        conversationId: apt.conversation_id
      }
    });
  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch appointment' } });
  }
});

// POST /api/appointments - Create a new appointment
router.post('/', async (req, res) => {
  const client = await getClient();

  try {
    const userId = req.user.id;
    const {
      patientName,
      patientPhone,
      patientEmail,
      appointmentDate,
      appointmentTime,
      durationMinutes = 30,
      reason,
      notes,
      leadId,
      conversationId
    } = req.body;

    if (!patientName || !patientPhone || !appointmentDate || !appointmentTime) {
      client.release();
      return res.status(400).json({
        error: { message: 'Patient name, phone, date, and time are required' }
      });
    }

    // Start transaction with SERIALIZABLE isolation to prevent race conditions
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    // Check for conflicting appointment with row lock
    const conflict = await client.query(
      `SELECT id FROM appointments
       WHERE user_id = $1
         AND appointment_date = $2
         AND appointment_time = $3
         AND status != 'cancelled'
       FOR UPDATE`,
      [userId, appointmentDate, appointmentTime]
    );

    if (conflict.rows.length > 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: { message: 'This time slot is already booked' }
      });
    }

    const result = await client.query(
      `INSERT INTO appointments (
        user_id, patient_name, patient_phone, patient_email,
        appointment_date, appointment_time, duration_minutes,
        reason, notes, lead_id, conversation_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        userId, patientName, patientPhone, patientEmail || null,
        appointmentDate, appointmentTime, durationMinutes,
        reason || null, notes || null, leadId || null, conversationId || null
      ]
    );

    // If linked to a lead, update lead status
    if (leadId) {
      await client.query(
        `UPDATE leads
         SET status = 'converted',
             appointment_booked = true,
             appointment_time = $1,
             appointment_id = $2
         WHERE id = $3`,
        [`${appointmentDate} ${appointmentTime}`, result.rows[0].id, leadId]
      );
    }

    // If linked to a conversation, update conversation status
    if (conversationId) {
      await client.query(
        `UPDATE conversations SET status = 'appointment_booked' WHERE id = $1`,
        [conversationId]
      );
    }

    await client.query('COMMIT');

    const apt = result.rows[0];

    res.status(201).json({
      appointment: {
        id: apt.id,
        patientName: apt.patient_name,
        patientPhone: apt.patient_phone,
        appointmentDate: apt.appointment_date,
        appointmentTime: apt.appointment_time,
        status: apt.status,
        createdAt: apt.created_at
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create appointment error:', error);

    // Handle serialization failure (concurrent transaction conflict)
    if (error.code === '40001') {
      return res.status(409).json({
        error: { message: 'This time slot was just booked. Please try another time.' }
      });
    }

    res.status(500).json({ error: { message: 'Failed to create appointment' } });
  } finally {
    client.release();
  }
});

// PUT /api/appointments/:id - Update appointment
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      patientName,
      patientPhone,
      patientEmail,
      appointmentDate,
      appointmentTime,
      durationMinutes,
      reason,
      notes,
      status
    } = req.body;

    const result = await query(
      `UPDATE appointments
       SET patient_name = COALESCE($1, patient_name),
           patient_phone = COALESCE($2, patient_phone),
           patient_email = COALESCE($3, patient_email),
           appointment_date = COALESCE($4, appointment_date),
           appointment_time = COALESCE($5, appointment_time),
           duration_minutes = COALESCE($6, duration_minutes),
           reason = COALESCE($7, reason),
           notes = COALESCE($8, notes),
           status = COALESCE($9, status),
           confirmed_at = CASE WHEN $9 = 'confirmed' THEN CURRENT_TIMESTAMP ELSE confirmed_at END
       WHERE id = $10 AND user_id = $11
       RETURNING *`,
      [
        patientName, patientPhone, patientEmail,
        appointmentDate, appointmentTime, durationMinutes,
        reason, notes, status, id, userId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Appointment not found' } });
    }

    const apt = result.rows[0];

    res.json({
      appointment: {
        id: apt.id,
        patientName: apt.patient_name,
        patientPhone: apt.patient_phone,
        appointmentDate: apt.appointment_date,
        appointmentTime: apt.appointment_time,
        status: apt.status,
        confirmedAt: apt.confirmed_at
      }
    });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ error: { message: 'Failed to update appointment' } });
  }
});

// DELETE /api/appointments/:id - Cancel appointment
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await query(
      `UPDATE appointments
       SET status = 'cancelled'
       WHERE id = $1 AND user_id = $2
       RETURNING id, lead_id`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Appointment not found' } });
    }

    // Update linked lead if exists
    if (result.rows[0].lead_id) {
      await query(
        `UPDATE leads
         SET status = 'new', appointment_booked = false, appointment_id = NULL
         WHERE id = $1`,
        [result.rows[0].lead_id]
      );
    }

    res.json({ message: 'Appointment cancelled successfully' });
  } catch (error) {
    console.error('Cancel appointment error:', error);
    res.status(500).json({ error: { message: 'Failed to cancel appointment' } });
  }
});

// GET /api/appointments/stats/overview - Get appointment statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        COUNT(*) FILTER (WHERE status = 'no_show') as no_show,
        COUNT(*) FILTER (WHERE appointment_date = CURRENT_DATE AND status != 'cancelled') as today,
        COUNT(*) FILTER (WHERE appointment_date >= CURRENT_DATE AND appointment_date <= CURRENT_DATE + INTERVAL '7 days' AND status != 'cancelled') as this_week
       FROM appointments
       WHERE user_id = $1`,
      [userId]
    );

    const stats = result.rows[0];

    res.json({
      stats: {
        total: parseInt(stats.total),
        scheduled: parseInt(stats.scheduled),
        confirmed: parseInt(stats.confirmed),
        completed: parseInt(stats.completed),
        cancelled: parseInt(stats.cancelled),
        noShow: parseInt(stats.no_show),
        today: parseInt(stats.today),
        thisWeek: parseInt(stats.this_week)
      }
    });
  } catch (error) {
    console.error('Get appointment stats error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch statistics' } });
  }
});

module.exports = router;
