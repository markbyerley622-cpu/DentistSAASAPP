const express = require('express');
const { query } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// GET /api/booking-slots - Get all booking slots for user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT id, day_of_week, time_slot, duration_minutes, is_active, created_at
       FROM booking_slots
       WHERE user_id = $1
       ORDER BY
         CASE day_of_week
           WHEN 'monday' THEN 1
           WHEN 'tuesday' THEN 2
           WHEN 'wednesday' THEN 3
           WHEN 'thursday' THEN 4
           WHEN 'friday' THEN 5
           WHEN 'saturday' THEN 6
           WHEN 'sunday' THEN 7
         END,
         time_slot`,
      [userId]
    );

    res.json({
      slots: result.rows.map(slot => ({
        id: slot.id,
        dayOfWeek: slot.day_of_week,
        timeSlot: slot.time_slot,
        durationMinutes: slot.duration_minutes,
        isActive: slot.is_active,
        createdAt: slot.created_at
      }))
    });
  } catch (error) {
    console.error('Get booking slots error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch booking slots' } });
  }
});

// POST /api/booking-slots - Create a new booking slot
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { dayOfWeek, timeSlot, durationMinutes = 30 } = req.body;

    if (!dayOfWeek || !timeSlot) {
      return res.status(400).json({
        error: { message: 'Day of week and time slot are required' }
      });
    }

    // Validate day of week
    const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    if (!validDays.includes(dayOfWeek.toLowerCase())) {
      return res.status(400).json({
        error: { message: 'Invalid day of week' }
      });
    }

    // Check for duplicate
    const existing = await query(
      `SELECT id FROM booking_slots
       WHERE user_id = $1 AND day_of_week = $2 AND time_slot = $3`,
      [userId, dayOfWeek.toLowerCase(), timeSlot]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: { message: 'This time slot already exists' }
      });
    }

    const result = await query(
      `INSERT INTO booking_slots (user_id, day_of_week, time_slot, duration_minutes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, day_of_week, time_slot, duration_minutes, is_active, created_at`,
      [userId, dayOfWeek.toLowerCase(), timeSlot, durationMinutes]
    );

    const slot = result.rows[0];

    res.status(201).json({
      slot: {
        id: slot.id,
        dayOfWeek: slot.day_of_week,
        timeSlot: slot.time_slot,
        durationMinutes: slot.duration_minutes,
        isActive: slot.is_active,
        createdAt: slot.created_at
      }
    });
  } catch (error) {
    console.error('Create booking slot error:', error);
    res.status(500).json({ error: { message: 'Failed to create booking slot' } });
  }
});

// PUT /api/booking-slots/:id - Update a booking slot
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { dayOfWeek, timeSlot, durationMinutes, isActive } = req.body;

    const result = await query(
      `UPDATE booking_slots
       SET day_of_week = COALESCE($1, day_of_week),
           time_slot = COALESCE($2, time_slot),
           duration_minutes = COALESCE($3, duration_minutes),
           is_active = COALESCE($4, is_active)
       WHERE id = $5 AND user_id = $6
       RETURNING id, day_of_week, time_slot, duration_minutes, is_active, created_at`,
      [dayOfWeek?.toLowerCase(), timeSlot, durationMinutes, isActive, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Booking slot not found' } });
    }

    const slot = result.rows[0];

    res.json({
      slot: {
        id: slot.id,
        dayOfWeek: slot.day_of_week,
        timeSlot: slot.time_slot,
        durationMinutes: slot.duration_minutes,
        isActive: slot.is_active,
        createdAt: slot.created_at
      }
    });
  } catch (error) {
    console.error('Update booking slot error:', error);
    res.status(500).json({ error: { message: 'Failed to update booking slot' } });
  }
});

// DELETE /api/booking-slots/:id - Delete a booking slot
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await query(
      'DELETE FROM booking_slots WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Booking slot not found' } });
    }

    res.json({ message: 'Booking slot deleted successfully' });
  } catch (error) {
    console.error('Delete booking slot error:', error);
    res.status(500).json({ error: { message: 'Failed to delete booking slot' } });
  }
});

// GET /api/booking-slots/available - Get available slots for a specific date
router.get('/available', async (req, res) => {
  try {
    const userId = req.user.id;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: { message: 'Date is required' } });
    }

    const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

    // Get slots for the day
    const slotsResult = await query(
      `SELECT id, time_slot, duration_minutes
       FROM booking_slots
       WHERE user_id = $1 AND day_of_week = $2 AND is_active = true
       ORDER BY time_slot`,
      [userId, dayOfWeek]
    );

    // Get booked appointments for the date
    const appointmentsResult = await query(
      `SELECT appointment_time
       FROM appointments
       WHERE user_id = $1 AND appointment_date = $2 AND status != 'cancelled'`,
      [userId, date]
    );

    const bookedTimes = appointmentsResult.rows.map(a => a.appointment_time);

    const availableSlots = slotsResult.rows
      .filter(slot => !bookedTimes.includes(slot.time_slot))
      .map(slot => ({
        id: slot.id,
        timeSlot: slot.time_slot,
        durationMinutes: slot.duration_minutes,
        available: true
      }));

    res.json({
      date,
      dayOfWeek,
      slots: availableSlots
    });
  } catch (error) {
    console.error('Get available slots error:', error);
    res.status(500).json({ error: { message: 'Failed to fetch available slots' } });
  }
});

module.exports = router;
