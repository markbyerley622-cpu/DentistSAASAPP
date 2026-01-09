import { useState, useEffect } from 'react'
import { leadsAPI } from '../lib/api'
import {
  Search,
  Download,
  Clock,
  Phone,
  CheckCircle,
  XCircle,
  PhoneCall,
  CalendarCheck,
  Sparkles,
  Users
} from 'lucide-react'

// Format date nicely
function formatDate(dateString) {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

// Format appointment time
function formatAppointmentTime(dateString) {
  if (!dateString) return null
  const date = new Date(dateString)
  return date.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

// Status badge component with colors
function StatusBadge({ lead }) {
  // Booked = Green
  if (lead.status === 'converted' || lead.appointmentBooked) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-success-500/10 border border-success-500/20">
        <CalendarCheck className="w-4 h-4 text-success-400" />
        <span className="text-sm font-medium text-success-400">Booked</span>
      </div>
    )
  }

  // Wants Callback = Purple
  if (lead.status === 'qualified' || lead.preferredTime?.toLowerCase().includes('callback')) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
        <PhoneCall className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium text-purple-400">Wants Callback</span>
      </div>
    )
  }

  // Replied = Yellow
  if (lead.status === 'contacted') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-warning-500/10 border border-warning-500/20">
        <Phone className="w-4 h-4 text-warning-400" />
        <span className="text-sm font-medium text-warning-400">Replied</span>
      </div>
    )
  }

  // No Response = Grey
  if (lead.status === 'lost') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-600/30 border border-dark-500/20">
        <XCircle className="w-4 h-4 text-dark-400" />
        <span className="text-sm font-medium text-dark-400">No Response</span>
      </div>
    )
  }

  // Handled (manually marked done) = Green
  if (lead.status === 'handled') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-success-500/10 border border-success-500/20">
        <CheckCircle className="w-4 h-4 text-success-400" />
        <span className="text-sm font-medium text-success-400">Handled</span>
      </div>
    )
  }

  // Initial SMS = Accent
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-500/10 border border-accent-500/20">
      <Sparkles className="w-4 h-4 text-accent-400" />
      <span className="text-sm font-medium text-accent-400">Initial SMS</span>
    </div>
  )
}

// Export to CSV
function downloadCSV(leads) {
  const headers = ['Name', 'Phone', 'Status', 'Reason', 'Appointment Time', 'Created At']
  const rows = leads.map(lead => [
    lead.name || 'Unknown',
    lead.phone,
    lead.status,
    lead.reason || '',
    lead.appointmentTime ? formatAppointmentTime(lead.appointmentTime) : '',
    formatDate(lead.createdAt)
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  link.setAttribute('download', `history-${new Date().toISOString().split('T')[0]}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export default function Leads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [search, setSearch] = useState('')

  const fetchLeads = async () => {
    setLoading(true)
    try {
      const [leadsRes, statsRes] = await Promise.all([
        leadsAPI.getAll({ limit: 200 }),
        leadsAPI.getStats()
      ])
      setLeads(leadsRes.data.leads)
      setStats(statsRes.data)
    } catch (error) {
      console.error('Failed to fetch leads:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLeads()
  }, [])

  const filteredLeads = leads.filter(lead =>
    lead.name?.toLowerCase().includes(search.toLowerCase()) ||
    lead.phone?.includes(search) ||
    lead.reason?.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-dark-400 text-sm">Loading history...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">History</h1>
          <p className="text-dark-400 mt-1">
            Complete record of all missed calls and their outcomes
          </p>
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <div className="flex items-center gap-4 px-4 py-2 rounded-lg bg-dark-800/50 border border-dark-700/50">
              <div className="text-center">
                <p className="text-lg font-semibold text-dark-100">{stats.total}</p>
                <p className="text-xs text-dark-500">Total</p>
              </div>
              <div className="w-px h-8 bg-dark-700" />
              <div className="text-center">
                <p className="text-lg font-semibold text-success-400">{stats.conversionRate}%</p>
                <p className="text-xs text-dark-500">Booked</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search and Export */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, or reason..."
            className="w-full pl-12 pr-4 py-3 rounded-xl bg-dark-800/50 border border-dark-700/50 text-dark-100 placeholder:text-dark-500 focus:outline-none focus:border-accent-500/50 focus:ring-2 focus:ring-accent-500/20 transition-all"
          />
        </div>
        <button
          onClick={() => downloadCSV(filteredLeads)}
          className="flex items-center gap-2 px-4 py-3 rounded-xl bg-dark-800/50 border border-dark-700/50 text-dark-300 hover:text-dark-100 hover:border-dark-600 transition-all"
        >
          <Download className="w-5 h-5" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* List */}
      <div className="space-y-3">
        {filteredLeads.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-dark-800/50 flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-dark-600" />
            </div>
            <p className="text-dark-200 text-lg font-medium">No history yet</p>
            <p className="text-dark-500 mt-1">
              {search ? 'Try a different search term' : 'Missed calls will appear here'}
            </p>
          </div>
        ) : (
          filteredLeads.map((lead) => (
            <div
              key={lead.id}
              className="p-4 rounded-xl bg-dark-800/30 border border-dark-700/50 hover:border-dark-600 transition-all"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                {/* Left: Info */}
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-dark-700 to-dark-800 flex items-center justify-center text-lg font-medium text-dark-300 border border-dark-700">
                    {lead.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="font-semibold text-dark-100">{lead.name || 'Unknown Caller'}</p>
                    <p className="text-sm text-dark-400 font-mono">{lead.phone}</p>
                    {lead.reason && (
                      <p className="text-sm text-dark-500 mt-1">"{lead.reason}"</p>
                    )}
                  </div>
                </div>

                {/* Right: Status + Time */}
                <div className="flex flex-col sm:items-end gap-2">
                  <StatusBadge lead={lead} />

                  {/* Show appointment time if booked */}
                  {(lead.status === 'converted' || lead.appointmentBooked) && lead.appointmentTime && (
                    <p className="text-sm text-success-400 flex items-center gap-1.5">
                      <CalendarCheck className="w-3.5 h-3.5" />
                      {formatAppointmentTime(lead.appointmentTime)}
                    </p>
                  )}

                  <p className="text-xs text-dark-500 flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    {formatDate(lead.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
