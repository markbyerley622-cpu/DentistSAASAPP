-- Migration v12b: Update ai_greeting to new simplified SMS format
-- This sets the new callback-only message for all users
-- Run this AFTER migration-v12-callback-type.sql

-- ================================================
-- UPDATE ALL AI GREETINGS TO NEW FORMAT
-- ================================================

-- Update all settings with the new SMS message
-- Uses practice_name from users table for personalization
UPDATE settings s
SET ai_greeting = 'Hi! This is ' || COALESCE(u.practice_name, 'our practice') || '. We missed your call.

Reply 1 for appointment request or 2 for other enquiry. We''ll call you back shortly.',
    updated_at = NOW()
FROM users u
WHERE s.user_id = u.id;

-- ================================================
-- VERIFICATION
-- ================================================

-- Run this to verify the update:
-- SELECT u.practice_name, s.ai_greeting FROM settings s JOIN users u ON s.user_id = u.id;
