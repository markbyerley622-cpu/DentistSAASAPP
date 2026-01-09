const express = require('express');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Helper: Check if a timestamp falls within business hours
function isDuringBusinessHours(timestamp, businessHours) {
  if (!businessHours || Object.keys(businessHours).length === 0) {
    // No business hours set, assume all calls are during hours
    return true;
  }

  const date = new Date(timestamp);
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[date.getDay()];
  const dayConfig = businessHours[dayName];

  // If day is not enabled (closed), it's after hours
  if (!dayConfig || !dayConfig.enabled) {
    return false;
  }

  // Get call time in HH:MM format
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const callTime = `${hours}:${minutes}`;

  // Compare with business hours
  const openTime = dayConfig.open || '09:00';
  const closeTime = dayConfig.close || '17:00';

  return callTime >= openTime && callTime < closeTime;
}

// GET /api/calls - Get all calls for user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, status, search, startDate, endDate, recentOnly } = req.query;
    const offset = (page - 1) * limit;

    // Auto-flag calls as 'no_response' if they've been pending/in_progress for 45+ minutes
    // This runs on each fetch to keep status current without needing a separate job
    await query(
      `UPDATE calls
       SET followup_status = 'no_response'
       WHERE user_id = $1
         AND followup_status IN ('pending', 'in_progress')
         AND created_at < NOW() - INTERVAL '45 minutes'
         AND id NOT IN (
           SELECT DISTINCT c.id FROM calls c
           JOIN conversations conv ON conv.call_id = c.id
           JOIN messages m ON m.conversation_id = conv.id
           WHERE m.sender = 'patient' AND c.user_id = $1
         )`,
      [userId]
    );

    // Also update leads to 'lost' (No Response) for stale conversations
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

    let whereClause = 'WHERE c.user_id = $1';
    const params = [userId];
    let paramCount = 1;

    // Filter to last 48 hours if recentOnly is true
    // Note: No paramCount++ here since we're not adding a placeholder parameter
    if (recentOnly === 'true' || recentOnly === '48') {
      whereClause += ` AND c.created_at >= NOW() - INTERVAL '48 hours'`;
    }

    if (status) {
      paramCount++;
      whereClause += ` AND c.status = $${paramCount}`;
      params.push(status);
    }

    if (search) {
      paramCount++;
      whereClause += ` AND (c.caller_name ILIKE $${paramCount} OR c.caller_phone ILIKE $${paramCount} OR c.call_reason ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (startDate) {
      paramCount++;
      whereClause += ` AND c.created_at >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      whereClause += ` AND c.created_at <= $${paramCount}`;
      params.push(endDate);
    }

    // Get business hours for the user
    const settingsResult = await query(
      'SELECT business_hours FROM settings WHERE user_id = $1',
      [userId]
    );
    const businessHours = settingsResult.rows[0]?.business_hours || {};

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM calls c ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get calls with lead data (appointment info)
    const result = await query(
      `SELECT c.id, c.twilio_call_sid, c.caller_phone, c.caller_name, c.call_reason, c.duration,
              c.recording_url, c.transcription, c.status, c.sentiment, c.ai_summary, c.created_at,
              c.followup_status, c.is_missed,
              l.appointment_booked, l.appointment_time, l.preferred_time, l.reason as lead_reason,
              l.status as lead_status
       FROM calls c
       LEFT JOIN leads l ON l.call_id = c.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    res.json({
      calls: result.rows.map(call => ({
        id: call.id,
        twilioCallSid: call.twilio_call_sid,
        callerPhone: call.caller_phone,
        callerName: call.caller_name,
        callReason: call.call_reason || call.lead_reason,
        duration: call.duration,
        recordingUrl: call.recording_url,
        transcription: call.transcription,
        status: call.status,
        sentiment: call.sentiment,
        aiSummary: call.ai_summary,
        createdAt: call.created_at,
        followupStatus: call.followup_status,
        isMissed: call.is_missed,
        isDuringBusinessHours: isDuringBusinessHours(call.created_at, businessHours),
        // Lead/appointment data
        appointmentBooked: call.appointment_booked || false,
        appointmentTime: call.appointment_time,
        preferredTime: call.preferred_time,
        leadStatus: call.lead_status
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get calls error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch calls' } });
  }
});

// GET /api/calls/:id - Get single call
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await query(
      `SELECT c.*, l.id as lead_id, l.name as lead_name, l.status as lead_status
       FROM calls c
       LEFT JOIN leads l ON l.call_id = c.id
       WHERE c.id = $1 AND c.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Call not found' } });
    }

    const call = result.rows[0];

    res.json({
      call: {
        id: call.id,
        twilioCallSid: call.twilio_call_sid,
        callerPhone: call.caller_phone,
        callerName: call.caller_name,
        callReason: call.call_reason,
        duration: call.duration,
        recordingUrl: call.recording_url,
        transcription: call.transcription,
        status: call.status,
        sentiment: call.sentiment,
        aiSummary: call.ai_summary,
        createdAt: call.created_at,
        lead: call.lead_id ? {
          id: call.lead_id,
          name: call.lead_name,
          status: call.lead_status
        } : null
      }
    });
  } catch (error) {
    console.error('Get call error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch call' } });
  }
});

// PUT /api/calls/:id - Update call
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { callerName, callReason, status, notes, followupStatus } = req.body;

    const result = await query(
      `UPDATE calls
       SET caller_name = COALESCE($1, caller_name),
           call_reason = COALESCE($2, call_reason),
           status = COALESCE($3, status),
           followup_status = COALESCE($4, followup_status)
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [callerName, callReason, status, followupStatus, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Call not found' } });
    }

    const call = result.rows[0];

    res.json({
      call: {
        id: call.id,
        twilioCallSid: call.twilio_call_sid,
        callerPhone: call.caller_phone,
        callerName: call.caller_name,
        callReason: call.call_reason,
        duration: call.duration,
        recordingUrl: call.recording_url,
        transcription: call.transcription,
        status: call.status,
        sentiment: call.sentiment,
        aiSummary: call.ai_summary,
        createdAt: call.created_at
      }
    });
  } catch (error) {
    console.error('Update call error:', error);
    res.status(500).json({ error: { message: 'Failed to update call' } });
  }
});

// DELETE /api/calls/:id - Delete call
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await query(
      'DELETE FROM calls WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Call not found' } });
    }

    res.json({ message: 'Call deleted successfully' });
  } catch (error) {
    console.error('Delete call error:', error);
    res.status(500).json({ error: { message: 'Failed to delete call' } });
  }
});

module.exports = router;
