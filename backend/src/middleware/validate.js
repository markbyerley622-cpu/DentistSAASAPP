const Joi = require('joi');

/**
 * Validation middleware factory
 * Validates request body, query, or params against a Joi schema
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false, // Return all errors, not just the first
      stripUnknown: true // Remove unknown keys
    });

    if (error) {
      const errors = error.details.map(detail => detail.message);
      return res.status(400).json({
        error: {
          message: 'Validation failed',
          details: errors
        }
      });
    }

    // Replace with validated/sanitized values
    req[property] = value;
    next();
  };
};

// ==========================================
// Common validation patterns
// ==========================================

// Phone number pattern (E.164 format or Australian format)
const phonePattern = /^(\+?[1-9]\d{1,14}|0[2-9]\d{8})$/;

// Email pattern
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ==========================================
// Auth schemas
// ==========================================

const registerSchema = Joi.object({
  email: Joi.string()
    .pattern(emailPattern)
    .max(255)
    .required()
    .messages({
      'string.pattern.base': 'Please provide a valid email address',
      'string.max': 'Email must be less than 255 characters'
    }),
  password: Joi.string()
    .min(8)
    .max(128)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters',
      'string.max': 'Password must be less than 128 characters'
    }),
  practiceName: Joi.string()
    .min(2)
    .max(100)
    .required()
    .messages({
      'string.min': 'Practice name must be at least 2 characters',
      'string.max': 'Practice name must be less than 100 characters'
    }),
  phone: Joi.string()
    .pattern(phonePattern)
    .allow('', null)
    .optional()
    .messages({
      'string.pattern.base': 'Please provide a valid phone number'
    }),
  timezone: Joi.string()
    .max(50)
    .optional()
    .default('Australia/Sydney')
});

const loginSchema = Joi.object({
  email: Joi.string()
    .pattern(emailPattern)
    .max(255)
    .required()
    .messages({
      'string.pattern.base': 'Please provide a valid email address'
    }),
  password: Joi.string()
    .max(128)
    .required()
});

const forgotPasswordSchema = Joi.object({
  phone: Joi.string()
    .pattern(phonePattern)
    .required()
    .messages({
      'string.pattern.base': 'Please provide a valid phone number'
    })
});

const verifyOtpSchema = Joi.object({
  phone: Joi.string()
    .pattern(phonePattern)
    .required(),
  code: Joi.string()
    .length(6)
    .pattern(/^\d{6}$/)
    .required()
    .messages({
      'string.length': 'Verification code must be 6 digits',
      'string.pattern.base': 'Verification code must be 6 digits'
    })
});

const resetPasswordSchema = Joi.object({
  phone: Joi.string()
    .pattern(phonePattern)
    .required(),
  resetToken: Joi.string()
    .uuid()
    .required(),
  newPassword: Joi.string()
    .min(8)
    .max(128)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters'
    })
});

const updatePasswordSchema = Joi.object({
  currentPassword: Joi.string()
    .max(128)
    .required(),
  newPassword: Joi.string()
    .min(8)
    .max(128)
    .required()
    .messages({
      'string.min': 'New password must be at least 8 characters'
    })
});

const updateProfileSchema = Joi.object({
  practiceName: Joi.string()
    .min(2)
    .max(100)
    .optional(),
  phone: Joi.string()
    .pattern(phonePattern)
    .allow('', null)
    .optional(),
  timezone: Joi.string()
    .max(50)
    .optional()
});

// ==========================================
// Settings schemas
// ==========================================

const twilioSettingsSchema = Joi.object({
  twilioPhone: Joi.string()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .required()
    .messages({
      'string.pattern.base': 'Twilio phone must be in E.164 format (e.g., +14155551234)'
    }),
  forwardingPhone: Joi.string()
    .pattern(phonePattern)
    .allow('', null)
    .optional(),
  twilioAccountSid: Joi.string()
    .pattern(/^AC[a-f0-9]{32}$/)
    .required()
    .messages({
      'string.pattern.base': 'Invalid Twilio Account SID format'
    }),
  twilioAuthToken: Joi.string()
    .length(32)
    .optional()
    .messages({
      'string.length': 'Twilio Auth Token must be 32 characters'
    })
});

const businessHoursSchema = Joi.object({
  businessHours: Joi.object({
    monday: Joi.object({
      enabled: Joi.boolean().required(),
      open: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
      close: Joi.string().pattern(/^\d{2}:\d{2}$/).required()
    }),
    tuesday: Joi.object({
      enabled: Joi.boolean().required(),
      open: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
      close: Joi.string().pattern(/^\d{2}:\d{2}$/).required()
    }),
    wednesday: Joi.object({
      enabled: Joi.boolean().required(),
      open: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
      close: Joi.string().pattern(/^\d{2}:\d{2}$/).required()
    }),
    thursday: Joi.object({
      enabled: Joi.boolean().required(),
      open: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
      close: Joi.string().pattern(/^\d{2}:\d{2}$/).required()
    }),
    friday: Joi.object({
      enabled: Joi.boolean().required(),
      open: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
      close: Joi.string().pattern(/^\d{2}:\d{2}$/).required()
    }),
    saturday: Joi.object({
      enabled: Joi.boolean().required(),
      open: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
      close: Joi.string().pattern(/^\d{2}:\d{2}$/).required()
    }),
    sunday: Joi.object({
      enabled: Joi.boolean().required(),
      open: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
      close: Joi.string().pattern(/^\d{2}:\d{2}$/).required()
    })
  }).required()
});

// ==========================================
// SMS schemas
// ==========================================

const sendSmsSchema = Joi.object({
  to: Joi.string()
    .pattern(phonePattern)
    .required()
    .messages({
      'string.pattern.base': 'Please provide a valid phone number'
    }),
  message: Joi.string()
    .min(1)
    .max(1600)
    .required()
    .messages({
      'string.min': 'Message cannot be empty',
      'string.max': 'Message must be less than 1600 characters'
    }),
  conversationId: Joi.number()
    .integer()
    .positive()
    .optional()
});

// ==========================================
// Lead schemas
// ==========================================

const createLeadSchema = Joi.object({
  name: Joi.string()
    .min(1)
    .max(100)
    .required(),
  phone: Joi.string()
    .pattern(phonePattern)
    .required(),
  email: Joi.string()
    .pattern(emailPattern)
    .max(255)
    .allow('', null)
    .optional(),
  reason: Joi.string()
    .max(500)
    .optional(),
  source: Joi.string()
    .valid('manual', 'missed_call', 'voicemail', 'sms', 'web', 'referral')
    .optional(),
  priority: Joi.string()
    .valid('low', 'medium', 'high')
    .optional()
});

const updateLeadSchema = Joi.object({
  name: Joi.string()
    .min(1)
    .max(100)
    .optional(),
  phone: Joi.string()
    .pattern(phonePattern)
    .optional(),
  email: Joi.string()
    .pattern(emailPattern)
    .max(255)
    .allow('', null)
    .optional(),
  reason: Joi.string()
    .max(500)
    .optional(),
  status: Joi.string()
    .valid('new', 'contacted', 'qualified', 'converted', 'lost')
    .optional(),
  priority: Joi.string()
    .valid('low', 'medium', 'high')
    .optional()
});

// ==========================================
// Query param schemas
// ==========================================

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
}).unknown(true); // Allow other query params

const analyticsQuerySchema = Joi.object({
  days: Joi.number().integer().min(1).max(365).default(30),
  period: Joi.string().valid('7d', '30d', '90d').optional()
}).unknown(true);

module.exports = {
  validate,
  schemas: {
    // Auth
    register: registerSchema,
    login: loginSchema,
    forgotPassword: forgotPasswordSchema,
    verifyOtp: verifyOtpSchema,
    resetPassword: resetPasswordSchema,
    updatePassword: updatePasswordSchema,
    updateProfile: updateProfileSchema,
    // Settings
    twilioSettings: twilioSettingsSchema,
    businessHours: businessHoursSchema,
    // SMS
    sendSms: sendSmsSchema,
    // Leads
    createLead: createLeadSchema,
    updateLead: updateLeadSchema,
    // Query
    pagination: paginationSchema,
    analyticsQuery: analyticsQuerySchema
  }
};
