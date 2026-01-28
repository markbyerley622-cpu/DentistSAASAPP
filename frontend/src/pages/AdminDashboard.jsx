import { useState, useEffect } from 'react'
import { adminAPI } from '../lib/api'
import {
  Users,
  Phone,
  UserCheck,
  CalendarCheck,
  TrendingUp,
  TrendingDown,
  Building2,
  Calendar,
  Search,
  PhoneMissed,
  MessageSquare,
  Activity,
  Clock,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react'

function StatCard({ title, value, icon: Icon, gradient, subtitle, trend, trendValue }) {
  return (
    <div className="card-hover group relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${gradient}`} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-dark-400 text-sm font-medium mb-1">{title}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-dark-100">{value}</span>
            {trend && trendValue && (
              <span className={`flex items-center text-xs font-medium ${
                trend === 'up' ? 'text-success-400' : trend === 'down' ? 'text-danger-400' : 'text-dark-400'
              }`}>
                {trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : trend === 'down' ? <ArrowDownRight className="w-3 h-3" /> : null}
                {trendValue}
              </span>
            )}
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

function MetricRow({ label, value, subValue, highlight }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-dark-700/30 last:border-0">
      <span className="text-sm text-dark-400">{label}</span>
      <div className="text-right">
        <span className={`font-semibold ${highlight ? 'text-accent-400' : 'text-dark-100'}`}>{value}</span>
        {subValue && <span className="text-xs text-dark-500 ml-1">({subValue})</span>}
      </div>
    </div>
  )
}

function ClientCard({ client }) {
  const conversionRate = client.stats.totalLeads > 0
    ? ((client.stats.bookedLeads / client.stats.totalLeads) * 100).toFixed(0)
    : 0

  return (
    <div className="p-4 rounded-lg bg-dark-800/30 hover:bg-dark-800/50 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-medium text-dark-100">{client.practiceName}</h4>
          <p className="text-xs text-dark-500">{client.email}</p>
          {client.smsNumber && (
            <p className="text-xs text-accent-400 mt-1">
              {client.smsNumber}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs text-dark-500">
            Joined {new Date(client.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="p-2 rounded bg-dark-800/50">
          <p className="text-lg font-bold text-danger-400">{client.stats.missedCalls}</p>
          <p className="text-[10px] text-dark-500">Missed</p>
        </div>
        <div className="p-2 rounded bg-dark-800/50">
          <p className="text-lg font-bold text-purple-400">{client.stats.totalLeads}</p>
          <p className="text-[10px] text-dark-500">Leads</p>
        </div>
        <div className="p-2 rounded bg-dark-800/50">
          <p className="text-lg font-bold text-success-400">{client.stats.bookedLeads}</p>
          <p className="text-[10px] text-dark-500">Callbacks</p>
        </div>
        <div className="p-2 rounded bg-dark-800/50">
          <p className="text-lg font-bold text-accent-400">{conversionRate}%</p>
          <p className="text-[10px] text-dark-500">Rate</p>
        </div>
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null)
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, clientsRes] = await Promise.all([
          adminAPI.getStats(),
          adminAPI.getClients({ limit: 20 })
        ])

        setStats(statsRes.data.stats)
        setClients(clientsRes.data.clients)
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
      const clientsRes = await adminAPI.getClients({ limit: 20 })
      setClients(clientsRes.data.clients)
      return
    }

    try {
      const clientsRes = await adminAPI.getClients({ search: searchTerm, limit: 20 })
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

  const weekGrowth = parseFloat(stats?.weekOverWeekGrowth) || 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Admin Dashboard</h1>
          <p className="text-dark-400 mt-1">
            Platform metrics and client overview
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20">
          <Building2 className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-medium text-purple-400">Admin View</span>
        </div>
      </div>

      {/* Today's Activity */}
      <div className="card bg-gradient-to-br from-accent-500/5 to-purple-500/5 border-accent-500/20">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-accent-400" />
          </div>
          <div>
            <h3 className="font-semibold text-dark-100">Today's Activity</h3>
            <p className="text-xs text-dark-500">Real-time platform metrics</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 rounded-lg bg-dark-800/30">
            <p className="text-3xl font-bold text-danger-400">{stats?.missedCallsToday || 0}</p>
            <p className="text-xs text-dark-500 mt-1">Missed Calls</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-dark-800/30">
            <p className="text-3xl font-bold text-purple-400">{stats?.leadsToday || 0}</p>
            <p className="text-xs text-dark-500 mt-1">Leads Created</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-dark-800/30">
            <p className="text-3xl font-bold text-success-400">{stats?.callbacksRequestedToday || 0}</p>
            <p className="text-xs text-dark-500 mt-1">Callbacks Requested</p>
          </div>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 lg:gap-4">
        <StatCard
          title="Total Clients"
          value={stats?.totalClients || 0}
          icon={Users}
          gradient="from-accent-500 to-accent-600"
          subtitle={`${stats?.activeClients || 0} active (30d)`}
        />
        <StatCard
          title="Missed Calls"
          value={stats?.missedCalls || 0}
          icon={PhoneMissed}
          gradient="from-danger-500 to-danger-600"
          subtitle={`${stats?.missedCallsWeek || 0} this week`}
          trend={weekGrowth > 0 ? 'up' : weekGrowth < 0 ? 'down' : null}
          trendValue={weekGrowth !== 0 ? `${Math.abs(weekGrowth)}%` : null}
        />
        <StatCard
          title="Response Rate"
          value={`${stats?.responseRate || 0}%`}
          icon={MessageSquare}
          gradient="from-blue-500 to-blue-600"
          subtitle="Automatically handled"
        />
        <StatCard
          title="Callbacks"
          value={(stats?.qualifiedLeads || 0) + (stats?.handledLeads || 0)}
          icon={Phone}
          gradient="from-purple-500 to-purple-600"
          subtitle={`${stats?.qualifiedLeads || 0} pending`}
        />
      </div>

      {/* Detailed Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SMS Metrics */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold text-dark-100">SMS Performance</h3>
              <p className="text-xs text-dark-500">Message delivery metrics</p>
            </div>
          </div>
          <div className="space-y-1">
            <MetricRow label="Total SMS Sent" value={stats?.smsSent || 0} />
            <MetricRow label="Replies Received" value={stats?.smsReceived || 0} />
            <MetricRow
              label="Reply Rate"
              value={stats?.smsSent > 0 ? `${((stats?.smsReceived / stats?.smsSent) * 100).toFixed(1)}%` : '0%'}
              highlight
            />
          </div>
        </div>

        {/* Conversion Funnel */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-success-500/10 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-success-400" />
            </div>
            <div>
              <h3 className="font-semibold text-dark-100">Conversion Funnel</h3>
              <p className="text-xs text-dark-500">Lead progression</p>
            </div>
          </div>
          <div className="space-y-1">
            <MetricRow label="Total Missed Calls" value={stats?.missedCalls || 0} />
            <MetricRow label="Auto Handled" value={stats?.aiHandledCalls || 0} subValue={`${stats?.responseRate || 0}%`} />
            <MetricRow label="Leads Created" value={stats?.totalLeads || 0} />
            <MetricRow label="Callback Requested" value={stats?.qualifiedLeads || 0} />
            <MetricRow label="Handled/Completed" value={stats?.handledLeads || 0} highlight />
          </div>
        </div>

        {/* Weekly Comparison */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h3 className="font-semibold text-dark-100">Weekly Comparison</h3>
              <p className="text-xs text-dark-500">This week vs last week</p>
            </div>
          </div>
          <div className="space-y-1">
            <MetricRow label="Missed Calls (This Week)" value={stats?.missedCallsWeek || 0} />
            <MetricRow label="Missed Calls (Last Week)" value={stats?.missedCallsLastWeek || 0} />
            <MetricRow label="Callbacks (This Week)" value={stats?.callbacksWeek || 0} highlight />
            <MetricRow
              label="Week-over-Week Change"
              value={`${weekGrowth > 0 ? '+' : ''}${weekGrowth}%`}
              highlight
            />
          </div>
        </div>

        {/* Client Health */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center">
              <UserCheck className="w-5 h-5 text-accent-400" />
            </div>
            <div>
              <h3 className="font-semibold text-dark-100">Client Health</h3>
              <p className="text-xs text-dark-500">Account status overview</p>
            </div>
          </div>
          <div className="space-y-1">
            <MetricRow label="Total Registered" value={stats?.totalClients || 0} />
            <MetricRow label="Active (30 days)" value={stats?.activeClients || 0} />
            <MetricRow
              label="Inactive"
              value={(stats?.totalClients || 0) - (stats?.activeClients || 0)}
            />
            <MetricRow
              label="Activity Rate"
              value={stats?.totalClients > 0 ? `${((stats?.activeClients / stats?.totalClients) * 100).toFixed(0)}%` : '0%'}
              highlight
            />
          </div>
        </div>
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

      {/* Clients */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-accent-400" />
            </div>
            <div>
              <h3 className="font-semibold text-dark-100">All Clients</h3>
              <p className="text-xs text-dark-500">{stats?.totalClients || 0} registered, {stats?.activeClients || 0} active</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {clients.length > 0 ? (
            clients.map((client) => (
              <ClientCard key={client.id} client={client} />
            ))
          ) : (
            <div className="text-center py-8 col-span-2">
              <Users className="w-8 h-8 text-dark-600 mx-auto mb-3" />
              <p className="text-dark-400 text-sm">No clients found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
