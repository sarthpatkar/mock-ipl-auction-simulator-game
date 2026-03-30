'use client'

import { useTheme } from '@/components/theme/ThemeProvider'

type Props = {
  variant?: 'navbar' | 'menu' | 'auth'
}

function ThemeIcon({ theme }: { theme: 'dark' | 'light' }) {
  if (theme === 'light') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M10 3.25a.75.75 0 0 1 .75.75v1.2a.75.75 0 0 1-1.5 0V4A.75.75 0 0 1 10 3.25Zm0 10.85a.75.75 0 0 1 .75.75v1.15a.75.75 0 0 1-1.5 0v-1.15a.75.75 0 0 1 .75-.75Zm6-4.1a.75.75 0 0 1 0 1.5h-1.15a.75.75 0 0 1 0-1.5H16Zm-10.85 0a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5h1.15Zm8.027-4.777a.75.75 0 0 1 1.06 0l.814.814a.75.75 0 1 1-1.06 1.06l-.814-.813a.75.75 0 0 1 0-1.061Zm-7.032 7.033a.75.75 0 0 1 1.06 0l.814.813a.75.75 0 1 1-1.06 1.061l-.814-.814a.75.75 0 0 1 0-1.06Zm7.845 1.874a.75.75 0 0 1 1.06-1.06l.814.813a.75.75 0 1 1-1.06 1.06l-.814-.813Zm-7.845-7.845a.75.75 0 0 1 1.06-1.06l.814.813a.75.75 0 1 1-1.06 1.06l-.814-.813ZM10 6.35a3.65 3.65 0 1 1 0 7.3 3.65 3.65 0 0 1 0-7.3Z"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M11.498 2.23a.75.75 0 0 1 .893.812 6.5 6.5 0 0 0 7.067 7.067.75.75 0 0 1 .812.893A8.5 8.5 0 1 1 10.998.73a.75.75 0 0 1 .5 1.5 7 7 0 1 0 6.272 9.272 8.02 8.02 0 0 1-6.272-8.272.75.75 0 0 1 0-1Z"
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
