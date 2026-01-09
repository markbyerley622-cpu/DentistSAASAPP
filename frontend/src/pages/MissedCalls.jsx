import { useState, useEffect } from 'react'
import { callsAPI } from '../lib/api'
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Phone,
  X,
  PhoneMissed,
  CheckCircle2,
  Clock,
  Calendar,
  Sparkles,
  PartyPopper,
  Sun,
  Moon
} from 'lucide-react'

// Beautiful status badges with clear meaning
function CallStatus({ call }) {
  // BOOKED = They're coming in!
  if (call.appointmentBooked) {
    return (
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-success-500/20 to-success-600/20 flex items-center justify-center ring-1 ring-success-500/30">
          <CheckCircle2 className="w-5 h-5 text-success-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-success-400">Booked</p>
          <p className="text-xs text-success-400/60">Appointment made</p>
        </div>
      </div>
    )
  }

  // REPLIED = They texted back
  if (call.followupStatus === 'completed') {
    return (
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500/20 to-accent-600/20 flex items-center justify-center ring-1 ring-accent-500/30">
          <CheckCircle2 className="w-5 h-5 text-accent-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-accent-400">Replied</p>
          <p className="text-xs text-accent-400/60">Check Follow-Ups</p>
        </div>
      </div>
    )
  }

  // WAITING = SMS sent, fingers crossed
  if (call.followupStatus === 'in_progress' || call.followupStatus === 'in-progress') {
    return (
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-warning-500/20 to-warning-600/20 flex items-center justify-center ring-1 ring-warning-500/30">
          <Clock className="w-5 h-5 text-warning-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-warning-400">Waiting</p>
          <p className="text-xs text-warning-400/60">SMS sent</p>
        </div>
      </div>
    )
  }

  // CALL THEM = No response, needs attention
  if (call.followupStatus === 'no_response') {
    return (
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-danger-500/20 to-danger-600/20 flex items-center justify-center ring-1 ring-danger-500/30 animate-pulse">
          <Phone className="w-5 h-5 text-danger-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-danger-400">Call Them</p>
          <p className="text-xs text-danger-400/60">No reply to SMS</p>
        </div>
      </div>
    )
  }

  // SENDING = Going out now
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-dark-700 to-dark-800 flex items-center justify-center ring-1 ring-dark-600">
        <Sparkles className="w-5 h-5 text-dark-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-dark-300">Sending</p>
        <p className="text-xs text-dark-500">SMS going out now</p>
      </div>
    </div>
  )
}

// Beautiful call button
function ActionButton({ call }) {
  if (call.appointmentBooked || call.followupStatus === 'completed') {
    return null
  }

  if (call.followupStatus === 'no_response') {
    return (
      <a
        href={`tel:${call.callerPhone}`}
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-danger-500 to-danger-600 hover:from-danger-600 hover:to-danger-700 text-white font-semibold text-sm shadow-lg shadow-danger-500/25 hover:shadow-danger-500/40 transition-all hover:scale-105"
      >
        <Phone className="w-4 h-4" />
        Call Now
      </a>
    )
  }

  return null
}

// Detail modal - clean and focused
function CallDetailModal({ call, onClose }) {
  if (!call) return null

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-dark-950/90 backdrop-blur-md" onClick={onClose} />

      <div className="relative w-full max-w-md bg-gradient-to-b from-dark-900 to-dark-950 rounded-3xl border border-dark-700/50 shadow-2xl shadow-black/50 animate-scale-in overflow-hidden">
        {/* Gradient accent top */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-accent-500 via-purple-500 to-accent-500" />

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-dark-800/50">
          <div>
            <h3 className="text-xl font-bold text-dark-100">
              {call.callerName || 'Unknown Caller'}
            </h3>
            <p className="text-dark-400 mt-1 font-mono">{call.callerPhone}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 rounded-xl text-dark-400 hover:text-dark-100 hover:bg-dark-800 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* When */}
          <div className="flex items-center gap-4 p-4 rounded-2xl bg-dark-800/30 border border-dark-700/30">
            <div className="w-10 h-10 rounded-xl bg-dark-700/50 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-dark-400" />
            </div>
            <div>
              <p className="text-xs text-dark-500 uppercase tracking-wide">Missed call</p>
              <p className="text-sm text-dark-200 font-medium mt-0.5">{formatDate(call.createdAt)}</p>
            </div>
          </div>

          {/* Status */}
          <div className="p-4 rounded-2xl bg-dark-800/30 border border-dark-700/30">
            <p className="text-xs text-dark-500 uppercase tracking-wide mb-3">Status</p>
            <CallStatus call={call} />
          </div>

          {/* What they wanted */}
          {call.callReason && (
            <div className="p-4 rounded-2xl bg-dark-800/30 border border-dark-700/30">
              <p className="text-xs text-dark-500 uppercase tracking-wide mb-2">What they wanted</p>
              <p className="text-sm text-dark-200">{call.callReason}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-dark-800/50 bg-dark-900/50">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-xl bg-dark-800 hover:bg-dark-700 text-dark-200 font-medium transition-colors"
          >
            Close
          </button>
          {(call.followupStatus === 'no_response' || call.followupStatus === 'pending') && (
            <a
              href={`tel:${call.callerPhone}`}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-danger-500 to-danger-600 hover:from-danger-600 hover:to-danger-700 text-white font-semibold shadow-lg shadow-danger-500/25 transition-all"
            >
              <Phone className="w-4 h-4" />
              Call Them
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// Call card component
function CallCard({ call, onClick, formatTime }) {
  return (
    <div
      onClick={() => onClick(call)}
      className={`group p-5 rounded-2xl border cursor-pointer transition-all duration-200 hover:shadow-xl ${
        call.followupStatus === 'no_response'
          ? 'bg-gradient-to-r from-danger-500/10 to-danger-500/5 border-danger-500/30 hover:border-danger-500/50 hover:shadow-danger-500/10'
          : call.appointmentBooked
          ? 'bg-gradient-to-r from-success-500/10 to-success-500/5 border-success-500/30 hover:border-success-500/50 hover:shadow-success-500/10'
          : 'bg-dark-800/30 border-dark-700/50 hover:border-dark-600 hover:bg-dark-800/50'
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Left: Who + When */}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-dark-100 text-lg truncate group-hover:text-white transition-colors">
            {call.callerName || call.callerPhone}
          </p>
          {call.callerName && (
            <p className="text-dark-400 text-sm font-mono mt-0.5">{call.callerPhone}</p>
          )}
          <p className="text-dark-500 text-sm mt-2 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {formatTime(call.createdAt)}
          </p>
        </div>

        {/* Right: Status + Action */}
        <div className="flex items-center gap-5">
          <div className="hidden sm:block">
            <CallStatus call={call} />
          </div>
          <ActionButton call={call} />
        </div>
      </div>

      {/* Mobile: Status below */}
      <div className="sm:hidden mt-4 pt-4 border-t border-dark-700/30">
        <div className="flex items-center justify-between">
          <CallStatus call={call} />
          <ActionButton call={call} />
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
  const [selectedCall, setSelectedCall] = useState(null)

  const fetchCalls = async () => {
    setLoading(true)
    try {
      const params = {
        page: pagination.page,
        limit: 50, // Get more since we're filtering to 48 hours
        recentOnly: 'true', // Last 48 hours only
        ...(search && { search })
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
  }, [pagination.page, search])

  const formatTime = (dateString) => {
    const date = new Date(dateString)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const time = date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true })

    if (date.toDateString() === today.toDateString()) {
      return `Today, ${time}`
    } else if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday, ${time}`
    }

    return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) + `, ${time}`
  }

  // Sort by priority: Need to call first, then waiting, then done
  const sortByPriority = (callsList) => {
    return [...callsList].sort((a, b) => {
      const priority = (call) => {
        if (call.followupStatus === 'no_response') return 0
        if (call.followupStatus === 'pending') return 1
        if (call.followupStatus === 'in_progress' || call.followupStatus === 'in-progress') return 2
        if (call.followupStatus === 'completed' && !call.appointmentBooked) return 3
        return 4
      }
      return priority(a) - priority(b)
    })
  }

  // Separate calls into during hours and after hours
  const duringHoursCalls = sortByPriority(calls.filter(c => c.isDuringBusinessHours))
  const afterHoursCalls = sortByPriority(calls.filter(c => !c.isDuringBusinessHours))

  const needCallCount = calls.filter(c => c.followupStatus === 'no_response').length
  const duringHoursNeedCall = duringHoursCalls.filter(c => c.followupStatus === 'no_response').length
  const afterHoursNeedCall = afterHoursCalls.filter(c => c.followupStatus === 'no_response').length

  return (
    <div className="space-y-8">
      {/* Header - Big and clear */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-dark-100">Missed Calls</h1>
          <p className="text-dark-500 text-sm mt-1">Last 48 hours</p>
          {needCallCount > 0 ? (
            <div className="flex items-center gap-2 mt-2">
              <div className="w-2 h-2 rounded-full bg-danger-500 animate-pulse" />
              <p className="text-danger-400 font-medium">
                {needCallCount} {needCallCount === 1 ? 'person needs' : 'people need'} a call back
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-2">
              <PartyPopper className="w-5 h-5 text-success-400" />
              <p className="text-success-400 font-medium">All caught up! Great job!</p>
            </div>
          )}
        </div>

        {/* Total count badge */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-dark-800/50 border border-dark-700/50">
          <PhoneMissed className="w-4 h-4 text-dark-400" />
          <span className="text-sm text-dark-300 font-medium">{pagination.total} calls</span>
        </div>
      </div>

      {/* Search - Clean and obvious */}
      <div className="relative max-w-lg">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPagination(p => ({ ...p, page: 1 }))
          }}
          placeholder="Search by name or phone number..."
          className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-dark-800/50 border border-dark-700/50 text-dark-100 placeholder:text-dark-500 focus:outline-none focus:border-accent-500/50 focus:ring-2 focus:ring-accent-500/20 transition-all"
        />
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-accent-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-dark-400 font-medium">Loading calls...</p>
          </div>
        </div>
      ) : calls.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-20 h-20 rounded-2xl bg-dark-800/50 flex items-center justify-center mx-auto mb-6">
            <PhoneMissed className="w-10 h-10 text-dark-600" />
          </div>
          <p className="text-dark-200 text-xl font-semibold">No missed calls</p>
          <p className="text-dark-500 mt-2 max-w-sm mx-auto">
            {search ? 'Try a different search term' : 'When someone calls and you miss it, they\'ll show up here'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* During Business Hours Section */}
          {duringHoursCalls.length > 0 && (
            <div className="space-y-4">
              {/* Section Header */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-warning-500/20 to-orange-500/20 flex items-center justify-center ring-1 ring-warning-500/30">
                  <Sun className="w-5 h-5 text-warning-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-dark-100">During Business Hours</h2>
                  <p className="text-sm text-dark-500">
                    {duringHoursCalls.length} {duringHoursCalls.length === 1 ? 'call' : 'calls'}
                    {duringHoursNeedCall > 0 && (
                      <span className="text-danger-400 ml-2">• {duringHoursNeedCall} need callback</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Calls list */}
              <div className="space-y-3 pl-2 border-l-2 border-warning-500/30 ml-5">
                {duringHoursCalls.map((call) => (
                  <CallCard
                    key={call.id}
                    call={call}
                    onClick={setSelectedCall}
                    formatTime={formatTime}
                  />
                ))}
              </div>
            </div>
          )}

          {/* After Hours Section */}
          {afterHoursCalls.length > 0 && (
            <div className="space-y-4">
              {/* Section Header */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 flex items-center justify-center ring-1 ring-purple-500/30">
                  <Moon className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-dark-100">After Hours & Weekends</h2>
                  <p className="text-sm text-dark-500">
                    {afterHoursCalls.length} {afterHoursCalls.length === 1 ? 'call' : 'calls'} • AI handled these
                    {afterHoursNeedCall > 0 && (
                      <span className="text-danger-400 ml-2">• {afterHoursNeedCall} need callback</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Calls list */}
              <div className="space-y-3 pl-2 border-l-2 border-purple-500/30 ml-5">
                {afterHoursCalls.map((call) => (
                  <CallCard
                    key={call.id}
                    call={call}
                    onClick={setSelectedCall}
                    formatTime={formatTime}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <p className="text-sm text-dark-400">
            Page <span className="font-medium text-dark-200">{pagination.page}</span> of <span className="font-medium text-dark-200">{pagination.totalPages}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
              disabled={pagination.page === 1}
              className="p-2.5 rounded-xl bg-dark-800 text-dark-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-dark-700 hover:text-dark-100 transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
              disabled={pagination.page === pagination.totalPages}
              className="p-2.5 rounded-xl bg-dark-800 text-dark-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-dark-700 hover:text-dark-100 transition-all"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selectedCall && (
        <CallDetailModal call={selectedCall} onClose={() => setSelectedCall(null)} />
      )}
    </div>
  )
}
