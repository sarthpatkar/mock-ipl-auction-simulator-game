import { RoomParticipant } from '@/types'
import { formatAuctionStatus, formatPrice } from '@/lib/auction-helpers'

type Props = {
  roundLabel: string
  progressLabel: string
  me?: RoomParticipant
  squadLimit: number
  auctionStatus: string
}

export function TopStatusBar({
  roundLabel,
  progressLabel,
  me,
  squadLimit,
  auctionStatus
}: Props) {
  const squadSummary = me ? `${me.squad_count} / ${squadLimit}` : '—'
  const budgetSummary = me ? formatPrice(me.budget_remaining) : '—'

  return (
    <section className="card auction-status-grid" aria-label="Auction status overview">
      <div className="status-metric status-metric-primary">
        <span className="status-label">Round</span>
        <strong className="status-value">{roundLabel}</strong>
      </div>

      <div className="status-metric">
        <span className="status-label">Progress</span>
        <strong className="status-value status-value-compact">{progressLabel}</strong>
      </div>

      <div className="status-metric">
        <span className="status-label">Budget</span>
        <strong className="status-value highlight">{budgetSummary}</strong>
      </div>

      <div className="status-metric">
        <span className="status-label">Squad</span>
        <strong className="status-value status-value-compact">{squadSummary} players</strong>
      </div>

      <div className="status-rail">
        <span className={`status-chip is-${auctionStatus}`}>{formatAuctionStatus(auctionStatus)}</span>
      </div>
    </section>
  )
}

export default TopStatusBar
