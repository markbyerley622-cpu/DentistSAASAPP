-- SmileDesk Migration V9 - CellCast + PBX Integration
-- Replaces Twilio with CellCast for SMS and supports external PBX webhooks
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. ADD CELLCAST CONFIGURATION COLUMNS
-- =============================================

-- CellCast API key (encrypted) - for SMS sending
ALTER TABLE settings ADD COLUMN IF NOT EXISTS cellcast_api_key TEXT;

-- SMS reply number (the CellCast dedicated number patients reply to)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sms_reply_number VARCHAR(20);

-- =============================================
-- 2. ADD PBX CONFIGURATION COLUMNS
-- =============================================

-- Business phone number (the main number patients call)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS business_phone VARCHAR(20);

-- PBX type (3cx, ringcentral, vonage, freepbx, 8x8, zoom, other)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS pbx_type VARCHAR(50) DEFAULT 'other';

-- Webhook secret for secure PBX webhooks
ALTER TABLE settings ADD COLUMN IF NOT EXISTS pbx_webhook_secret VARCHAR(100);

-- =============================================
-- 3. MIGRATE EXISTING DATA
-- =============================================

-- Copy twilio_phone to sms_reply_number if not already set
-- (This preserves the existing SMS number during migration)
UPDATE settings
SET sms_reply_number = twilio_phone
WHERE sms_reply_number IS NULL AND twilio_phone IS NOT NULL;

-- Copy user's phone as business_phone if not set
UPDATE settings s
SET business_phone = u.phone
FROM users u
WHERE s.user_id = u.id
  AND s.business_phone IS NULL
  AND u.phone IS NOT NULL;

-- =============================================
-- 4. UPDATE VIEWS TO INCLUDE NEW FIELDS
-- =============================================

DROP VIEW IF EXISTS v_admin_clients;
CREATE VIEW v_admin_clients AS
SELECT
  u.id,
  u.email,
  u.practice_name,
  u.phone,
  u.timezone,
  u.is_admin,
  u.created_at,
  s.twilio_phone,
  s.forwarding_phone,
  s.sms_reply_number,
  s.business_phone,
  s.pbx_type,
  (SELECT COUNT(*) FROM calls c WHERE c.user_id = u.id) as total_calls,
  (SELECT COUNT(*) FROM calls c WHERE c.user_id = u.id AND c.is_missed = true) as missed_calls,
  (SELECT COUNT(*) FROM leads l WHERE l.user_id = u.id) as total_leads,
  (SELECT COUNT(*) FROM appointments a WHERE a.user_id = u.id) as total_appointments,
  (SELECT COUNT(*) FROM leads l WHERE l.user_id = u.id AND l.status = 'converted') as converted_leads
FROM users u
LEFT JOIN settings s ON s.user_id = u.id
WHERE u.is_admin = false
ORDER BY u.created_at DESC;

-- =============================================
-- 5. CREATE INDEXES FOR NEW COLUMNS
-- =============================================

CREATE INDEX IF NOT EXISTS idx_settings_sms_reply_number ON settings(sms_reply_number);
CREATE INDEX IF NOT EXISTS idx_settings_business_phone ON settings(business_phone);
CREATE INDEX IF NOT EXISTS idx_settings_pbx_webhook_secret ON settings(pbx_webhook_secret);

-- =============================================
-- VERIFICATION QUERIES
-- =============================================

-- Check new columns exist
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'settings' AND column_name IN ('cellcast_api_key', 'sms_reply_number', 'business_phone', 'pbx_type', 'pbx_webhook_secret');

-- =============================================
-- NOTES ON TWILIO REMOVAL
-- =============================================
--
-- The Twilio columns (twilio_account_sid, twilio_auth_token, twilio_phone)
-- are NOT removed in this migration to allow for gradual transition.
--
-- After confirming CellCast is working, run migration V10 to remove Twilio columns:
--
-- ALTER TABLE settings DROP COLUMN IF EXISTS twilio_account_sid;
-- ALTER TABLE settings DROP COLUMN IF EXISTS twilio_auth_token;
-- ALTER TABLE settings DROP COLUMN IF EXISTS twilio_phone;
--
-- =============================================
-- WEBHOOK SETUP INSTRUCTIONS
-- =============================================
--
-- 1. CellCast Inbound SMS Webhook:
--    URL: https://your-app.com/api/sms/incoming
--    Method: POST
--
-- 2. PBX Missed Call Webhook (choose your PBX type):
--    Generic: https://your-app.com/api/pbx/missed-call
--    3CX:     https://your-app.com/api/pbx/missed-call/3cx
--    RingCentral: https://your-app.com/api/pbx/missed-call/ringcentral
--    Vonage:  https://your-app.com/api/pbx/missed-call/vonage
--    FreePBX: https://your-app.com/api/pbx/missed-call/freepbx
--    8x8:     https://your-app.com/api/pbx/missed-call/8x8
--    Zoom:    https://your-app.com/api/pbx/missed-call/zoom
--
-- =============================================
-- DONE! CellCast + PBX integration ready.
-- =============================================
