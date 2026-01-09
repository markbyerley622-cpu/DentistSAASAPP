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
  Calendar
} from 'lucide-react'

// Super simple status - just what the receptionist needs to know
function CallStatus({ call }) {
  // BOOKED = Green checkmark, we're done
  if (call.appointmentBooked) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-success-500/20 flex items-center justify-center">
          <CheckCircle2 className="w-5 h-5 text-success-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-success-400">Booked</p>
          <p className="text-xs text-dark-500">No action needed</p>
        </div>
      </div>
    )
  }

  // REPLIED = They responded, check follow-ups
  if (call.followupStatus === 'completed') {
    return (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-accent-500/20 flex items-center justify-center">
          <CheckCircle2 className="w-5 h-5 text-accent-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-accent-400">Replied</p>
          <p className="text-xs text-dark-500">Check Follow-Ups</p>
        </div>
      </div>
    )
  }

  // WAITING = SMS sent, waiting for reply
  if (call.followupStatus === 'in_progress' || call.followupStatus === 'in-progress') {
    return (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-warning-500/20 flex items-center justify-center">
          <Clock className="w-5 h-5 text-warning-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-warning-400">Waiting</p>
          <p className="text-xs text-dark-500">SMS sent, no reply yet</p>
        </div>
      </div>
    )
  }

  // NO RESPONSE = Need to call them
  if (call.followupStatus === 'no_response') {
    return (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-danger-500/20 flex items-center justify-center animate-pulse">
          <Phone className="w-5 h-5 text-danger-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-danger-400">Call Them</p>
          <p className="text-xs text-dark-500">No reply to SMS</p>
        </div>
      </div>
    )
  }

  // PENDING = Will be sent soon
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center">
        <Clock className="w-5 h-5 text-dark-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-dark-300">Sending...</p>
        <p className="text-xs text-dark-500">SMS going out</p>
      </div>
    </div>
  )
}

// Simple action button
function ActionButton({ call, onClick }) {
  // If booked or replied - no action needed
  if (call.appointmentBooked || call.followupStatus === 'completed') {
    return null
  }

  // If no response - show call button
  if (call.followupStatus === 'no_response') {
    return (
      <a
        href={`tel:${call.callerPhone}`}
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-danger-500 hover:bg-danger-600 text-white font-medium text-sm transition-colors"
      >
        <Phone className="w-4 h-4" />
        Call Now
      </a>
    )
  }

  return null
}

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
      <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md bg-dark-900 rounded-2xl border border-dark-700/50 shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-dark-800">
          <div>
            <h3 className="text-xl font-bold text-dark-100">
              {call.callerName || 'Unknown Caller'}
            </h3>
            <p className="text-dark-400 mt-1">{call.callerPhone}</p>
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
          {/* When */}
          <div className="flex items-center gap-3 p-4 rounded-lg bg-dark-800/50">
            <Calendar className="w-5 h-5 text-dark-400" />
            <div>
              <p className="text-xs text-dark-500">Missed call</p>
              <p className="text-sm text-dark-200">{formatDate(call.createdAt)}</p>
            </div>
          </div>

          {/* Status */}
          <div className="p-4 rounded-lg bg-dark-800/50">
            <p className="text-xs text-dark-500 mb-3">Status</p>
            <CallStatus call={call} />
          </div>

          {/* What they wanted */}
          {call.callReason && (
            <div className="p-4 rounded-lg bg-dark-800/50">
              <p className="text-xs text-dark-500 mb-2">What they wanted</p>
              <p className="text-sm text-dark-200">{call.callReason}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-dark-800">
          <button onClick={onClose} className="btn-secondary flex-1">
            Close
          </button>
          {(call.followupStatus === 'no_response' || call.followupStatus === 'pending') && (
            <a
              href={`tel:${call.callerPhone}`}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-danger-500 hover:bg-danger-600 text-white font-medium transition-colors"
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
        limit: 20,
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

  // Format time simply
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

    return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + `, ${time}`
  }

  // Sort: Need to call first, then waiting, then done
  const sortedCalls = [...calls].sort((a, b) => {
    const priority = (call) => {
      if (call.followupStatus === 'no_response') return 0 // Call them - top
      if (call.followupStatus === 'pending') return 1
      if (call.followupStatus === 'in_progress' || call.followupStatus === 'in-progress') return 2
      if (call.followupStatus === 'completed' && !call.appointmentBooked) return 3
      return 4 // Booked - bottom
    }
    return priority(a) - priority(b)
  })

  // Count how many need calls
  const needCallCount = calls.filter(c => c.followupStatus === 'no_response').length

  return (
    <div className="space-y-6">
      {/* Header - Super simple */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Missed Calls</h1>
          {needCallCount > 0 ? (
            <p className="text-danger-400 mt-1 font-medium">
              {needCallCount} {needCallCount === 1 ? 'person needs' : 'people need'} a call back
            </p>
          ) : (
            <p className="text-success-400 mt-1">All caught up!</p>
          )}
        </div>
      </div>

      {/* Search - Simple */}
      <div className="relative max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPagination(p => ({ ...p, page: 1 }))
          }}
          placeholder="Search name or phone..."
          className="input pl-12 w-full"
        />
      </div>

      {/* Call List - Card style for simplicity */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-dark-400">Loading...</p>
            </div>
          </div>
        ) : sortedCalls.length === 0 ? (
          <div className="text-center py-12">
            <PhoneMissed className="w-12 h-12 text-dark-600 mx-auto mb-4" />
            <p className="text-dark-300 text-lg font-medium">No missed calls</p>
            <p className="text-dark-500 mt-1">
              {search ? 'Try a different search' : 'When someone calls and you miss it, it shows here'}
            </p>
          </div>
        ) : (
          sortedCalls.map((call) => (
            <div
              key={call.id}
              onClick={() => setSelectedCall(call)}
              className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-lg ${
                call.followupStatus === 'no_response'
                  ? 'bg-danger-500/5 border-danger-500/30 hover:border-danger-500/50'
                  : call.appointmentBooked
                  ? 'bg-success-500/5 border-success-500/20 hover:border-success-500/40'
                  : 'bg-dark-800/30 border-dark-700/50 hover:border-dark-600'
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                {/* Left: Who + When */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-dark-100 text-lg truncate">
                    {call.callerName || call.callerPhone}
                  </p>
                  {call.callerName && (
                    <p className="text-dark-500 text-sm">{call.callerPhone}</p>
                  )}
                  <p className="text-dark-500 text-sm mt-1">{formatTime(call.createdAt)}</p>
                </div>

                {/* Right: Status + Action */}
                <div className="flex items-center gap-4">
                  <div className="hidden sm:block">
                    <CallStatus call={call} />
                  </div>
                  <ActionButton call={call} />
                </div>
              </div>

              {/* Mobile: Show status below */}
              <div className="sm:hidden mt-4 pt-4 border-t border-dark-700/50">
                <CallStatus call={call} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination - Simple */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <p className="text-sm text-dark-400">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
              disabled={pagination.page === 1}
              className="p-2 rounded-lg bg-dark-800 text-dark-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-dark-700"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
              disabled={pagination.page === pagination.totalPages}
              className="p-2 rounded-lg bg-dark-800 text-dark-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-dark-700"
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
