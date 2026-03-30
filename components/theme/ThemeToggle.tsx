'use client'

import { useTheme } from '@/components/theme/ThemeProvider'

type Props = {
  variant?: 'navbar' | 'menu' | 'auth'
}

function ThemeIcon({ theme }: { theme: 'dark' | 'light' }) {
  if (theme === 'light') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="4.1" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M10 1.9v2.2" />
          <path d="M10 15.9v2.2" />
          <path d="M1.9 10h2.2" />
          <path d="M15.9 10h2.2" />
          <path d="M4.25 4.25 5.8 5.8" />
          <path d="M14.2 14.2 15.75 15.75" />
          <path d="M14.2 5.8 15.75 4.25" />
          <path d="M4.25 15.75 5.8 14.2" />
        </g>
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3a6 6 0 1 0 9 9 9 9 0 1 1-9-9Z"
      />
    </svg>
  )
}

export function ThemeToggle({ variant = 'navbar' }: Props) {
  const { theme, toggleTheme } = useTheme()
  const isLight = theme === 'light'
  const buttonClass =
    variant === 'navbar'
      ? 'theme-toggle-button theme-toggle-button-navbar'
      : variant === 'auth'
        ? 'theme-toggle-button theme-toggle-button-auth'
        : 'theme-toggle-button theme-toggle-button-panel'

  if (variant === 'menu') {
    return (
      <button
        type="button"
        className={`btn btn-ghost btn-sm theme-toggle-button theme-toggle-button-panel ${isLight ? 'is-light' : 'is-dark'}`}
        aria-pressed={isLight}
        aria-label={`Switch to ${isLight ? 'dark' : 'light'} mode`}
        onClick={toggleTheme}
      >
        <span className="theme-toggle-copy">
          <strong>Theme</strong>
          <small>{isLight ? 'Light' : 'Dark'}</small>
        </span>
        <span className={`theme-toggle-switch ${isLight ? 'is-light' : 'is-dark'}`} aria-hidden="true">
          <span className="theme-toggle-switch-thumb">
            <ThemeIcon theme={theme} />
          </span>
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      className={`${buttonClass} ${isLight ? 'is-light' : 'is-dark'}`}
      aria-pressed={isLight}
      aria-label={`Switch to ${isLight ? 'dark' : 'light'} mode`}
      onClick={toggleTheme}
    >
      <span className="theme-toggle-icon">
        <ThemeIcon theme={theme} />
      </span>
      <span className="theme-toggle-label">{isLight ? 'Light' : 'Dark'}</span>
    </button>
  )
}
