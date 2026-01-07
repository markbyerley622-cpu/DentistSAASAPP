-- SmileDesk Migration V6 - Voicemail Transcription & Intent
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. ADD VOICEMAIL TRANSCRIPTION & INTENT TO CALLS
-- =============================================
ALTER TABLE calls ADD COLUMN IF NOT EXISTS voicemail_transcription TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS voicemail_intent VARCHAR(30);
-- Intent values: 'emergency', 'appointment', 'callback', 'inquiry', 'other'

-- =============================================
-- 2. INDEX FOR FILTERING BY INTENT
-- =============================================
CREATE INDEX IF NOT EXISTS idx_calls_voicemail_intent
ON calls(voicemail_intent) WHERE voicemail_intent IS NOT NULL;

-- =============================================
-- 3. VIEW FOR VOICEMAIL DASHBOARD
-- =============================================
CREATE OR REPLACE VIEW v_voicemail_leads AS
SELECT
  c.id,
  c.user_id,
  c.caller_phone,
  c.caller_name,
  c.voicemail_url,
  c.voicemail_duration,
  c.voicemail_transcription,
  c.voicemail_intent,
  c.followup_status,
  c.created_at,
  l.id as lead_id,
  l.status as lead_status,
  l.name as lead_name
FROM calls c
LEFT JOIN leads l ON l.call_id = c.id
WHERE c.voicemail_url IS NOT NULL
  AND c.voicemail_duration >= 3;

-- =============================================
-- DONE! Voicemail intent tracking is ready
-- =============================================
