import { formatAuctionStatus, getTeamThemeClass, getTeamThemeStyle } from '@/lib/auction-helpers'
import { AuctionSession } from '@/types'

type Props = {
  remaining: number
  total: number
  paused?: boolean
  status?: AuctionSession['status']
  themeTeam?: string | null
}

export function TimerRing({ remaining, total, paused = false, status = 'waiting', themeTeam }: Props) {
  const safeRemaining = Math.max(0, remaining)
  const pct = total > 0 ? Math.max(0, Math.min(1, safeRemaining / total)) : 0
  const state = paused ? 'paused' : safeRemaining <= 5 ? 'danger' : safeRemaining <= 10 ? 'warning' : 'live'

  return (
    <section
      className={`card timer-panel team-theme ${getTeamThemeClass(themeTeam)} is-${state}`}
      style={getTeamThemeStyle(themeTeam)}
      aria-label="Auction timer"
    >
      <div className="timer-panel-head">
        <span className="status-label">Timer</span>
        <span className={`timer-state-chip is-${state}`}>{paused ? 'Paused' : formatAuctionStatus(status)}</span>
      </div>

      <div className="timer-ring-shell">
        <div
          className={`timer-ring is-${state}`}
          style={{ ['--timer-progress' as string]: `${pct}` }}
        >
          <div className="timer-ring-core">
            <strong className="timer-seconds">{safeRemaining}</strong>
            <span className="timer-unit">seconds</span>
          </div>
        </div>
      </div>

      <div className="timer-progress">
        <div className={`timer-progress-fill is-${state}`} style={{ width: `${pct * 100}%` }} />
      </div>

      <div className="timer-caption">
        {paused
          ? 'Auction is paused. Waiting for the host to resume.'
          : safeRemaining <= 5
            ? 'Final seconds. Next confirmed bid resets the clock.'
            : 'Timer reflects the confirmed backend end time.'}
      </div>
    </section>
  )
}

export default TimerRing
