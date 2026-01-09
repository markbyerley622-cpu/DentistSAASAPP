const express = require('express');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// GET /api/leads - Get all leads for user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, status, search, priority } = req.query;
    const offset = (page - 1) * limit;

    // Auto-flag leads as 'lost' (No Response) if they've been 'new' for 45+ minutes with no reply
    await query(
      `UPDATE leads
       SET status = 'lost'
       WHERE user_id = $1
         AND status = 'new'
         AND created_at < NOW() - INTERVAL '45 minutes'
         AND conversation_id NOT IN (
           SELECT DISTINCT conv.id FROM conversations conv
           JOIN messages m ON m.conversation_id = conv.id
           WHERE m.sender = 'patient' AND conv.user_id = $1
         )`,
      [userId]
    );

    let whereClause = 'WHERE l.user_id = $1';
    const params = [userId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      whereClause += ` AND l.status = $${paramCount}`;
      params.push(status);
    }

    if (priority) {
      paramCount++;
      whereClause += ` AND l.priority = $${paramCount}`;
      params.push(priority);
    }

    if (search) {
      paramCount++;
      whereClause += ` AND (l.name ILIKE $${paramCount} OR l.phone ILIKE $${paramCount} OR l.email ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM leads l ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get leads
    const result = await query(
      `SELECT l.*, c.caller_phone, c.call_reason as original_call_reason
       FROM leads l
       LEFT JOIN calls c ON l.call_id = c.id
       ${whereClause}
       ORDER BY
         CASE l.priority
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           WHEN 'low' THEN 3
         END,
         l.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    res.json({
      leads: result.rows.map(lead => ({
        id: lead.id,
        callId: lead.call_id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        reason: lead.reason,
        preferredTime: lead.preferred_time,
        appointmentBooked: lead.appointment_booked,
        appointmentTime: lead.appointment_time,
        notes: lead.notes,
        status: lead.status,
        priority: lead.priority,
        createdAt: lead.created_at,
        updatedAt: lead.updated_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch leads' } });
  }
});

// GET /api/leads/stats - Get lead statistics by status
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT
        status,
        COUNT(*) as count
       FROM leads
       WHERE user_id = $1
       GROUP BY status`,
      [userId]
    );

    const stats = {
      new: 0,
      contacted: 0,
      qualified: 0,
      converted: 0,
      lost: 0
    };

    result.rows.forEach(row => {
      stats[row.status] = parseInt(row.count);
    });

    const total = Object.values(stats).reduce((a, b) => a + b, 0);

    res.json({
      stats,
      total,
      conversionRate: total > 0 ? ((stats.converted / total) * 100).toFixed(1) : 0
    });
  } catch (error) {
    console.error('Get lead stats error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch lead stats' } });
  }
});

// GET /api/leads/:id - Get single lead
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await query(
      `SELECT l.*, c.transcription, c.recording_url, c.ai_summary
       FROM leads l
       LEFT JOIN calls c ON l.call_id = c.id
       WHERE l.id = $1 AND l.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Lead not found' } });
    }

    const lead = result.rows[0];

    res.json({
      lead: {
        id: lead.id,
        callId: lead.call_id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        reason: lead.reason,
        preferredTime: lead.preferred_time,
        appointmentBooked: lead.appointment_booked,
        appointmentTime: lead.appointment_time,
        notes: lead.notes,
        status: lead.status,
        priority: lead.priority,
        createdAt: lead.created_at,
        updatedAt: lead.updated_at,
        call: lead.call_id ? {
          transcription: lead.transcription,
          recordingUrl: lead.recording_url,
          aiSummary: lead.ai_summary
        } : null
      }
    });
  } catch (error) {
    console.error('Get lead error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch lead' } });
  }
});

// POST /api/leads - Create new lead
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, phone, email, reason, preferredTime, notes, priority, callId } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        error: { message: 'Name and phone are required' }
      });
    }

    const result = await query(
      `INSERT INTO leads (user_id, call_id, name, phone, email, reason, preferred_time, notes, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, callId || null, name, phone, email || null, reason || null, preferredTime || null, notes || null, priority || 'medium']
    );

    const lead = result.rows[0];

    res.status(201).json({
      lead: {
        id: lead.id,
        callId: lead.call_id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        reason: lead.reason,
        preferredTime: lead.preferred_time,
        appointmentBooked: lead.appointment_booked,
        appointmentTime: lead.appointment_time,
        notes: lead.notes,
        status: lead.status,
        priority: lead.priority,
        createdAt: lead.created_at
      }
    });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ error: { message: 'Failed to create lead' } });
  }
});

// PUT /api/leads/:id - Update lead
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { name, phone, email, reason, preferredTime, appointmentBooked, appointmentTime, notes, status, priority } = req.body;

    const result = await query(
      `UPDATE leads
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           email = COALESCE($3, email),
           reason = COALESCE($4, reason),
           preferred_time = COALESCE($5, preferred_time),
           appointment_booked = COALESCE($6, appointment_booked),
           appointment_time = $7,
           notes = COALESCE($8, notes),
           status = COALESCE($9, status),
           priority = COALESCE($10, priority)
       WHERE id = $11 AND user_id = $12
       RETURNING *`,
      [name, phone, email, reason, preferredTime, appointmentBooked, appointmentTime || null, notes, status, priority, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Lead not found' } });
    }

    const lead = result.rows[0];

    res.json({
      lead: {
        id: lead.id,
        callId: lead.call_id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        reason: lead.reason,
        preferredTime: lead.preferred_time,
        appointmentBooked: lead.appointment_booked,
        appointmentTime: lead.appointment_time,
        notes: lead.notes,
        status: lead.status,
        priority: lead.priority,
        createdAt: lead.created_at,
        updatedAt: lead.updated_at
      }
    });
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({ error: { message: 'Failed to update lead' } });
  }
});

// DELETE /api/leads/:id - Delete lead
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await query(
      'DELETE FROM leads WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Lead not found' } });
    }

    res.json({ message: 'Lead deleted successfully' });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ error: { message: 'Failed to delete lead' } });
  }
});

module.exports = router;
