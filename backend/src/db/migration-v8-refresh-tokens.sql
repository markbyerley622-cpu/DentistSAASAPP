-- Migration V8: Add refresh tokens table for secure token refresh
-- Run this migration after v7-admin.sql

-- Create refresh_tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for token lookup
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- Auto-cleanup of expired tokens (optional - can be run periodically)
-- DELETE FROM refresh_tokens WHERE expires_at < NOW();

COMMENT ON TABLE refresh_tokens IS 'Stores refresh tokens for JWT token renewal';
COMMENT ON COLUMN refresh_tokens.token IS 'Random 128-character hex string';
COMMENT ON COLUMN refresh_tokens.expires_at IS '7-day expiry from creation';
