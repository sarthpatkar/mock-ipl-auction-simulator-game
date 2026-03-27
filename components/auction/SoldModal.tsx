import { formatPrice, getTeamThemeClass, getTeamThemeStyle } from '@/lib/auction-helpers'

type Props = {
  visible: boolean
  type: 'sold' | 'unsold'
  playerName: string
  teamName?: string
  price?: number
}

export function SoldModal({ visible, type, playerName, teamName, price }: Props) {
  if (!visible) return null

  if (type === 'sold') {
    return (
      <div className="modal-overlay">
        <div className={`modal auction-modal auction-modal-sold team-theme ${getTeamThemeClass(teamName)}`} style={getTeamThemeStyle(teamName)}>
          <p className="badge badge-green">Sold</p>
          <h3 className="modal-title">Sold to {teamName || '—'}</h3>
          <p className="auction-modal-subtitle">{playerName}</p>
          <p className="auction-modal-price">{price ? `for ${formatPrice(price)}` : null}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay">
      <div className="modal auction-modal auction-modal-unsold">
        <p className="badge badge-gray">Unsold</p>
        <h3 className="modal-title">Unsold</h3>
        <p className="auction-modal-subtitle">{playerName}</p>
      </div>
    </div>
  )
}

export default SoldModal
