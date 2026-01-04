import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles, Phone, ArrowRight, ArrowLeft, AlertCircle } from 'lucide-react'
import api from '../lib/api'

export default function ForgotPassword() {
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const formatPhoneNumber = (value) => {
    const phoneNumber = value.replace(/\D/g, '')
    if (phoneNumber.length <= 3) return phoneNumber
    if (phoneNumber.length <= 6) return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`
  }

  const handlePhoneChange = (e) => {
    const formatted = formatPhoneNumber(e.target.value)
    setPhone(formatted)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const phoneDigits = phone.replace(/\D/g, '')
    if (phoneDigits.length !== 10) {
      setError('Please enter a valid 10-digit phone number')
      setLoading(false)
      return
    }

    try {
      await api.post('/auth/forgot-password', { phone: phoneDigits })
      navigate('/verify-otp', { state: { phone: phoneDigits } })
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to send verification code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-dark-950 flex">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent-600/20 via-purple-600/10 to-dark-950" />
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)`,
          backgroundSize: '40px 40px'
        }} />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent-500/30 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl" />

        <div className="relative z-10 flex flex-col justify-center px-12 lg:px-20">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center shadow-lg shadow-accent-500/30">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">SmileDesk</span>
          </div>

          <h1 className="text-4xl lg:text-5xl font-bold text-white leading-tight mb-6">
            Reset Your
            <br />
            <span className="text-gradient">Password</span>
          </h1>

          <p className="text-lg text-dark-300 max-w-md">
            Enter your phone number and we'll send you a verification code to reset your password.
          </p>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-12">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center shadow-lg shadow-accent-500/30">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">SmileDesk</span>
          </div>

          <Link
            to="/login"
            className="inline-flex items-center gap-2 text-dark-400 hover:text-dark-200 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to login
          </Link>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-dark-100 mb-2">Forgot password?</h2>
            <p className="text-dark-400">
              Enter your phone number to receive a verification code
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-lg bg-danger-500/10 border border-danger-500/20 flex items-start gap-3 animate-slide-down">
              <AlertCircle className="w-5 h-5 text-danger-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-danger-400">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="input-group">
              <label htmlFor="phone" className="input-label">Phone number</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={handlePhoneChange}
                  className="input pl-12"
                  placeholder="(555) 123-4567"
                  required
                />
              </div>
              <p className="text-xs text-dark-500 mt-2">
                We'll send a 6-digit code to this number
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2 group"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Send verification code
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
