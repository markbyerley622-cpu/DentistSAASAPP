import { useState, useEffect } from 'react'
import { callsAPI } from '../lib/api'
import {
  Phone,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Play,
  FileText,
  Clock,
  Calendar,
  X,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff
} from 'lucide-react'

function StatusBadge({ status }) {
  const styles = {
    'completed': 'bg-success-500/10 text-success-400 border-success-500/20',
    'in-progress': 'bg-warning-500/10 text-warning-400 border-warning-500/20',
    'missed': 'bg-danger-500/10 text-danger-400 border-danger-500/20',
    'failed': 'bg-dark-600/50 text-dark-400 border-dark-600/50'
  }

  const icons = {
    'completed': PhoneIncoming,
    'in-progress': Phone,
    'missed': PhoneMissed,
    'failed': PhoneOff
  }

  const Icon = icons[status] || Phone

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${styles[status] || styles.completed}`}>
      <Icon className="w-3 h-3" />
      {status}
    </span>
  )
}

function CallModal({ call, onClose }) {
  if (!call) return null

  const formatDuration = (seconds) => {
    if (!seconds) return '--:--'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
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
      {/* Backdrop */}
      <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-dark-900 rounded-2xl border border-dark-700/50 shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-dark-800">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent-500/10 flex items-center justify-center">
              <Phone className="w-6 h-6 text-accent-400" />
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
          {/* Meta info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg bg-dark-800/50">
              <p className="text-xs text-dark-500 mb-1">Status</p>
              <StatusBadge status={call.status} />
            </div>
            <div className="p-4 rounded-lg bg-dark-800/50">
              <p className="text-xs text-dark-500 mb-1">Duration</p>
              <p className="text-sm font-medium text-dark-200 flex items-center gap-2">
                <Clock className="w-4 h-4 text-dark-400" />
                {formatDuration(call.duration)}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-dark-800/50 col-span-2">
              <p className="text-xs text-dark-500 mb-1">Date & Time</p>
              <p className="text-sm font-medium text-dark-200 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-dark-400" />
                {formatDate(call.createdAt)}
              </p>
            </div>
          </div>

          {/* Call reason */}
          {call.callReason && (
            <div>
              <p className="text-sm font-medium text-dark-300 mb-2">Call Reason</p>
              <div className="px-4 py-3 rounded-lg bg-dark-800/50 text-dark-200">
                {call.callReason}
              </div>
            </div>
          )}

          {/* Recording */}
          {call.recordingUrl && (
            <div>
              <p className="text-sm font-medium text-dark-300 mb-2">Recording</p>
              <div className="flex items-center gap-4 p-4 rounded-lg bg-dark-800/50">
                <button className="w-10 h-10 rounded-full bg-accent-600 hover:bg-accent-500 flex items-center justify-center transition-colors">
                  <Play className="w-4 h-4 text-white ml-0.5" />
                </button>
                <div className="flex-1">
                  <div className="h-1 bg-dark-700 rounded-full">
                    <div className="h-1 bg-accent-500 rounded-full" style={{ width: '0%' }} />
                  </div>
                </div>
                <span className="text-sm text-dark-400 font-mono">{formatDuration(call.duration)}</span>
              </div>
            </div>
          )}

          {/* Transcription */}
          {call.transcription && (
            <div>
              <p className="text-sm font-medium text-dark-300 mb-2 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Transcription
              </p>
              <div className="p-4 rounded-lg bg-dark-800/50 text-sm text-dark-300 leading-relaxed max-h-48 overflow-y-auto">
                {call.transcription}
              </div>
            </div>
          )}

          {/* AI Summary */}
          {call.aiSummary && (
            <div>
              <p className="text-sm font-medium text-dark-300 mb-2">AI Summary</p>
              <div className="p-4 rounded-lg bg-accent-500/5 border border-accent-500/20 text-sm text-dark-300">
                {call.aiSummary}
              </div>
            </div>
          )}
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

export default function Calls() {
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
        limit: 10,
        ...(search && { search }),
        ...(statusFilter && { status: statusFilter })
      }
      const response = await callsAPI.getAll(params)
      setCalls(response.data.calls)
      setPagination(response.data.pagination)
    } catch (error) {
      console.error('Failed to fetch calls:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCalls()
  }, [pagination.page, search, statusFilter])

  const formatDuration = (seconds) => {
    if (!seconds) return '--:--'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
      return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
    } else if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Missed Calls</h1>
          <p className="text-dark-400 mt-1">
            View all missed calls that triggered instant AI follow-up
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-dark-400">
          <Phone className="w-4 h-4" />
          <span>{pagination.total} missed calls</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPagination(p => ({ ...p, page: 1 }))
            }}
            placeholder="Search by name, phone, or reason..."
            className="input pl-12"
          />
        </div>

        {/* Status filter */}
        <div className="relative">
          <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPagination(p => ({ ...p, page: 1 }))
            }}
            className="input pl-12 pr-10 appearance-none cursor-pointer min-w-[160px]"
          >
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="in-progress">In Progress</option>
            <option value="missed">Missed</option>
            <option value="failed">Failed</option>
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
                  Reason
                </th>
                <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                  Duration
                </th>
                <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                  Time
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-800/50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-dark-400 text-sm">Loading calls...</p>
                    </div>
                  </td>
                </tr>
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <Phone className="w-8 h-8 text-dark-600 mx-auto mb-3" />
                    <p className="text-dark-400">No calls found</p>
                    <p className="text-dark-500 text-sm mt-1">
                      {search || statusFilter ? 'Try adjusting your filters' : 'Calls will appear here once they come in'}
                    </p>
                  </td>
                </tr>
              ) : (
                calls.map((call) => (
                  <tr
                    key={call.id}
                    onClick={() => setSelectedCall(call)}
                    className="hover:bg-dark-800/30 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-medium text-dark-200">
                          {call.callerName || 'Unknown Caller'}
                        </p>
                        <p className="text-xs text-dark-500">{call.callerPhone}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-dark-300">
                        {call.callReason || '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={call.status} />
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-dark-300 font-mono">
                        {formatDuration(call.duration)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-dark-400">
                        {formatDate(call.createdAt)}
                      </span>
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

      {/* Call detail modal */}
      {selectedCall && (
        <CallModal call={selectedCall} onClose={() => setSelectedCall(null)} />
      )}
    </div>
  )
}
