-- SmileDesk Migration V3 - OTP for Password Reset
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. OTP CODES TABLE (For password reset via SMS)
-- =============================================
CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  reset_token UUID DEFAULT uuid_generate_v4(),
  verified BOOLEAN DEFAULT false,
  attempts INTEGER DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON otp_codes(phone);
CREATE INDEX IF NOT EXISTS idx_otp_codes_reset_token ON otp_codes(reset_token);
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires ON otp_codes(expires_at);

-- =============================================
-- 2. FUNCTION TO CLEAN UP EXPIRED OTPs
-- =============================================
CREATE OR REPLACE FUNCTION cleanup_expired_otps()
RETURNS void AS $$
BEGIN
  DELETE FROM otp_codes WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- DONE! Run the forgot password flow now
-- =============================================
