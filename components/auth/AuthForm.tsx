'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseClient } from '@/lib/supabase'

type Mode = 'login' | 'register'

export function AuthForm() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const ensureProfile = async (userId: string, preferredUsername: string) => {
    const fallbackUsername = preferredUsername.trim() || `franchise_${userId.slice(0, 8)}`
    const { data: existingProfile } = await supabaseClient.from('profiles').select('id').eq('id', userId).maybeSingle()
    if (existingProfile) return

    const { error: profileError } = await supabaseClient.from('profiles').insert({
      id: userId,
      username: fallbackUsername
    })
    if (profileError) {
      const message = profileError.message.toLowerCase()
      if (message.includes('row-level security') || message.includes('new row violates')) {
        return
      }
      throw profileError
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (mode === 'register' && !username.trim()) {
      setError('Please enter a username')
      setLoading(false)
      return
    }

    try {
      if (mode === 'login') {
        const { data, error: authError } = await supabaseClient.auth.signInWithPassword({ email, password })
        if (authError) throw authError
        if (data.user) {
          await ensureProfile(data.user.id, email.split('@')[0])
        }
      } else {
        const { data, error: signUpError } = await supabaseClient.auth.signUp({ email, password })
        if (signUpError) throw signUpError
        if (data.user) {
          await ensureProfile(data.user.id, username)
        }
      }
      router.push('/')
    } catch (err: any) {
      setError(err.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-form-side">
      <div className="auth-form-header">
        <div className="navbar-logo" style={{ marginBottom: 8 }}>
          IPL AUCTION
          <span>FRANCHISE MODE</span>
        </div>
        <h2 className="auth-form-title">{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
        <p className="auth-form-sub">
          {mode === 'login' ? 'Sign in to your franchise account' : 'Join the auction league with your franchise'}
        </p>
      </div>

      <div className="auth-toggle">
        <button className={`auth-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => toggleMode('login')}>
          Sign In
        </button>
        <button className={`auth-tab ${mode === 'register' ? 'active' : ''}`} onClick={() => toggleMode('register')}>
          Register
        </button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        {mode === 'register' && (
          <div className="input-group">
            <label className="input-label">Username</label>
            <input
              className="input-field"
              type="text"
              placeholder="YourFranchiseName"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
        )}

        <div className="input-group">
          <label className="input-label">Email</label>
          <input
            className="input-field"
            type="email"
            placeholder="owner@franchise.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="input-group">
          <label className="input-label">Password</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input-field"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••••••"
              style={{ paddingRight: 48 }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase'
              }}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {error && <p className="text-red text-sm">{error}</p>}

        <button className="btn btn-primary btn-lg w-full" type="submit" disabled={loading}>
          <span>{loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}</span>
        </button>
      </form>

      <div className="auth-footer">
        {mode === 'login' ? (
          <>
            Don&apos;t have an account?{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); toggleMode('register') }}>
              Create one
            </a>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); toggleMode('login') }}>
              Sign in
            </a>
          </>
        )}
      </div>
    </div>
  )
}

export default AuthForm
