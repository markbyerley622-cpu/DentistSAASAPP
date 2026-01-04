import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Sparkles, ArrowRight, ArrowLeft, AlertCircle, RefreshCw } from 'lucide-react'
import api from '../lib/api'

export default function VerifyOTP() {
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const inputRefs = useRef([])
  const navigate = useNavigate()
  const location = useLocation()
  const phone = location.state?.phone

  useEffect(() => {
    if (!phone) {
      navigate('/forgot-password')
    }
  }, [phone, navigate])

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [resendCooldown])

  const handleChange = (index, value) => {
    if (!/^\d*$/.test(value)) return

    const newOtp = [...otp]
    newOtp[index] = value.slice(-1)
    setOtp(newOtp)

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pastedData) {
      const newOtp = [...otp]
      for (let i = 0; i < pastedData.length; i++) {
        newOtp[i] = pastedData[i]
      }
      setOtp(newOtp)
      inputRefs.current[Math.min(pastedData.length, 5)]?.focus()
    }
  }

  const handleResend = async () => {
    if (resendCooldown > 0) return
    setResendLoading(true)
    setError('')

    try {
      await api.post('/auth/forgot-password', { phone })
      setResendCooldown(60)
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to resend code')
    } finally {
      setResendLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const code = otp.join('')
    if (code.length !== 6) {
      setError('Please enter the complete 6-digit code')
      return
    }

    setLoading(true)

    try {
      const response = await api.post('/auth/verify-otp', { phone, code })
      navigate('/reset-password', {
        state: {
          phone,
          resetToken: response.data.resetToken
        }
      })
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Invalid verification code')
      setOtp(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  const formatPhone = (phoneNumber) => {
    if (!phoneNumber) return ''
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6)}`
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
            Check Your
            <br />
            <span className="text-gradient">Phone</span>
          </h1>

          <p className="text-lg text-dark-300 max-w-md">
            We've sent a 6-digit verification code to your phone number. Enter it below to continue.
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
            to="/forgot-password"
            className="inline-flex items-center gap-2 text-dark-400 hover:text-dark-200 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Change phone number
          </Link>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-dark-100 mb-2">Enter verification code</h2>
            <p className="text-dark-400">
              We sent a code to <span className="text-dark-200">{formatPhone(phone)}</span>
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-lg bg-danger-500/10 border border-danger-500/20 flex items-start gap-3 animate-slide-down">
              <AlertCircle className="w-5 h-5 text-danger-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-danger-400">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="input-label mb-3 block">Verification code</label>
              <div className="flex gap-3 justify-center" onPaste={handlePaste}>
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => (inputRefs.current[index] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    className="w-12 h-14 text-center text-xl font-semibold bg-dark-800/50 border border-dark-700 rounded-lg text-dark-100 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 transition-all"
                    autoFocus={index === 0}
                  />
                ))}
              </div>
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
                  Verify code
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-dark-400 text-sm">
              Didn't receive the code?{' '}
              <button
                onClick={handleResend}
                disabled={resendCooldown > 0 || resendLoading}
                className="text-accent-400 hover:text-accent-300 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                {resendLoading ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : resendCooldown > 0 ? (
                  `Resend in ${resendCooldown}s`
                ) : (
                  'Resend code'
                )}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
