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
  AlertCircle
} from 'lucide-react'

function FollowUpStatusBadge({ status }) {
  const styles = {
    'completed': 'bg-success-500/10 text-success-400 border-success-500/20',
    'in_progress': 'bg-accent-500/10 text-accent-400 border-accent-500/20',
    'in-progress': 'bg-accent-500/10 text-accent-400 border-accent-500/20',
    'pending': 'bg-warning-500/10 text-warning-400 border-warning-500/20',
    'no_response': 'bg-dark-600/50 text-dark-400 border-dark-600/50'
  }

  const labels = {
    'completed': 'Responded',
    'in_progress': 'SMS Sent',
    'in-progress': 'SMS Sent',
    'pending': 'Pending',
    'no_response': 'No Response'
  }

  const icons = {
    'completed': CheckCircle,
    'in_progress': MessageSquare,
    'in-progress': MessageSquare,
    'pending': Clock,
    'no_response': AlertCircle
  }

  const Icon = icons[status] || Clock

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${styles[status] || styles.pending}`}>
      <Icon className="w-3 h-3" />
      {labels[status] || status}
    </span>
  )
}

function PatientModal({ patient, onClose }) {
  if (!patient) return null

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
              <PhoneMissed className="w-6 h-6 text-accent-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-dark-100">
                {patient.callerName || 'Unknown Patient'}
              </h3>
              <p className="text-sm text-dark-400">{patient.callerPhone}</p>
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
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-dark-800/50">
              <p className="text-xs text-dark-500 mb-1">Follow-up Status</p>
              <FollowUpStatusBadge status={patient.followupStatus || 'pending'} />
            </div>
            <div className="p-4 rounded-lg bg-dark-800/50">
              <p className="text-xs text-dark-500 mb-1">Missed Call Time</p>
              <p className="text-sm font-medium text-dark-200 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-dark-400" />
                {formatDate(patient.createdAt)}
              </p>
            </div>
          </div>

          {/* Contact reason if known */}
          {patient.callReason && (
            <div>
              <p className="text-sm font-medium text-dark-300 mb-2">Reason for Contact</p>
              <div className="px-4 py-3 rounded-lg bg-dark-800/50 text-dark-200">
                {patient.callReason}
              </div>
            </div>
          )}

          {/* Follow-up info */}
          <div className="p-4 rounded-lg bg-accent-500/5 border border-accent-500/20">
            <div className="flex items-start gap-3">
              <MessageSquare className="w-5 h-5 text-accent-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-accent-400">SMS Follow-up</p>
                <p className="text-xs text-accent-300/70 mt-1">
                  {patient.followupStatus === 'completed'
                    ? 'Patient has responded to the follow-up SMS.'
                    : patient.followupStatus === 'in_progress' || patient.followupStatus === 'in-progress'
                    ? 'Follow-up SMS has been sent. Waiting for response.'
                    : 'Follow-up SMS will be sent automatically.'}
                </p>
                {patient.followupAttempts > 0 && (
                  <p className="text-xs text-dark-400 mt-2">
                    Follow-up attempts: {patient.followupAttempts}
                  </p>
                )}
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

export default function MissedPatients() {
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedPatient, setSelectedPatient] = useState(null)

  const fetchPatients = async () => {
    setLoading(true)
    try {
      const params = {
        page: pagination.page,
        limit: 10,
        ...(search && { search }),
        ...(statusFilter && { status: statusFilter })
      }
      const response = await callsAPI.getAll(params)
      setPatients(response.data.calls)
      setPagination(response.data.pagination)
    } catch (error) {
      console.error('Failed to fetch missed patients:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPatients()
  }, [pagination.page, search, statusFilter])

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
          <h1 className="text-2xl font-bold text-dark-100">Missed Patients</h1>
          <p className="text-dark-400 mt-1">
            Patients who called but didn't get through - SMS follow-up sent automatically
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-dark-400">
          <PhoneMissed className="w-4 h-4" />
          <span>{pagination.total} missed</span>
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
            placeholder="Search by name or phone..."
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
            className="input pl-12 pr-10 appearance-none cursor-pointer min-w-[180px]"
          >
            <option value="">All follow-up statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">SMS Sent</option>
            <option value="completed">Responded</option>
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
                  Patient
                </th>
                <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                  Follow-up Status
                </th>
                <th className="text-left px-6 py-4 text-xs font-medium text-dark-400 uppercase tracking-wider">
                  Missed At
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-800/50">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-dark-400 text-sm">Loading...</p>
                    </div>
                  </td>
                </tr>
              ) : patients.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center">
                    <PhoneMissed className="w-8 h-8 text-dark-600 mx-auto mb-3" />
                    <p className="text-dark-400">No missed patients found</p>
                    <p className="text-dark-500 text-sm mt-1">
                      {search || statusFilter ? 'Try adjusting your filters' : 'When patients call and miss you, they\'ll appear here'}
                    </p>
                  </td>
                </tr>
              ) : (
                patients.map((patient) => (
                  <tr
                    key={patient.id}
                    onClick={() => setSelectedPatient(patient)}
                    className="hover:bg-dark-800/30 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-medium text-dark-200">
                          {patient.callerName || 'Unknown Patient'}
                        </p>
                        <p className="text-xs text-dark-500">{patient.callerPhone}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <FollowUpStatusBadge status={patient.followupStatus || 'pending'} />
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-dark-400">
                        {formatDate(patient.createdAt)}
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

      {/* Patient detail modal */}
      {selectedPatient && (
        <PatientModal patient={selectedPatient} onClose={() => setSelectedPatient(null)} />
      )}
    </div>
  )
}
