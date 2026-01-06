import { useState, useEffect } from 'react'
import { leadsAPI } from '../lib/api'
import {
  Users,
  Search,
  Plus,
  X,
  Phone,
  Mail,
  Calendar,
  Clock,
  MessageSquare,
  ChevronRight,
  Star,
  CheckCircle,
  XCircle,
  UserPlus,
  Filter,
  LayoutGrid,
  List,
  PhoneCall,
  CalendarCheck
} from 'lucide-react'

const STATUS_CONFIG = {
  new: { label: 'Awaiting Response', color: 'accent', icon: UserPlus },
  contacted: { label: 'Responded', color: 'warning', icon: Phone },
  qualified: { label: 'Interested', color: 'purple', icon: Star },
  converted: { label: 'Booked', color: 'success', icon: CheckCircle },
  lost: { label: 'No Answer', color: 'dark', icon: XCircle }
}

const PRIORITY_CONFIG = {
  high: { label: 'High', color: 'danger' },
  medium: { label: 'Medium', color: 'warning' },
  low: { label: 'Low', color: 'dark' }
}

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.new
  const colorClasses = {
    accent: 'bg-accent-500/10 text-accent-400 border-accent-500/20',
    warning: 'bg-warning-500/10 text-warning-400 border-warning-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    success: 'bg-success-500/10 text-success-400 border-success-500/20',
    dark: 'bg-dark-600/50 text-dark-400 border-dark-600/50'
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colorClasses[config.color]}`}>
      <config.icon className="w-3 h-3" />
      {config.label}
    </span>
  )
}

function PriorityBadge({ priority }) {
  const config = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium
  const colorClasses = {
    danger: 'bg-danger-500/10 text-danger-400',
    warning: 'bg-warning-500/10 text-warning-400',
    dark: 'bg-dark-600/50 text-dark-400'
  }

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colorClasses[config.color]}`}>
      {config.label}
    </span>
  )
}

function LeadCard({ lead, onClick }) {
  const formatDate = (dateString) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = (now - date) / (1000 * 60 * 60)

    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${Math.floor(diffInHours)}h ago`
    if (diffInHours < 48) return 'Yesterday'
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const wantsCallback = lead.preferredTime?.toLowerCase().includes('callback') ||
                        lead.reason?.toLowerCase().includes('call back') ||
                        lead.reason?.toLowerCase().includes('callback')

  return (
    <div
      onClick={() => onClick(lead)}
      className="p-4 rounded-xl bg-dark-800/30 border border-dark-700/50 hover:border-dark-600 hover:bg-dark-800/50 cursor-pointer transition-all group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-dark-700 to-dark-800 flex items-center justify-center text-sm font-medium text-dark-300 border border-dark-700">
            {lead.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div>
            <h4 className="font-medium text-dark-200 group-hover:text-dark-100 transition-colors">
              {lead.name}
            </h4>
            <p className="text-xs text-dark-500">{lead.phone}</p>
          </div>
        </div>
        <PriorityBadge priority={lead.priority} />
      </div>

      {/* Appointment time for booked leads */}
      {lead.status === 'converted' && lead.appointmentTime && (
        <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-success-500/10 border border-success-500/20">
          <CalendarCheck className="w-4 h-4 text-success-400" />
          <span className="text-sm font-medium text-success-400">{lead.appointmentTime}</span>
        </div>
      )}

      {/* Callback requested indicator */}
      {wantsCallback && lead.status !== 'converted' && (
        <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-warning-500/10 border border-warning-500/20">
          <PhoneCall className="w-4 h-4 text-warning-400" />
          <span className="text-sm font-medium text-warning-400">Wants callback</span>
        </div>
      )}

      {lead.reason && !wantsCallback && (
        <p className="text-sm text-dark-400 mb-3 line-clamp-2">{lead.reason}</p>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-dark-500">{formatDate(lead.createdAt)}</span>
        <ChevronRight className="w-4 h-4 text-dark-600 group-hover:text-dark-400 transition-colors" />
      </div>
    </div>
  )
}

function KanbanColumn({ title, status, leads, onLeadClick, count }) {
  const config = STATUS_CONFIG[status]
  const colorClasses = {
    accent: 'from-accent-500/20 to-accent-500/5',
    warning: 'from-warning-500/20 to-warning-500/5',
    purple: 'from-purple-500/20 to-purple-500/5',
    success: 'from-success-500/20 to-success-500/5',
    dark: 'from-dark-600/20 to-dark-600/5'
  }

  return (
    <div className="flex-1 min-w-[280px] max-w-[350px]">
      <div className={`p-4 rounded-t-xl bg-gradient-to-b ${colorClasses[config.color]}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <config.icon className="w-4 h-4 text-dark-300" />
            <h3 className="font-medium text-dark-200">{title}</h3>
          </div>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-dark-800/50 text-dark-400">
            {count}
          </span>
        </div>
      </div>
      <div className="p-2 rounded-b-xl bg-dark-800/20 border border-dark-700/30 border-t-0 min-h-[400px] space-y-2">
        {leads.length > 0 ? (
          leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onClick={onLeadClick} />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="w-8 h-8 text-dark-700 mb-2" />
            <p className="text-sm text-dark-500">No leads</p>
          </div>
        )}
      </div>
    </div>
  )
}

function LeadModal({ lead, onClose, onUpdate }) {
  const [formData, setFormData] = useState(lead)
  const [saving, setSaving] = useState(false)

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData({ ...formData, [name]: value })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await leadsAPI.update(lead.id, formData)
      onUpdate()
      onClose()
    } catch (error) {
      console.error('Failed to update lead:', error)
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-dark-900 rounded-2xl border border-dark-700/50 shadow-2xl animate-scale-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between p-6 border-b border-dark-800 bg-dark-900">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-dark-700 to-dark-800 flex items-center justify-center text-lg font-medium text-dark-300 border border-dark-700">
              {lead.name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-dark-100">{lead.name}</h3>
              <p className="text-sm text-dark-400">Lead Details</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-dark-400 hover:text-dark-100 hover:bg-dark-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-6">
            {/* Contact info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-dark-800/50 flex items-center gap-3">
                <Phone className="w-5 h-5 text-dark-400" />
                <div>
                  <p className="text-xs text-dark-500">Phone</p>
                  <p className="text-sm text-dark-200">{lead.phone}</p>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-dark-800/50 flex items-center gap-3">
                <Mail className="w-5 h-5 text-dark-400" />
                <div>
                  <p className="text-xs text-dark-500">Email</p>
                  <p className="text-sm text-dark-200">{lead.email || 'Not provided'}</p>
                </div>
              </div>
            </div>

            {/* Status and Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="input-group">
                <label className="input-label">Status</label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="input"
                >
                  {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                    <option key={key} value={key}>{config.label}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Priority</label>
                <select
                  name="priority"
                  value={formData.priority}
                  onChange={handleChange}
                  className="input"
                >
                  {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                    <option key={key} value={key}>{config.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Reason */}
            <div className="input-group">
              <label className="input-label">Reason for Contact</label>
              <input
                name="reason"
                value={formData.reason || ''}
                onChange={handleChange}
                className="input"
                placeholder="e.g., Teeth cleaning appointment"
              />
            </div>

            {/* Preferred time */}
            <div className="input-group">
              <label className="input-label">Preferred Time</label>
              <input
                name="preferredTime"
                value={formData.preferredTime || ''}
                onChange={handleChange}
                className="input"
                placeholder="e.g., Weekday mornings"
              />
            </div>

            {/* Notes */}
            <div className="input-group">
              <label className="input-label">Notes</label>
              <textarea
                name="notes"
                value={formData.notes || ''}
                onChange={handleChange}
                rows={4}
                className="input resize-none"
                placeholder="Add any notes about this lead..."
              />
            </div>

            {/* Meta info */}
            <div className="pt-4 border-t border-dark-800">
              <div className="flex items-center gap-2 text-xs text-dark-500">
                <Clock className="w-4 h-4" />
                <span>Created {formatDate(lead.createdAt)}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 flex justify-end gap-3 p-6 border-t border-dark-800 bg-dark-900">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Leads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState('kanban')
  const [selectedLead, setSelectedLead] = useState(null)

  const fetchLeads = async () => {
    setLoading(true)
    try {
      const [leadsRes, statsRes] = await Promise.all([
        leadsAPI.getAll({ limit: 100 }),
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

  const getLeadsByStatus = (status) =>
    filteredLeads.filter(lead => lead.status === status)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-dark-400 text-sm">Loading leads...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Follow-ups</h1>
          <p className="text-dark-400 mt-1">
            Track responses and appointment bookings from missed calls
          </p>
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <div className="hidden sm:flex items-center gap-4 px-4 py-2 rounded-lg bg-dark-800/50 border border-dark-700/50">
              <div className="text-center">
                <p className="text-lg font-semibold text-dark-100">{stats.total}</p>
                <p className="text-xs text-dark-500">Total</p>
              </div>
              <div className="w-px h-8 bg-dark-700" />
              <div className="text-center">
                <p className="text-lg font-semibold text-success-400">{stats.conversionRate}%</p>
                <p className="text-xs text-dark-500">Conversion</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads..."
            className="input pl-12"
          />
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-dark-800/50 border border-dark-700/50">
          <button
            onClick={() => setViewMode('kanban')}
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'kanban'
                ? 'bg-dark-700 text-dark-100'
                : 'text-dark-400 hover:text-dark-200'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="hidden sm:inline">Kanban</span>
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-dark-700 text-dark-100'
                : 'text-dark-400 hover:text-dark-200'
            }`}
          >
            <List className="w-4 h-4" />
            <span className="hidden sm:inline">List</span>
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 lg:mx-0 lg:px-0">
          {Object.entries(STATUS_CONFIG).map(([status, config]) => (
            <KanbanColumn
              key={status}
              title={config.label}
              status={status}
              leads={getLeadsByStatus(status)}
              onLeadClick={setSelectedLead}
              count={getLeadsByStatus(status).length}
            />
          ))}
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-800">
                  <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                    Lead
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                    Reason
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                    Appointment
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800/50">
                {filteredLeads.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <Users className="w-8 h-8 text-dark-600 mx-auto mb-3" />
                      <p className="text-dark-400">No leads found</p>
                    </td>
                  </tr>
                ) : (
                  filteredLeads.map((lead) => (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      className="hover:bg-dark-800/30 cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-dark-700 flex items-center justify-center text-sm font-medium text-dark-300">
                            {lead.name?.charAt(0)?.toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-dark-200">{lead.name}</p>
                            <p className="text-xs text-dark-500">{lead.phone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-dark-300">{lead.reason || '-'}</span>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={lead.status} />
                      </td>
                      <td className="px-6 py-4">
                        {lead.status === 'converted' && lead.appointmentTime ? (
                          <div className="flex items-center gap-2">
                            <CalendarCheck className="w-4 h-4 text-success-400" />
                            <span className="text-sm font-medium text-success-400">{lead.appointmentTime}</span>
                          </div>
                        ) : (lead.preferredTime?.toLowerCase().includes('callback') ||
                              lead.reason?.toLowerCase().includes('callback')) ? (
                          <div className="flex items-center gap-2">
                            <PhoneCall className="w-4 h-4 text-warning-400" />
                            <span className="text-sm text-warning-400">Wants callback</span>
                          </div>
                        ) : (
                          <span className="text-sm text-dark-500">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-dark-400">
                          {new Date(lead.createdAt).toLocaleDateString()}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lead detail modal */}
      {selectedLead && (
        <LeadModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={fetchLeads}
        />
      )}
    </div>
  )
}
