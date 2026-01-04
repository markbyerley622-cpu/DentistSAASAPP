-- SmileDesk Migration V2
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. BOOKING SLOTS TABLE (Manual time slots)
-- =============================================
CREATE TABLE IF NOT EXISTS booking_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week VARCHAR(20) NOT NULL, -- 'monday', 'tuesday', etc.
  time_slot VARCHAR(20) NOT NULL, -- '10:00 AM', '2:30 PM'
  duration_minutes INTEGER DEFAULT 30,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_booking_slots_user_id ON booking_slots(user_id);
CREATE INDEX IF NOT EXISTS idx_booking_slots_day ON booking_slots(day_of_week);

-- =============================================
-- 2. CONVERSATIONS TABLE (AI chat history)
-- =============================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  caller_phone VARCHAR(50) NOT NULL,
  channel VARCHAR(20) DEFAULT 'sms', -- 'sms', 'voice', 'whatsapp'
  direction VARCHAR(20) DEFAULT 'outbound', -- 'inbound', 'outbound'
  status VARCHAR(30) DEFAULT 'active', -- 'active', 'completed', 'appointment_booked', 'no_response', 'callback_requested'
  started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_call_id ON conversations(call_id);
CREATE INDEX IF NOT EXISTS idx_conversations_lead_id ON conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_caller_phone ON conversations(caller_phone);

-- =============================================
-- 3. MESSAGES TABLE (Individual messages in conversations)
-- =============================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender VARCHAR(20) NOT NULL, -- 'ai', 'caller', 'system'
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text', -- 'text', 'audio', 'system'
  twilio_sid VARCHAR(255), -- Twilio message/call SID
  delivered BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- =============================================
-- 4. APPOINTMENTS TABLE (Booked appointments)
-- =============================================
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  patient_name VARCHAR(255) NOT NULL,
  patient_phone VARCHAR(50) NOT NULL,
  patient_email VARCHAR(255),
  appointment_date DATE NOT NULL,
  appointment_time VARCHAR(20) NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  reason VARCHAR(255),
  notes TEXT,
  status VARCHAR(30) DEFAULT 'scheduled', -- 'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'
  google_event_id VARCHAR(255), -- If synced to Google Calendar
  reminder_sent BOOLEAN DEFAULT false,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appointments_user_id ON appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_lead_id ON appointments(lead_id);

-- =============================================
-- 5. UPDATE CALLS TABLE (Add missed call tracking)
-- =============================================
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_missed BOOLEAN DEFAULT false;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS followup_status VARCHAR(30) DEFAULT 'pending'; -- 'pending', 'in_progress', 'completed', 'no_response'
ALTER TABLE calls ADD COLUMN IF NOT EXISTS followup_attempts INTEGER DEFAULT 0;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;

-- =============================================
-- 6. UPDATE LEADS TABLE (Better status tracking)
-- =============================================
-- Update status options: 'new', 'contacted', 'responding', 'interested', 'booked', 'no_answer', 'not_interested'
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_attempts INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'missed_call'; -- 'missed_call', 'website', 'referral', 'manual'

-- =============================================
-- 7. UPDATE SETTINGS TABLE (Add AI config)
-- =============================================
ALTER TABLE settings ADD COLUMN IF NOT EXISTS followup_delay_minutes INTEGER DEFAULT 2; -- Wait before AI follows up
ALTER TABLE settings ADD COLUMN IF NOT EXISTS max_followup_attempts INTEGER DEFAULT 3;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS followup_channel VARCHAR(20) DEFAULT 'sms'; -- 'sms', 'call', 'both'
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ai_personality VARCHAR(50) DEFAULT 'professional'; -- 'professional', 'friendly', 'casual'
ALTER TABLE settings ADD COLUMN IF NOT EXISTS callback_offer BOOLEAN DEFAULT true; -- Offer callback if no slots work

-- Set ai_greeting to NULL if it's the old default (so frontend shows personalized version)
UPDATE settings
SET ai_greeting = NULL
WHERE ai_greeting = 'Hello! Thank you for calling. This is the AI assistant for the dental practice. How can I help you today?';

-- =============================================
-- 8. UPDATE USERS TABLE (Default to Australian timezone)
-- =============================================
ALTER TABLE users ALTER COLUMN timezone SET DEFAULT 'Australia/Sydney';

-- =============================================
-- 9. TRIGGERS FOR updated_at
-- =============================================
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_appointments_updated_at ON appointments;
CREATE TRIGGER update_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- 10. USEFUL VIEWS
-- =============================================

-- View: Today's missed calls needing follow-up
CREATE OR REPLACE VIEW v_pending_followups AS
SELECT
  c.id,
  c.user_id,
  c.caller_phone,
  c.caller_name,
  c.created_at as missed_at,
  c.followup_attempts,
  u.practice_name,
  s.followup_delay_minutes,
  s.max_followup_attempts,
  s.followup_channel
FROM calls c
JOIN users u ON c.user_id = u.id
JOIN settings s ON s.user_id = u.id
WHERE c.is_missed = true
  AND c.followup_status = 'pending'
  AND c.followup_attempts < s.max_followup_attempts
  AND c.created_at > NOW() - INTERVAL '24 hours';

-- View: Dashboard stats
CREATE OR REPLACE VIEW v_dashboard_stats AS
SELECT
  user_id,
  COUNT(*) FILTER (WHERE is_missed = true AND created_at > NOW() - INTERVAL '24 hours') as missed_calls_24h,
  COUNT(*) FILTER (WHERE followup_status = 'completed' AND created_at > NOW() - INTERVAL '24 hours') as responses_24h,
  COUNT(*) FILTER (WHERE followup_status = 'no_response' AND created_at > NOW() - INTERVAL '24 hours') as no_answer_24h
FROM calls
GROUP BY user_id;

-- =============================================
-- DONE! Your database is now ready for full Twilio integration
-- =============================================
