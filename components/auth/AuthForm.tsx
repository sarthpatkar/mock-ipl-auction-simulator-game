'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CreatorBranding } from '@/components/shared/CreatorBranding'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { supabaseClient } from '@/lib/supabase'

type Mode = 'login' | 'register'

function getFriendlyAuthError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const message = rawMessage.toLowerCase()

  if (message.includes('pkce code verifier not found')) {
    return 'We could not complete Google sign-in. Please try again from this browser.'
  }

  if (message.includes('invalid login credentials')) {
    return 'Incorrect email or password. Please try again.'
  }

  if (message.includes('email not confirmed')) {
    return 'Please verify your email before signing in.'
  }

  if (message.includes('user already registered')) {
    return 'An account with this email already exists. Sign in instead.'
  }

  if (message.includes('password should be at least')) {
    return 'Password is too short. Please use a stronger password.'
  }

  if (message.includes('unable to validate email address')) {
    return 'Please enter a valid email address.'
  }

  if (message.includes('signup is disabled')) {
    return 'Account creation is unavailable right now. Please try again later.'
  }

  if (message.includes('google sign-in failed')) {
    return 'Google sign-in could not be completed. Please try again.'
  }

  if (message.includes('network') || message.includes('fetch')) {
    return 'Unable to reach the server right now. Please try again.'
  }

  return 'Something went wrong. Please try again.'
}

export function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mobileFeatureCards = [
    {
      title: 'Live Auction Rooms',
      copy: 'Private rooms for your auction group.'
    },
    {
      title: 'Real Player Pool',
      copy: 'Bid on a deep IPL-inspired player list.'
    },
    {
      title: 'Budget Strategy',
      copy: 'Balance stars, depth, and purse pressure.'
    },
    {
      title: 'Multiplayer With Friends',
      copy: 'Compete live with friends in real time.'
    }
  ]

  const toggleMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  useEffect(() => {
    const oauthError = searchParams.get('error')
    if (!oauthError) return
    setError(getFriendlyAuthError(oauthError))
  }, [searchParams])

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
      setError(getFriendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setOauthLoading(true)
    setError(null)

    try {
      if (typeof window === 'undefined') return

      const redirectTo = new URL('/auth/callback', window.location.origin).toString()
      const { error: oauthError } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo
        }
      })

      if (oauthError) throw oauthError
    } catch (err) {
      setError(getFriendlyAuthError(err))
      setOauthLoading(false)
    }
  }

  return (
    <div className="auth-form-side">
      <div className="auth-form-shell">
        <section className="auth-form-card">
          <div className="auth-form-header">
            <div className="auth-form-brand-row">
              <div className="navbar-logo auth-form-logo">
                IPL AUCTION
                <span>FRANCHISE MODE</span>
              </div>
              <ThemeToggle variant="auth" />
            </div>
            <h2 className="auth-form-title">{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
            <p className="auth-form-sub">
              {mode === 'login' ? 'Sign in to enter your auction room and manage your franchise.' : 'Create your franchise account and join the bidding war.'}
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

          <button
            className="btn btn-ghost btn-lg w-full auth-google-button"
            type="button"
            onClick={() => void handleGoogleSignIn()}
            disabled={loading || oauthLoading}
          >
            <span className="auth-google-mark" aria-hidden="true">
              <svg viewBox="0 0 18 18" role="presentation" focusable="false">
                <path
                  fill="#4285F4"
                  d="M17.64 9.2045c0-.6382-.0573-1.2518-.1636-1.8409H9v3.4818h4.8436c-.2086 1.125-.8427 2.0781-1.7963 2.7163v2.2581h2.9081C16.6582 14.2527 17.64 11.9563 17.64 9.2045Z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.4673-.8059 5.9563-2.1809l-2.9081-2.2581c-.8059.54-1.8368.8591-3.0482.8591-2.3441 0-4.3282-1.5832-5.0373-3.7091H.9564v2.3318C2.4377 15.9841 5.4818 18 9 18Z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.9627 10.7109C3.7827 10.1709 3.6805 9.5945 3.6805 9s.1023-1.1709.2823-1.7109V4.9573H.9564C.3477 6.1705 0 7.5423 0 9s.3477 2.8295.9564 4.0427l3.0063-2.3318Z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.3459l2.5814-2.5814C13.4632.8918 11.43 0 9 0 5.4818 0 2.4377 2.0159.9564 4.9573l3.0063 2.3318C4.6718 5.1627 6.6559 3.5795 9 3.5795Z"
                />
              </svg>
            </span>
            <span className="auth-google-label">{oauthLoading ? 'Redirecting…' : 'Continue with Google'}</span>
          </button>

          <div className="auth-divider" aria-hidden="true">
            <span />
            <small>or continue with email</small>
            <span />
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
              <div className="auth-password-wrap">
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
                  className="auth-password-toggle"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && <p className="text-red text-sm">{error}</p>}

            <button className="btn btn-primary btn-lg w-full auth-submit-button" type="submit" disabled={loading || oauthLoading}>
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
        </section>

        <section className="auth-mobile-post-auth" aria-label="Platform features">
          <div className="auth-mobile-feature-grid">
            {mobileFeatureCards.map((feature) => (
              <div key={feature.title} className="auth-mobile-feature-card">
                <strong>{feature.title}</strong>
                <span>{feature.copy}</span>
              </div>
            ))}
          </div>
        </section>

        <CreatorBranding variant="auth-footer" />
      </div>
    </div>
  )
}

export default AuthForm
