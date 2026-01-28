import { useState, useEffect } from 'react'
import { analyticsAPI } from '../lib/api'
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  PhoneMissed,
  CalendarCheck,
  PhoneOff,
  MessageSquare,
  BarChart3
} from 'lucide-react'

function StatCard({ title, value, suffix, trend, trendDirection, icon: Icon, gradient, subtitle }) {
  const isPositive = trendDirection === 'up'

  return (
    <div className="card-hover group relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${gradient}`} />

      <div className="flex items-start justify-between">
        <div>
          <p className="text-dark-400 text-sm font-medium mb-1">{title}</p>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-dark-100">{value}</span>
            {suffix && <span className="text-lg text-dark-400">{suffix}</span>}
          </div>
          {subtitle && <p className="text-xs text-dark-500 mt-1">{subtitle}</p>}
        </div>

        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} bg-opacity-10 flex items-center justify-center`}>
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

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const analyticsRes = await analyticsAPI.getOverview('30d')
        setStats(analyticsRes.data.stats)
      } catch (error) {
        console.error('Failed to fetch analytics:', error)
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
          <p className="text-dark-400 text-sm">Loading analytics...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Analytics</h1>
          <p className="text-dark-400 mt-1">
            Performance overview for the last 30 days
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dark-800/50 border border-dark-700/50">
          <Calendar className="w-4 h-4 text-dark-400" />
          <span className="text-sm text-dark-300">Last 30 days</span>
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
          subtitle="Total missed calls"
        />
        <StatCard
          title="SMS Sent"
          value={stats?.newLeads?.value || 0}
          trend={stats?.newLeads?.trend}
          trendDirection={stats?.newLeads?.trendDirection}
          icon={MessageSquare}
          gradient="from-purple-500 to-purple-600"
          subtitle="Automatic follow-ups"
        />
        <StatCard
          title="Booked"
          value={stats?.conversionRate?.value || 0}
          suffix="%"
          icon={CalendarCheck}
          gradient="from-success-500 to-success-600"
          subtitle="Conversion rate"
        />
        <StatCard
          title="No Response"
          value={stats?.callsToday?.value || 0}
          icon={PhoneOff}
          gradient="from-warning-500 to-warning-600"
          subtitle="Need manual follow-up"
        />
      </div>

      {/* Analytics placeholder for future charts */}
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-accent-400" />
          </div>
          <div>
            <h3 className="font-semibold text-dark-100">Performance Trends</h3>
            <p className="text-xs text-dark-500">Conversion and response analytics</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Conversion funnel */}
          <div className="p-4 rounded-lg bg-dark-800/30">
            <p className="text-sm text-dark-400 mb-4">Conversion Funnel</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-dark-300">Missed Calls</span>
                <span className="text-sm font-medium text-dark-100">{stats?.totalCalls?.value || 0}</span>
              </div>
              <div className="w-full h-2 bg-dark-700 rounded-full">
                <div className="h-full bg-accent-500 rounded-full" style={{ width: '100%' }} />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-dark-300">SMS Sent</span>
                <span className="text-sm font-medium text-dark-100">{stats?.newLeads?.value || 0}</span>
              </div>
              <div className="w-full h-2 bg-dark-700 rounded-full">
                <div
                  className="h-full bg-purple-500 rounded-full"
                  style={{ width: `${stats?.totalCalls?.value ? (stats?.newLeads?.value / stats?.totalCalls?.value * 100) : 0}%` }}
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-dark-300">Booked</span>
                <span className="text-sm font-medium text-success-400">
                  {Math.round((stats?.conversionRate?.value || 0) * (stats?.newLeads?.value || 0) / 100)}
                </span>
              </div>
              <div className="w-full h-2 bg-dark-700 rounded-full">
                <div
                  className="h-full bg-success-500 rounded-full"
                  style={{ width: `${stats?.conversionRate?.value || 0}%` }}
                />
              </div>
            </div>
          </div>

          {/* Response breakdown */}
          <div className="p-4 rounded-lg bg-dark-800/30">
            <p className="text-sm text-dark-400 mb-4">Response Breakdown</p>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-success-500" />
                <span className="text-sm text-dark-300 flex-1">Replied & Booked</span>
                <span className="text-sm font-medium text-dark-100">{stats?.conversionRate?.value || 0}%</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-accent-500" />
                <span className="text-sm text-dark-300 flex-1">Replied</span>
                <span className="text-sm font-medium text-dark-100">
                  {Math.max(0, 100 - (stats?.conversionRate?.value || 0) - (stats?.callsToday?.value || 0))}%
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-warning-500" />
                <span className="text-sm text-dark-300 flex-1">No Response</span>
                <span className="text-sm font-medium text-dark-100">{stats?.callsToday?.value || 0}%</span>
              </div>
            </div>
          </div>

          {/* SMS Performance */}
          <div className="p-4 rounded-lg bg-dark-800/30">
            <p className="text-sm text-dark-400 mb-4">SMS Performance</p>
            <div className="text-center py-4">
              <div className="text-4xl font-bold text-dark-100 mb-1">
                {stats?.conversionRate?.value || 0}%
              </div>
              <p className="text-sm text-dark-400">Booking Rate</p>
              <p className="text-xs text-dark-500 mt-2">
                {stats?.newLeads?.value || 0} SMS sent automatically
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
