'use client'

import { useEffect, useMemo, useState } from 'react'
import { Player } from '@/types'
import Image from 'next/image'
import { formatRole, getTeamColor, getTeamThemeClass, getTeamThemeStyle, isInternalPlayerImageUrl } from '@/lib/auction-helpers'

type Props = {
  player: Player | null
}

export function PlayerCard({ player }: Props) {
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [player?.id, player?.image_url])

  const fallbackInitials = useMemo(
    () =>
      player?.name
        .split(' ')
        .map((part) => part[0])
        .join('')
        .slice(0, 2) || '',
    [player?.name]
  )
  const displayImageUrl = useMemo(() => {
    if (!player?.image_url) return null
    return isInternalPlayerImageUrl(player.image_url) ? player.image_url : null
  }, [player?.image_url])

  if (!player) {
    return (
      <div className="card player-card player-card-empty">
        <div className="player-card-empty-copy">
          <span className="status-label">Awaiting state update</span>
          <strong className="player-card-empty-title">Waiting for the next player</strong>
          <p className="text-muted">The auction stage updates only after the backend confirms the next turn.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`card player-card team-theme ${getTeamThemeClass(player.ipl_team)}`} style={getTeamThemeStyle(player.ipl_team)}>
      <div className="player-card-media">
        {displayImageUrl && !imageFailed ? (
          <Image src={displayImageUrl} alt={player.name} fill className="object-cover" onError={() => setImageFailed(true)} />
        ) : (
          <div className="player-card-fallback">
            {fallbackInitials}
          </div>
        )}
      </div>
      <div className="player-card-content">
        <div className="player-card-header">
          <span className="player-card-kicker">Current player</span>
          <h2 className="text-3xl font-display" data-auction-player-target="current-name">{player.name}</h2>
          <span className="badge badge-blue text-uppercase">{formatRole(player.role)}</span>
          <span
            className="badge badge-team"
            style={{
              backgroundColor: `${getTeamColor(player.ipl_team)}22`,
              borderColor: `${getTeamColor(player.ipl_team)}55`,
              color: getTeamColor(player.ipl_team)
            }}
          >
            {player.ipl_team || 'FA'}
          </span>
          <span className="badge badge-gray">{player.category}</span>
        </div>
        <div className="player-card-meta">
          <p><span className="player-meta-label">Age</span><span className="player-meta-value">{player.age ?? '—'}</span></p>
          <p><span className="player-meta-label">Nationality</span><span className="player-meta-value">{player.nationality || '—'}</span></p>
          <p><span className="player-meta-label">Batting Style</span><span className="player-meta-value strong">{player.batting_style || '—'}</span></p>
          <p><span className="player-meta-label">Bowling Style</span><span className="player-meta-value strong">{player.bowling_style || '—'}</span></p>
          <p><span className="player-meta-label">Base Price</span><span className="player-meta-value gold">{player.base_price_label || '—'}</span></p>
          <p><span className="player-meta-label">Spouse</span><span className="player-meta-value">{player.spouse || '—'}</span></p>
        </div>
      </div>
    </div>
  )
}

export default PlayerCard
