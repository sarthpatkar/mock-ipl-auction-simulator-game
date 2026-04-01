import { Suspense } from 'react'
import { AuthForm } from '@/components/auth/AuthForm'
import { HeroSide } from '@/components/auth/HeroSide'
import { UnofficialDisclaimer } from '@/components/shared/UnofficialDisclaimer'

export default function LoginPage() {
  return (
    <main className="auth-page">
      <div className="auth-page-main">
        <HeroSide />
        <Suspense fallback={null}>
          <AuthForm />
        </Suspense>
      </div>
      <UnofficialDisclaimer compact className="auth-page-disclaimer" />
    </main>
  )
}
