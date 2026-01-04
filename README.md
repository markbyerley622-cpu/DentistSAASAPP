# SmileDesk

Never miss a call again. Instant AI follow-up for every missed call at your dental practice.

## Features

- **AI Phone Receptionist** - 24/7 automated call handling with Twilio integration
- **Smart Lead Capture** - Automatic lead creation from incoming calls
- **Call Transcription** - AI-powered transcription and summarization
- **Appointment Booking** - Google Calendar integration for scheduling
- **Analytics Dashboard** - Track calls, leads, and conversion rates
- **Modern UI** - Sleek, dark-themed dashboard with glassmorphism effects

## Tech Stack

**Backend:**
- Node.js + Express
- PostgreSQL
- JWT Authentication
- Twilio API
- Google Calendar API

**Frontend:**
- React 18 + Vite
- TailwindCSS
- React Router
- Axios
- Lucide Icons

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Twilio Account (for phone features)
- Google Cloud Project (for calendar integration)

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Update the `.env` file with your configuration:
```env
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=dentistai
DB_USER=postgres
DB_PASSWORD=your_password

# JWT
JWT_SECRET=your-super-secret-key
JWT_EXPIRES_IN=7d

# Twilio (optional for phone features)
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token

# Google Calendar (optional for booking)
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3001/api/calendar/callback
```

5. Create the database:
```bash
createdb dentistai
```

6. Run migrations:
```bash
npm run migrate
```

7. Start the server:
```bash
npm run dev
```

The API will be running at `http://localhost:3001`

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The app will be running at `http://localhost:5173`

## Project Structure

```
dentistSAAS/
├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   ├── config.js      # Database connection
│   │   │   └── migrate.js     # Database migrations
│   │   ├── middleware/
│   │   │   └── auth.js        # JWT authentication
│   │   ├── routes/
│   │   │   ├── auth.js        # Authentication routes
│   │   │   ├── calls.js       # Call management
│   │   │   ├── leads.js       # Lead management
│   │   │   ├── twilio.js      # Twilio webhooks
│   │   │   ├── calendar.js    # Google Calendar
│   │   │   ├── analytics.js   # Analytics data
│   │   │   └── settings.js    # User settings
│   │   └── index.js           # Express server
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── Layout.jsx     # Main layout with sidebar
│   │   ├── context/
│   │   │   └── AuthContext.jsx
│   │   ├── lib/
│   │   │   └── api.js         # Axios API client
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Register.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Calls.jsx
│   │   │   ├── Leads.jsx
│   │   │   └── Settings.jsx
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── public/
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
└── README.md
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile
- `PUT /api/auth/password` - Change password

### Calls
- `GET /api/calls` - List calls (with pagination, filtering)
- `GET /api/calls/:id` - Get call details
- `PUT /api/calls/:id` - Update call
- `DELETE /api/calls/:id` - Delete call

### Leads
- `GET /api/leads` - List leads
- `GET /api/leads/stats` - Get lead statistics
- `GET /api/leads/:id` - Get lead details
- `POST /api/leads` - Create lead
- `PUT /api/leads/:id` - Update lead
- `DELETE /api/leads/:id` - Delete lead

### Analytics
- `GET /api/analytics/overview` - Dashboard stats
- `GET /api/analytics/calls-by-day` - Calls chart data
- `GET /api/analytics/leads-by-status` - Lead funnel
- `GET /api/analytics/call-reasons` - Call reasons breakdown

### Settings
- `GET /api/settings` - Get settings
- `PUT /api/settings` - Update settings
- `PUT /api/settings/twilio` - Update Twilio config
- `PUT /api/settings/business-hours` - Update hours
- `PUT /api/settings/ai-greeting` - Update AI greeting

### Calendar
- `GET /api/calendar/auth-url` - Get Google OAuth URL
- `GET /api/calendar/status` - Check connection status
- `POST /api/calendar/disconnect` - Disconnect calendar
- `GET /api/calendar/events` - Get events
- `POST /api/calendar/events` - Create event

## Twilio Webhook URLs

Configure these in your Twilio console:

- **Voice URL:** `https://your-domain.com/api/twilio/voice/incoming`
- **Status Callback:** `https://your-domain.com/api/twilio/call-status`

## License

MIT
