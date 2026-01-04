const express = require('express');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// GET /api/conversations - Get all conversations
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, limit = 50, offset = 0 } = req.query;

    let whereClause = 'WHERE c.user_id = $1';
    const params = [userId];

    if (status) {
      params.push(status);
      whereClause += ` AND c.status = $${params.length}`;
    }

    const result = await query(
      `SELECT
        c.id,
        c.caller_phone,
        c.channel,
        c.direction,
        c.status,
        c.started_at,
        c.ended_at,
        c.created_at,
        l.name as lead_name,
        l.id as lead_id,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
       FROM conversations c
       LEFT JOIN leads l ON c.lead_id = l.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM conversations c ${whereClause}`,
      params
    );

    res.json({
      conversations: result.rows.map(conv => ({
        id: conv.id,
        callerPhone: conv.caller_phone,
        channel: conv.channel,
        direction: conv.direction,
        status: conv.status,
        startedAt: conv.started_at,
        endedAt: conv.ended_at,
        createdAt: conv.created_at,
        leadName: conv.lead_name,
        leadId: conv.lead_id,
        messageCount: parseInt(conv.message_count),
        lastMessage: conv.last_message
      })),
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch conversations' } });
  }
});

// GET /api/conversations/:id - Get single conversation with messages
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Get conversation
    const convResult = await query(
      `SELECT
        c.*,
        l.name as lead_name,
        l.phone as lead_phone,
        l.email as lead_email,
        l.status as lead_status
       FROM conversations c
       LEFT JOIN leads l ON c.lead_id = l.id
       WHERE c.id = $1 AND c.user_id = $2`,
      [id, userId]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Conversation not found' } });
    }

    // Get messages
    const messagesResult = await query(
      `SELECT id, sender, content, message_type, delivered, read_at, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    const conv = convResult.rows[0];

    res.json({
      conversation: {
        id: conv.id,
        callerPhone: conv.caller_phone,
        channel: conv.channel,
        direction: conv.direction,
        status: conv.status,
        startedAt: conv.started_at,
        endedAt: conv.ended_at,
        createdAt: conv.created_at,
        lead: conv.lead_id ? {
          id: conv.lead_id,
          name: conv.lead_name,
          phone: conv.lead_phone,
          email: conv.lead_email,
          status: conv.lead_status
        } : null
      },
      messages: messagesResult.rows.map(msg => ({
        id: msg.id,
        sender: msg.sender,
        content: msg.content,
        messageType: msg.message_type,
        delivered: msg.delivered,
        readAt: msg.read_at,
        createdAt: msg.created_at
      }))
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch conversation' } });
  }
});

// POST /api/conversations - Create a new conversation (usually from Twilio webhook)
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { callerPhone, channel = 'sms', direction = 'outbound', callId, leadId } = req.body;

    if (!callerPhone) {
      return res.status(400).json({ error: { message: 'Caller phone is required' } });
    }

    const result = await query(
      `INSERT INTO conversations (user_id, caller_phone, channel, direction, call_id, lead_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, callerPhone, channel, direction, callId || null, leadId || null]
    );

    const conv = result.rows[0];

    res.status(201).json({
      conversation: {
        id: conv.id,
        callerPhone: conv.caller_phone,
        channel: conv.channel,
        direction: conv.direction,
        status: conv.status,
        startedAt: conv.started_at,
        createdAt: conv.created_at
      }
    });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ error: { message: 'Failed to create conversation' } });
  }
});

// PUT /api/conversations/:id - Update conversation status
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { status, leadId } = req.body;

    const updates = [];
    const params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      updates.push(`status = $${paramCount}`);
      params.push(status);

      if (['completed', 'appointment_booked', 'no_response'].includes(status)) {
        updates.push('ended_at = CURRENT_TIMESTAMP');
      }
    }

    if (leadId !== undefined) {
      paramCount++;
      updates.push(`lead_id = $${paramCount}`);
      params.push(leadId);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: { message: 'No updates provided' } });
    }

    params.push(id, userId);

    const result = await query(
      `UPDATE conversations
       SET ${updates.join(', ')}
       WHERE id = $${paramCount + 1} AND user_id = $${paramCount + 2}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Conversation not found' } });
    }

    const conv = result.rows[0];

    res.json({
      conversation: {
        id: conv.id,
        callerPhone: conv.caller_phone,
        channel: conv.channel,
        status: conv.status,
        endedAt: conv.ended_at
      }
    });
  } catch (error) {
    console.error('Update conversation error:', error);
    res.status(500).json({ error: { message: 'Failed to update conversation' } });
  }
});

// POST /api/conversations/:id/messages - Add a message to conversation
router.post('/:id/messages', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { sender, content, messageType = 'text', twilioSid } = req.body;

    if (!sender || !content) {
      return res.status(400).json({
        error: { message: 'Sender and content are required' }
      });
    }

    // Verify conversation belongs to user
    const convCheck = await query(
      'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Conversation not found' } });
    }

    const result = await query(
      `INSERT INTO messages (conversation_id, sender, content, message_type, twilio_sid)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, sender, content, messageType, twilioSid || null]
    );

    const msg = result.rows[0];

    res.status(201).json({
      message: {
        id: msg.id,
        sender: msg.sender,
        content: msg.content,
        messageType: msg.message_type,
        delivered: msg.delivered,
        createdAt: msg.created_at
      }
    });
  } catch (error) {
    console.error('Add message error:', error);
    res.status(500).json({ error: { message: 'Failed to add message' } });
  }
});

// GET /api/conversations/stats/overview - Get conversation statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'appointment_booked') as booked,
        COUNT(*) FILTER (WHERE status = 'no_response') as no_response,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as today
       FROM conversations
       WHERE user_id = $1`,
      [userId]
    );

    const stats = result.rows[0];

    res.json({
      stats: {
        total: parseInt(stats.total),
        active: parseInt(stats.active),
        completed: parseInt(stats.completed),
        booked: parseInt(stats.booked),
        noResponse: parseInt(stats.no_response),
        today: parseInt(stats.today)
      }
    });
  } catch (error) {
    console.error('Get conversation stats error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch statistics' } });
  }
});

module.exports = router;
