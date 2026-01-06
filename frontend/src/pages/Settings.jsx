import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { settingsAPI, calendarAPI, authAPI } from '../lib/api'
import {
  Settings as SettingsIcon,
  Building2,
  Phone,
  Bell,
  Calendar,
  Sparkles,
  Clock,
  Check,
  X,
  AlertCircle,
  Save,
  Loader2,
  Link2,
  Unlink
} from 'lucide-react'

function SettingsSection({ title, description, icon: Icon, children }) {
  return (
    <div className="card">
      <div className="flex items-start gap-4 mb-6">
        <div className="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-accent-400" />
        </div>
        <div>
          <h3 className="font-semibold text-dark-100">{title}</h3>
          <p className="text-sm text-dark-400 mt-1">{description}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors ${
        checked ? 'bg-accent-600' : 'bg-dark-700'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function SuccessMessage({ message, onClose }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-lg bg-success-500/10 border border-success-500/20 animate-slide-down">
      <Check className="w-5 h-5 text-success-400" />
      <p className="text-sm text-success-400 flex-1">{message}</p>
      <button onClick={onClose} className="text-success-400 hover:text-success-300">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

function ErrorMessage({ message, onClose }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-lg bg-danger-500/10 border border-danger-500/20 animate-slide-down">
      <AlertCircle className="w-5 h-5 text-danger-400" />
      <p className="text-sm text-danger-400 flex-1">{message}</p>
      <button onClick={onClose} className="text-danger-400 hover:text-danger-300">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

export default function Settings() {
  const { user, updateUser } = useAuth()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const [profile, setProfile] = useState({
    practiceName: '',
    phone: '',
    timezone: 'Australia/Sydney'
  })

  const [settings, setSettings] = useState({
    twilioPhone: '',
    forwardingPhone: '',
    twilioAccountSid: '',
    twilioAuthToken: '',
    notificationEmail: true,
    notificationSms: false,
    bookingMode: 'manual',
    aiGreeting: '',
    businessHours: {}
  })

  const [calendarConnected, setCalendarConnected] = useState(false)
  const [calendarCredentialsConfigured, setCalendarCredentialsConfigured] = useState(false)
  const [googleCredentials, setGoogleCredentials] = useState({ clientId: '', clientSecret: '' })
  const [savingGoogleCredentials, setSavingGoogleCredentials] = useState(false)
  const [savingBusinessHours, setSavingBusinessHours] = useState(false)

  const defaultBusinessHours = {
    monday: { enabled: true, open: '09:00', close: '17:00' },
    tuesday: { enabled: true, open: '09:00', close: '17:00' },
    wednesday: { enabled: true, open: '09:00', close: '17:00' },
    thursday: { enabled: true, open: '09:00', close: '17:00' },
    friday: { enabled: true, open: '09:00', close: '17:00' },
    saturday: { enabled: false, open: '09:00', close: '13:00' },
    sunday: { enabled: false, open: '09:00', close: '13:00' }
  }

  const [businessHours, setBusinessHours] = useState(defaultBusinessHours)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [settingsRes, calendarRes] = await Promise.all([
          settingsAPI.get(),
          calendarAPI.getStatus()
        ])

        setSettings({
          twilioPhone: settingsRes.data.settings.twilioPhone || '',
          forwardingPhone: settingsRes.data.settings.forwardingPhone || '',
          twilioAccountSid: settingsRes.data.settings.twilioAccountSid || '',
          twilioAuthToken: '',
          notificationEmail: settingsRes.data.settings.notificationEmail,
          notificationSms: settingsRes.data.settings.notificationSms,
          bookingMode: settingsRes.data.settings.bookingMode,
          aiGreeting: settingsRes.data.settings.aiGreeting || '',
          businessHours: settingsRes.data.settings.businessHours || {}
        })

        // Load business hours from settings or use defaults
        if (settingsRes.data.settings.businessHours && Object.keys(settingsRes.data.settings.businessHours).length > 0) {
          setBusinessHours(settingsRes.data.settings.businessHours)
        }

        setCalendarConnected(calendarRes.data.connected)
        setCalendarCredentialsConfigured(calendarRes.data.credentialsConfigured || false)

        setProfile({
          practiceName: user?.practiceName || '',
          phone: user?.phone || '',
          timezone: user?.timezone || 'Australia/Sydney'
        })
      } catch (error) {
        console.error('Failed to fetch settings:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()

    // Check for calendar connection callback
    const calendarStatus = searchParams.get('calendar')
    if (calendarStatus === 'success') {
      setSuccess('Google Calendar connected successfully!')
      setCalendarConnected(true)
    } else if (calendarStatus === 'error') {
      setError('Failed to connect Google Calendar. Please try again.')
    }
  }, [user, searchParams])

  const handleSaveProfile = async () => {
    setSaving(true)
    try {
      await authAPI.updateProfile(profile)
      updateUser(profile)
      setSuccess('Profile updated successfully!')
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      await settingsAPI.update({
        notificationEmail: settings.notificationEmail,
        notificationSms: settings.notificationSms,
        bookingMode: settings.bookingMode
      })
      setSuccess('Settings saved successfully!')
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveForwarding = async () => {
    if (!settings.forwardingPhone) {
      setError('Please enter your phone number')
      return
    }

    setSaving(true)
    try {
      await settingsAPI.updateForwarding({
        forwardingPhone: settings.forwardingPhone
      })
      setSuccess('Phone number saved!')
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to save phone number')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAiGreeting = async () => {
    setSaving(true)
    try {
      await settingsAPI.updateAiGreeting({ aiGreeting: settings.aiGreeting })
      setSuccess('AI greeting saved successfully!')
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to save AI greeting')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveGoogleCredentials = async () => {
    if (!googleCredentials.clientId || !googleCredentials.clientSecret) {
      setError('Please enter both Client ID and Client Secret')
      return
    }

    setSavingGoogleCredentials(true)
    try {
      await calendarAPI.saveCredentials({
        clientId: googleCredentials.clientId,
        clientSecret: googleCredentials.clientSecret
      })
      setCalendarCredentialsConfigured(true)
      setGoogleCredentials({ clientId: '', clientSecret: '' })
      setSuccess('Google OAuth credentials saved! You can now connect your calendar.')
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to save Google credentials')
    } finally {
      setSavingGoogleCredentials(false)
    }
  }

  const handleRemoveGoogleCredentials = async () => {
    try {
      await calendarAPI.removeCredentials()
      setCalendarCredentialsConfigured(false)
      setCalendarConnected(false)
      setSuccess('Google OAuth credentials removed')
    } catch (err) {
      setError('Failed to remove credentials')
    }
  }

  const handleConnectCalendar = async () => {
    try {
      const response = await calendarAPI.getAuthUrl()
      window.location.href = response.data.authUrl
    } catch (err) {
      if (err.response?.data?.error?.code === 'CREDENTIALS_NOT_CONFIGURED') {
        setError('Please configure your Google OAuth credentials first')
      } else {
        setError(err.response?.data?.error?.message || 'Failed to connect to Google Calendar')
      }
    }
  }

  const handleDisconnectCalendar = async () => {
    try {
      await calendarAPI.disconnect()
      setCalendarConnected(false)
      setSuccess('Google Calendar disconnected')
    } catch (err) {
      setError('Failed to disconnect calendar')
    }
  }

  const handleSaveBusinessHours = async () => {
    setSavingBusinessHours(true)
    try {
      await settingsAPI.updateBusinessHours({ businessHours })
      setSuccess('Business hours saved!')
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to save business hours')
    } finally {
      setSavingBusinessHours(false)
    }
  }

  const updateBusinessHoursDay = (day, field, value) => {
    setBusinessHours(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value
      }
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-dark-400 text-sm">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-dark-100">Settings</h1>
        <p className="text-dark-400 mt-1">
          Manage your practice settings and integrations
        </p>
      </div>

      {/* Alerts */}
      {success && (
        <SuccessMessage message={success} onClose={() => setSuccess('')} />
      )}
      {error && (
        <ErrorMessage message={error} onClose={() => setError('')} />
      )}

      {/* Practice Profile */}
      <SettingsSection
        title="Practice Profile"
        description="Basic information about your dental practice"
        icon={Building2}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">Practice Name</label>
              <input
                type="text"
                value={profile.practiceName}
                onChange={(e) => setProfile({ ...profile, practiceName: e.target.value })}
                className="input"
                placeholder="Sunshine Dental"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Phone Number</label>
              <input
                type="tel"
                value={profile.phone}
                onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                className="input"
                placeholder="(555) 123-4567"
              />
            </div>
          </div>
          <div className="input-group">
            <label className="input-label">Timezone</label>
            <select
              value={profile.timezone}
              onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
              className="input"
            >
              <optgroup label="Australian Mainland">
                <option value="Australia/Perth">Western Australia (AWST, UTC+8)</option>
                <option value="Australia/Adelaide">South Australia (ACST/ACDT, UTC+9:30)</option>
                <option value="Australia/Darwin">Northern Territory (ACST, UTC+9:30)</option>
                <option value="Australia/Brisbane">Queensland (AEST, UTC+10)</option>
                <option value="Australia/Sydney">New South Wales (AEST/AEDT, UTC+10)</option>
                <option value="Australia/Melbourne">Victoria (AEST/AEDT, UTC+10)</option>
                <option value="Australia/Hobart">Tasmania (AEST/AEDT, UTC+10)</option>
                <option value="Australia/Canberra">ACT - Canberra (AEST/AEDT, UTC+10)</option>
              </optgroup>
              <optgroup label="Australian Territories">
                <option value="Australia/Eucla">Eucla (ACWST, UTC+8:45)</option>
                <option value="Australia/Lord_Howe">Lord Howe Island (UTC+10:30)</option>
                <option value="Indian/Cocos">Cocos Islands (UTC+6:30)</option>
                <option value="Indian/Christmas">Christmas Island (UTC+7)</option>
              </optgroup>
            </select>
          </div>
          <button onClick={handleSaveProfile} disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="ml-2">Save Profile</span>
          </button>
        </div>
      </SettingsSection>

      {/* Twilio Phone Number */}
      <SettingsSection
        title="Your Twilio Number"
        description="This is your dedicated patient line - add it to your phone system"
        icon={Phone}
      >
        <div className="space-y-4">
          {settings.twilioPhone ? (
            <>
              <div className="p-4 rounded-lg bg-accent-500/10 border border-accent-500/20">
                <p className="text-xs text-accent-400 mb-2">Your Twilio Phone Number</p>
                <p className="text-2xl font-bold text-dark-100 tracking-wide">{settings.twilioPhone}</p>
              </div>
              <div className="p-3 rounded-lg bg-dark-800/50 border border-dark-700/50">
                <p className="text-sm text-dark-300">
                  Add this number to your phone system or give it to patients. Missed calls will trigger automatic SMS follow-ups.
                </p>
              </div>
            </>
          ) : (
            <div className="p-4 rounded-lg bg-warning-500/10 border border-warning-500/20">
              <p className="text-sm text-warning-400">
                No Twilio number assigned yet. Contact support to get your dedicated patient line set up.
              </p>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* Call Forwarding */}
      <SettingsSection
        title="Call Forwarding"
        description="Enter the phone number where patient calls should be forwarded"
        icon={Phone}
      >
        <div className="space-y-4">
          <div className="input-group">
            <label className="input-label">Your Phone Number</label>
            <input
              type="tel"
              value={settings.forwardingPhone || ''}
              onChange={(e) => setSettings({ ...settings, forwardingPhone: e.target.value })}
              className="input"
              placeholder="+61414855294"
            />
            <p className="text-xs text-dark-500 mt-1">
              Business or personal - calls ring here first. If you miss a call, the patient gets an automatic SMS follow-up.
            </p>
          </div>

          <button onClick={handleSaveForwarding} disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="ml-2">Save</span>
          </button>
        </div>
      </SettingsSection>

      {/* AI SMS Message */}
      <SettingsSection
        title="AI SMS Message"
        description="Customize the SMS message sent to patients"
        icon={Sparkles}
      >
        <div className="space-y-4">
          {/* Practice name badge */}
          <div className="p-3 rounded-lg bg-accent-500/10 border border-accent-500/20">
            <p className="text-xs text-accent-400">
              Your practice name <span className="font-semibold">"{user?.practiceName}"</span> is automatically included in messages.
            </p>
          </div>

          <div className="input-group">
            <label className="input-label">SMS Message</label>
            <textarea
              value={(() => {
                const practiceName = user?.practiceName || 'Our Practice';
                const defaultGreeting = `Hi! This is ${practiceName}. We missed your call and want to make sure we help you. Would you like us to call you back, or would you prefer to schedule an appointment? Just reply here!`;
                // If no greeting set, or it's an old default, use the new one
                if (!settings.aiGreeting ||
                    settings.aiGreeting.includes('the dental practice') ||
                    settings.aiGreeting.includes('for the dental practice') ||
                    settings.aiGreeting.includes('Thank you for calling') ||
                    settings.aiGreeting.includes('How can we help you today')) {
                  return defaultGreeting;
                }
                return settings.aiGreeting;
              })()}
              onChange={(e) => setSettings({ ...settings, aiGreeting: e.target.value })}
              rows={4}
              className="input resize-none"
              placeholder={`Hi! This is ${user?.practiceName || 'Our Practice'}. We missed your call and want to make sure we help you. Would you like us to call you back, or would you prefer to schedule an appointment? Just reply here!`}
            />
            <p className="text-xs text-dark-500 mt-2">
              This is the SMS message sent when following up on missed calls
            </p>
          </div>
          <button onClick={handleSaveAiGreeting} disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="ml-2">Save Message</span>
          </button>
        </div>
      </SettingsSection>

      {/* Notifications */}
      <SettingsSection
        title="Notifications"
        description="Choose how you want to be notified"
        icon={Bell}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-dark-800/50">
            <div>
              <p className="font-medium text-dark-200">Email Notifications</p>
              <p className="text-sm text-dark-400">Receive email alerts for new leads and calls</p>
            </div>
            <Toggle
              checked={settings.notificationEmail}
              onChange={(val) => setSettings({ ...settings, notificationEmail: val })}
            />
          </div>
          <div className="flex items-center justify-between p-4 rounded-lg bg-dark-800/50">
            <div>
              <p className="font-medium text-dark-200">SMS Notifications</p>
              <p className="text-sm text-dark-400">Receive text messages for urgent matters</p>
            </div>
            <Toggle
              checked={settings.notificationSms}
              onChange={(val) => setSettings({ ...settings, notificationSms: val })}
            />
          </div>
          <button onClick={handleSaveSettings} disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="ml-2">Save Notifications</span>
          </button>
        </div>
      </SettingsSection>

      {/* Google Calendar */}
      <SettingsSection
        title="Google Calendar"
        description="Connect your calendar for automatic appointment booking"
        icon={Calendar}
      >
        <div className="space-y-4">
          {/* Step 1: Setup Instructions */}
          {!calendarCredentialsConfigured && (
            <div className="p-4 rounded-lg bg-accent-500/10 border border-accent-500/20">
              <p className="text-sm font-medium text-accent-400 mb-2">Setup Required</p>
              <p className="text-xs text-accent-300/80 mb-3">
                To connect Google Calendar, you need to create your own Google OAuth credentials:
              </p>
              <ol className="text-xs text-accent-300/80 space-y-1 list-decimal list-inside mb-3">
                <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-accent-400">Google Cloud Console</a></li>
                <li>Create a new project or select an existing one</li>
                <li>Enable the "Google Calendar API"</li>
                <li>Configure the OAuth consent screen (External, add your email as test user)</li>
                <li>Go to "Credentials" and create an OAuth 2.0 Client ID (Web application)</li>
                <li>Add this redirect URI: <code className="bg-dark-800 px-1 rounded text-accent-400">{window.location.origin}/api/calendar/callback</code></li>
                <li>Copy the Client ID and Client Secret below</li>
              </ol>
              <div className="mt-3 p-2 rounded bg-warning-500/10 border border-warning-500/20">
                <p className="text-xs text-warning-400">
                  <strong>Note:</strong> New OAuth apps are in "Testing" mode and limited to 100 users.
                  For production use, submit your app for Google verification in the OAuth consent screen settings.
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Credentials Input */}
          {!calendarCredentialsConfigured ? (
            <div className="space-y-4">
              <div className="input-group">
                <label className="input-label">Google OAuth Client ID</label>
                <input
                  type="text"
                  value={googleCredentials.clientId}
                  onChange={(e) => setGoogleCredentials({ ...googleCredentials, clientId: e.target.value })}
                  className="input"
                  placeholder="xxxx.apps.googleusercontent.com"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Google OAuth Client Secret</label>
                <input
                  type="password"
                  value={googleCredentials.clientSecret}
                  onChange={(e) => setGoogleCredentials({ ...googleCredentials, clientSecret: e.target.value })}
                  className="input"
                  placeholder="Enter your client secret"
                />
              </div>
              <button
                onClick={handleSaveGoogleCredentials}
                disabled={savingGoogleCredentials}
                className="btn-primary flex items-center gap-2"
              >
                {savingGoogleCredentials ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Credentials
              </button>
            </div>
          ) : (
            <>
              {/* Credentials configured badge */}
              <div className="p-3 rounded-lg bg-success-500/10 border border-success-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success-400" />
                  <span className="text-sm text-success-400">Google OAuth credentials configured</span>
                </div>
                <button
                  onClick={handleRemoveGoogleCredentials}
                  className="text-xs text-dark-400 hover:text-danger-400 transition-colors"
                >
                  Remove
                </button>
              </div>

              {/* Step 3: Connect Calendar */}
              <div className="p-4 rounded-lg bg-dark-800/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${calendarConnected ? 'bg-success-500' : 'bg-dark-500'}`} />
                    <div>
                      <p className="font-medium text-dark-200">
                        {calendarConnected ? 'Connected' : 'Not Connected'}
                      </p>
                      <p className="text-sm text-dark-400">
                        {calendarConnected
                          ? 'Your Google Calendar is linked'
                          : 'Click to authorize access to your Google Calendar'}
                      </p>
                    </div>
                  </div>
                  {calendarConnected ? (
                    <button onClick={handleDisconnectCalendar} className="btn-secondary flex items-center gap-2">
                      <Unlink className="w-4 h-4" />
                      Disconnect
                    </button>
                  ) : (
                    <button onClick={handleConnectCalendar} className="btn-primary flex items-center gap-2">
                      <Link2 className="w-4 h-4" />
                      Connect Calendar
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </SettingsSection>

      {/* Booking Mode */}
      <SettingsSection
        title="Booking Mode"
        description="Control how appointments are scheduled"
        icon={Clock}
      >
        <div className="space-y-3">
          {[
            { value: 'manual', label: 'Manual', description: 'Review and confirm all appointments manually' },
            { value: 'auto', label: 'Automatic', description: 'AI books appointments directly to your calendar' },
            { value: 'suggest', label: 'Suggest Only', description: 'AI suggests times, you confirm' }
          ].map((mode) => (
            <label
              key={mode.value}
              className={`flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                settings.bookingMode === mode.value
                  ? 'bg-accent-500/10 border-accent-500/30'
                  : 'bg-dark-800/50 border-dark-700/50 hover:border-dark-600'
              }`}
            >
              <input
                type="radio"
                name="bookingMode"
                value={mode.value}
                checked={settings.bookingMode === mode.value}
                onChange={(e) => setSettings({ ...settings, bookingMode: e.target.value })}
                className="sr-only"
              />
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                settings.bookingMode === mode.value
                  ? 'border-accent-500 bg-accent-500'
                  : 'border-dark-500'
              }`}>
                {settings.bookingMode === mode.value && (
                  <Check className="w-3 h-3 text-white" />
                )}
              </div>
              <div>
                <p className="font-medium text-dark-200">{mode.label}</p>
                <p className="text-sm text-dark-400">{mode.description}</p>
              </div>
            </label>
          ))}
          <button onClick={handleSaveSettings} disabled={saving} className="btn-primary mt-4">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="ml-2">Save Booking Mode</span>
          </button>
        </div>
      </SettingsSection>

      {/* Business Hours */}
      <SettingsSection
        title="Business Hours"
        description="Set your practice hours - the AI will offer appointments during these times"
        icon={Clock}
      >
        <div className="space-y-4">
          {/* Info banner */}
          <div className="p-4 rounded-lg bg-accent-500/10 border border-accent-500/20">
            <p className="text-sm text-accent-300">
              {calendarConnected
                ? "Google Calendar is connected - the AI will check your calendar for conflicts before offering times."
                : "Set your open hours below. The AI will offer 30-minute appointment slots during these times."}
            </p>
          </div>

          {/* Days */}
          <div className="space-y-3">
            {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => (
              <div
                key={day}
                className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
                  businessHours[day]?.enabled
                    ? 'bg-dark-800/50 border-dark-700/50'
                    : 'bg-dark-900/50 border-dark-800/50 opacity-60'
                }`}
              >
                <Toggle
                  checked={businessHours[day]?.enabled || false}
                  onChange={(val) => updateBusinessHoursDay(day, 'enabled', val)}
                />
                <span className="w-24 font-medium text-dark-200 capitalize">{day}</span>
                {businessHours[day]?.enabled ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="time"
                      value={businessHours[day]?.open || '09:00'}
                      onChange={(e) => updateBusinessHoursDay(day, 'open', e.target.value)}
                      className="input w-32"
                    />
                    <span className="text-dark-500">to</span>
                    <input
                      type="time"
                      value={businessHours[day]?.close || '17:00'}
                      onChange={(e) => updateBusinessHoursDay(day, 'close', e.target.value)}
                      className="input w-32"
                    />
                  </div>
                ) : (
                  <span className="text-dark-500 text-sm">Closed</span>
                )}
              </div>
            ))}
          </div>

          <button onClick={handleSaveBusinessHours} disabled={savingBusinessHours} className="btn-primary">
            {savingBusinessHours ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="ml-2">Save Business Hours</span>
          </button>
        </div>
      </SettingsSection>
    </div>
  )
}
