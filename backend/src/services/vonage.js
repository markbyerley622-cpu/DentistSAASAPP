/**
 * Vonage SMS Service
 * Real-time two-way SMS messaging for instant patient responses
 *
 * API Documentation: https://developer.vonage.com/en/messaging/sms/overview
 *
 * Features:
 * - Send SMS messages instantly
 * - Receive inbound SMS via webhooks (real-time push)
 * - Australian numbers supported (+61)
 */

const https = require('https');

// Vonage API configuration
const VONAGE_API_BASE = 'rest.nexmo.com';

/**
 * Send SMS via Vonage API
 *
 * @param {string} apiKey - Vonage API key
 * @param {string} apiSecret - Vonage API secret
 * @param {string} to - Recipient phone number (E.164 format)
 * @param {string} message - SMS message content
 * @param {string} from - Sender ID (phone number or alphanumeric, max 11 chars)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendSMS(apiKey, apiSecret, to, message, from = null) {
  if (!apiKey || !apiSecret) {
    return { success: false, error: 'Vonage credentials not configured' };
  }

  if (!to || !message) {
    return { success: false, error: 'Missing recipient or message' };
  }

  // Normalize phone number
  const normalizedTo = normalizePhoneNumber(to);

  // Use provided 'from' or default to 'SmileDesk'
  const sender = from || process.env.VONAGE_FROM_NUMBER || 'SmileDesk';

  const payload = {
    api_key: apiKey,
    api_secret: apiSecret,
    to: normalizedTo.replace('+', ''), // Vonage wants number without +
    from: sender.replace('+', ''),
    text: message
  };

  try {
    console.log('Vonage: Sending SMS to', normalizedTo);

    const response = await makeRequest('/sms/json', payload);

    console.log('Vonage: Response', JSON.stringify(response));

    // Vonage returns messages array with status for each
    if (response.messages && response.messages.length > 0) {
      const msg = response.messages[0];

      // Status "0" means success
      if (msg.status === '0') {
        return {
          success: true,
          messageId: msg['message-id'],
          response: response
        };
      } else {
        console.error('Vonage: API returned error', msg);
        return {
          success: false,
          error: msg['error-text'] || `Error code: ${msg.status}`
        };
      }
    } else {
      return {
        success: false,
        error: 'No response from Vonage'
      };
    }
  } catch (error) {
    console.error('Vonage sendSMS error:', error.message);
    return {
      success: false,
      error: error.message || 'Failed to send SMS'
    };
  }
}

/**
 * Make HTTP request to Vonage API
 *
 * @param {string} path - API path
 * @param {object} body - Request body
 * @returns {Promise<object>}
 */
function makeRequest(path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);

    const options = {
      hostname: VONAGE_API_BASE,
      port: 443,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'application/json',
        'User-Agent': 'SmileDesk/1.0'
      }
    };

    console.log('Vonage: Making request to', `https://${VONAGE_API_BASE}${path}`);

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
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

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Normalize phone number to E.164 format
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
 * Parse inbound SMS webhook from Vonage
 *
 * Vonage inbound webhook format (GET or POST):
 * {
 *   "msisdn": "61412345678",        // From number (sender)
 *   "to": "61481073412",            // Your Vonage number
 *   "messageId": "abc123",
 *   "text": "Hello!",
 *   "type": "text",
 *   "keyword": "HELLO",
 *   "message-timestamp": "2026-01-08 10:30:00"
 * }
 *
 * @param {object} webhookData - Raw webhook payload from Vonage
 * @returns {object} - Normalized inbound message
 */
function parseInboundWebhook(webhookData) {
  // Vonage uses 'msisdn' for sender, 'to' for your number, 'text' for message
  const data = webhookData;

  // Normalize the from number (add + prefix if needed)
  let fromNumber = data.msisdn || data.from;
  if (fromNumber && !fromNumber.startsWith('+')) {
    fromNumber = '+' + fromNumber;
  }

  // Normalize the to number
  let toNumber = data.to;
  if (toNumber && !toNumber.startsWith('+')) {
    toNumber = '+' + toNumber;
  }

  return {
    from: normalizePhoneNumber(fromNumber),
    to: toNumber,
    message: data.text || data.body || data.message,
    messageId: data.messageId || data['message-id'] || data.id,
    timestamp: data['message-timestamp'] || data.timestamp || new Date().toISOString(),
    type: data.type || 'text',
    keyword: data.keyword
  };
}

/**
 * Get account balance from Vonage
 *
 * @param {string} apiKey - Vonage API key
 * @param {string} apiSecret - Vonage API secret
 * @returns {Promise<{success: boolean, balance?: object, error?: string}>}
 */
async function getBalance(apiKey, apiSecret) {
  try {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: VONAGE_API_BASE,
        port: 443,
        path: `/account/get-balance?api_key=${apiKey}&api_secret=${apiSecret}`,
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.value !== undefined) {
              resolve({ success: true, balance: parsed.value, currency: parsed.currency || 'EUR' });
            } else {
              resolve({ success: false, error: parsed['error-text'] || 'Failed to get balance' });
            }
          } catch (e) {
            resolve({ success: false, error: 'Failed to parse response' });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });

      req.end();
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendSMS,
  normalizePhoneNumber,
  parseInboundWebhook,
  getBalance
};
