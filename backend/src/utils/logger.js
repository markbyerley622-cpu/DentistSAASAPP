/**
 * Structured logging utility using pino
 * Production-ready logging with proper log levels and formatting
 */

const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';

// Create logger instance
const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),

  // Pretty print in development, JSON in production
  transport: isProduction ? undefined : {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  },

  // Base properties included in every log
  base: {
    env: process.env.NODE_ENV || 'development',
    service: 'smiledesk-api'
  },

  // Redact sensitive fields
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'apiKey',
      'apiSecret',
      'authToken',
      'refreshToken',
      'token'
    ],
    censor: '[REDACTED]'
  },

  // Custom serializers
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      ip: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress
    }),
    res: (res) => ({
      statusCode: res.statusCode
    }),
    err: pino.stdSerializers.err
  }
});

// Create child loggers for different modules
const createModuleLogger = (moduleName) => {
  return logger.child({ module: moduleName });
};

// Convenience loggers for common modules
const loggers = {
  sms: createModuleLogger('sms'),
  pbx: createModuleLogger('pbx'),
  auth: createModuleLogger('auth'),
  appointments: createModuleLogger('appointments'),
  vonage: createModuleLogger('vonage'),
  db: createModuleLogger('database'),
  webhook: createModuleLogger('webhook'),
  scheduler: createModuleLogger('scheduler')
};

module.exports = {
  logger,
  createModuleLogger,
  ...loggers
};
