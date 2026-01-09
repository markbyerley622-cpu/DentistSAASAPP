-- Migration v12b: Reset ai_greeting to use dynamic code default
-- This clears custom greetings so the new simplified SMS format is used
-- The code fallback in pbx.js dynamically inserts practice_name
-- Run this AFTER migration-v12-callback-type.sql

-- ================================================
-- RESET ALL AI GREETINGS TO NULL (uses code default)
-- ================================================

-- Set all ai_greeting to NULL so they use the dynamic default:
-- "Hi! This is {practice_name}. We missed your call.
--  Reply 1 for appointment or 2 for other. We'll call you back shortly."

UPDATE settings
SET ai_greeting = NULL,
    updated_at = NOW()
WHERE ai_greeting IS NOT NULL;

-- ================================================
-- The code fallback in pbx.js line 175-176 handles the message:
--
-- const followUpMessage = settings.ai_greeting ||
--   `Hi! This is ${practiceName}. We missed your call.\n\nReply 1 for appointment or 2 for other. We'll call you back shortly.`;
--
-- This ensures:
-- 1. Dynamic practice name from users table
-- 2. Single source of truth for the message template
-- 3. Easy to update in future (just change code)
-- ================================================

-- VERIFICATION: Check all settings now use NULL
-- SELECT COUNT(*) as total, COUNT(ai_greeting) as custom FROM settings;
-- Expected: custom = 0
