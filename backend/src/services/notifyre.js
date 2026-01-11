/**
 * Notifyre SMS Service
 * Real-time two-way SMS messaging for instant patient responses
 *
 * API Documentation: https://docs.notifyre.com/api/introduction
 * Twexit API (Twilio-compatible): https://support.notifyre.com/twexit-api-node-js
 *
 * Features:
 * - Send SMS messages instantly via Twexit API
 * - Receive inbound SMS via webhooks (real-time push)
 * - Australian numbers supported (+61)
 */

const https = require('https');

// Notifyre Native API endpoint
const NOTIFYRE_API_HOST = 'api.notifyre.com';

/**
 * Send SMS via Notifyre Native API
 *
 * @param {string} accountId - Notifyre Account ID (unused, kept for compatibility)
 * @param {string} apiToken - Notifyre API Token
 * @param {string} to - Recipient phone number (E.164 format)
 * @param {string} message - SMS message content
 * @param {string} from - Sender number (your Notifyre virtual number)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendSMS(accountId, apiToken, to, message, from) {
  if (!apiToken) {
    return { success: false, error: 'Notifyre credentials not configured' };
  }

  if (!to || !message) {
    return { success: false, error: 'Missing recipient or message' };
  }

  if (!from) {
    return { success: false, error: 'Missing sender number (from)' };
  }

  // Normalize phone number
  const normalizedTo = normalizePhoneNumber(to);
  const normalizedFrom = normalizePhoneNumber(from);

  try {
    console.log('Notifyre: Sending SMS to', normalizedTo, 'from', normalizedFrom);

    const response = await makeNotifyreRequest(apiToken, {
      recipients: [normalizedTo],
      from: normalizedFrom,
      body: message
    });

    console.log('Notifyre: Response', JSON.stringify(response));

    // Native API response
    if (response.success || response.id || response.messageId) {
      return {
        success: true,
        messageId: response.id || response.messageId || response.message_id || null,
        response: response
      };
    } else if (response.error || response.message) {
      console.error('Notifyre: API returned error', response);
      return {
        success: false,
        error: response.error || response.message || 'Unknown error'
      };
    } else {
      return {
        success: true,
        messageId: null,
        response: response
      };
    }
  } catch (error) {
    console.error('Notifyre sendSMS error:', error.message);
    return {
      success: false,
      error: error.message || 'Failed to send SMS'
    };
  }
}

/**
 * Make HTTP request to Notifyre Native API
 *
 * @param {string} apiToken - Notifyre API Token
 * @param {object} body - Request body (recipients, from, body)
 * @returns {Promise<object>}
 */
function makeNotifyreRequest(apiToken, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);

    const options = {
      hostname: NOTIFYRE_API_HOST,
      port: 443,
      path: '/v2/sms/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${apiToken}`,
        'Accept': 'application/json',
        'User-Agent': 'SmileDesk/1.0'
      }
    };

    console.log('Notifyre: Making request to', `https://${NOTIFYRE_API_HOST}${options.path}`);

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.message || parsed.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
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
 * Parse inbound SMS webhook from Notifyre
 *
 * Notifyre webhook format (POST):
 * {
 *   "id": "abc123",
 *   "from": "+61412345678",       // Sender number
 *   "to": "+61481073412",         // Your Notifyre number
 *   "message": "Hello!",
 *   "receivedDateUtc": "2026-01-10T10:30:00Z",
 *   "type": "sms_received"
 * }
 *
 * May also come in Twilio-compatible format:
 * {
 *   "From": "+61412345678",
 *   "To": "+61481073412",
 *   "Body": "Hello!",
 *   "MessageSid": "abc123"
 * }
 *
 * @param {object} webhookData - Raw webhook payload from Notifyre
 * @returns {object} - Normalized inbound message
 */
function parseInboundWebhook(webhookData) {
  const data = webhookData;

  // Handle both Notifyre native and Twilio-compatible formats
  let fromNumber = data.from || data.From || data.msisdn || data.sender;
  let toNumber = data.to || data.To || data.recipient;
  let messageBody = data.message || data.Body || data.body || data.text || data.content;
  let messageId = data.id || data.MessageSid || data.message_id || data.messageId;

  // Normalize the from number (add + prefix if needed)
  if (fromNumber && !fromNumber.startsWith('+')) {
    fromNumber = '+' + fromNumber;
  }

  // Normalize the to number
  if (toNumber && !toNumber.startsWith('+')) {
    toNumber = '+' + toNumber;
  }

  return {
    from: normalizePhoneNumber(fromNumber),
    to: toNumber,
    message: messageBody,
    messageId: messageId,
    timestamp: data.receivedDateUtc || data.DateCreated || data.timestamp || new Date().toISOString(),
    type: data.type || 'sms_received'
  };
}

/**
 * Parse delivery status webhook from Notifyre
 *
 * @param {object} webhookData - Raw webhook payload
 * @returns {object} - Normalized status update
 */
function parseStatusWebhook(webhookData) {
  const data = webhookData;

  return {
    messageId: data.id || data.MessageSid || data.message_id,
    status: data.status || data.MessageStatus || data.Status,
    errorCode: data.error_code || data.ErrorCode,
    errorMessage: data.error_message || data.ErrorMessage,
    timestamp: data.timestamp || data.DateUpdated || new Date().toISOString()
  };
}

module.exports = {
  sendSMS,
  normalizePhoneNumber,
  parseInboundWebhook,
  parseStatusWebhook
};
