import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { analyticsAPI, callsAPI, leadsAPI } from '../lib/api'
import {
  Phone,
  Users,
  TrendingUp,
  TrendingDown,
  Clock,
  ArrowUpRight,
  Calendar,
  Sparkles,
  PhoneMissed,
  CalendarCheck,
  PhoneOff,
  Zap,
  Voicemail,
  AlertTriangle,
  PhoneCall,
  HelpCircle,
  Play
} from 'lucide-react'

function StatCard({ title, value, suffix, trend, trendDirection, icon: Icon, gradient, delay }) {
  const isPositive = trendDirection === 'up'

  return (
    <div
      className="card-hover group relative overflow-hidden"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Gradient accent */}
      <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${gradient}`} />

      <div className="flex items-start justify-between">
        <div>
          <p className="text-dark-400 text-sm font-medium mb-1">{title}</p>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-dark-100">{value}</span>
            {suffix && <span className="text-lg text-dark-400">{suffix}</span>}
          </div>
        </div>

        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} bg-opacity-10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>

      {trend !== undefined && (
        <div className="mt-4 flex items-center gap-2">
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            isPositive
              ? 'bg-success-500/10 text-success-400'
              : 'bg-danger-500/10 text-danger-400'
          }`}>
            {isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            <span>{Math.abs(trend)}%</span>
          </div>
          <span className="text-xs text-dark-500">vs last period</span>
        </div>
      )}
    </div>
  )
}

function RecentCallCard({ call }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-success-500'
      case 'in-progress': return 'bg-warning-500'
      case 'missed': return 'bg-danger-500'
      default: return 'bg-dark-500'
    }
  }

  const formatDuration = (seconds) => {
    if (!seconds) return '--:--'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatTime = (dateString) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  return (
    <div className="flex items-center gap-4 p-4 rounded-lg bg-dark-800/30 hover:bg-dark-800/50 transition-colors group">
      <div className={`w-2 h-2 rounded-full ${getStatusColor(call.status)}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-dark-200 truncate">
            {call.callerName || 'Unknown Caller'}
          </p>
          {call.callReason && (
            <span className="hidden sm:inline-flex px-2 py-0.5 rounded text-xs bg-dark-700 text-dark-400">
              {call.callReason}
            </span>
          )}
        </div>
        <p className="text-xs text-dark-500">{call.callerPhone}</p>
      </div>

      <div className="text-right">
        <p className="text-sm text-dark-300 font-mono">{formatDuration(call.duration)}</p>
        <p className="text-xs text-dark-500">{formatTime(call.createdAt)}</p>
      </div>

      <ArrowUpRight className="w-4 h-4 text-dark-600 group-hover:text-dark-400 transition-colors" />
    </div>
  )
}

function LeadCard({ lead }) {
  const getStatusBadge = (status) => {
    const styles = {
      new: 'bg-accent-500/10 text-accent-400 border-accent-500/20',
      contacted: 'bg-warning-500/10 text-warning-400 border-warning-500/20',
      qualified: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      converted: 'bg-success-500/10 text-success-400 border-success-500/20',
      lost: 'bg-dark-600/50 text-dark-400 border-dark-600/50'
    }
    return styles[status] || styles.new
  }

  return (
    <div className="flex items-center gap-4 p-4 rounded-lg bg-dark-800/30 hover:bg-dark-800/50 transition-colors group">
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-dark-700 to-dark-800 flex items-center justify-center text-sm font-medium text-dark-300 border border-dark-700">
        {lead.name?.charAt(0)?.toUpperCase() || '?'}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-dark-200 truncate">{lead.name}</p>
        <p className="text-xs text-dark-500">{lead.reason || 'General inquiry'}</p>
      </div>

      <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusBadge(lead.status)}`}>
        {lead.status}
      </span>
    </div>
  )
}

function VoicemailCard({ voicemail }) {
  const getIntentBadge = (intent) => {
    const styles = {
      emergency: { bg: 'bg-danger-500/10 text-danger-400 border-danger-500/20', icon: AlertTriangle, label: 'Emergency' },
      appointment: { bg: 'bg-success-500/10 text-success-400 border-success-500/20', icon: CalendarCheck, label: 'Appointment' },
      callback: { bg: 'bg-accent-500/10 text-accent-400 border-accent-500/20', icon: PhoneCall, label: 'Callback' },
      inquiry: { bg: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: HelpCircle, label: 'Inquiry' },
      other: { bg: 'bg-dark-600/50 text-dark-400 border-dark-600/50', icon: Voicemail, label: 'Other' }
    }
    return styles[intent] || styles.other
  }

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatTime = (dateString) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  const intentInfo = getIntentBadge(voicemail.intent)
  const IntentIcon = intentInfo.icon

  return (
    <div className={`p-4 rounded-lg bg-dark-800/30 hover:bg-dark-800/50 transition-colors group ${voicemail.intent === 'emergency' ? 'border border-danger-500/30' : ''}`}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${voicemail.intent === 'emergency' ? 'bg-danger-500/20' : 'bg-dark-700'}`}>
          <IntentIcon className={`w-5 h-5 ${voicemail.intent === 'emergency' ? 'text-danger-400' : 'text-dark-400'}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium text-dark-200">{voicemail.callerName}</p>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${intentInfo.bg}`}>
              {intentInfo.label}
            </span>
          </div>
          <p className="text-xs text-dark-500 mb-2">{voicemail.callerPhone}</p>

          {voicemail.transcription && (
            <p className="text-xs text-dark-400 italic line-clamp-2">
              "{voicemail.transcription}"
            </p>
          )}
        </div>

        <div className="text-right flex flex-col items-end gap-2">
          <p className="text-xs text-dark-500">{formatTime(voicemail.createdAt)}</p>
          <div className="flex items-center gap-1 text-xs text-dark-400">
            <Play className="w-3 h-3" />
            <span>{formatDuration(voicemail.duration)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recentCalls, setRecentCalls] = useState([])
  const [recentLeads, setRecentLeads] = useState([])
  const [voicemails, setVoicemails] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [analyticsRes, callsRes, leadsRes, voicemailsRes] = await Promise.all([
          analyticsAPI.getOverview('30d'),
          callsAPI.getAll({ limit: 5 }),
          leadsAPI.getAll({ limit: 5 }),
          callsAPI.getVoicemails({ limit: 5 })
        ])

        setStats(analyticsRes.data.stats)
        setRecentCalls(callsRes.data.calls)
        setRecentLeads(leadsRes.data.leads)
        setVoicemails(voicemailsRes.data.voicemails || [])
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-dark-400 text-sm">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Welcome header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Dashboard</h1>
          <p className="text-dark-400 mt-1">
            Track missed patient calls and instant AI SMS follow-ups.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-500/10 border border-accent-500/20">
            <div className="w-2 h-2 rounded-full bg-accent-500 animate-pulse" />
            <span className="text-xs font-medium text-accent-400">Auto-syncs with Twilio</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dark-800/50 border border-dark-700/50">
            <Calendar className="w-4 h-4 text-dark-400" />
            <span className="text-sm text-dark-300">Last 30 days</span>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <StatCard
          title="Missed Calls"
          value={stats?.totalCalls?.value || 0}
          trend={stats?.totalCalls?.trend}
          trendDirection={stats?.totalCalls?.trendDirection}
          icon={PhoneMissed}
          gradient="from-accent-500 to-accent-600"
          delay={0}
        />
        <StatCard
          title="Instant Responses"
          value={stats?.newLeads?.value || 0}
          trend={stats?.newLeads?.trend}
          trendDirection={stats?.newLeads?.trendDirection}
          icon={Zap}
          gradient="from-purple-500 to-purple-600"
          delay={100}
        />
        <StatCard
          title="Booked"
          value={stats?.conversionRate?.value || 0}
          suffix="%"
          icon={CalendarCheck}
          gradient="from-success-500 to-success-600"
          delay={200}
        />
        <StatCard
          title="No Answer"
          value={stats?.callsToday?.value || 0}
          icon={PhoneOff}
          gradient="from-warning-500 to-warning-600"
          delay={300}
        />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'View missed calls', href: '/calls', icon: PhoneMissed },
          { label: 'Manage follow-ups', href: '/leads', icon: Users },
          { label: 'AI Settings', href: '/settings', icon: Sparkles },
          { label: 'Business hours', href: '/settings', icon: Clock },
        ].map((action, index) => (
          <Link
            key={action.label}
            to={action.href}
            className="flex items-center gap-3 p-4 rounded-xl bg-dark-800/30 border border-dark-700/50 hover:border-dark-600 hover:bg-dark-800/50 transition-all group"
          >
            <action.icon className="w-5 h-5 text-dark-400 group-hover:text-accent-400 transition-colors" />
            <span className="text-sm font-medium text-dark-300 group-hover:text-dark-100 transition-colors">
              {action.label}
            </span>
          </Link>
        ))}
      </div>

      {/* Voicemails with Intent */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-warning-500/10 flex items-center justify-center">
              <Voicemail className="w-5 h-5 text-warning-400" />
            </div>
            <div>
              <h3 className="font-semibold text-dark-100">Voicemails</h3>
              <p className="text-xs text-dark-500">Sorted by urgency - emergency first</p>
            </div>
          </div>
          <Link
            to="/missed-patients"
            className="text-sm text-accent-400 hover:text-accent-300 font-medium flex items-center gap-1"
          >
            View all
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="space-y-3">
          {voicemails.length > 0 ? (
            voicemails.map((vm) => (
              <VoicemailCard key={vm.id} voicemail={vm} />
            ))
          ) : (
            <div className="text-center py-8">
              <Voicemail className="w-8 h-8 text-dark-600 mx-auto mb-3" />
              <p className="text-dark-400 text-sm">No voicemails yet</p>
              <p className="text-dark-500 text-xs mt-1">When callers leave voicemails, they'll appear here with transcription and intent</p>
            </div>
          )}
        </div>
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Missed Calls */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center">
                <PhoneMissed className="w-5 h-5 text-accent-400" />
              </div>
              <div>
                <h3 className="font-semibold text-dark-100">Recent Missed Calls</h3>
                <p className="text-xs text-dark-500">Calls that triggered instant follow-up</p>
              </div>
            </div>
            <Link
              to="/calls"
              className="text-sm text-accent-400 hover:text-accent-300 font-medium flex items-center gap-1"
            >
              View all
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="space-y-2">
            {recentCalls.length > 0 ? (
              recentCalls.map((call) => (
                <RecentCallCard key={call.id} call={call} />
              ))
            ) : (
              <div className="text-center py-8">
                <PhoneMissed className="w-8 h-8 text-dark-600 mx-auto mb-3" />
                <p className="text-dark-400 text-sm">No missed calls yet</p>
                <p className="text-dark-500 text-xs mt-1">Missed calls will trigger instant AI follow-up</p>
              </div>
            )}
          </div>
        </div>

        {/* Follow-up Status */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h3 className="font-semibold text-dark-100">Follow-up Status</h3>
                <p className="text-xs text-dark-500">Lead responses & bookings</p>
              </div>
            </div>
            <Link
              to="/leads"
              className="text-sm text-accent-400 hover:text-accent-300 font-medium flex items-center gap-1"
            >
              View all
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="space-y-2">
            {recentLeads.length > 0 ? (
              recentLeads.map((lead) => (
                <LeadCard key={lead.id} lead={lead} />
              ))
            ) : (
              <div className="text-center py-8">
                <Zap className="w-8 h-8 text-dark-600 mx-auto mb-3" />
                <p className="text-dark-400 text-sm">No follow-ups yet</p>
                <p className="text-dark-500 text-xs mt-1">AI will instantly respond to missed calls</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Status Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-accent-600/20 via-purple-600/20 to-accent-600/20 border border-accent-500/20 p-6 lg:p-8">
        <div className="absolute top-0 right-0 w-64 h-64 bg-accent-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl" />

        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center shadow-lg shadow-accent-500/30 animate-pulse-slow">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-dark-100">Instant Follow-up Active</h3>
              <p className="text-dark-400 mt-1">
                AI instantly responds to missed calls via SMS. Never lose a patient again.
              </p>
            </div>
          </div>

          <Link
            to="/settings"
            className="btn-primary flex items-center gap-2 whitespace-nowrap"
          >
            Configure AI
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
