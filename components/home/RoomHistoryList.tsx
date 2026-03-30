import Link from 'next/link'
import { Room } from '@/types'

type Props = {
  rooms: Room[]
  counts?: Record<string, number>
  loading?: boolean
  error?: string | null
}

export function RoomHistoryList({ rooms, counts = {}, loading = false, error = null }: Props) {
  const getRoomHref = (room: Room) => {
    if (room.status === 'completed') return `/room/${room.id}/results`
    if (room.status === 'auction') return `/room/${room.id}/auction`
    if (room.status === 'accelerated_selection') return `/room/${room.id}/accelerated`
    return `/room/${room.id}/lobby`
  }

  if (loading) {
    return (
      <div className="history-list">
        <div className="history-item history-item-skeleton skeleton-card skeleton-block-sm" />
        <div className="history-item history-item-skeleton skeleton-card skeleton-block-sm" />
        <div className="history-item history-item-skeleton skeleton-card skeleton-block-sm" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="empty-state">
        <span className="empty-icon empty-icon-dot" aria-hidden="true"></span>
        <div className="empty-text">{error}</div>
      </div>
    )
  }

  if (!rooms.length) {
    return (
      <div className="empty-state">
        <span className="empty-icon empty-icon-dot" aria-hidden="true"></span>
        <div className="empty-text">No rooms yet. Create one to start an auction.</div>
      </div>
    )
  }

  return (
    <div className="history-list">
      {rooms.map((room) => {
        const statusBadge =
          room.status === 'completed'
            ? <span className="badge badge-gold">Completed</span>
            : <span className="badge badge-green">Ongoing</span>
        const participants = counts[room.id] ?? 0
        return (
          <Link key={room.id} className="history-item" href={getRoomHref(room)}>
            <div className={`history-icon ${room.status === 'completed' ? 'hi-completed' : 'hi-ongoing'}`}>
              <span className="history-status-dot" aria-hidden="true"></span>
            </div>
            <div className="history-info">
              <div className="history-name">{room.name}</div>
              <div className="history-meta">
                {new Date(room.created_at).toLocaleString()} · {participants}/10 participants
              </div>
            </div>
            {statusBadge}
            <span className="history-arrow">›</span>
          </Link>
        )
      })}
    </div>
  )
}

export default RoomHistoryList
