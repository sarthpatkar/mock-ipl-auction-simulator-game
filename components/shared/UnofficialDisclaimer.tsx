import { APP_DISCLAIMER } from '@/lib/branding'

type Props = {
  compact?: boolean
  className?: string
}

export function UnofficialDisclaimer({ compact = false, className }: Props) {
  return (
    <div className={`unofficial-disclaimer ${compact ? 'is-compact' : ''} ${className ?? ''}`.trim()} role="note">
      <span className="unofficial-disclaimer-label">Disclaimer</span>
      <p>{APP_DISCLAIMER}</p>
    </div>
  )
}

export default UnofficialDisclaimer
