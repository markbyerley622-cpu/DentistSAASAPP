const crypto = require('crypto');

/**
 * Shared encryption utilities for sensitive data (Twilio auth tokens, etc.)
 * Uses AES-256-CBC encryption
 */

// Require encryption key in production
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
  console.error('FATAL: ENCRYPTION_KEY environment variable is required in production');
  process.exit(1);
}

// Use development-only fallback (32 bytes for AES-256)
const KEY = ENCRYPTION_KEY || 'dev-only-32-char-key-not-prod!!';
const IV_LENGTH = 16;

/**
 * Encrypt sensitive data
 * @param {string} text - Plain text to encrypt
 * @returns {string|null} - Encrypted text as hex (iv:encrypted) or null if empty
 */
function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypt sensitive data
 * @param {string} text - Encrypted text (iv:encrypted format)
 * @returns {string|null} - Decrypted plain text or null if empty
 */
function decrypt(text) {
  if (!text) return null;
  try {
    // Check if it's encrypted (contains colon separator)
    if (!text.includes(':')) {
      // Not encrypted (legacy data), return as-is
      return text;
    }
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error('Decryption error:', error.message);
    // Return original text if decryption fails (legacy unencrypted data)
    return text;
  }
}

module.exports = {
  encrypt,
  decrypt
};
