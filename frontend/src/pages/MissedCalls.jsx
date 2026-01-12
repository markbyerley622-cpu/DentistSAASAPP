import { useState, useEffect, useCallback } from 'react'
import { callsAPI } from '../lib/api'
import {
  Search,
  Phone,
  PhoneMissed,
  Check,
  Clock,
  Calendar,
  MessageSquare,
  AlertCircle,
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

// Call type badge - simplified for receptionist
function CallTypeBadge({ callbackType, aiStatus }) {
  if (callbackType === 'appointment_request') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-xs font-medium">
        <Calendar className="w-3 h-3" />
        Appointment Requested
      </span>
    )
  }
  if (callbackType === 'general_callback') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 text-xs font-medium">
        <Phone className="w-3 h-3" />
        General Enquiry
      </span>
    )
  }
  if (aiStatus === 'no_response') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-danger-500/20 text-danger-400 text-xs font-medium">
        <AlertCircle className="w-3 h-3" />
        No Response
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-dark-600 text-dark-400 text-xs font-medium">
      <MessageSquare className="w-3 h-3" />
      Initial SMS Sent
    </span>
  )
}

// AI status indicator - shows status with callback needed indicator
function AIStatusBadge({ aiStatus }) {
  switch (aiStatus) {
    case 'replied':
      return (
        <div className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success-500/20 text-success-400 text-xs font-medium">
            <CheckCircle2 className="w-3 h-3" />
            Replied
          </span>
          <span className="text-xs font-medium text-danger-400">
            Needs Callback
          </span>
        </div>
      )
    case 'waiting':
      return (
        <div className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-warning-500/20 text-warning-400 text-xs font-medium">
            <Clock className="w-3 h-3" />
            Waiting
          </span>
          <span className="text-xs font-medium text-danger-400">
            Needs Callback
          </span>
        </div>
      )
    case 'no_response':
      return (
        <div className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-danger-500/20 text-danger-400 text-xs font-medium">
            <AlertCircle className="w-3 h-3" />
            No Response
          </span>
          <span className="text-xs font-medium text-danger-400">
            Needs Callback
          </span>
        </div>
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
  const [activeCalls, setActiveCalls] = useState([])
  const [historyCalls, setHistoryCalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [markingIds, setMarkingIds] = useState(new Set())
  const [showHistory, setShowHistory] = useState(false)

  // Fetch active and history calls
  const fetchActiveCalls = useCallback(async () => {
    try {
      const response = await callsAPI.getAll({
        recentOnly: 'true',
        limit: 100,
        ...(search && { search })
      })

      // Separate pending and completed calls
      const pending = []
      const completed = []

      response.data.calls.forEach(call => {
        let aiStatus = 'sending'
        if (call.handledByAi && call.callbackType) {
          aiStatus = 'replied'
        } else if (call.followupStatus === 'no_response') {
          aiStatus = 'no_response'
        } else if (call.followupStatus === 'in_progress') {
          aiStatus = 'waiting'
        }

        const enrichedCall = { ...call, aiStatus }

        if (call.receptionistStatus === 'done' || call.followupStatus === 'completed') {
          completed.push(enrichedCall)
        } else {
          pending.push(enrichedCall)
        }
      })

      setActiveCalls(pending)
      setHistoryCalls(completed)
    } catch (error) {
      console.error('Failed to fetch active calls:', error)
    }
  }, [search])

  // Initial load
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await fetchActiveCalls()
      setLoading(false)
    }
    load()
  }, [fetchActiveCalls])

  // Mark call as done - optimistic update, move to history
  const handleMarkDone = async (callId) => {
    // Prevent double-clicks
    if (markingIds.has(callId)) return
    setMarkingIds(prev => new Set(prev).add(callId))

    // Optimistic: Move from active to history immediately
    const callToMove = activeCalls.find(c => c.id === callId)
    setActiveCalls(prev => prev.filter(c => c.id !== callId))
    if (callToMove) {
      setHistoryCalls(prev => [callToMove, ...prev])
    }

    try {
      await callsAPI.update(callId, {
        receptionistStatus: 'done',
        followupStatus: 'completed'
      })
    } catch (error) {
      console.error('Failed to mark as done:', error)
      // Rollback: Move back from history to active
      if (callToMove) {
        setHistoryCalls(prev => prev.filter(c => c.id !== callId))
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

  // All active calls need callback (except those still sending initial SMS)
  const needsCallbackCount = activeCalls.filter(
    c => c.aiStatus !== 'sending'
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
      ) : (
        /* Active Calls - Cards on mobile, Table on desktop */
        <div className="bg-dark-800/50 rounded-xl border border-dark-700/50 overflow-hidden">
          {activeCalls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <CheckCircle2 className="w-12 h-12 text-success-500/50 mb-4" />
              <p className="text-dark-300 font-medium">All caught up!</p>
              <p className="text-dark-500 text-sm mt-1">No missed calls need your attention.</p>
            </div>
          ) : (
            <>
              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-dark-700/30">
                {activeCalls.map((call) => (
                  <div key={call.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-dark-100">
                          {call.callerName || formatPhone(call.callerPhone)}
                        </p>
                        <p className="text-xs text-dark-500 mt-0.5">
                          {formatTime(call.createdAt)}
                        </p>
                      </div>
                      <AIStatusBadge aiStatus={call.aiStatus} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <CallTypeBadge callbackType={call.callbackType} aiStatus={call.aiStatus} />
                      <button
                        onClick={() => handleMarkDone(call.id)}
                        disabled={markingIds.has(call.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-300 hover:text-dark-100 text-sm font-medium transition-colors border border-dark-600 disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" />
                        Mark as done
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table */}
              <table className="w-full hidden md:table">
                <thead>
                  <tr className="border-b border-dark-700/50">
                    <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                      Phone
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                      Time
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                      Status
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
                      <td className="py-3 px-4">
                        <CallTypeBadge callbackType={call.callbackType} aiStatus={call.aiStatus} />
                      </td>
                      <td className="py-3 px-4">
                        <AIStatusBadge aiStatus={call.aiStatus} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleMarkDone(call.id)}
                          disabled={markingIds.has(call.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-300 hover:text-dark-100 text-sm font-medium transition-colors border border-dark-600 disabled:opacity-50"
                        >
                          <Check className="w-4 h-4" />
                          Mark as done
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* History Section */}
      {!loading && historyCalls.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 text-dark-400 hover:text-dark-200 text-sm font-medium transition-colors mb-4"
          >
            <span className={`transform transition-transform ${showHistory ? 'rotate-90' : ''}`}>▶</span>
            History ({historyCalls.length} completed)
          </button>

          {showHistory && (
            <div className="bg-dark-800/30 rounded-xl border border-dark-700/30 overflow-hidden">
              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-dark-700/20">
                {historyCalls.map((call) => (
                  <div key={call.id} className="p-4 space-y-2 opacity-60">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-dark-300">
                          {call.callerName || formatPhone(call.callerPhone)}
                        </p>
                        <p className="text-xs text-dark-500 mt-0.5">
                          {formatTime(call.createdAt)}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-dark-700/50 text-dark-400 text-xs font-medium">
                        <Check className="w-3 h-3 text-success-500" />
                        Done
                      </span>
                    </div>
                    <CallTypeBadge callbackType={call.callbackType} aiStatus={call.aiStatus} />
                  </div>
                ))}
              </div>

              {/* Desktop Table */}
              <table className="w-full hidden md:table">
                <thead>
                  <tr className="border-b border-dark-700/30">
                    <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                      Phone
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                      Time
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-dark-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700/20">
                  {historyCalls.map((call) => (
                    <tr key={call.id} className="opacity-60">
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium text-dark-300">
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
                      <td className="py-3 px-4">
                        <CallTypeBadge callbackType={call.callbackType} aiStatus={call.aiStatus} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700/50 text-dark-400 text-sm font-medium">
                          <Check className="w-4 h-4 text-success-500" />
                          Marked as done
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
