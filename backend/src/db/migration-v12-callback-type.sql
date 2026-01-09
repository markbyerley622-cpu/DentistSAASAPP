-- Migration v12: Callback Type Classification for Missed Calls
-- This migration adds callback_type to support intent classification
-- and receptionist_status for the simplified checklist workflow
--
-- Run this in Supabase SQL Editor or your database client

-- ================================================
-- STEP 1: ADD NEW COLUMNS TO calls TABLE
-- ================================================

-- callback_type: Classification of what the caller wants
-- Values: 'appointment_request' or 'general_callback'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calls' AND column_name = 'callback_type'
  ) THEN
    ALTER TABLE calls ADD COLUMN callback_type VARCHAR(30);
  END IF;
END $$;

-- handled_by_ai: Whether AI successfully sent SMS and got a response
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calls' AND column_name = 'handled_by_ai'
  ) THEN
    ALTER TABLE calls ADD COLUMN handled_by_ai BOOLEAN DEFAULT false;
  END IF;
END $$;

-- receptionist_status: Simple workflow status for receptionist
-- Values: 'pending' (needs action) or 'done' (handled)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calls' AND column_name = 'receptionist_status'
  ) THEN
    ALTER TABLE calls ADD COLUMN receptionist_status VARCHAR(20) DEFAULT 'pending';
  END IF;
END $$;

-- marked_done_at: When the receptionist marked this call as done
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calls' AND column_name = 'marked_done_at'
  ) THEN
    ALTER TABLE calls ADD COLUMN marked_done_at TIMESTAMPTZ;
  END IF;
END $$;

-- marked_done_by: Which user marked this as done (audit trail)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calls' AND column_name = 'marked_done_by'
  ) THEN
    ALTER TABLE calls ADD COLUMN marked_done_by UUID;
  END IF;
END $$;

-- ================================================
-- STEP 2: ADD callback_type TO leads TABLE
-- ================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'callback_type'
  ) THEN
    ALTER TABLE leads ADD COLUMN callback_type VARCHAR(30);
  END IF;
END $$;

-- ================================================
-- STEP 3: CREATE INDEXES FOR PERFORMANCE
-- ================================================

-- Index for active missed calls (pending receptionist action)
-- This is the main query for the Missed Calls table
CREATE INDEX IF NOT EXISTS idx_calls_receptionist_pending
ON calls(user_id, receptionist_status, created_at DESC)
WHERE receptionist_status = 'pending' AND is_missed = true;

-- Index for history view (completed calls)
CREATE INDEX IF NOT EXISTS idx_calls_receptionist_done
ON calls(user_id, marked_done_at DESC)
WHERE receptionist_status = 'done';

-- Index for callback_type reporting/filtering
CREATE INDEX IF NOT EXISTS idx_calls_callback_type
ON calls(user_id, callback_type)
WHERE callback_type IS NOT NULL;

-- Index for handled_by_ai filtering
CREATE INDEX IF NOT EXISTS idx_calls_handled_by_ai
ON calls(user_id, handled_by_ai)
WHERE is_missed = true;

-- ================================================
-- STEP 4: ADD COLUMN COMMENTS FOR DOCUMENTATION
-- ================================================

COMMENT ON COLUMN calls.callback_type IS 'Intent classification: appointment_request or general_callback';
COMMENT ON COLUMN calls.handled_by_ai IS 'Whether AI sent SMS follow-up and patient replied';
COMMENT ON COLUMN calls.receptionist_status IS 'Receptionist workflow status: pending or done';
COMMENT ON COLUMN calls.marked_done_at IS 'Timestamp when receptionist marked call as done';
COMMENT ON COLUMN calls.marked_done_by IS 'User ID of receptionist who marked call as done';
COMMENT ON COLUMN leads.callback_type IS 'Intent classification from SMS reply';

-- ================================================
-- STEP 5: BACKFILL EXISTING DATA
-- ================================================

-- Set receptionist_status based on existing followup_status
UPDATE calls
SET receptionist_status = CASE
  WHEN followup_status = 'completed' THEN 'done'
  WHEN followup_status = 'no_response' THEN 'pending'
  ELSE 'pending'
END
WHERE receptionist_status IS NULL;

-- Set handled_by_ai = true for calls that have conversations with patient replies
UPDATE calls c
SET handled_by_ai = true
WHERE EXISTS (
  SELECT 1 FROM conversations conv
  JOIN messages m ON m.conversation_id = conv.id
  WHERE conv.call_id = c.id AND m.sender = 'patient'
) AND (handled_by_ai IS NULL OR handled_by_ai = false);

-- Also mark handled_by_ai = true if SMS was sent (conversation exists)
UPDATE calls c
SET handled_by_ai = true
WHERE EXISTS (
  SELECT 1 FROM conversations conv
  WHERE conv.call_id = c.id
) AND handled_by_ai IS NULL;

-- Infer callback_type from existing lead data
UPDATE calls
SET callback_type = CASE
  WHEN l.preferred_time ILIKE '%callback%' THEN 'general_callback'
  WHEN l.appointment_booked = true THEN 'appointment_request'
  ELSE NULL
END
FROM leads l
WHERE l.call_id = calls.id AND calls.callback_type IS NULL;

-- Also infer from conversation status
UPDATE calls
SET callback_type = CASE
  WHEN conv.status = 'callback_requested' THEN 'general_callback'
  WHEN conv.status = 'appointment_booked' THEN 'appointment_request'
  ELSE calls.callback_type
END
FROM conversations conv
WHERE conv.call_id = calls.id AND calls.callback_type IS NULL;

-- Update leads table callback_type to match
UPDATE leads l
SET callback_type = c.callback_type
FROM calls c
WHERE l.call_id = c.id AND l.callback_type IS NULL AND c.callback_type IS NOT NULL;

-- Set marked_done_at for already completed calls
UPDATE calls
SET marked_done_at = updated_at
WHERE receptionist_status = 'done' AND marked_done_at IS NULL;

-- ================================================
-- VERIFICATION QUERIES (run these to check migration)
-- ================================================

-- Check column existence:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'calls' AND column_name IN ('callback_type', 'handled_by_ai', 'receptionist_status', 'marked_done_at', 'marked_done_by');

-- Check index existence:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'calls' AND indexname LIKE 'idx_calls_%';

-- Check data distribution:
-- SELECT receptionist_status, COUNT(*) FROM calls WHERE is_missed = true GROUP BY receptionist_status;
-- SELECT callback_type, COUNT(*) FROM calls WHERE callback_type IS NOT NULL GROUP BY callback_type;
