import { useState, useEffect } from 'react'
import { adminAPI } from '../lib/api'
import {
  Users,
  Phone,
  Voicemail,
  UserCheck,
  CalendarCheck,
  TrendingUp,
  AlertTriangle,
  Building2,
  PhoneCall,
  HelpCircle,
  Calendar,
  ArrowUpRight,
  Search,
  Play,
  PhoneMissed
} from 'lucide-react'

function StatCard({ title, value, icon: Icon, gradient, subtitle }) {
  return (
    <div className="card-hover group relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${gradient}`} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-dark-400 text-sm font-medium mb-1">{title}</p>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-dark-100">{value}</span>
          </div>
          {subtitle && <p className="text-xs text-dark-500 mt-1">{subtitle}</p>}
        </div>
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} bg-opacity-10 flex items-center justify-center`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  )
}

function ClientCard({ client }) {
  return (
    <div className="p-4 rounded-lg bg-dark-800/30 hover:bg-dark-800/50 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-medium text-dark-100">{client.practiceName}</h4>
          <p className="text-xs text-dark-500">{client.email}</p>
          {client.twilioPhone && (
            <p className="text-xs text-accent-400 mt-1">
              {client.twilioPhone}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs text-dark-500">
            Joined {new Date(client.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        <div className="p-2 rounded bg-dark-800/50">
          <p className="text-lg font-bold text-danger-400">{client.stats.missedCalls}</p>
          <p className="text-[10px] text-dark-500">Missed</p>
        </div>
        <div className="p-2 rounded bg-dark-800/50">
          <p className="text-lg font-bold text-warning-400">{client.stats.totalVoicemails}</p>
          <p className="text-[10px] text-dark-500">VMs</p>
        </div>
        <div className="p-2 rounded bg-dark-800/50">
          <p className="text-lg font-bold text-purple-400">{client.stats.totalAppointments}</p>
          <p className="text-[10px] text-dark-500">Appts</p>
        </div>
        <div className="p-2 rounded bg-dark-800/50">
          <p className="text-lg font-bold text-accent-400">{client.stats.callbackRequests}</p>
          <p className="text-[10px] text-dark-500">Callbacks</p>
        </div>
        <div className="p-2 rounded bg-dark-800/50">
          <p className="text-lg font-bold text-dark-100">{client.stats.totalLeads}</p>
          <p className="text-[10px] text-dark-500">Leads</p>
        </div>
        <div className="p-2 rounded bg-dark-800/50">
          <p className="text-lg font-bold text-success-400">{client.stats.bookedLeads}</p>
          <p className="text-[10px] text-dark-500">Booked</p>
        </div>
        <div className="p-2 rounded bg-dark-800/50">
          <p className="text-lg font-bold text-blue-400">{client.stats.upcomingAppointments}</p>
          <p className="text-[10px] text-dark-500">Upcoming</p>
        </div>
      </div>
    </div>
  )
}

function VoicemailCard({ voicemail }) {
  const getIntentStyle = (intent) => {
    const styles = {
      emergency: { bg: 'bg-danger-500/10 text-danger-400 border-danger-500/20', icon: AlertTriangle },
      appointment: { bg: 'bg-success-500/10 text-success-400 border-success-500/20', icon: CalendarCheck },
      callback: { bg: 'bg-accent-500/10 text-accent-400 border-accent-500/20', icon: PhoneCall },
      inquiry: { bg: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: HelpCircle },
      other: { bg: 'bg-dark-600/50 text-dark-400 border-dark-600/50', icon: Voicemail }
    }
    return styles[intent] || styles.other
  }

  const intentInfo = getIntentStyle(voicemail.intent)
  const IntentIcon = intentInfo.icon

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className={`p-4 rounded-lg bg-dark-800/30 hover:bg-dark-800/50 transition-colors ${voicemail.intent === 'emergency' ? 'border border-danger-500/30' : ''}`}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${voicemail.intent === 'emergency' ? 'bg-danger-500/20' : 'bg-dark-700'}`}>
          <IntentIcon className={`w-5 h-5 ${voicemail.intent === 'emergency' ? 'text-danger-400' : 'text-dark-400'}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium text-dark-200">{voicemail.callerName}</p>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${intentInfo.bg}`}>
              {voicemail.intent || 'other'}
            </span>
          </div>
          <p className="text-xs text-dark-500 mb-1">{voicemail.callerPhone}</p>
          <p className="text-xs text-accent-400">{voicemail.clientName}</p>

          {voicemail.transcription && (
            <p className="text-xs text-dark-400 italic mt-2 line-clamp-2">
              "{voicemail.transcription}"
            </p>
          )}
        </div>

        <div className="text-right flex flex-col items-end gap-2">
          <p className="text-xs text-dark-500">
            {new Date(voicemail.createdAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            })}
          </p>
          <div className="flex items-center gap-1 text-xs text-dark-400">
            <Play className="w-3 h-3" />
            <span>{formatDuration(voicemail.duration)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null)
  const [clients, setClients] = useState([])
  const [voicemails, setVoicemails] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, clientsRes, voicemailsRes] = await Promise.all([
          adminAPI.getStats(),
          adminAPI.getClients({ limit: 10 }),
          adminAPI.getVoicemails({ limit: 10 })
        ])

        setStats(statsRes.data.stats)
        setClients(clientsRes.data.clients)
        setVoicemails(voicemailsRes.data.voicemails)
      } catch (error) {
        console.error('Failed to fetch admin data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      const clientsRes = await adminAPI.getClients({ limit: 10 })
      setClients(clientsRes.data.clients)
      return
    }

    try {
      const clientsRes = await adminAPI.getClients({ search: searchTerm, limit: 10 })
      setClients(clientsRes.data.clients)
    } catch (error) {
      console.error('Search failed:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-dark-400 text-sm">Loading admin dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Admin Dashboard</h1>
          <p className="text-dark-400 mt-1">
            Overview of all clients and platform activity
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20">
          <Building2 className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-medium text-purple-400">Admin View</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 lg:gap-4">
        <StatCard
          title="Clients"
          value={stats?.totalClients || 0}
          icon={Users}
          gradient="from-accent-500 to-accent-600"
          subtitle="Active dentists"
        />
        <StatCard
          title="Missed Calls"
          value={stats?.missedCalls || 0}
          icon={PhoneMissed}
          gradient="from-danger-500 to-danger-600"
          subtitle={`${stats?.totalCalls || 0} total calls`}
        />
        <StatCard
          title="Voicemails"
          value={stats?.totalVoicemails || 0}
          icon={Voicemail}
          gradient="from-warning-500 to-warning-600"
          subtitle={`${stats?.callbackRequests || 0} callbacks`}
        />
        <StatCard
          title="Leads"
          value={stats?.totalLeads || 0}
          icon={UserCheck}
          gradient="from-purple-500 to-purple-600"
          subtitle={`${stats?.conversionRate || 0}% converted`}
        />
        <StatCard
          title="Booked"
          value={stats?.bookedLeads || 0}
          icon={CalendarCheck}
          gradient="from-success-500 to-success-600"
          subtitle="Appointments made"
        />
        <StatCard
          title="Upcoming"
          value={stats?.upcomingAppointments || 0}
          icon={Calendar}
          gradient="from-blue-500 to-blue-600"
          subtitle="Scheduled appts"
        />
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
          <input
            type="text"
            placeholder="Search clients by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-full pl-10 pr-4 py-2 bg-dark-800/50 border border-dark-700 rounded-lg text-dark-100 placeholder:text-dark-500 focus:outline-none focus:border-accent-500"
          />
        </div>
        <button
          onClick={handleSearch}
          className="btn-primary"
        >
          Search
        </button>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Clients */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-accent-400" />
              </div>
              <div>
                <h3 className="font-semibold text-dark-100">Clients</h3>
                <p className="text-xs text-dark-500">{stats?.totalClients || 0} total dentists</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {clients.length > 0 ? (
              clients.map((client) => (
                <ClientCard key={client.id} client={client} />
              ))
            ) : (
              <div className="text-center py-8">
                <Users className="w-8 h-8 text-dark-600 mx-auto mb-3" />
                <p className="text-dark-400 text-sm">No clients found</p>
              </div>
            )}
          </div>
        </div>

        {/* Voicemails */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-warning-500/10 flex items-center justify-center">
                <Voicemail className="w-5 h-5 text-warning-400" />
              </div>
              <div>
                <h3 className="font-semibold text-dark-100">Recent Voicemails</h3>
                <p className="text-xs text-dark-500">Across all clients, sorted by urgency</p>
              </div>
            </div>
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
