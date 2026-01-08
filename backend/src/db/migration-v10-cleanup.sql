-- SmileDesk Migration V10 - Cleanup Settings Table
-- Remove Twilio, Google Calendar, and unused columns
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. DROP VIEW FIRST (depends on columns we're removing)
-- =============================================
DROP VIEW IF EXISTS v_admin_clients;

-- =============================================
-- 2. DROP TWILIO COLUMNS (No longer needed)
-- =============================================
ALTER TABLE settings DROP COLUMN IF EXISTS twilio_phone;
ALTER TABLE settings DROP COLUMN IF EXISTS twilio_account_sid;
ALTER TABLE settings DROP COLUMN IF EXISTS twilio_auth_token;

-- =============================================
-- 3. DROP GOOGLE CALENDAR COLUMNS (Not using)
-- =============================================
ALTER TABLE settings DROP COLUMN IF EXISTS google_calendar_connected;
ALTER TABLE settings DROP COLUMN IF EXISTS google_tokens;
ALTER TABLE settings DROP COLUMN IF EXISTS google_client_id;
ALTER TABLE settings DROP COLUMN IF EXISTS google_client_secret;

-- =============================================
-- 4. DROP UNUSED COLUMNS
-- =============================================
ALTER TABLE settings DROP COLUMN IF EXISTS cellcast_api_key;  -- Using global env var
ALTER TABLE settings DROP COLUMN IF EXISTS pbx_webhook_secret; -- Not needed with CellCast
ALTER TABLE settings DROP COLUMN IF EXISTS pbx_type;          -- Not needed anymore
ALTER TABLE settings DROP COLUMN IF EXISTS business_phone;    -- Redundant with user.phone

-- =============================================
-- 5. KEEP THESE COLUMNS:
-- =============================================
-- sms_reply_number    - CellCast number for this dentist (YOU set this)
-- forwarding_phone    - Where calls ring (dentist enters this)
-- notification_email  - Email notifications on/off
-- notification_sms    - SMS notifications on/off
-- booking_mode        - manual/auto/suggest
-- business_hours      - When they're open
-- ai_greeting         - Custom SMS message
-- followup_delay_minutes
-- max_followup_attempts
-- followup_channel
-- ai_personality
-- callback_offer

-- =============================================
-- 6. RECREATE ADMIN CLIENTS VIEW
-- =============================================
CREATE VIEW v_admin_clients AS
SELECT
  u.id,
  u.email,
  u.practice_name,
  u.phone,
  u.timezone,
  u.is_admin,
  u.created_at,
  s.sms_reply_number,
  s.forwarding_phone,
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
-- FINAL SETTINGS TABLE STRUCTURE:
-- =============================================
-- id                     UUID (primary key)
-- user_id                UUID (foreign key to users)
-- sms_reply_number       VARCHAR - CellCast number (admin sets this)
-- forwarding_phone       VARCHAR - Where calls ring (dentist sets this)
-- notification_email     BOOLEAN
-- notification_sms       BOOLEAN
-- booking_mode           VARCHAR (manual/auto/suggest)
-- business_hours         JSONB
-- ai_greeting            TEXT
-- followup_delay_minutes INTEGER
-- max_followup_attempts  INTEGER
-- followup_channel       VARCHAR
-- ai_personality         VARCHAR
-- callback_offer         BOOLEAN
-- created_at             TIMESTAMP
-- updated_at             TIMESTAMP

-- =============================================
-- DONE! Settings table cleaned up.
-- =============================================
