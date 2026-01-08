-- SmileDesk Migration V8 - Remove Voicemail UI/Storage
-- Voicemails still work via phone system, but data is NOT stored in app
-- SMS only triggers when caller hangs up WITHOUT leaving a voicemail
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. DROP VOICEMAIL VIEWS
-- =============================================
DROP VIEW IF EXISTS v_voicemail_leads;
DROP VIEW IF EXISTS v_admin_voicemails;

-- =============================================
-- 2. RECREATE ADMIN STATS VIEW WITHOUT VOICEMAIL
-- =============================================
DROP VIEW IF EXISTS v_admin_stats;
CREATE VIEW v_admin_stats AS
SELECT
  (SELECT COUNT(*) FROM users WHERE is_admin = false) as total_clients,
  (SELECT COUNT(*) FROM calls) as total_calls,
  (SELECT COUNT(*) FROM calls WHERE is_missed = true) as missed_calls,
  (SELECT COUNT(*) FROM leads) as total_leads,
  (SELECT COUNT(*) FROM leads WHERE status = 'converted') as converted_leads,
  (SELECT COUNT(*) FROM appointments) as total_appointments,
  (SELECT COUNT(*) FROM appointments WHERE status = 'scheduled') as upcoming_appointments;

-- =============================================
-- 3. RECREATE ADMIN CLIENTS VIEW WITHOUT VOICEMAIL
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
-- 4. DROP VOICEMAIL INDEXES
-- =============================================
DROP INDEX IF EXISTS idx_calls_voicemail;
DROP INDEX IF EXISTS idx_calls_voicemail_intent;

-- =============================================
-- 5. DROP VOICEMAIL COLUMNS FROM CALLS TABLE
-- =============================================
ALTER TABLE calls DROP COLUMN IF EXISTS voicemail_url;
ALTER TABLE calls DROP COLUMN IF EXISTS voicemail_duration;
ALTER TABLE calls DROP COLUMN IF EXISTS voicemail_transcription;
ALTER TABLE calls DROP COLUMN IF EXISTS voicemail_intent;

-- =============================================
-- 6. UPDATE ANY LEADS WITH 'voicemail' SOURCE TO 'missed_call'
-- =============================================
UPDATE leads SET source = 'missed_call' WHERE source = 'voicemail';

-- =============================================
-- 7. UPDATE ANY CALLS WITH 'voicemail_left' FOLLOWUP STATUS
-- These are calls where caller left a voicemail - mark as completed
-- (dentist handles these via their phone system, not the app)
-- =============================================
UPDATE calls SET followup_status = 'completed' WHERE followup_status = 'voicemail_left';

-- =============================================
-- 8. CLEANUP ORPHANED LEADS WITH VOICEMAIL REASON
-- =============================================
UPDATE leads SET reason = 'Missed call - handled via phone'
WHERE reason LIKE '%voicemail%' OR reason LIKE '%Voicemail%';

-- =============================================
-- VERIFICATION QUERIES (Run these to confirm cleanup)
-- =============================================

-- Check no voicemail columns remain
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'calls' AND column_name LIKE '%voicemail%';
-- Expected: 0 rows

-- Check no voicemail source in leads
-- SELECT COUNT(*) FROM leads WHERE source = 'voicemail';
-- Expected: 0

-- Check no voicemail_left status
-- SELECT COUNT(*) FROM calls WHERE followup_status = 'voicemail_left';
-- Expected: 0

-- =============================================
-- DONE! Voicemail UI has been removed.
--
-- New call flow:
-- 1. Patient calls, dentist doesn't answer
-- 2. Patient hears: "Leave a message or hang up and we'll text you"
-- 3. If they leave voicemail (>= 3 sec): No SMS, dentist handles via phone
-- 4. If they hang up (< 3 sec): SMS follow-up sent automatically
-- =============================================
