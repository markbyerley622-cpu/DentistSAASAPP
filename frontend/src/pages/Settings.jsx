import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { settingsAPI, authAPI } from '../lib/api'
import {
  Settings as SettingsIcon,
  Building2,
  Phone,
  Bell,
  Sparkles,
  Clock,
  Check,
  X,
  AlertCircle,
  Save,
  Loader2
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
    forwardingPhone: '',
    smsReplyNumber: '',
    notificationEmail: true,
    notificationSms: false,
    aiGreeting: '',
    businessHours: {}
  })

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
        const settingsRes = await settingsAPI.get()
        const s = settingsRes.data.settings

        setSettings({
          forwardingPhone: s.forwardingPhone || '',
          smsReplyNumber: s.smsReplyNumber || '',
          notificationEmail: s.notificationEmail,
          notificationSms: s.notificationSms,
          aiGreeting: s.aiGreeting || '',
          businessHours: s.businessHours || {}
        })

        // Load business hours from settings or use defaults
        if (s.businessHours && Object.keys(s.businessHours).length > 0) {
          setBusinessHours(s.businessHours)
        }

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
  }, [user])

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
        notificationSms: settings.notificationSms
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
      setSuccess('SMS message saved successfully!')
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to save SMS message')
    } finally {
      setSaving(false)
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

      {/* Phone System Configuration */}
      <SettingsSection
        title="SMS Follow-Up"
        description="Automatic SMS follow-ups when patients miss your call"
        icon={Phone}
      >
        <div className="space-y-4">
          {/* SMS Reply Number - shows configured or pending */}
          {settings.smsReplyNumber ? (
            <div className="p-4 rounded-lg bg-success-500/10 border border-success-500/20">
              <p className="text-xs text-success-400 mb-1">SMS Number (Patients text this number)</p>
              <p className="text-2xl font-bold text-dark-100 tracking-wide">{settings.smsReplyNumber}</p>
              <p className="text-xs text-dark-400 mt-2">
                When you miss a call, patients receive an SMS from this number. They reply here to book.
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-warning-500/10 border border-warning-500/20">
              <p className="text-sm font-medium text-warning-400 mb-1">Configuring Soon</p>
              <p className="text-xs text-warning-300">
                Your dedicated SMS number is being set up. You'll be notified when it's ready.
              </p>
            </div>
          )}

          {/* Info banner */}
          <div className="p-3 rounded-lg bg-dark-800/50 border border-dark-700/50">
            <p className="text-sm text-dark-300">
              When patients call and you miss it (and they don't leave a voicemail), they'll automatically receive an SMS to book an appointment.
            </p>
          </div>

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
              Your mobile or office phone where we notify you of new bookings
            </p>
          </div>

          <button onClick={handleSaveForwarding} disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="ml-2">Save</span>
          </button>
        </div>
      </SettingsSection>

      {/* SMS Message */}
      <SettingsSection
        title="SMS Message"
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
                const defaultGreeting = `Hi! This is ${practiceName}. We missed your call and want to make sure we help you. Reply 1 for us to call you back, or Reply 2 to schedule an appointment. Thanks!`;
                // If no greeting set, or it's an old default, use the new one
                if (!settings.aiGreeting ||
                    settings.aiGreeting.includes('the dental practice') ||
                    settings.aiGreeting.includes('for the dental practice') ||
                    settings.aiGreeting.includes('Thank you for calling') ||
                    settings.aiGreeting.includes('How can we help you today') ||
                    settings.aiGreeting.includes('Would you like us to call you back') ||
                    settings.aiGreeting.includes('Just reply here')) {
                  return defaultGreeting;
                }
                return settings.aiGreeting;
              })()}
              onChange={(e) => setSettings({ ...settings, aiGreeting: e.target.value })}
              rows={4}
              className="input resize-none"
              placeholder={`Hi! This is ${user?.practiceName || 'Our Practice'}. We missed your call and want to make sure we help you. Reply 1 for us to call you back, or Reply 2 to schedule an appointment. Thanks!`}
            />
            <p className="text-xs text-dark-500 mt-2">
              This is the SMS message sent when following up on missed calls. Patients reply 1 or 2.
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

      {/* Business Hours */}
      <SettingsSection
        title="Business Hours"
        description="Set your practice hours - the system will offer appointments during these times"
        icon={Clock}
      >
        <div className="space-y-4">
          {/* Info banner */}
          <div className="p-4 rounded-lg bg-accent-500/10 border border-accent-500/20">
            <p className="text-sm text-accent-300">
              Set your open hours below. The system will offer 30-minute appointment slots during these times.
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
