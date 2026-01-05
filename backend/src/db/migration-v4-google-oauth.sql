-- SmileDesk Migration V4 - Per-User Google OAuth Credentials
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
-- DONE! Users can now configure their own Google Calendar integration
-- =============================================
