const express = require('express');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// GET /api/calls - Get all calls for user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, status, search, startDate, endDate } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE user_id = $1';
    const params = [userId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      whereClause += ` AND status = $${paramCount}`;
      params.push(status);
    }

    if (search) {
      paramCount++;
      whereClause += ` AND (caller_name ILIKE $${paramCount} OR caller_phone ILIKE $${paramCount} OR call_reason ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (startDate) {
      paramCount++;
      whereClause += ` AND created_at >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      whereClause += ` AND created_at <= $${paramCount}`;
      params.push(endDate);
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM calls ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get calls
    const result = await query(
      `SELECT id, twilio_call_sid, caller_phone, caller_name, call_reason, duration,
              recording_url, transcription, status, sentiment, ai_summary, created_at,
              followup_status, is_missed
       FROM calls
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    res.json({
      calls: result.rows.map(call => ({
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
        followupStatus: call.followup_status,
        isMissed: call.is_missed
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
    const { callerName, callReason, status, notes } = req.body;

    const result = await query(
      `UPDATE calls
       SET caller_name = COALESCE($1, caller_name),
           call_reason = COALESCE($2, call_reason),
           status = COALESCE($3, status)
       WHERE id = $4 AND user_id = $5
       RETURNING *`,
      [callerName, callReason, status, id, userId]
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
