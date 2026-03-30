'use client'

import { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

type Props = {
  subtitle?: string
  showHome?: boolean
  actions?: ReactNode
  showThemeToggle?: boolean
}

export function PageNavbar({ subtitle, showHome = false, actions, showThemeToggle = true }: Props) {
  const router = useRouter()

  return (
    <nav className="navbar">
      <div className="navbar-left">
        {showHome && (
          <button className="btn btn-ghost btn-sm navbar-home" onClick={() => router.push('/')}>
            ← Home
          </button>
        )}
        <div className="navbar-logo">
          IPL AUCTION
          {subtitle && <span>{subtitle}</span>}
        </div>
      </div>
      <div className="navbar-watermark">Built by Sarth Patkar</div>
      <div className="navbar-actions">
        {showThemeToggle && <ThemeToggle variant="navbar" />}
        {actions}
      </div>
    </nav>
  )
}

export default PageNavbar
