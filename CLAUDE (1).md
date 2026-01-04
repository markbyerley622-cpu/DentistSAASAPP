# CLAUDE.md - DentistAI SaaS Project Instructions

## Project Overview

You are building **DentistAI** - a lean SaaS that helps dental practices never miss a patient call. The core value prop is simple: "Never miss a new patient call again."

### The Problem We Solve
- Front desk misses calls (lunch, busy, after hours)
- Missed calls = lost new patients
- Each new patient ≈ $300–$3,000 lifetime value

### Core Product (V1 Scope)
1. **Call Capture**: Forward missed calls to AI agent via Twilio (uses their existing number)
2. **AI Voice Agent**: Greets caller, asks name + reason, offers to book or request callback
3. **Appointment Handling**: Book into Google Calendar OR send details to front desk via SMS/email
4. **Instant Notifications**: SMS/email alerts with caller details
5. **Dashboard**: Call logs, lead details, conversion metrics

### What NOT to Build
- Full practice management system
- Chatbots everywhere
- Complex dashboards
- CRM replacement

Keep it lean and sellable.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Telephony** | Twilio Voice API |
| **Voice AI** | OpenAI Realtime API (or Whisper + TTS) |
| **Backend** | Node.js + Express |
| **Database** | PostgreSQL |
| **Frontend** | React + Vite + TailwindCSS |
| **Auth** | JWT + bcrypt |
| **Calendar** | Google Calendar API |
| **Notifications** | Twilio SMS + Nodemailer |

---

## Project Structure

```
dentist-ai-saas/
├── backend/
│   ├── server.js              # Express entry point
│   ├── package.json
│   ├── .env.example
│   ├── config/
│   │   └── database.js        # PostgreSQL connection
│   ├── middleware/
│   │   └── auth.js            # JWT authentication
│   ├── routes/
│   │   ├── auth.js            # Login/register/me
│   │   ├── calls.js           # Call logs CRUD
│   │   ├── leads.js           # Lead management
│   │   ├── twilio.js          # Twilio webhooks
│   │   ├── calendar.js        # Google Calendar OAuth + booking
│   │   ├── analytics.js       # Dashboard stats
│   │   └── settings.js        # Practice settings
│   ├── services/
│   │   ├── ai-agent.js        # OpenAI voice agent logic
│   │   ├── twilio.js          # Twilio helper functions
│   │   ├── calendar.js        # Google Calendar service
│   │   ├── notifications.js   # SMS/email sending
│   │   └── transcription.js   # Call transcription
│   └── database/
│       ├── migrate.js         # Schema migrations
│       └── seed.js            # Test data
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── .env.example
│   └── src/
│       ├── main.jsx           # React entry
│       ├── App.jsx            # Router setup
│       ├── index.css          # Tailwind imports
│       ├── components/
│       │   ├── Layout.jsx     # Dashboard layout
│       │   ├── Sidebar.jsx    # Navigation
│       │   ├── Header.jsx     # Top bar
│       │   ├── CallCard.jsx   # Call log item
│       │   ├── LeadCard.jsx   # Lead item
│       │   ├── StatsCard.jsx  # Analytics card
│       │   └── Modal.jsx      # Reusable modal
│       ├── pages/
│       │   ├── Login.jsx
│       │   ├── Register.jsx
│       │   ├── Dashboard.jsx  # Overview stats
│       │   ├── Calls.jsx      # Call logs
│       │   ├── Leads.jsx      # Lead management
│       │   ├── Calendar.jsx   # Google Calendar integration
│       │   └── Settings.jsx   # Practice settings
│       ├── hooks/
│       │   ├── useAuth.js     # Auth context
│       │   └── useApi.js      # API fetch wrapper
│       └── utils/
│           ├── api.js         # Axios instance
│           └── helpers.js     # Formatters, etc.
└── CLAUDE.md                  # This file
```

---

## Database Schema

### users
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  practice_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  timezone VARCHAR(50) DEFAULT 'America/New_York',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### settings
```sql
CREATE TABLE settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  twilio_phone VARCHAR(20),
  notification_email VARCHAR(255),
  notification_sms VARCHAR(20),
  booking_mode VARCHAR(20) DEFAULT 'notify', -- 'notify' or 'book'
  business_hours JSONB,
  google_calendar_connected BOOLEAN DEFAULT FALSE,
  google_tokens JSONB
);
```

### calls
```sql
CREATE TABLE calls (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  twilio_call_sid VARCHAR(100),
  caller_phone VARCHAR(20),
  caller_name VARCHAR(255),
  call_reason TEXT,
  duration INTEGER,
  recording_url TEXT,
  transcription TEXT,
  status VARCHAR(20) DEFAULT 'new', -- new, contacted, converted, lost
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### leads
```sql
CREATE TABLE leads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  call_id INTEGER REFERENCES calls(id),
  name VARCHAR(255),
  phone VARCHAR(20),
  email VARCHAR(255),
  reason TEXT,
  preferred_time TEXT,
  appointment_booked BOOLEAN DEFAULT FALSE,
  appointment_time TIMESTAMP,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'new', -- new, contacted, booked, lost
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Endpoints

### Auth
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login, returns JWT
- `GET /api/auth/me` - Get current user

### Calls
- `GET /api/calls` - List calls (paginated)
- `GET /api/calls/:id` - Get call details
- `PATCH /api/calls/:id` - Update call status

### Leads
- `GET /api/leads` - List leads
- `GET /api/leads/:id` - Get lead details
- `PATCH /api/leads/:id` - Update lead
- `POST /api/leads/:id/book` - Book appointment

### Twilio Webhooks
- `POST /api/twilio/voice` - Handle incoming call
- `POST /api/twilio/status` - Call status callback
- `POST /api/twilio/transcription` - Transcription callback

### Calendar
- `GET /api/calendar/auth` - Start Google OAuth
- `GET /api/calendar/callback` - OAuth callback
- `GET /api/calendar/slots` - Get available slots
- `POST /api/calendar/book` - Book appointment

### Analytics
- `GET /api/analytics/overview` - Dashboard stats
- `GET /api/analytics/calls` - Call metrics
- `GET /api/analytics/conversions` - Conversion rates

### Settings
- `GET /api/settings` - Get practice settings
- `PUT /api/settings` - Update settings

---

## AI Voice Agent Behavior

The AI agent does ONLY these 3 things:
1. **Greet**: "Hi, thanks for calling [Practice Name]. I'm an automated assistant. How can I help you today?"
2. **Capture Info**: Ask for name, phone (if not captured), reason for calling
3. **Offer Next Step**: "Would you like me to have someone call you back, or would you like to schedule an appointment?"

**DO NOT**:
- Give medical/dental advice
- Diagnose anything
- Make promises about treatment
- Handle emergencies (direct to 911)

---

## Key Implementation Notes

### Twilio Voice Flow
```
1. Missed call → Forwarded to Twilio number
2. Twilio hits /api/twilio/voice webhook
3. Return TwiML to connect to AI agent (or use <Gather> for simple flow)
4. Capture caller info via speech recognition
5. Save to database
6. Send notification to practice
7. Optionally book into Google Calendar
```

### Google Calendar Integration
```
1. User clicks "Connect Google Calendar" in settings
2. Redirect to Google OAuth consent
3. Store refresh token securely
4. Fetch available slots based on business hours
5. Create calendar events when booking
```

### Notification Flow
```
1. Call ends → Webhook triggered
2. Extract caller name, phone, reason
3. Send SMS to practice notification number
4. Send email to practice notification email
5. Update dashboard in real-time (optional: WebSocket)
```

---

## Environment Variables

### Backend (.env)
```
PORT=3001
DATABASE_URL=postgresql://localhost:5432/dentist_ai
JWT_SECRET=your-secret-key
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1xxx
OPENAI_API_KEY=sk-xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=http://localhost:3001/api/calendar/callback
SMTP_HOST=smtp.gmail.com
SMTP_USER=xxx
SMTP_PASS=xxx
FRONTEND_URL=http://localhost:5173
```

### Frontend (.env)
```
VITE_API_URL=http://localhost:3001/api
```

---

## Commands

```bash
# Backend
cd backend
npm install
npm run dev          # Start dev server with nodemon
npm run db:migrate   # Run migrations
npm run db:seed      # Seed test data

# Frontend
cd frontend
npm install
npm run dev          # Start Vite dev server
npm run build        # Production build
```

---

## Styling Guidelines

- Use **TailwindCSS** for all styling
- Color scheme: Professional blue/teal (dental/medical feel)
- Keep dashboard clean and minimal
- Mobile-responsive (dentists check on phones)
- Use shadcn/ui components if needed

---

## Priority Order for Building

1. **Database + Auth** - Get login working first
2. **Dashboard Layout** - Shell with sidebar navigation
3. **Settings Page** - Twilio number config
4. **Twilio Webhook** - Basic call handling
5. **Call Logs** - Display incoming calls
6. **Notifications** - SMS/email on new calls
7. **AI Voice Agent** - Enhance with OpenAI
8. **Google Calendar** - OAuth + booking
9. **Analytics** - Dashboard stats

---

## Testing Checklist

- [ ] Can register new practice account
- [ ] Can login and see dashboard
- [ ] Twilio webhook receives calls
- [ ] Calls are logged to database
- [ ] SMS notification sent on missed call
- [ ] Email notification sent on missed call
- [ ] Can view call history
- [ ] Can update lead status
- [ ] Google Calendar connects via OAuth
- [ ] Can book appointment to calendar
- [ ] Dashboard shows correct stats

---

## Common Issues & Solutions

**Twilio webhook not working**: Make sure to use ngrok for local development and update Twilio webhook URL.

**Google OAuth fails**: Check redirect URI matches exactly in Google Cloud Console.

**Calls not logging**: Verify DATABASE_URL is correct and migrations ran.

**SMS not sending**: Check Twilio credentials and verify phone number format (+1XXXXXXXXXX).

---

## Remember

> "We are not building 'AI for dentists' in general. We're building one boring money printer: Never miss a new patient call again."

Keep it lean. Ship fast. Sell before perfecting.
