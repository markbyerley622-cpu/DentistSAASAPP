import { useState, useEffect, useCallback } from 'react'
import { callsAPI } from '../lib/api'
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Phone,
  PhoneMissed,
  Check,
  Clock,
  Calendar,
  MessageSquare,
  AlertCircle,
  History,
  Undo2,
  CheckCircle2
} from 'lucide-react'

// Format phone for display
function formatPhone(phone) {
  if (!phone) return 'Unknown'
  // Australian format: 0412 345 678
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 10 && cleaned.startsWith('0')) {
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`
  }
  if (cleaned.length === 11 && cleaned.startsWith('61')) {
    return `0${cleaned.slice(2, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`
  }
  return phone
}

// Format time for display
function formatTime(dateString) {
  const date = new Date(dateString)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  const time = date.toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })

  if (date.toDateString() === now.toDateString()) {
    return `Today ${time}`
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${time}`
  }
  return date.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  }) + ` ${time}`
}

// Call type badge
function CallTypeBadge({ callbackType }) {
  if (callbackType === 'appointment_request') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-xs font-medium">
        <Calendar className="w-3 h-3" />
        Appointment
      </span>
    )
  }
  if (callbackType === 'general_callback') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 text-xs font-medium">
        <Phone className="w-3 h-3" />
        Other
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-dark-600 text-dark-400 text-xs font-medium">
      <MessageSquare className="w-3 h-3" />
      Pending
    </span>
  )
}

// AI status indicator
function AIStatusBadge({ aiStatus }) {
  switch (aiStatus) {
    case 'replied':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success-500/20 text-success-400 text-xs font-medium">
          <CheckCircle2 className="w-3 h-3" />
          Replied
        </span>
      )
    case 'waiting':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-warning-500/20 text-warning-400 text-xs font-medium">
          <Clock className="w-3 h-3" />
          Waiting
        </span>
      )
    case 'no_response':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-danger-500/20 text-danger-400 text-xs font-medium">
          <AlertCircle className="w-3 h-3" />
          No Reply
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-dark-600 text-dark-400 text-xs font-medium">
          <Clock className="w-3 h-3" />
          Sending
        </span>
      )
  }
}

export default function MissedCalls() {
  const [activeTab, setActiveTab] = useState('active')
  const [activeCalls, setActiveCalls] = useState([])
  const [historyCalls, setHistoryCalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [historyPagination, setHistoryPagination] = useState({ page: 1, totalPages: 1 })
  const [markingIds, setMarkingIds] = useState(new Set())

  // Fetch active calls
  const fetchActiveCalls = useCallback(async () => {
    try {
      const response = await callsAPI.getAll({
        recentOnly: 'true',
        limit: 100,
        ...(search && { search })
      })

      // Filter to only pending calls and compute AI status
      const pending = response.data.calls
        .filter(c => c.receptionistStatus !== 'done' && c.followupStatus !== 'completed')
        .map(call => {
          let aiStatus = 'sending'
          if (call.handledByAi && call.callbackType) {
            aiStatus = 'replied'
          } else if (call.followupStatus === 'no_response') {
            aiStatus = 'no_response'
          } else if (call.followupStatus === 'in_progress') {
            aiStatus = 'waiting'
          }
          return { ...call, aiStatus }
        })

      setActiveCalls(pending)
    } catch (error) {
      console.error('Failed to fetch active calls:', error)
    }
  }, [search])

  // Fetch history calls
  const fetchHistoryCalls = useCallback(async () => {
    try {
      const response = await callsAPI.getAll({
        recentOnly: 'true',
        limit: 50,
        page: historyPagination.page,
        ...(search && { search })
      })

      // Filter to only done calls
      const done = response.data.calls.filter(
        c => c.receptionistStatus === 'done' || c.followupStatus === 'completed'
      )

      setHistoryCalls(done)
      setHistoryPagination(prev => ({
        ...prev,
        totalPages: Math.ceil(done.length / 50) || 1
      }))
    } catch (error) {
      console.error('Failed to fetch history:', error)
    }
  }, [search, historyPagination.page])

  // Initial load
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await Promise.all([fetchActiveCalls(), fetchHistoryCalls()])
      setLoading(false)
    }
    load()
  }, [fetchActiveCalls, fetchHistoryCalls])

  // Mark call as done - optimistic update
  const handleMarkDone = async (callId) => {
    // Prevent double-clicks
    if (markingIds.has(callId)) return
    setMarkingIds(prev => new Set(prev).add(callId))

    // Optimistic: Remove from active immediately
    const callToMove = activeCalls.find(c => c.id === callId)
    setActiveCalls(prev => prev.filter(c => c.id !== callId))

    try {
      await callsAPI.update(callId, {
        receptionistStatus: 'done',
        followupStatus: 'completed'
      })

      // Add to history
      if (callToMove) {
        setHistoryCalls(prev => [
          { ...callToMove, markedDoneAt: new Date().toISOString() },
          ...prev
        ])
      }
    } catch (error) {
      console.error('Failed to mark as done:', error)
      // Rollback: Add back to active
      if (callToMove) {
        setActiveCalls(prev => [callToMove, ...prev])
      }
    } finally {
      setMarkingIds(prev => {
        const next = new Set(prev)
        next.delete(callId)
        return next
      })
    }
  }

  // Undo - move back to active
  const handleUndo = async (callId) => {
    if (markingIds.has(callId)) return
    setMarkingIds(prev => new Set(prev).add(callId))

    const callToMove = historyCalls.find(c => c.id === callId)
    setHistoryCalls(prev => prev.filter(c => c.id !== callId))

    try {
      await callsAPI.update(callId, {
        receptionistStatus: 'pending',
        followupStatus: 'in_progress'
      })

      if (callToMove) {
        setActiveCalls(prev => [{ ...callToMove, receptionistStatus: 'pending' }, ...prev])
      }
    } catch (error) {
      console.error('Failed to undo:', error)
      if (callToMove) {
        setHistoryCalls(prev => [callToMove, ...prev])
      }
    } finally {
      setMarkingIds(prev => {
        const next = new Set(prev)
        next.delete(callId)
        return next
      })
    }
  }

  const needsCallbackCount = activeCalls.filter(
    c => c.aiStatus === 'no_response' || c.aiStatus === 'replied'
  ).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Missed Calls</h1>
          <p className="text-dark-500 text-sm mt-1">Last 48 hours</p>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4">
          {needsCallbackCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-danger-500/10 border border-danger-500/20">
              <div className="w-2 h-2 rounded-full bg-danger-500 animate-pulse" />
              <span className="text-sm font-medium text-danger-400">
                {needsCallbackCount} need callback
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-800 border border-dark-700">
            <PhoneMissed className="w-4 h-4 text-dark-400" />
            <span className="text-sm text-dark-300">{activeCalls.length} active</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-dark-800/50 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'active'
              ? 'bg-dark-700 text-dark-100'
              : 'text-dark-400 hover:text-dark-200'
          }`}
        >
          Active ({activeCalls.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'history'
              ? 'bg-dark-700 text-dark-100'
              : 'text-dark-400 hover:text-dark-200'
          }`}
        >
          <History className="w-4 h-4" />
          History
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone..."
          className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-dark-800 border border-dark-700 text-dark-100 placeholder:text-dark-500 text-sm focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/20"
        />
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-dark-400">Loading...</span>
          </div>
        </div>
      ) : activeTab === 'active' ? (
        /* Active Calls Table */
        <div className="bg-dark-800/50 rounded-xl border border-dark-700/50 overflow-hidden">
          {activeCalls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <CheckCircle2 className="w-12 h-12 text-success-500/50 mb-4" />
              <p className="text-dark-300 font-medium">All caught up!</p>
              <p className="text-dark-500 text-sm mt-1">No missed calls need your attention.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-700/50">
                  <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                    Phone
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                    Time
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider hidden sm:table-cell">
                    Type
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider hidden md:table-cell">
                    AI Status
                  </th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/30">
                {activeCalls.map((call) => (
                  <tr
                    key={call.id}
                    className="hover:bg-dark-700/30 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div>
                        <p className="font-medium text-dark-100">
                          {call.callerName || formatPhone(call.callerPhone)}
                        </p>
                        {call.callerName && (
                          <p className="text-xs text-dark-500 font-mono mt-0.5">
                            {formatPhone(call.callerPhone)}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-dark-300">
                        {formatTime(call.createdAt)}
                      </span>
                    </td>
                    <td className="py-3 px-4 hidden sm:table-cell">
                      <CallTypeBadge callbackType={call.callbackType} />
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell">
                      <AIStatusBadge aiStatus={call.aiStatus} />
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleMarkDone(call.id)}
                        disabled={markingIds.has(call.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success-500/10 hover:bg-success-500/20 text-success-400 text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" />
                        Done
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        /* History Table */
        <div className="bg-dark-800/50 rounded-xl border border-dark-700/50 overflow-hidden">
          {historyCalls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <History className="w-12 h-12 text-dark-600 mb-4" />
              <p className="text-dark-400">No history yet</p>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-dark-700/50">
                    <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                      Phone
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                      Missed At
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider hidden sm:table-cell">
                      Type
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider hidden md:table-cell">
                      Completed
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700/30">
                  {historyCalls.map((call) => (
                    <tr
                      key={call.id}
                      className="hover:bg-dark-700/30 transition-colors opacity-75"
                    >
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium text-dark-200">
                            {call.callerName || formatPhone(call.callerPhone)}
                          </p>
                          {call.callerName && (
                            <p className="text-xs text-dark-500 font-mono mt-0.5">
                              {formatPhone(call.callerPhone)}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-dark-400">
                          {formatTime(call.createdAt)}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden sm:table-cell">
                        <CallTypeBadge callbackType={call.callbackType} />
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <span className="text-sm text-dark-500">
                          {call.markedDoneAt ? formatTime(call.markedDoneAt) : '-'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleUndo(call.id)}
                          disabled={markingIds.has(call.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-300 text-sm transition-colors disabled:opacity-50"
                          title="Move back to active"
                        >
                          <Undo2 className="w-4 h-4" />
                          Undo
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* History Pagination */}
              {historyPagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-dark-700/50">
                  <span className="text-sm text-dark-500">
                    Page {historyPagination.page} of {historyPagination.totalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setHistoryPagination(p => ({ ...p, page: p.page - 1 }))}
                      disabled={historyPagination.page === 1}
                      className="p-2 rounded-lg bg-dark-700 text-dark-300 disabled:opacity-40 hover:bg-dark-600 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setHistoryPagination(p => ({ ...p, page: p.page + 1 }))}
                      disabled={historyPagination.page === historyPagination.totalPages}
                      className="p-2 rounded-lg bg-dark-700 text-dark-300 disabled:opacity-40 hover:bg-dark-600 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
