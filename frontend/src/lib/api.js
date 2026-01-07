import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || '/api'

// Create axios instance
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Auth API
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  updateProfile: (data) => api.put('/auth/profile', data),
  updatePassword: (data) => api.put('/auth/password', data),
}

// Calls API
export const callsAPI = {
  getAll: (params) => api.get('/calls', { params }),
  getOne: (id) => api.get(`/calls/${id}`),
  update: (id, data) => api.put(`/calls/${id}`, data),
  delete: (id) => api.delete(`/calls/${id}`),
  getVoicemails: (params) => api.get('/calls/voicemails', { params }),
}

// Leads API
export const leadsAPI = {
  getAll: (params) => api.get('/leads', { params }),
  getStats: () => api.get('/leads/stats'),
  getOne: (id) => api.get(`/leads/${id}`),
  create: (data) => api.post('/leads', data),
  update: (id, data) => api.put(`/leads/${id}`, data),
  delete: (id) => api.delete(`/leads/${id}`),
}

// Analytics API
export const analyticsAPI = {
  getOverview: (period) => api.get('/analytics/overview', { params: { period } }),
  getCallsByDay: (days) => api.get('/analytics/calls-by-day', { params: { days } }),
  getLeadsByStatus: () => api.get('/analytics/leads-by-status'),
  getCallReasons: (days) => api.get('/analytics/call-reasons', { params: { days } }),
  getPeakHours: (days) => api.get('/analytics/peak-hours', { params: { days } }),
}

// Settings API
export const settingsAPI = {
  get: () => api.get('/settings'),
  update: (data) => api.put('/settings', data),
  updateTwilio: (data) => api.put('/settings/twilio', data),
  updateForwarding: (data) => api.put('/settings/forwarding', data),
  updateNotifications: (data) => api.put('/settings/notifications', data),
  updateBusinessHours: (data) => api.put('/settings/business-hours', data),
  updateAiGreeting: (data) => api.put('/settings/ai-greeting', data),
}

// Twilio API
export const twilioAPI = {
  test: () => api.post('/twilio/test'),
}

// Booking Slots API
export const bookingSlotsAPI = {
  getAll: () => api.get('/booking-slots'),
  create: (data) => api.post('/booking-slots', data),
  update: (id, data) => api.put(`/booking-slots/${id}`, data),
  delete: (id) => api.delete(`/booking-slots/${id}`),
  getAvailable: (date) => api.get('/booking-slots/available', { params: { date } }),
}

// Conversations API
export const conversationsAPI = {
  getAll: (params) => api.get('/conversations', { params }),
  getOne: (id) => api.get(`/conversations/${id}`),
  create: (data) => api.post('/conversations', data),
  update: (id, data) => api.put(`/conversations/${id}`, data),
  addMessage: (id, data) => api.post(`/conversations/${id}/messages`, data),
  getStats: () => api.get('/conversations/stats/overview'),
}

// Appointments API
export const appointmentsAPI = {
  getAll: (params) => api.get('/appointments', { params }),
  getToday: () => api.get('/appointments/today'),
  getUpcoming: () => api.get('/appointments/upcoming'),
  getOne: (id) => api.get(`/appointments/${id}`),
  create: (data) => api.post('/appointments', data),
  update: (id, data) => api.put(`/appointments/${id}`, data),
  cancel: (id) => api.delete(`/appointments/${id}`),
  getStats: () => api.get('/appointments/stats/overview'),
}

export default api
