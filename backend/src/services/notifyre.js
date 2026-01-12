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

// Notifyre Native API
const NOTIFYRE_API_HOST = 'api.notifyre.com';

/**
 * Send SMS via Notifyre Native API
 *
 * @param {string} accountId - Notifyre Account ID (unused but kept for API compatibility)
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
      Body: message,
      Recipients: [
        {
          type: 'mobile_number',
          value: normalizedTo
        }
      ],
      From: normalizedFrom,
      AddUnsubscribeLink: false
    });

    console.log('Notifyre: Response', JSON.stringify(response));

    // Native API success check
    if (response.payload && response.payload.id) {
      return {
        success: true,
        messageId: response.payload.id,
        response: response
      };
    } else if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
      return {
        success: true,
        messageId: response.payload?.id || null,
        response: response
      };
    } else if (response.message && response.statusCode >= 400) {
      console.error('Notifyre: API returned error', response);
      return {
        success: false,
        error: response.message || 'Unknown error'
      };
    } else {
      // Assume success if no explicit error
      return {
        success: true,
        messageId: response.id || response.payload?.id || null,
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
 * Uses x-api-token header and JSON body
 *
 * @param {string} apiToken - Notifyre API Token
 * @param {object} body - Request body
 * @returns {Promise<object>}
 */
function makeNotifyreRequest(apiToken, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);

    const options = {
      hostname: NOTIFYRE_API_HOST,
      port: 443,
      path: '/sms/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-api-token': apiToken,
        'Accept': 'application/json'
      }
    };

    console.log('Notifyre: Making request to', `https://${NOTIFYRE_API_HOST}${options.path}`);
    console.log('Notifyre: Request body', postData);

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('Notifyre: HTTP Status', res.statusCode);
        console.log('Notifyre: Raw response', data);
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
 * Notifyre Native webhook format (POST):
 * {
 *   "Event": "sms_received",
 *   "Timestamp": 1768214454,
 *   "Payload": {
 *     "RecipientID": "00000000-0000-0000-0000-000000000000",
 *     "RecipientNumber": "+61430253299",    // Your Notifyre number
 *     "SenderNumber": "+61414855294",       // Customer's number
 *     "ReplyID": "c6eefdc4-8ad1-4fea-877e-e18ba2699e4e",
 *     "Message": "1",
 *     "ReceivedDateUtc": 1768214449
 *   }
 * }
 *
 * @param {object} webhookData - Raw webhook payload from Notifyre
 * @returns {object} - Normalized inbound message
 */
function parseInboundWebhook(webhookData) {
  const data = webhookData;

  // Handle Notifyre native format with Payload wrapper
  const payload = data.Payload || data.payload || data;

  // Extract fields from Notifyre native format
  let fromNumber = payload.SenderNumber || payload.senderNumber ||
                   payload.from || payload.From || data.from || data.From ||
                   payload.msisdn || payload.sender;

  let toNumber = payload.RecipientNumber || payload.recipientNumber ||
                 payload.to || payload.To || data.to || data.To ||
                 payload.recipient;

  let messageBody = payload.Message || payload.message ||
                    payload.Body || payload.body ||
                    data.message || data.Body || data.body ||
                    payload.text || payload.content;

  let messageId = payload.ReplyID || payload.replyId || payload.replyID ||
                  payload.id || payload.MessageSid ||
                  data.id || data.MessageSid || data.message_id || data.messageId;

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
    timestamp: payload.ReceivedDateUtc || payload.receivedDateUtc ||
               data.Timestamp || data.timestamp ||
               data.receivedDateUtc || data.DateCreated || new Date().toISOString(),
    type: data.Event || data.event || data.type || 'sms_received'
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
