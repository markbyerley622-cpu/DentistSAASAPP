-- SmileDesk Migration V4 - Per-User Google OAuth & Call Forwarding
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. ADD GOOGLE OAUTH COLUMNS TO SETTINGS TABLE
-- =============================================
-- These allow each user to configure their own Google OAuth app credentials
-- instead of relying on environment variables

ALTER TABLE settings ADD COLUMN IF NOT EXISTS google_client_id VARCHAR(255);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS google_client_secret VARCHAR(255);

-- Add comment for clarity
COMMENT ON COLUMN settings.google_client_id IS 'User''s own Google OAuth Client ID from Google Cloud Console';
COMMENT ON COLUMN settings.google_client_secret IS 'User''s own Google OAuth Client Secret from Google Cloud Console';

-- =============================================
-- 2. ADD CALL FORWARDING PHONE NUMBER
-- =============================================
-- This is the dentist's real phone number where calls get forwarded to
-- When a patient calls the Twilio number, it forwards to this number

ALTER TABLE settings ADD COLUMN IF NOT EXISTS forwarding_phone VARCHAR(50);

COMMENT ON COLUMN settings.forwarding_phone IS 'Dentist''s real phone number - calls to Twilio number forward here';

-- =============================================
-- 3. ADD ADDITIONAL CALL/SMS TRACKING COLUMNS
-- =============================================

-- Ensure calls table has the needed columns
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_missed BOOLEAN DEFAULT false;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS followup_status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE calls ADD COLUMN IF NOT EXISTS followup_attempts INTEGER DEFAULT 0;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMP;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS conversation_id INTEGER REFERENCES conversations(id);

-- Ensure conversations table has the needed columns
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS call_id INTEGER REFERENCES calls(id);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel VARCHAR(20) DEFAULT 'sms';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS direction VARCHAR(20) DEFAULT 'outbound';

-- Ensure leads table has conversation reference
ALTER TABLE leads ADD COLUMN IF NOT EXISTS conversation_id INTEGER REFERENCES conversations(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'missed_call';

-- =============================================
-- DONE! Database is now ready for call forwarding + SMS follow-up
-- =============================================
