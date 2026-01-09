const express = require('express');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Helper: Check if a timestamp falls within business hours
function isDuringBusinessHours(timestamp, businessHours) {
  if (!businessHours || Object.keys(businessHours).length === 0) {
    return true;
  }

  const date = new Date(timestamp);
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[date.getDay()];
  const dayConfig = businessHours[dayName];

  if (!dayConfig || !dayConfig.enabled) {
    return false;
  }

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const callTime = `${hours}:${minutes}`;

  const openTime = dayConfig.open || '09:00';
  const closeTime = dayConfig.close || '17:00';

  return callTime >= openTime && callTime < closeTime;
}

// GET /api/calls - Get all calls for user (legacy + new fields)
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, status, search, startDate, endDate, recentOnly } = req.query;
    const offset = (page - 1) * limit;

    // Auto-flag calls as 'no_response' if they've been pending for 45+ minutes
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

    // Also update leads to 'lost' for stale conversations
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

    // Get calls with lead data and new fields
    const result = await query(
      `SELECT c.id, c.twilio_call_sid, c.caller_phone, c.caller_name, c.call_reason, c.duration,
              c.recording_url, c.transcription, c.status, c.sentiment, c.ai_summary, c.created_at,
              c.followup_status, c.is_missed, c.callback_type, c.handled_by_ai,
              c.receptionist_status, c.marked_done_at,
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
        // New fields
        callbackType: call.callback_type,
        handledByAi: call.handled_by_ai || false,
        receptionistStatus: call.receptionist_status || 'pending',
        markedDoneAt: call.marked_done_at,
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

// GET /api/calls/active - Get active missed calls (receptionist_status = pending)
router.get('/active', async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, limit = 100 } = req.query;

    // Get business hours
    const settingsResult = await query(
      'SELECT business_hours FROM settings WHERE user_id = $1',
      [userId]
    );
    const businessHours = settingsResult.rows[0]?.business_hours || {};

    let whereClause = `WHERE c.user_id = $1
      AND c.is_missed = true
      AND (c.receptionist_status = 'pending' OR c.receptionist_status IS NULL)
      AND c.created_at >= NOW() - INTERVAL '48 hours'`;
    const params = [userId];

    if (search) {
      whereClause += ` AND (c.caller_name ILIKE $2 OR c.caller_phone ILIKE $2)`;
      params.push(`%${search}%`);
    }

    const result = await query(
      `SELECT c.id, c.caller_phone, c.caller_name, c.created_at, c.callback_type,
              c.handled_by_ai, c.receptionist_status, c.followup_status,
              l.status as lead_status
       FROM calls c
       LEFT JOIN leads l ON l.call_id = c.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${params.length + 1}`,
      [...params, limit]
    );

    // Compute AI status for each call
    const calls = result.rows.map(call => {
      // Determine AI status
      let aiStatus = 'sending'; // Default: SMS being sent
      if (call.handled_by_ai && call.callback_type) {
        aiStatus = 'replied'; // Patient replied with 1 or 2
      } else if (call.followup_status === 'no_response') {
        aiStatus = 'no_response'; // 45+ min, no reply
      } else if (call.followup_status === 'in_progress') {
        aiStatus = 'waiting'; // SMS sent, waiting for reply
      }

      return {
        id: call.id,
        callerPhone: call.caller_phone,
        callerName: call.caller_name,
        createdAt: call.created_at,
        callbackType: call.callback_type,
        aiStatus,
        isDuringBusinessHours: isDuringBusinessHours(call.created_at, businessHours)
      };
    });

    res.json({ calls, total: calls.length });
  } catch (error) {
    console.error('Get active calls error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch active calls' } });
  }
});

// GET /api/calls/history - Get completed missed calls (receptionist_status = done)
router.get('/history', async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, page = 1, limit = 50, days = 7 } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = `WHERE c.user_id = $1
      AND c.is_missed = true
      AND c.receptionist_status = 'done'
      AND c.marked_done_at >= NOW() - INTERVAL '1 day' * $2`;
    const params = [userId, days];

    if (search) {
      whereClause += ` AND (c.caller_name ILIKE $3 OR c.caller_phone ILIKE $3)`;
      params.push(`%${search}%`);
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM calls c ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT c.id, c.caller_phone, c.caller_name, c.created_at, c.callback_type,
              c.handled_by_ai, c.marked_done_at,
              l.appointment_booked, l.appointment_time
       FROM calls c
       LEFT JOIN leads l ON l.call_id = c.id
       ${whereClause}
       ORDER BY c.marked_done_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({
      calls: result.rows.map(call => ({
        id: call.id,
        callerPhone: call.caller_phone,
        callerName: call.caller_name,
        createdAt: call.created_at,
        callbackType: call.callback_type,
        handledByAi: call.handled_by_ai,
        markedDoneAt: call.marked_done_at,
        appointmentBooked: call.appointment_booked,
        appointmentTime: call.appointment_time
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch history' } });
  }
});

// GET /api/calls/:id - Get single call
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await query(
      `SELECT c.*, l.id as lead_id, l.name as lead_name, l.status as lead_status,
              l.callback_type as lead_callback_type
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
        callbackType: call.callback_type,
        handledByAi: call.handled_by_ai,
        receptionistStatus: call.receptionist_status,
        markedDoneAt: call.marked_done_at,
        lead: call.lead_id ? {
          id: call.lead_id,
          name: call.lead_name,
          status: call.lead_status,
          callbackType: call.lead_callback_type
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
    const { callerName, callReason, status, notes, followupStatus, receptionistStatus } = req.body;

    // If marking as done, set the timestamp and user
    const isDone = receptionistStatus === 'done' || followupStatus === 'completed';

    const result = await query(
      `UPDATE calls
       SET caller_name = COALESCE($1, caller_name),
           call_reason = COALESCE($2, call_reason),
           status = COALESCE($3, status),
           followup_status = COALESCE($4, followup_status),
           receptionist_status = COALESCE($5, receptionist_status),
           marked_done_at = CASE WHEN $6 THEN NOW() ELSE marked_done_at END,
           marked_done_by = CASE WHEN $6 THEN $7 ELSE marked_done_by END
       WHERE id = $8 AND user_id = $7
       RETURNING *`,
      [callerName, callReason, status, followupStatus, receptionistStatus, isDone, userId, id]
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
        callbackType: call.callback_type,
        handledByAi: call.handled_by_ai,
        receptionistStatus: call.receptionist_status,
        markedDoneAt: call.marked_done_at
      }
    });
  } catch (error) {
    console.error('Update call error:', error);
    res.status(500).json({ error: { message: 'Failed to update call' } });
  }
});

// POST /api/calls/:id/done - Mark call as done (optimized endpoint)
router.post('/:id/done', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await query(
      `UPDATE calls
       SET receptionist_status = 'done',
           followup_status = 'completed',
           marked_done_at = NOW(),
           marked_done_by = $1
       WHERE id = $2 AND user_id = $1
       RETURNING id, receptionist_status, marked_done_at`,
      [userId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Call not found' } });
    }

    res.json({
      success: true,
      call: result.rows[0]
    });
  } catch (error) {
    console.error('Mark done error:', error);
    res.status(500).json({ error: { message: 'Failed to mark call as done' } });
  }
});

// POST /api/calls/:id/undo - Undo marking call as done (move back to active)
router.post('/:id/undo', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await query(
      `UPDATE calls
       SET receptionist_status = 'pending',
           followup_status = CASE
             WHEN callback_type IS NOT NULL THEN 'in_progress'
             ELSE 'pending'
           END,
           marked_done_at = NULL,
           marked_done_by = NULL
       WHERE id = $1 AND user_id = $2
       RETURNING id, receptionist_status`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Call not found' } });
    }

    res.json({
      success: true,
      call: result.rows[0]
    });
  } catch (error) {
    console.error('Undo done error:', error);
    res.status(500).json({ error: { message: 'Failed to undo' } });
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
