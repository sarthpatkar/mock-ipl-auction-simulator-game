import { AuthForm } from '@/components/auth/AuthForm'
import { HeroSide } from '@/components/auth/HeroSide'

export default function LoginPage() {
  return (
    <main className="auth-page">
      <HeroSide />
      <AuthForm />
    </main>
  )
}
