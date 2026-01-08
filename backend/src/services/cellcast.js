/**
 * CellCast SMS Service
 * Australian SMS provider - replaces Twilio for SMS functionality
 *
 * API Documentation: https://cellcast.com.au/api-docs
 *
 * Features:
 * - Send SMS messages
 * - Receive inbound SMS via webhooks
 * - No voice calling (PBX systems handle calls)
 */

const https = require('https');
const { URL } = require('url');

// CellCast API configuration
const CELLCAST_API_BASE = 'https://cellcast.com.au/api/v3';

/**
 * Send SMS via CellCast API
 *
 * @param {string} apiKey - CellCast API key (APPKEY)
 * @param {string} to - Recipient phone number (E.164 format, e.g., +61412345678)
 * @param {string} message - SMS message content
 * @param {string} from - Sender ID or phone number (optional)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendSMS(apiKey, to, message, from = null) {
  if (!apiKey) {
    return { success: false, error: 'CellCast API key not configured' };
  }

  if (!to || !message) {
    return { success: false, error: 'Missing recipient or message' };
  }

  // Normalize phone number to E.164 format
  const normalizedTo = normalizePhoneNumber(to);

  const payload = {
    sms_text: message,
    numbers: [normalizedTo]
  };

  // Add sender ID if provided
  if (from) {
    payload.from = from;
  }

  try {
    console.log('CellCast: Sending SMS to', normalizedTo);
    console.log('CellCast: Payload', JSON.stringify(payload));

    const response = await makeRequest('POST', '/send-sms', apiKey, payload);

    console.log('CellCast: Response', JSON.stringify(response));

    // CellCast returns { meta: { code: 200, status: 'SUCCESS' }, msg: 'Queued', data: {...} }
    if (response.meta?.status === 'SUCCESS' || response.meta?.code === 200) {
      return {
        success: true,
        messageId: response.data?.messages?.[0]?.message_id || 'sent',
        response: response
      };
    } else {
      console.error('CellCast: API returned error', response);
      return {
        success: false,
        error: response.msg || response.meta?.status || 'Failed to send SMS'
      };
    }
  } catch (error) {
    console.error('CellCast sendSMS error:', error.message);
    console.error('CellCast error details:', error);
    return {
      success: false,
      error: error.message || 'Failed to send SMS'
    };
  }
}

/**
 * Validate CellCast API credentials
 *
 * @param {string} apiKey - CellCast API key to validate
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function validateCredentials(apiKey) {
  if (!apiKey) {
    return { valid: false, error: 'API key is required' };
  }

  try {
    // CellCast doesn't have a specific "validate" endpoint,
    // so we check account balance which requires valid credentials
    const response = await makeRequest('GET', '/get-balance', apiKey);

    if (response.error) {
      return { valid: false, error: response.error };
    }

    return {
      valid: true,
      balance: response.balance || response.data?.balance
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Get account balance from CellCast
 *
 * @param {string} apiKey - CellCast API key
 * @returns {Promise<{success: boolean, balance?: number, error?: string}>}
 */
async function getBalance(apiKey) {
  try {
    const response = await makeRequest('GET', '/get-balance', apiKey);

    if (response.balance !== undefined || response.data?.balance !== undefined) {
      return {
        success: true,
        balance: response.balance || response.data?.balance
      };
    }

    return { success: false, error: 'Could not retrieve balance' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Make HTTP request to CellCast API
 *
 * @param {string} method - HTTP method
 * @param {string} endpoint - API endpoint
 * @param {string} apiKey - CellCast API key
 * @param {object} body - Request body for POST/PUT
 * @returns {Promise<object>}
 */
function makeRequest(method, endpoint, apiKey, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${CELLCAST_API_BASE}${endpoint}`);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'APPKEY': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'SmileDesk/1.0'
      }
    };

    console.log('CellCast: Making request to', url.href);

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);

          // Check for API-level errors
          if (res.statusCode >= 400) {
            reject(new Error(parsed.message || parsed.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          // Non-JSON response
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve({ raw: data });
          }
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    // Set timeout
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Normalize phone number to E.164 format
 * Handles Australian numbers primarily
 *
 * @param {string} phone - Phone number in various formats
 * @returns {string} - Phone number in E.164 format
 */
function normalizePhoneNumber(phone) {
  if (!phone) return phone;

  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Handle Australian numbers
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    // Australian local format: 0412345678 -> +61412345678
    cleaned = '+61' + cleaned.slice(1);
  } else if (cleaned.startsWith('61') && !cleaned.startsWith('+')) {
    // Missing + prefix
    cleaned = '+' + cleaned;
  } else if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    // Assume Australian if no country code
    if (cleaned.length === 9) {
      cleaned = '+61' + cleaned;
    }
  }

  return cleaned;
}

/**
 * Parse inbound SMS webhook from CellCast
 *
 * CellCast sends inbound SMS as an ARRAY:
 * [
 *   {
 *     "from": "61412345678",
 *     "body": "Hello!",
 *     "received_at": "2026-01-08 17:50:34",
 *     "message_id": "6952176713",
 *     "type": "SMS",
 *     "original_message_id": "...",
 *     "original_body": "..."
 *   }
 * ]
 *
 * @param {object|array} webhookData - Raw webhook payload from CellCast
 * @returns {object} - Normalized inbound message
 */
function parseInboundWebhook(webhookData) {
  // CellCast sends an array - get first item
  const data = Array.isArray(webhookData) ? webhookData[0] : webhookData;

  if (!data) {
    return { from: null, to: null, message: null, messageId: null, timestamp: null };
  }

  return {
    from: normalizePhoneNumber(data.from || data.sender || data.mobile),
    to: data.to || data.recipient || data.dedicated_number || null, // CellCast doesn't include 'to'
    message: data.body || data.message || data.sms_text || data.text,
    messageId: data.message_id || data.id || data.sms_id,
    timestamp: data.received_at || data.timestamp || new Date().toISOString(),
    originalMessageId: data.original_message_id,
    originalBody: data.original_body
  };
}

/**
 * Validate webhook signature from CellCast (if they provide one)
 *
 * @param {object} headers - Request headers
 * @param {string} body - Raw request body
 * @param {string} secret - Webhook secret (if configured)
 * @returns {boolean}
 */
function validateWebhookSignature(headers, body, secret) {
  // CellCast may not require signature validation
  // This is a placeholder for if they do
  if (!secret) return true;

  // Implement signature validation if CellCast provides it
  // For now, allow all requests (use IP whitelisting or other security)
  return true;
}

module.exports = {
  sendSMS,
  validateCredentials,
  getBalance,
  normalizePhoneNumber,
  parseInboundWebhook,
  validateWebhookSignature
};
