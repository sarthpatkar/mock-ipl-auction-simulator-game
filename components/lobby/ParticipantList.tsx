import { RoomParticipant } from '@/types'
import { formatPrice } from '@/lib/auction-helpers'

type Props = {
  participants: RoomParticipant[]
  limit?: number
  autoSkipped?: string[]
  adminUserId?: string | null
}

export function ParticipantList({ participants, limit = 10, autoSkipped = [], adminUserId }: Props) {
  const percent = Math.min(100, Math.round((participants.length / limit) * 100))
  return (
    <div className="participants-card">
      <div className="pc-header">
        <div className="pc-title">Participants</div>
        <div className="capacity-bar">
          <span className="cap-num">
            {participants.length} / {limit}
          </span>
          <div className="progress-bar-wrap" style={{ width: 80 }}>
            <div className={`progress-bar-fill ${participants.length >= limit ? 'danger' : ''}`} style={{ width: `${percent}%` }}></div>
          </div>
        </div>
      </div>

      {participants.length >= limit && (
        <div className="full-banner show">Participant limit reached. Auction table is ready.</div>
      )}

      <div className="participant-list">
        {participants.map((p) => (
          <div key={p.id} className="participant-item">
            <div className="p-avatar" style={{ background: '#00C8FF22', color: 'var(--neon-blue)' }}>
              {p.team_name.slice(0, 2).toUpperCase()}
            </div>
            <div className="p-info">
              <div className="p-username">
                {p.profiles?.username || 'Franchise Owner'}
                {p.user_id === adminUserId && <span className="badge badge-gold ml-2">Admin</span>}
              </div>
              <div className="p-team" style={{ color: 'var(--text-secondary)' }}>
                {p.team_name} · Players: {p.squad_count} · Budget: {formatPrice(p.budget_remaining)}
              </div>
            </div>
            {autoSkipped.includes(p.id) && <span className="badge badge-gray">Auto-skipped</span>}
          </div>
        ))}
        {participants.length === 0 && <div className="waiting-msg">Waiting for participants...</div>}
      </div>
    </div>
  )
}

export default ParticipantList
