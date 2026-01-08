require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Import routes
const authRoutes = require('./routes/auth');
const callsRoutes = require('./routes/calls');
const leadsRoutes = require('./routes/leads');
const twilioRoutes = require('./routes/twilio');
const analyticsRoutes = require('./routes/analytics');
const settingsRoutes = require('./routes/settings');
const bookingSlotsRoutes = require('./routes/bookingSlots');
const conversationsRoutes = require('./routes/conversations');
const appointmentsRoutes = require('./routes/appointments');
const adminRoutes = require('./routes/admin');
const pbxRoutes = require('./routes/pbx');
const smsRoutes = require('./routes/sms');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for Render/Vercel (required for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/calls', callsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/twilio', twilioRoutes); // Legacy - will be removed
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/booking-slots', bookingSlotsRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/pbx', pbxRoutes);     // PBX missed call webhooks
app.use('/api/sms', smsRoutes);     // CellCast SMS webhooks

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: { message: 'Not found' } });
});

app.listen(PORT, () => {
  console.log(`😁 SmileDesk API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
