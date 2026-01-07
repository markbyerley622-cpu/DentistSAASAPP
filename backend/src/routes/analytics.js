const express = require('express');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// GET /api/analytics/overview - Get dashboard overview stats
router.get('/overview', async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = '30d' } = req.query;

    // Calculate date range
    let daysAgo;
    switch (period) {
      case '7d': daysAgo = 7; break;
      case '30d': daysAgo = 30; break;
      case '90d': daysAgo = 90; break;
      default: daysAgo = 30;
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    // Get total calls in period
    const callsResult = await query(
      `SELECT COUNT(*) as total,
              COUNT(CASE WHEN created_at >= NOW() - INTERVAL '1 day' THEN 1 END) as today
       FROM calls
       WHERE user_id = $1 AND created_at >= $2`,
      [userId, startDate.toISOString()]
    );

    // Get previous period for comparison
    const prevStartDate = new Date(startDate);
    prevStartDate.setDate(prevStartDate.getDate() - daysAgo);

    const prevCallsResult = await query(
      `SELECT COUNT(*) as total
       FROM calls
       WHERE user_id = $1 AND created_at >= $2 AND created_at < $3`,
      [userId, prevStartDate.toISOString(), startDate.toISOString()]
    );

    // Get lead stats
    const leadsResult = await query(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN status = 'new' THEN 1 END) as new,
         COUNT(CASE WHEN status = 'converted' THEN 1 END) as converted
       FROM leads
       WHERE user_id = $1 AND created_at >= $2`,
      [userId, startDate.toISOString()]
    );

    const prevLeadsResult = await query(
      `SELECT COUNT(*) as total
       FROM leads
       WHERE user_id = $1 AND created_at >= $2 AND created_at < $3`,
      [userId, prevStartDate.toISOString(), startDate.toISOString()]
    );

    // Calculate metrics
    const totalCalls = parseInt(callsResult.rows[0].total);
    const prevTotalCalls = parseInt(prevCallsResult.rows[0].total);
    const callsToday = parseInt(callsResult.rows[0].today);

    const totalLeads = parseInt(leadsResult.rows[0].total);
    const prevTotalLeads = parseInt(prevLeadsResult.rows[0].total);
    const newLeads = parseInt(leadsResult.rows[0].new);
    const convertedLeads = parseInt(leadsResult.rows[0].converted);

    const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

    // Calculate trends
    const callsTrend = prevTotalCalls > 0
      ? ((totalCalls - prevTotalCalls) / prevTotalCalls) * 100
      : (totalCalls > 0 ? 100 : 0);

    const leadsTrend = prevTotalLeads > 0
      ? ((totalLeads - prevTotalLeads) / prevTotalLeads) * 100
      : (totalLeads > 0 ? 100 : 0);

    // Get average call duration
    const durationResult = await query(
      `SELECT AVG(duration) as avg_duration
       FROM calls
       WHERE user_id = $1 AND created_at >= $2 AND duration > 0`,
      [userId, startDate.toISOString()]
    );

    const avgDuration = Math.round(parseFloat(durationResult.rows[0].avg_duration) || 0);

    res.json({
      stats: {
        totalCalls: {
          value: totalCalls,
          trend: Math.round(callsTrend * 10) / 10,
          trendDirection: callsTrend >= 0 ? 'up' : 'down'
        },
        callsToday: {
          value: callsToday
        },
        newLeads: {
          value: newLeads,
          trend: Math.round(leadsTrend * 10) / 10,
          trendDirection: leadsTrend >= 0 ? 'up' : 'down'
        },
        conversionRate: {
          value: Math.round(conversionRate * 10) / 10,
          suffix: '%'
        },
        avgCallDuration: {
          value: avgDuration,
          suffix: 's'
        },
        totalLeads: {
          value: totalLeads
        }
      },
      period
    });
  } catch (error) {
    console.error('Get overview error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch analytics' } });
  }
});

// GET /api/analytics/calls-by-day - Get calls grouped by day
router.get('/calls-by-day', async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 14 } = req.query;

    const daysInt = Math.min(Math.max(parseInt(days) || 14, 1), 365); // Sanitize: 1-365 days
    const result = await query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM calls
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [userId, daysInt]
    );

    // Fill in missing days with 0
    const data = [];
    const today = new Date();
    for (let i = daysInt - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const found = result.rows.find(row => row.date.toISOString().split('T')[0] === dateStr);
      data.push({
        date: dateStr,
        count: found ? parseInt(found.count) : 0
      });
    }

    res.json({ data });
  } catch (error) {
    console.error('Get calls by day error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch calls data' } });
  }
});

// GET /api/analytics/leads-by-status - Get leads grouped by status
router.get('/leads-by-status', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT status, COUNT(*) as count
       FROM leads
       WHERE user_id = $1
       GROUP BY status`,
      [userId]
    );

    const data = {
      new: 0,
      contacted: 0,
      qualified: 0,
      converted: 0,
      lost: 0
    };

    result.rows.forEach(row => {
      data[row.status] = parseInt(row.count);
    });

    res.json({ data });
  } catch (error) {
    console.error('Get leads by status error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch leads data' } });
  }
});

// GET /api/analytics/call-reasons - Get calls grouped by reason
router.get('/call-reasons', async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const daysInt = Math.min(Math.max(parseInt(days) || 30, 1), 365); // Sanitize: 1-365 days
    const result = await query(
      `SELECT call_reason, COUNT(*) as count
       FROM calls
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '1 day' * $2
         AND call_reason IS NOT NULL
       GROUP BY call_reason
       ORDER BY count DESC
       LIMIT 10`,
      [userId, daysInt]
    );

    res.json({
      data: result.rows.map(row => ({
        reason: row.call_reason,
        count: parseInt(row.count)
      }))
    });
  } catch (error) {
    console.error('Get call reasons error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch call reasons' } });
  }
});

// GET /api/analytics/peak-hours - Get peak call hours
router.get('/peak-hours', async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const daysInt = Math.min(Math.max(parseInt(days) || 30, 1), 365); // Sanitize: 1-365 days
    const result = await query(
      `SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count
       FROM calls
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY EXTRACT(HOUR FROM created_at)
       ORDER BY hour`,
      [userId, daysInt]
    );

    // Fill in all 24 hours
    const data = [];
    for (let i = 0; i < 24; i++) {
      const found = result.rows.find(row => parseInt(row.hour) === i);
      data.push({
        hour: i,
        label: `${i.toString().padStart(2, '0')}:00`,
        count: found ? parseInt(found.count) : 0
      });
    }

    res.json({ data });
  } catch (error) {
    console.error('Get peak hours error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch peak hours' } });
  }
});

module.exports = router;
