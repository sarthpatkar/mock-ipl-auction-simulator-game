'use client'

import Image from 'next/image'
import { memo, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { RealtimeStatus } from '@/hooks/useAuction'
import { useTimer } from '@/hooks/useTimer'
import { AdminControls } from '@/components/auction/AdminControls'
import { BidActions } from '@/components/auction/BidActions'
import { formatAuctionStatus, formatPrice, formatRole, getTeamThemeClass, getTeamThemeStyle, isInternalPlayerImageUrl } from '@/lib/auction-helpers'
import type { AuctionLiveState, Bid, Player, Room, RoomParticipant, SquadPlayer } from '@/types'

type Props = {
  room: Room | null
  auction: AuctionLiveState | null
  currentPlayer: Player | null
  progressCount: string
  participants: RoomParticipant[]
  bidHistory: Bid[]
  squads: SquadPlayer[]
  playersById: Record<string, Player>
  currentUserId: string | null
  me: RoomParticipant | undefined
  soundEnabled: boolean
  onToggleSound: () => void
  onExpire: (endsAt: string) => void | Promise<void>
  screenLoading: boolean
  screenError: string | null
  connectionState: RealtimeStatus
  isStale: boolean
  onRefetch: () => void | Promise<void>
  skipTargetCount: number
}

function formatCompactPurse(value: number) {
  return formatPrice(value).replace(/^₹/, '').replace(' Cr', ' cr').replace('L', 'L')
}

function useExpiryFlag(endsAt: string | null, status?: AuctionLiveState['status']) {
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (!endsAt || status !== 'live') {
      setExpired(false)
      return
    }

    const ms = new Date(endsAt).getTime() - Date.now()
    if (ms <= 0) {
      setExpired(true)
      return
    }

    setExpired(false)
    const timeout = window.setTimeout(() => setExpired(true), ms)
    return () => window.clearTimeout(timeout)
  }, [endsAt, status])

  return expired
}

function MobilePlayerMedia({ player }: { player: Player | null }) {
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

  return (
    <div className="mobile-auction-player-media">
      {displayImageUrl && !imageFailed ? (
        <Image src={displayImageUrl} alt={player?.name || 'Player'} fill className="object-cover" onError={() => setImageFailed(true)} />
      ) : (
        <div className="mobile-auction-player-fallback">{fallbackInitials || 'PL'}</div>
      )}
    </div>
  )
}

const MobilePlayerIdentity = memo(function MobilePlayerIdentity({ player }: { player: Player | null }) {
  if (!player) {
    return (
      <div className="mobile-auction-player-content">
        <span className="status-label">Current player</span>
        <strong className="mobile-auction-player-name">Waiting for the next player</strong>
        <p className="mobile-auction-player-team">Stage updates after backend confirmation.</p>
      </div>
    )
  }

  const primaryDetailItems = [
    ['Role', formatRole(player.role)],
    ['Category', player.category],
    ['Age', player.age ?? '—']
  ]

  const middleDetailItems = [
    ['Nationality', player.nationality || '—'],
    ['Base', player.base_price_label || '—']
  ]

  const secondaryDetailItems = [
    ['Batting', player.batting_style || '—'],
    ['Bowling', player.bowling_style || '—'],
    ['Spouse', player.spouse || '—']
  ]

  return (
    <>
      <MobilePlayerMedia player={player} />
      <div className="mobile-auction-player-content">
        <div className="mobile-auction-player-head">
          <div className="mobile-auction-player-copy">
            <span className="status-label">Current player</span>
            <strong className="mobile-auction-player-name" data-auction-player-target="current-name">{player.name}</strong>
          </div>
          <div className="mobile-auction-player-badges">
            <span className="mobile-auction-player-badge">{player.ipl_team || 'FA'}</span>
          </div>
        </div>
        <div className="mobile-auction-player-details mobile-auction-player-details-primary" aria-label="Primary player details">
          {primaryDetailItems.map(([label, value]) => (
            <span key={label} className="mobile-auction-player-detail">
              <span>{label}</span>
              <strong>{value}</strong>
            </span>
          ))}
        </div>
        <div className="mobile-auction-player-details mobile-auction-player-details-middle" aria-label="Secondary player details">
          {middleDetailItems.map(([label, value]) => (
            <span key={label} className="mobile-auction-player-detail">
              <span>{label}</span>
              <strong>{value}</strong>
            </span>
          ))}
        </div>
      </div>
      <div className="mobile-auction-player-details mobile-auction-player-details-secondary" aria-label="Player details">
        {secondaryDetailItems.map(([label, value]) => (
          <span key={label} className="mobile-auction-player-detail">
            <span>{label}</span>
            <strong>{value}</strong>
          </span>
        ))}
      </div>
    </>
  )
})

const MobilePlayerIdentityCard = memo(function MobilePlayerIdentityCard({
  player
}: {
  player: Player | null
}) {
  return (
    <section
      className={`card mobile-auction-player-card team-theme ${getTeamThemeClass(player?.ipl_team)}`}
      style={getTeamThemeStyle(player?.ipl_team)}
      aria-label="Current player"
    >
      <MobilePlayerIdentity player={player} />
    </section>
  )
})

const MobileCurrentBidAndTimer = memo(function MobileCurrentBidAndTimer({
  auction,
  currentPlayer,
  highestBidder,
  timerSeconds,
  onExpire
}: {
  auction: AuctionLiveState
  currentPlayer: Player | null
  highestBidder: RoomParticipant | undefined
  timerSeconds: number
  onExpire: (endsAt: string) => void | Promise<void>
}) {
  const pausedRemaining = useMemo(() => {
    if (!auction.paused_remaining_ms) return 0
    return Math.max(0, Math.ceil(auction.paused_remaining_ms / 1000))
  }, [auction.paused_remaining_ms])

  const { remaining } = useTimer(auction.status === 'live' ? auction.ends_at ?? null : null, onExpire)
  const seconds = auction.status === 'paused' ? pausedRemaining : remaining
  const safeSeconds = Math.max(0, seconds)
  const timerProgress = timerSeconds > 0 ? Math.max(0, Math.min(1, safeSeconds / timerSeconds)) : 0
  const timerState = auction.status === 'paused' ? 'paused' : safeSeconds <= 5 ? 'danger' : safeSeconds <= 10 ? 'warning' : 'live'

  return (
    <section
      className={`card mobile-auction-timer team-theme ${getTeamThemeClass(currentPlayer?.ipl_team)} is-${auction.status}`}
      style={getTeamThemeStyle(currentPlayer?.ipl_team)}
      aria-label="Auction timer"
    >
      <div className="mobile-auction-timer-bid">
        <div>
          <span className="status-label">Current bid</span>
          <strong className="mobile-auction-timer-bid-value">{formatPrice(auction.current_price)}</strong>
        </div>
        <div className="mobile-auction-timer-bidder">
          <span className="status-label">Highest bidder</span>
          <strong>{highestBidder?.team_name || 'No bids yet'}</strong>
        </div>
      </div>

      <div className="mobile-auction-timer-core">
        <div className={`mobile-auction-timer-ring is-${timerState}`} style={{ ['--timer-progress' as string]: `${timerProgress}` }}>
          <div className="mobile-auction-timer-ring-core">
            <strong className="mobile-auction-timer-seconds">{safeSeconds}</strong>
            <span className="mobile-auction-timer-unit">seconds</span>
          </div>
        </div>
      </div>

      <div className="mobile-auction-timer-foot">
        <span className={`timer-state-chip is-${timerState}`}>
          {auction.status === 'paused' ? 'Paused' : formatAuctionStatus(auction.status)}
        </span>
        <span className="mobile-auction-timer-caption">
          {auction.status === 'paused'
            ? 'Waiting for the host to resume.'
            : `${timerSeconds}s clock · live backend timer`}
        </span>
      </div>
    </section>
  )
})

const MobileBidHistoryStrip = memo(function MobileBidHistoryStrip({
  bidHistory,
  participants
}: {
  bidHistory: Bid[]
  participants: RoomParticipant[]
}) {
  return (
    <section className="card mobile-auction-history" aria-label="Recent bids">
      <div className="mobile-auction-section-head">
        <span className="status-label">Recent bids</span>
      </div>
      <div className="mobile-auction-history-track" role="list">
        {bidHistory.slice(0, 16).map((bid) => {
          const bidder = participants.find((participant) => participant.id === bid.bidder_id)
          return (
            <div
              key={bid.id}
              className={`mobile-auction-history-item team-theme ${getTeamThemeClass(bidder?.team_name)}`}
              style={getTeamThemeStyle(bidder?.team_name)}
              role="listitem"
            >
              <span className="mobile-auction-history-name">{bidder?.profiles?.username || bidder?.team_name || 'Bid'}</span>
              <strong className="mobile-auction-history-price">{formatPrice(bid.amount)}</strong>
            </div>
          )
        })}
        {bidHistory.length === 0 && <div className="mobile-auction-history-empty">No bids yet</div>}
      </div>
    </section>
  )
})

const MobileTeamsPanel = memo(function MobileTeamsPanel({
  participant,
  squad,
  playersById
}: {
  participant: RoomParticipant | null
  squad: SquadPlayer[]
  playersById: Record<string, Player>
}) {
  return (
    <section className="card mobile-auction-teams-panel" aria-label="Selected team squad">
      <div className="mobile-auction-team-summary">
        <div>
          <span className="status-label">Selected team</span>
          <strong>{participant?.team_name || 'No team selected'}</strong>
        </div>
        {participant && (
          <div className="mobile-auction-team-summary-metrics">
            <span>{participant.squad_count} players</span>
            <span>{formatPrice(participant.budget_remaining)} left</span>
          </div>
        )}
      </div>

      <div className="mobile-auction-panel-list">
        {participant && squad.length > 0 ? (
          squad.map((entry) => {
            const player = playersById[entry.player_id]
            return (
              <div key={entry.id} className="mobile-auction-panel-row">
                <div>
                  <strong>{player?.name || entry.player_id}</strong>
                  <span>{player ? formatRole(player.role) : 'Player'}</span>
                </div>
                <strong className="mobile-auction-panel-price">{formatPrice(entry.price_paid)}</strong>
              </div>
            )
          })
        ) : (
          <div className="mobile-auction-panel-empty">No picks yet.</div>
        )}
      </div>
    </section>
  )
})

const MobileBottomActionBar = memo(function MobileBottomActionBar({
  auction,
  me,
  squadLimit,
  skipTargetCount
}: {
  auction: AuctionLiveState
  me: RoomParticipant
  squadLimit: number
  skipTargetCount: number
}) {
  const isExpired = useExpiryFlag(auction.ends_at ?? null, auction.status)

  return (
    <div className="mobile-auction-actionbar">
      <div className="mobile-auction-actionbar-inner">
        <BidActions
          auctionSessionId={auction.auction_session_id}
          participantId={me.id}
          currentPrice={auction.current_price}
          hasHighestBid={Boolean(auction.highest_bidder_id)}
          budgetRemaining={me.budget_remaining}
          squadCount={me.squad_count}
          squadLimit={squadLimit}
          isPaused={auction.status === 'paused'}
          isExpired={isExpired}
          skipped={Boolean(auction.skipped_bidders?.includes(me.id))}
          isHighestBidder={auction.highest_bidder_id === me.id}
          skipCount={auction.skipped_bidders?.length || 0}
          activeCount={skipTargetCount}
        />
      </div>
    </div>
  )
})

function getMobileLiveMessage(
  screenError: string | null,
  connectionState: RealtimeStatus,
  isStale: boolean
) {
  if (screenError) return { tone: 'is-error', title: 'Live board issue', copy: screenError }
  if (connectionState === 'offline') {
    return {
      tone: 'is-danger',
      title: 'Connection lost',
      copy: 'Realtime connection is down. Use refresh once the channel reconnects.'
    }
  }
  if (connectionState === 'degraded') {
    return {
      tone: 'is-warning',
      title: 'Sync status',
      copy: 'Realtime delivery is delayed. Waiting for the next confirmed backend update.'
    }
  }
  if (isStale) {
    return {
      tone: 'is-warning',
      title: 'Sync status',
      copy: 'The board is catching up to the most recent backend state.'
    }
  }
  return null
}

export function MobileAuctionLayout({
  room,
  auction,
  currentPlayer,
  progressCount,
  participants,
  bidHistory,
  squads,
  playersById,
  currentUserId,
  me,
  soundEnabled,
  onToggleSound,
  onExpire,
  screenLoading,
  screenError,
  connectionState,
  isStale,
  onRefetch,
  skipTargetCount
}: Props) {
  const router = useRouter()
  const [adminMenuOpen, setAdminMenuOpen] = useState(false)
  const [teamsOpen, setTeamsOpen] = useState(false)
  const orderedParticipants = useMemo(() => {
    const mine = participants.find((participant) => participant.user_id === currentUserId)
    const others = participants.filter((participant) => participant.user_id !== currentUserId)
    return mine ? [mine, ...others] : participants
  }, [currentUserId, participants])
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null)

  useEffect(() => {
    if (!orderedParticipants.length) {
      setSelectedParticipantId(null)
      return
    }

    setSelectedParticipantId((current) =>
      current && orderedParticipants.some((participant) => participant.id === current) ? current : orderedParticipants[0]?.id ?? null
    )
  }, [orderedParticipants])

  const isAdmin = Boolean(room?.admin_id && currentUserId === room.admin_id)
  const highestBidder = useMemo(
    () => participants.find((participant) => participant.id === auction?.highest_bidder_id),
    [auction?.highest_bidder_id, participants]
  )
  const selectedParticipant = useMemo(
    () => orderedParticipants.find((participant) => participant.id === selectedParticipantId) ?? null,
    [orderedParticipants, selectedParticipantId]
  )
  const selectedSquad = useMemo(
    () => (selectedParticipant ? squads.filter((entry) => entry.participant_id === selectedParticipant.id) : []),
    [selectedParticipant, squads]
  )
  const liveMessage = getMobileLiveMessage(screenError, connectionState, isStale)
  const squadSummary = `${me?.squad_count ?? 0}/${room?.settings.squad_size ?? 0}`
  const purseSummary = me ? formatCompactPurse(me.budget_remaining) : '0 cr'

  return (
    <>
      <header className="mobile-auction-navbar">
        <div className="mobile-auction-navbar-left">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => router.push('/')}>
            ← Home
          </button>
          <div className="mobile-auction-nav-room">
            <span className="status-label">Room</span>
            <strong>{room?.name || 'Auction Room'}</strong>
          </div>
        </div>

        <div className="mobile-auction-navbar-center" aria-label="Squad, purse, and auction progress">
          <div className="mobile-auction-nav-capsule">
            <span>Squad</span>
            <strong>{squadSummary}</strong>
          </div>
          <div className="mobile-auction-nav-capsule">
            <span>Purse</span>
            <strong>{purseSummary}</strong>
          </div>
          <div className="mobile-auction-nav-capsule">
            <span>Done</span>
            <strong>{progressCount}</strong>
          </div>
        </div>

        <div className="mobile-auction-navbar-right">
          {(auction || room) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm mobile-auction-admin-trigger"
              aria-expanded={adminMenuOpen}
              aria-label="Auction menu"
              onClick={() => setAdminMenuOpen((value) => !value)}
            >
              ⋮
            </button>
          )}
        </div>
      </header>

      {adminMenuOpen && <button className="mobile-auction-admin-backdrop" type="button" aria-label="Close admin menu" onClick={() => setAdminMenuOpen(false)} />}
      {adminMenuOpen && auction && (
          <div className="mobile-auction-admin-menu">
            <button
              type="button"
              className={`btn btn-ghost btn-sm auction-sound-toggle mobile-auction-admin-sound ${soundEnabled ? 'is-enabled' : 'is-disabled'}`}
              aria-pressed={soundEnabled}
              onClick={onToggleSound}
            >
              Sound {soundEnabled ? 'On' : 'Off'}
            </button>
            {isAdmin && <AdminControls auctionSessionId={auction.auction_session_id} status={auction.status} compact />}
          </div>
      )}

      <div className="mobile-auction-fixed-stack">
        <MobilePlayerIdentityCard player={currentPlayer} />
        {auction && (
          <MobileCurrentBidAndTimer
            auction={auction}
            currentPlayer={currentPlayer}
            highestBidder={highestBidder}
            timerSeconds={room?.settings.timer_seconds || 15}
            onExpire={onExpire}
          />
        )}
      </div>

      <div className="mobile-auction-scroll">
        {screenLoading ? (
          <>
            <div className="card skeleton-card skeleton-block-sm" />
            <div className="card skeleton-card skeleton-block-sm" />
            <div className="card skeleton-card skeleton-block-lg" />
          </>
        ) : (
          <>
            {liveMessage && (
              <div className={`card live-banner ${liveMessage.tone}`}>
                <div>
                  <span className="status-label">{liveMessage.title}</span>
                  <p className="live-banner-copy">{liveMessage.copy}</p>
                </div>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => void onRefetch()}>
                  Refresh Board
                </button>
              </div>
            )}

            {auction ? (
              <>
                <MobileBidHistoryStrip bidHistory={bidHistory} participants={participants} />

                <section className="card mobile-auction-teams" aria-label="Team selector">
                  <div className="mobile-auction-teams-head">
                    <span className="status-label">View teams</span>
                    <button className="btn btn-ghost btn-sm mobile-auction-teams-toggle" type="button" onClick={() => setTeamsOpen((value) => !value)}>
                      {teamsOpen ? 'Hide Teams' : 'Show Teams'}
                    </button>
                  </div>

                  <div className="mobile-auction-teams-strip" role="tablist" aria-label="Participant teams">
                    {orderedParticipants.map((participant) => {
                      const isSelected = participant.id === selectedParticipantId
                      const isMine = participant.user_id === currentUserId
                      return (
                        <button
                          key={participant.id}
                          type="button"
                          role="tab"
                          aria-selected={isSelected}
                          className={`mobile-auction-team-chip ${isSelected ? 'is-selected' : ''} ${isMine ? 'is-mine' : ''}`}
                          onClick={() => {
                            setSelectedParticipantId(participant.id)
                            setTeamsOpen(true)
                          }}
                        >
                          <span>{isMine ? 'My Team' : 'Team'}</span>
                          <strong>{participant.team_name}</strong>
                        </button>
                      )
                    })}
                  </div>
                </section>

                {teamsOpen && <MobileTeamsPanel participant={selectedParticipant} squad={selectedSquad} playersById={playersById} />}

                {auction.highest_bidder_id === me?.id && (
                  <div className="card live-callout is-success">
                    <span className="status-label">Live advantage</span>
                    <p>You currently hold the highest confirmed bid.</p>
                  </div>
                )}
              </>
            ) : (
              <div className="card player-card-empty">
                <div className="player-card-empty-copy">
                  <span className="status-label">Awaiting live session</span>
                  <strong className="player-card-empty-title">Auction session is not ready</strong>
                  <p className="text-muted">This screen activates once the room and auction session are available from the backend.</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {auction && me && <MobileBottomActionBar auction={auction} me={me} squadLimit={room?.settings.squad_size || 20} skipTargetCount={skipTargetCount} />}
    </>
  )
}

export default MobileAuctionLayout
