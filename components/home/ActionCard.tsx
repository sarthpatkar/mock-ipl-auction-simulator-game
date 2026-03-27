type Props = {
  title: string
  desc: string
  ctaLabel: string
  variant?: 'primary' | 'secondary'
  onClick?: () => void
  disabled?: boolean
}

export function ActionCard({ title, desc, ctaLabel, variant = 'primary', onClick, disabled = false }: Props) {
  const accentClass = variant === 'primary' ? 'accent-gold' : 'accent-blue'
  const toneClass = variant === 'primary' ? 'text-gold' : 'text-blue'

  return (
    <button type="button" className={`action-card ${variant} ${disabled ? 'is-disabled' : ''}`} onClick={onClick} disabled={disabled}>
      <span className={`action-kicker ${accentClass}`}></span>
      <div className={`action-title ${toneClass}`}>{title}</div>
      <p className="action-desc">{desc}</p>
      <span className={`action-card-cta btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'} w-full`}>{ctaLabel}</span>
    </button>
  )
}

export default ActionCard
