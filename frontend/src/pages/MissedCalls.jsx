import { useState, useEffect } from 'react'
import { callsAPI } from '../lib/api'
import {
  Phone,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Clock,
  Calendar,
  X,
  PhoneMissed,
  MessageSquare,
  CheckCircle,
  AlertCircle,
  CalendarCheck,
  PhoneCall,
  AlertTriangle,
  CircleDot
} from 'lucide-react'

// AI Status - what happened after the missed call
function AIStatusBadge({ status, appointmentBooked }) {
  if (appointmentBooked) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success-500/10 text-success-400 border border-success-500/20">
        <CalendarCheck className="w-3 h-3" />
        Booked
      </span>
    )
  }

  const config = {
    'completed': { label: 'Replied', color: 'bg-success-500/10 text-success-400 border-success-500/20', icon: CheckCircle },
    'in_progress': { label: 'SMS Sent', color: 'bg-accent-500/10 text-accent-400 border-accent-500/20', icon: MessageSquare },
    'in-progress': { label: 'SMS Sent', color: 'bg-accent-500/10 text-accent-400 border-accent-500/20', icon: MessageSquare },
    'pending': { label: 'Pending', color: 'bg-warning-500/10 text-warning-400 border-warning-500/20', icon: Clock },
    'no_response': { label: 'No Response', color: 'bg-dark-600/50 text-dark-400 border-dark-600/50', icon: AlertCircle }
  }

  const { label, color, icon: Icon } = config[status] || config.pending

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${color}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}

// AI Intent - why they likely called
function AIIntentBadge({ reason }) {
  if (!reason) return <span className="text-dark-500 text-sm">-</span>

  const lowerReason = reason.toLowerCase()

  if (lowerReason.includes('book') || lowerReason.includes('appointment')) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-400">
        <CalendarCheck className="w-3 h-3" />
        Booking
      </span>
    )
  }

  if (lowerReason.includes('callback') || lowerReason.includes('call back')) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-warning-500/10 text-warning-400">
        <PhoneCall className="w-3 h-3" />
        Callback
      </span>
    )
  }

  if (lowerReason.includes('emergency') || lowerReason.includes('urgent') || lowerReason.includes('pain')) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-danger-500/10 text-danger-400">
        <AlertTriangle className="w-3 h-3" />
        Urgent
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-dark-700 text-dark-300">
      <CircleDot className="w-3 h-3" />
      Inquiry
    </span>
  )
}

// Action Required indicator
function ActionRequired({ call }) {
  // Action required if: no response, pending, or callback requested
  const needsAction = !call.appointmentBooked && (
    call.followupStatus === 'no_response' ||
    call.followupStatus === 'pending' ||
    call.callReason?.toLowerCase().includes('callback')
  )

  if (!needsAction) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-dark-500">
        <CheckCircle className="w-3 h-3" />
        Handled
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-danger-500/20 text-danger-400 border border-danger-500/30 animate-pulse">
      <AlertCircle className="w-3 h-3" />
      Action Required
    </span>
  )
}

function CallDetailModal({ call, onClose }) {
  if (!call) return null

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('en-AU', {
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

      <div className="relative w-full max-w-2xl bg-dark-900 rounded-2xl border border-dark-700/50 shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-dark-800">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent-500/10 flex items-center justify-center">
              <PhoneMissed className="w-6 h-6 text-accent-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-dark-100">
                {call.callerName || 'Unknown Caller'}
              </h3>
              <p className="text-sm text-dark-400">{call.callerPhone}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-dark-400 hover:text-dark-100 hover:bg-dark-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Status Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-dark-800/50">
              <p className="text-xs text-dark-500 mb-2">AI Status</p>
              <AIStatusBadge status={call.followupStatus} appointmentBooked={call.appointmentBooked} />
            </div>
            <div className="p-4 rounded-lg bg-dark-800/50">
              <p className="text-xs text-dark-500 mb-2">Likely Intent</p>
              <AIIntentBadge reason={call.callReason} />
            </div>
          </div>

          {/* Time */}
          <div className="p-4 rounded-lg bg-dark-800/50">
            <p className="text-xs text-dark-500 mb-1">Missed Call Time</p>
            <p className="text-sm font-medium text-dark-200 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-dark-400" />
              {formatDate(call.createdAt)}
            </p>
          </div>

          {/* Reason */}
          {call.callReason && (
            <div>
              <p className="text-sm font-medium text-dark-300 mb-2">AI Detected Intent</p>
              <div className="px-4 py-3 rounded-lg bg-dark-800/50 text-dark-200">
                {call.callReason}
              </div>
            </div>
          )}

          {/* Action status */}
          <div className="p-4 rounded-lg bg-accent-500/5 border border-accent-500/20">
            <div className="flex items-start gap-3">
              <MessageSquare className="w-5 h-5 text-accent-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-accent-400">SMS Follow-up</p>
                <p className="text-xs text-accent-300/70 mt-1">
                  {call.appointmentBooked
                    ? 'Patient has booked an appointment.'
                    : call.followupStatus === 'completed'
                    ? 'Patient has replied to the SMS.'
                    : call.followupStatus === 'in_progress' || call.followupStatus === 'in-progress'
                    ? 'SMS sent. Waiting for reply.'
                    : call.followupStatus === 'no_response'
                    ? 'No response received. May need manual follow-up.'
                    : 'SMS will be sent automatically.'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-dark-800">
          <button onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MissedCalls() {
  const [calls, setCalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedCall, setSelectedCall] = useState(null)

  const fetchCalls = async () => {
    setLoading(true)
    try {
      const params = {
        page: pagination.page,
        limit: 15,
        ...(search && { search }),
        ...(statusFilter && { status: statusFilter })
      }
      const response = await callsAPI.getAll(params)
      setCalls(response.data.calls)
      setPagination(response.data.pagination)
    } catch (error) {
      console.error('Failed to fetch missed calls:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCalls()
  }, [pagination.page, search, statusFilter])

  const formatTime = (dateString) => {
    const date = new Date(dateString)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
      return `Today ${date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true })}`
    } else if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday ${date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true })}`
    }

    return date.toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  // Sort: Action Required first
  const sortedCalls = [...calls].sort((a, b) => {
    const aNeeds = !a.appointmentBooked && (a.followupStatus === 'no_response' || a.followupStatus === 'pending')
    const bNeeds = !b.appointmentBooked && (b.followupStatus === 'no_response' || b.followupStatus === 'pending')
    if (aNeeds && !bNeeds) return -1
    if (!aNeeds && bNeeds) return 1
    return 0
  })

  const actionRequiredCount = calls.filter(c =>
    !c.appointmentBooked && (c.followupStatus === 'no_response' || c.followupStatus === 'pending')
  ).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Missed Calls</h1>
          <p className="text-dark-400 mt-1">
            Calls that need follow-up. AI sends SMS automatically.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {actionRequiredCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-danger-500/10 border border-danger-500/20">
              <AlertCircle className="w-4 h-4 text-danger-400" />
              <span className="text-sm font-medium text-danger-400">{actionRequiredCount} need action</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-dark-400">
            <PhoneMissed className="w-4 h-4" />
            <span>{pagination.total} total</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPagination(p => ({ ...p, page: 1 }))
            }}
            placeholder="Search by name or phone..."
            className="input pl-12"
          />
        </div>

        <div className="relative">
          <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPagination(p => ({ ...p, page: 1 }))
            }}
            className="input pl-12 pr-10 appearance-none cursor-pointer min-w-[180px]"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">SMS Sent</option>
            <option value="completed">Replied</option>
            <option value="no_response">No Response</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-800">
                <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                  Caller
                </th>
                <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                  Time
                </th>
                <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                  Intent
                </th>
                <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                  AI Status
                </th>
                <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-800/50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-dark-400 text-sm">Loading...</p>
                    </div>
                  </td>
                </tr>
              ) : sortedCalls.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <PhoneMissed className="w-8 h-8 text-dark-600 mx-auto mb-3" />
                    <p className="text-dark-400">No missed calls</p>
                    <p className="text-dark-500 text-sm mt-1">
                      {search || statusFilter ? 'Try adjusting your filters' : 'Missed calls will appear here'}
                    </p>
                  </td>
                </tr>
              ) : (
                sortedCalls.map((call) => (
                  <tr
                    key={call.id}
                    onClick={() => setSelectedCall(call)}
                    className="hover:bg-dark-800/30 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-medium text-dark-200">
                          {call.callerName || 'Unknown'}
                        </p>
                        <p className="text-xs text-dark-500">{call.callerPhone}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-dark-400">
                        {formatTime(call.createdAt)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <AIIntentBadge reason={call.callReason} />
                    </td>
                    <td className="px-6 py-4">
                      <AIStatusBadge status={call.followupStatus} appointmentBooked={call.appointmentBooked} />
                    </td>
                    <td className="px-6 py-4">
                      <ActionRequired call={call} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-dark-800">
            <p className="text-sm text-dark-400">
              Page {pagination.page} of {pagination.totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                disabled={pagination.page === 1}
                className="btn-ghost p-2 disabled:opacity-50"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                disabled={pagination.page === pagination.totalPages}
                className="btn-ghost p-2 disabled:opacity-50"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedCall && (
        <CallDetailModal call={selectedCall} onClose={() => setSelectedCall(null)} />
      )}
    </div>
  )
}
