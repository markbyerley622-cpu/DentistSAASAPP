import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Sparkles, Lock, ArrowRight, AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-react'
import api from '../lib/api'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { phone, resetToken } = location.state || {}

  useEffect(() => {
    if (!phone || !resetToken) {
      navigate('/forgot-password')
    }
  }, [phone, resetToken, navigate])

  const passwordRequirements = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'Contains a number', met: /\d/.test(password) },
    { label: 'Contains a letter', met: /[a-zA-Z]/.test(password) },
  ]

  const allRequirementsMet = passwordRequirements.every((req) => req.met)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!allRequirementsMet) {
      setError('Please meet all password requirements')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      await api.post('/auth/reset-password', {
        phone,
        resetToken,
        newPassword: password
      })
      setSuccess(true)
      setTimeout(() => {
        navigate('/login')
      }, 2000)
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-dark-950 flex items-center justify-center p-8">
        <div className="text-center animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-success-500/20 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-success-400" />
          </div>
          <h2 className="text-2xl font-bold text-dark-100 mb-2">Password reset successful!</h2>
          <p className="text-dark-400 mb-4">Redirecting you to login...</p>
          <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
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
            Create New
            <br />
            <span className="text-gradient">Password</span>
          </h1>

          <p className="text-lg text-dark-300 max-w-md">
            Choose a strong password to secure your account. Make sure it's unique and memorable.
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

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-dark-100 mb-2">Set new password</h2>
            <p className="text-dark-400">
              Create a strong password for your account
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
              <label htmlFor="password" className="input-label">New password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pl-12 pr-12"
                  placeholder="Enter new password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Password requirements */}
            {password && (
              <div className="space-y-2 animate-fade-in">
                {passwordRequirements.map((req, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center ${
                      req.met ? 'bg-success-500/20' : 'bg-dark-800'
                    }`}>
                      {req.met && <CheckCircle className="w-3 h-3 text-success-400" />}
                    </div>
                    <span className={`text-sm ${req.met ? 'text-success-400' : 'text-dark-500'}`}>
                      {req.label}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="input-group">
              <label htmlFor="confirmPassword" className="input-label">Confirm password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input pl-12 pr-12"
                  placeholder="Confirm new password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300 transition-colors"
                >
                  {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-danger-400 mt-2">Passwords do not match</p>
              )}
              {confirmPassword && password === confirmPassword && (
                <p className="text-xs text-success-400 mt-2 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Passwords match
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !allRequirementsMet || password !== confirmPassword}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Reset password
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-dark-400">
            Remember your password?{' '}
            <Link to="/login" className="text-accent-400 hover:text-accent-300 font-medium transition-colors">
              Back to login
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
