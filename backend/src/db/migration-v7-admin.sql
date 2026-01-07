-- SmileDesk Migration V7 - Admin Role
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. ADD ADMIN COLUMN TO USERS
-- =============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- =============================================
-- 2. CREATE INDEX FOR ADMIN QUERIES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin) WHERE is_admin = true;

-- =============================================
-- 3. SET YOURSELF AS ADMIN
-- Replace 'your@email.com' with your actual email
-- =============================================
-- UPDATE users SET is_admin = true WHERE email = 'your@email.com';

-- =============================================
-- 4. ADMIN VIEW - ALL CLIENTS WITH STATS
-- =============================================
CREATE OR REPLACE VIEW v_admin_clients AS
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
  (SELECT COUNT(*) FROM calls c WHERE c.user_id = u.id AND c.voicemail_url IS NOT NULL) as total_voicemails,
  (SELECT COUNT(*) FROM leads l WHERE l.user_id = u.id) as total_leads,
  (SELECT COUNT(*) FROM appointments a WHERE a.user_id = u.id) as total_appointments,
  (SELECT COUNT(*) FROM leads l WHERE l.user_id = u.id AND l.status = 'converted') as converted_leads
FROM users u
LEFT JOIN settings s ON s.user_id = u.id
WHERE u.is_admin = false
ORDER BY u.created_at DESC;

-- =============================================
-- 5. ADMIN VIEW - ALL VOICEMAILS ACROSS CLIENTS
-- =============================================
CREATE OR REPLACE VIEW v_admin_voicemails AS
SELECT
  c.id,
  c.user_id,
  u.practice_name,
  u.email as client_email,
  c.caller_phone,
  c.caller_name,
  c.voicemail_url,
  c.voicemail_duration,
  c.voicemail_transcription,
  c.voicemail_intent,
  c.followup_status,
  c.created_at
FROM calls c
JOIN users u ON c.user_id = u.id
WHERE c.voicemail_url IS NOT NULL
  AND c.voicemail_duration >= 3
ORDER BY
  CASE c.voicemail_intent
    WHEN 'emergency' THEN 1
    WHEN 'appointment' THEN 2
    WHEN 'callback' THEN 3
    WHEN 'inquiry' THEN 4
    ELSE 5
  END,
  c.created_at DESC;

-- =============================================
-- 6. ADMIN VIEW - ALL LEADS ACROSS CLIENTS
-- =============================================
CREATE OR REPLACE VIEW v_admin_leads AS
SELECT
  l.id,
  l.user_id,
  u.practice_name,
  u.email as client_email,
  l.name,
  l.phone,
  l.email,
  l.reason,
  l.status,
  l.priority,
  l.source,
  l.appointment_booked,
  l.created_at
FROM leads l
JOIN users u ON l.user_id = u.id
ORDER BY l.created_at DESC;

-- =============================================
-- 7. ADMIN STATS VIEW
-- =============================================
CREATE OR REPLACE VIEW v_admin_stats AS
SELECT
  (SELECT COUNT(*) FROM users WHERE is_admin = false) as total_clients,
  (SELECT COUNT(*) FROM calls) as total_calls,
  (SELECT COUNT(*) FROM calls WHERE voicemail_url IS NOT NULL) as total_voicemails,
  (SELECT COUNT(*) FROM leads) as total_leads,
  (SELECT COUNT(*) FROM leads WHERE status = 'converted') as converted_leads,
  (SELECT COUNT(*) FROM appointments) as total_appointments,
  (SELECT COUNT(*) FROM appointments WHERE status = 'scheduled') as upcoming_appointments;

-- =============================================
-- DONE! Admin system is ready
--
-- IMPORTANT: After running this, set yourself as admin:
-- UPDATE users SET is_admin = true WHERE email = 'your@email.com';
-- =============================================
