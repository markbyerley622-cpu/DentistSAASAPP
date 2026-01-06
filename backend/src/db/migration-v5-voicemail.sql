-- SmileDesk Migration V5 - Voicemail Support
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. ADD VOICEMAIL COLUMNS TO CALLS TABLE
-- =============================================
ALTER TABLE calls ADD COLUMN IF NOT EXISTS voicemail_url TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS voicemail_duration INTEGER DEFAULT 0;

-- Add 'voicemail_left' as a valid followup_status
-- (existing values: 'pending', 'in_progress', 'completed', 'no_response')
-- Now also includes: 'voicemail_left'

-- =============================================
-- 2. UPDATE LEADS TABLE (Add 'voicemail' as source)
-- =============================================
-- Existing sources: 'missed_call', 'website', 'referral', 'manual'
-- Now also includes: 'voicemail'

-- =============================================
-- 3. INDEX FOR VOICEMAIL QUERIES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_calls_voicemail ON calls(voicemail_url) WHERE voicemail_url IS NOT NULL;

-- =============================================
-- DONE! Voicemail support is now ready
-- =============================================
