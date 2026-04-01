'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { APP_NAME } from '@/lib/branding'
import { UnofficialDisclaimer } from '@/components/shared/UnofficialDisclaimer'
import { ensureUserProfile } from '@/lib/auth-profiles'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { supabaseClient } from '@/lib/supabase'

function getFriendlyAuthError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const message = rawMessage.toLowerCase()

  if (message.includes('pkce code verifier not found')) {
    return 'We could not complete Google sign-in. Please try again from this browser.'
  }

  if (message.includes('google sign-in failed')) {
    return 'Google sign-in could not be completed. Please try again.'
  }

  if (message.includes('network') || message.includes('fetch')) {
    return 'Unable to reach the server right now. Please try again.'
  }

  return 'Something went wrong. Please try again.'
}

function AuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [message, setMessage] = useState('Completing Google sign-in…')

  useEffect(() => {
    let active = true
    let redirected = false

    const redirectHome = () => {
      if (redirected || typeof window === 'undefined') return
      redirected = true
      window.location.replace('/')
    }

    const finishAuth = async () => {
      const code = searchParams.get('code')
      const oauthError = getFriendlyAuthError(searchParams.get('error_description') || searchParams.get('error') || 'Google sign-in failed')

      if (!code) {
        router.replace(`/auth/login?error=${encodeURIComponent(oauthError)}`)
        return
      }

      try {
        const { data, error } = await supabaseClient.auth.exchangeCodeForSession(code)
        if (error) throw error

        const user = data.user ?? data.session?.user
        if (!user) {
          throw new Error('Google sign-in did not return a user')
        }

        if (active) {
          setMessage('Finalizing your account…')
        }

        void ensureUserProfile(user, supabaseClient).catch(() => {})
        redirectHome()
      } catch (err) {
        const errorMessage = getFriendlyAuthError(err)
        if (active) {
          setMessage(errorMessage)
          router.replace(`/auth/login?error=${encodeURIComponent(errorMessage)}`)
        }
      }
    }

    void finishAuth()

    return () => {
      active = false
    }
  }, [router, searchParams])

  return (
    <main className="auth-page">
      <div className="auth-form-side">
        <div className="auth-form-shell">
          <section className="auth-form-card">
            <div className="auth-form-header">
              <div className="auth-form-brand-row">
                <div className="navbar-logo auth-form-logo">
                  {APP_NAME}
                  <span>UNOFFICIAL FAN BUILD</span>
                </div>
                <ThemeToggle variant="auth" />
              </div>
              <h2 className="auth-form-title">Signing you in</h2>
              <p className="auth-form-sub">{message}</p>
            </div>
            <UnofficialDisclaimer compact />
          </section>
        </div>
      </div>
    </main>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackContent />
    </Suspense>
  )
}
