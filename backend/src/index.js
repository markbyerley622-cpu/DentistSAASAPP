require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

// Import utilities
const { logger } = require('./utils/logger');
const { initSentry, requestHandler, tracingHandler, errorHandler, flush } = require('./utils/sentry');
const { startScheduler, stopScheduler, getSchedulerStatus } = require('./jobs/scheduler');
const { captureRawBody } = require('./middleware/vonageWebhook');

// Import routes
const authRoutes = require('./routes/auth');
const callsRoutes = require('./routes/calls');
const leadsRoutes = require('./routes/leads');
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

// Initialize Sentry (must be first)
initSentry(app);

// Trust proxy for Render/Vercel (required for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Sentry request handler (must be first middleware)
app.use(requestHandler());
app.use(tracingHandler());

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:5173',
  'http://localhost:3000'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn({ origin }, 'CORS blocked request from unknown origin');
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Request logging (using pino instead of morgan for structured logs)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      ip: req.ip
    }, `${req.method} ${req.path}`);
  });
  next();
});

// Body parsing with raw body capture for webhook signature validation
app.use(express.json({
  verify: captureRawBody,
  limit: '1mb'
}));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    scheduler: getSchedulerStatus()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/calls', callsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/booking-slots', bookingSlotsRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/pbx', pbxRoutes);     // PBX missed call webhooks
app.use('/api/sms', smsRoutes);     // Vonage SMS webhooks (instant two-way)

// Sentry error handler (must be before other error handlers)
app.use(errorHandler());

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error({
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  }, 'Unhandled error');

  res.status(err.status || 500).json({
    error: {
      message: process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
});

// 404 handler
app.use((req, res) => {
  logger.warn({ path: req.path, method: req.method }, 'Route not found');
  res.status(404).json({ error: { message: 'Not found' } });
});

// Start server
const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, 'SmileDesk API started');

  // Start scheduled jobs
  startScheduler();
});

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info({ signal }, 'Shutdown signal received');

  // Stop accepting new requests
  server.close(async () => {
    logger.info('HTTP server closed');

    // Stop scheduled jobs
    stopScheduler();

    // Flush Sentry events
    await flush(2000);

    logger.info('Graceful shutdown complete');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
