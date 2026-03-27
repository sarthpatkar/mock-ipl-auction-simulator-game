'use client'

type Props = {
  variant?: 'home' | 'auth'
}

const LINKEDIN_URL = 'https://www.linkedin.com/in/sarthpatkar'
const GITHUB_URL = 'https://github.com/sarthpatkar'

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M6.94 8.5A1.56 1.56 0 1 1 6.94 5.37a1.56 1.56 0 0 1 0 3.13ZM8.3 19H5.58V9.63H8.3V19Zm10.12 0h-2.72v-4.56c0-1.09-.02-2.49-1.52-2.49-1.52 0-1.75 1.18-1.75 2.41V19H9.71V9.63h2.61v1.28h.04c.36-.69 1.25-1.42 2.58-1.42 2.76 0 3.27 1.81 3.27 4.16V19Z"
      />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 .5C5.65.5.5 5.66.5 12.03c0 5.1 3.3 9.43 7.87 10.96.58.1.79-.25.79-.56 0-.27-.01-1.18-.02-2.13-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.2 1.77 1.2 1.04 1.78 2.72 1.26 3.38.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.29-5.25-5.74 0-1.27.45-2.3 1.2-3.11-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.19 1.19a11.1 11.1 0 0 1 5.8 0c2.21-1.5 3.18-1.19 3.18-1.19.63 1.59.23 2.77.11 3.06.75.81 1.2 1.84 1.2 3.11 0 4.46-2.69 5.44-5.26 5.73.41.36.78 1.05.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.67.8.56A11.53 11.53 0 0 0 23.5 12.03C23.5 5.66 18.35.5 12 .5Z"
      />
    </svg>
  )
}

export function CreatorBranding({ variant = 'home' }: Props) {
  return (
    <div className={`creator-branding is-${variant}`}>
      <div className="creator-branding-copy">
        <span className="creator-branding-title">Built by Sarth Patkar</span>
        <span className="creator-branding-meta">IT Engineering Student · Mumbai</span>
      </div>

      <div className="creator-branding-links" aria-label="Creator profile links">
        <a
          className="creator-link"
          href={LINKEDIN_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Sarth Patkar on LinkedIn"
          title="LinkedIn"
        >
          <LinkedInIcon />
          <span>LinkedIn</span>
        </a>
        <a
          className="creator-link"
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Sarth Patkar on GitHub"
          title="GitHub"
        >
          <GitHubIcon />
          <span>GitHub</span>
        </a>
      </div>
    </div>
  )
}

export default CreatorBranding
