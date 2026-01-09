-- Migration v11: Performance indexes, delivery tracking, and idempotency
-- Run this in Supabase SQL Editor or your database client

-- ================================================
-- STEP 1: ADD NEW COLUMNS FIRST
-- ================================================

-- Add external message ID for idempotency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'external_message_id'
  ) THEN
    ALTER TABLE messages ADD COLUMN external_message_id VARCHAR(255);
  END IF;
END $$;

-- Add delivery status tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'delivery_status'
  ) THEN
    ALTER TABLE messages ADD COLUMN delivery_status VARCHAR(50) DEFAULT 'pending';
  END IF;
END $$;

-- Add delivery timestamp
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'delivered_at'
  ) THEN
    ALTER TABLE messages ADD COLUMN delivered_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add delivery error tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'delivery_error'
  ) THEN
    ALTER TABLE messages ADD COLUMN delivery_error TEXT;
  END IF;
END $$;

-- Add provider (vonage, cellcast, twilio)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'provider'
  ) THEN
    ALTER TABLE messages ADD COLUMN provider VARCHAR(50);
  END IF;
END $$;

-- Add state_data to conversations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'state_data'
  ) THEN
    ALTER TABLE conversations ADD COLUMN state_data JSONB DEFAULT '{}';
  END IF;
END $$;

-- Add last_activity_at to conversations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'last_activity_at'
  ) THEN
    ALTER TABLE conversations ADD COLUMN last_activity_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Add last_sms_at to conversations for cooldown tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'last_sms_at'
  ) THEN
    ALTER TABLE conversations ADD COLUMN last_sms_at TIMESTAMPTZ;
  END IF;
END $$;

-- ================================================
-- STEP 2: CREATE INDEXES (after columns exist)
-- ================================================

-- Conversations: Fast lookup by user and phone
CREATE INDEX IF NOT EXISTS idx_conversations_user_phone
ON conversations(user_id, caller_phone);

-- Conversations: Fast lookup for active conversations
CREATE INDEX IF NOT EXISTS idx_conversations_status_active
ON conversations(status)
WHERE status NOT IN ('completed', 'appointment_booked');

-- Appointments: Fast lookup by date and user (for slot availability)
CREATE INDEX IF NOT EXISTS idx_appointments_user_date
ON appointments(user_id, appointment_date, appointment_time);

-- Appointments: Fast lookup for upcoming appointments
CREATE INDEX IF NOT EXISTS idx_appointments_upcoming
ON appointments(user_id, appointment_date)
WHERE status NOT IN ('cancelled', 'no_show');

-- Messages: Fast lookup by conversation (for state retrieval)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
ON messages(conversation_id, created_at DESC);

-- Messages: Fast lookup by external ID (for idempotency and delivery tracking)
CREATE INDEX IF NOT EXISTS idx_messages_external_id
ON messages(external_message_id)
WHERE external_message_id IS NOT NULL;

-- Leads: Fast lookup by conversation
CREATE INDEX IF NOT EXISTS idx_leads_conversation
ON leads(conversation_id)
WHERE conversation_id IS NOT NULL;

-- Leads: Fast lookup for stale leads (auto-flag job)
CREATE INDEX IF NOT EXISTS idx_leads_status_created
ON leads(status, created_at)
WHERE status = 'new';

-- Calls: Fast lookup for stale calls (auto-flag job)
CREATE INDEX IF NOT EXISTS idx_calls_followup_created
ON calls(followup_status, created_at)
WHERE followup_status IN ('pending', 'in_progress');

-- Calls: Fast lookup by user and recent
CREATE INDEX IF NOT EXISTS idx_calls_user_created
ON calls(user_id, created_at DESC);

-- ================================================
-- STEP 3: ADD UNIQUE CONSTRAINT FOR IDEMPOTENCY
-- ================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_external_message_id_unique'
  ) THEN
    ALTER TABLE messages
    ADD CONSTRAINT messages_external_message_id_unique
    UNIQUE (external_message_id);
  END IF;
EXCEPTION
  WHEN duplicate_table THEN
    NULL;
END $$;

-- ================================================
-- STEP 4: ADD COLUMN COMMENTS
-- ================================================

COMMENT ON COLUMN messages.external_message_id IS 'External provider message ID for idempotency and tracking';
COMMENT ON COLUMN messages.delivery_status IS 'Delivery status: pending, sent, delivered, failed';
COMMENT ON COLUMN messages.provider IS 'SMS provider: vonage, cellcast, twilio';
COMMENT ON COLUMN conversations.state_data IS 'JSON state data for conversation flow';
COMMENT ON COLUMN conversations.last_activity_at IS 'Last activity timestamp for timeout tracking';
COMMENT ON COLUMN conversations.last_sms_at IS 'Last SMS sent timestamp for cooldown';

-- ================================================
-- STEP 5: UPDATE EXISTING DATA
-- ================================================

-- Set provider for existing messages based on twilio_sid
UPDATE messages
SET provider = 'twilio'
WHERE twilio_sid IS NOT NULL AND provider IS NULL;

-- Set delivery_status for existing delivered messages
UPDATE messages
SET delivery_status = 'delivered'
WHERE delivered = true AND delivery_status = 'pending';

-- Set last_activity_at from existing data
UPDATE conversations
SET last_activity_at = COALESCE(ended_at, created_at)
WHERE last_activity_at IS NULL;
