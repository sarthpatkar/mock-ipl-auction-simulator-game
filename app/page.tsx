'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ensureUserProfile } from '@/lib/auth-profiles'
import { getBrowserSessionUser, supabaseClient } from '@/lib/supabase'
import {
  createRoomWithAdmin,
  DEFAULT_ROOM_SETTINGS,
  LEGENDS_AUCTION_DEFAULT_SETTINGS,
  MATCH_AUCTION_DEFAULT_SETTINGS,
  fetchUserRooms
} from '@/lib/room-client'
import { fetchAvailableMatches, fetchMatchesByIds } from '@/lib/match-client'
import { LEGENDS_AUCTION_MODE, MATCH_AUCTION_MODE, MATCH_ROOM_BUDGET_OPTIONS, MATCH_ROOM_SQUAD_OPTIONS } from '@/lib/match-auction'
import { ActionCard } from '@/components/home/ActionCard'
import { AuctionModeSelector } from '@/components/home/AuctionModeSelector'
import { MatchAuctionFields } from '@/components/home/MatchAuctionFields'
import { RoomHistoryList } from '@/components/home/RoomHistoryList'
import { CreatorBranding } from '@/components/shared/CreatorBranding'
import { PageNavbar } from '@/components/shared/PageNavbar'
import { UnofficialDisclaimer } from '@/components/shared/UnofficialDisclaimer'
import { AuctionMode, Match, MatchAuctionResult, Room } from '@/types'

export default function HomePage() {
  const legendsComingSoonMessage = 'Legends Auction is coming soon. Player import is still in progress.'
  const router = useRouter()
  const [userInitial, setUserInitial] = useState('U')
  const [rooms, setRooms] = useState<Room[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [teamName, setTeamName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joinTeam, setJoinTeam] = useState('')
  const [auctionMode, setAuctionMode] = useState<AuctionMode>('full_auction')
  const [availableMatches, setAvailableMatches] = useState<Match[]>([])
  const [matchesByRoomId, setMatchesByRoomId] = useState<Record<string, Match | null>>({})
  const [matchResultsByRoomId, setMatchResultsByRoomId] = useState<Record<string, MatchAuctionResult | null>>({})
  const [matchesLoading, setMatchesLoading] = useState(false)
  const [matchesError, setMatchesError] = useState<string | null>(null)
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [matchBudget, setMatchBudget] = useState<number>(MATCH_ROOM_BUDGET_OPTIONS[0])
  const [matchSquadSize, setMatchSquadSize] = useState<number>(MATCH_ROOM_SQUAD_OPTIONS[0])
  const [error, setError] = useState<string | null>(null)
  const [roomsError, setRoomsError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [roomsLoading, setRoomsLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const currentUser = await getBrowserSessionUser()
        if (!active) return

        if (!currentUser) {
          router.replace('/auth/login')
          return
        }

        void ensureUserProfile(currentUser, supabaseClient).catch(() => {})
        setUserId(currentUser.id)
        const email = currentUser.email || 'U'
        setUserInitial(email.charAt(0).toUpperCase())
      } finally {
        if (active) setInitializing(false)
      }
    })()

    return () => {
      active = false
    }
  }, [router])

  const fetchRooms = useCallback(async () => {
    if (!userId) return

    setRoomsLoading(true)
    setRoomsError(null)

    try {
      const result = await fetchUserRooms(userId)
      setRooms(result.rooms)
      setCounts(result.counts)
    } catch (fetchError) {
      setRooms([])
      setCounts({})
      setRoomsError(fetchError instanceof Error ? fetchError.message : 'Failed to load your rooms')
    } finally {
      setRoomsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void fetchRooms()
  }, [fetchRooms])

  useEffect(() => {
    if (!userId || rooms.length === 0) {
      setMatchesByRoomId({})
      setMatchResultsByRoomId({})
      return
    }

    const matchRooms = rooms.filter((room) => room.auction_mode === MATCH_AUCTION_MODE && room.match_id)
    if (matchRooms.length === 0) {
      setMatchesByRoomId({})
      setMatchResultsByRoomId({})
      return
    }

    let active = true

    void (async () => {
      try {
        const roomIds = matchRooms.map((room) => room.id)
        const matchIds = [...new Set(matchRooms.map((room) => room.match_id!).filter(Boolean))]
        const [matchMap, resultResponse] = await Promise.all([
          fetchMatchesByIds(matchIds),
          supabaseClient
            .from('match_auction_results')
            .select('room_id, user_id, projected_score, actual_score, result_status, rank, winner_user_id, last_updated_at, last_result_updated_at, published_stats_version')
            .in('room_id', roomIds)
            .eq('user_id', userId)
        ])

        if (!active) return

        const nextMatchesByRoomId = matchRooms.reduce<Record<string, Match | null>>((acc, room) => {
          acc[room.id] = room.match_id ? matchMap[room.match_id] ?? null : null
          return acc
        }, {})

        const nextResultsByRoomId = (((resultResponse.data as MatchAuctionResult[] | null) ?? []) as MatchAuctionResult[]).reduce<
          Record<string, MatchAuctionResult | null>
        >((acc, row) => {
          acc[row.room_id] = row
          return acc
        }, {})

        setMatchesByRoomId(nextMatchesByRoomId)
        setMatchResultsByRoomId(nextResultsByRoomId)
      } catch {
        if (!active) return
        setMatchesByRoomId({})
        setMatchResultsByRoomId({})
      }
    })()

    return () => {
      active = false
    }
  }, [rooms, userId])

  useEffect(() => {
    if (!createOpen || auctionMode !== MATCH_AUCTION_MODE) return

    let active = true
    setMatchesLoading(true)
    setMatchesError(null)

    void fetchAvailableMatches()
      .then((matches) => {
        if (!active) return
        setAvailableMatches(matches)
        setSelectedMatchId((current) => current || matches[0]?.id || '')
      })
      .catch((matchError) => {
        if (!active) return
        setMatchesError(matchError instanceof Error ? matchError.message : 'Failed to load upcoming matches')
      })
      .finally(() => {
        if (active) setMatchesLoading(false)
      })

    return () => {
      active = false
    }
  }, [auctionMode, createOpen])

  useEffect(() => {
    if (!profileMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [profileMenuOpen])

  const handleCreate = async () => {
    setError(null)

    if (auctionMode === LEGENDS_AUCTION_MODE) {
      setError(legendsComingSoonMessage)
      return
    }

    if (!roomName.trim() || !teamName.trim()) {
      setError('Please fill in room and team name')
      return
    }

    setCreating(true)
    try {
      const isMatchAuction = auctionMode === MATCH_AUCTION_MODE
      if (isMatchAuction && !selectedMatchId) {
        throw new Error('Select an upcoming match for Match Auction')
      }

      const nextSettings = isMatchAuction
        ? {
            ...MATCH_AUCTION_DEFAULT_SETTINGS,
            budget: matchBudget,
            squad_size: matchSquadSize
          }
        : DEFAULT_ROOM_SETTINGS

      const result = await createRoomWithAdmin(roomName, teamName, {
        auctionMode,
        matchId: isMatchAuction ? selectedMatchId : null,
        settings: nextSettings
      })
      setCreateOpen(false)
      setRoomName('')
      setTeamName('')
      setSelectedMatchId('')
      setMatchBudget(MATCH_ROOM_BUDGET_OPTIONS[0])
      setMatchSquadSize(MATCH_ROOM_SQUAD_OPTIONS[0])
      await fetchRooms()
      router.push(`/room/${result.room_id}/lobby`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create room')
    } finally {
      setCreating(false)
    }
  }

  const handleJoin = async () => {
    setError(null)

    if (joinCode.length !== 7) {
      setError('Enter 7-digit code')
      return
    }

    setJoining(true)
    try {
      const { data, error: joinError } = await supabaseClient.rpc('join_room_by_code', {
        p_code: joinCode,
        p_team_name: joinTeam.trim() || 'Guest'
      })

      if (joinError) throw joinError
      if (!data?.success) {
        throw new Error(data?.error || 'Failed to join room')
      }

      setJoinOpen(false)
      setJoinCode('')
      setJoinTeam('')
      await fetchRooms()
      router.push(`/room/${data.room_id}/lobby`)
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Failed to join room')
    } finally {
      setJoining(false)
    }
  }

  const handleSignOut = async () => {
    setError(null)
    setProfileMenuOpen(false)
    setSigningOut(true)

    try {
      const { error: signOutError } = await supabaseClient.auth.signOut()
      if (signOutError) throw signOutError

      setUserId(null)
      setRooms([])
      setCounts({})
      setCreateOpen(false)
      setJoinOpen(false)
      router.replace('/auth/login')
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Failed to sign out')
    } finally {
      setSigningOut(false)
    }
  }

  const filteredRooms = useMemo(() => rooms.filter((room) => room.auction_mode === auctionMode), [auctionMode, rooms])
  const totalRooms = filteredRooms.length
  const ongoingRooms = filteredRooms.filter((room) => room.status !== 'completed').length
  const modalError = error ? <p className="text-red text-sm mt-2">{error}</p> : null
  const isLegendsComingSoon = auctionMode === LEGENDS_AUCTION_MODE
  const actionsDisabled = initializing || signingOut || isLegendsComingSoon
  const statusLabel = useMemo(() => {
    if (initializing) return 'Loading'
    if (roomsLoading) return 'Syncing'
    return `${filteredRooms.length} rooms`
  }, [filteredRooms.length, initializing, roomsLoading])

  return (
    <div className="home-page screen page-with-navbar">
      <PageNavbar
        subtitle="FRANCHISE MODE"
        actions={
          <div className="nav-user-menu" ref={profileMenuRef}>
            <button
              type="button"
              className="nav-profile-trigger"
              aria-haspopup="menu"
              aria-expanded={profileMenuOpen}
              aria-label="Open profile menu"
              onClick={() => setProfileMenuOpen((value) => !value)}
              disabled={initializing}
            >
              <div className="nav-user">
                <div className="nav-avatar">{userInitial}</div>
                <span className="nav-username">Franchise</span>
              </div>
            </button>
            {profileMenuOpen && (
              <div className="nav-profile-menu" role="menu" aria-label="Profile menu">
                <button className="nav-profile-menu-item" type="button" role="menuitem" onClick={() => void handleSignOut()} disabled={signingOut}>
                  {signingOut ? 'Signing Out…' : 'Sign Out'}
                </button>
              </div>
            )}
          </div>
        }
      />

      <div className="home-hero">
        <p className="home-hero-sub">Season 2026 · Franchise Mode</p>
        <h1 className="home-hero-title">
          BUILD YOUR <em>DREAM TEAM</em>
        </h1>
        <p className="home-hero-desc">Host or join a live T20 auction room with your friends</p>
      </div>

      <div className="home-mode-row">
        <AuctionModeSelector value={auctionMode} onChange={setAuctionMode} />
      </div>

      {isLegendsComingSoon && (
        <div className="home-body home-banner-row">
          <div className="card live-banner home-banner-card">
            <div>
              <span className="status-label">Coming Soon</span>
              <p className="live-banner-copy">{legendsComingSoonMessage}</p>
            </div>
          </div>
        </div>
      )}

      {error && !createOpen && !joinOpen && (
        <div className="home-body home-banner-row">
          <div className="card live-banner is-error home-banner-card">
            <div>
              <span className="status-label">Action failed</span>
              <p className="live-banner-copy">{error}</p>
            </div>
          </div>
        </div>
      )}

      <div className="home-body">
        <div className="action-panel">
          <ActionCard
            title="Create Room"
            desc="Start a new auction room. You'll be the admin and control the auction from the lobby."
            ctaLabel="Create Auction Room"
            variant="primary"
            onClick={() => setCreateOpen(true)}
            disabled={actionsDisabled}
          />

          <ActionCard
            title="Join Room"
            desc="Enter a valid room code to join an existing auction as a franchise owner."
            ctaLabel="Join with Code"
            variant="secondary"
            onClick={() => setJoinOpen(true)}
            disabled={actionsDisabled}
          />

          <div className="quick-stats">
            <div className="qs-item">
              <div className="qs-val">{roomsLoading ? '—' : totalRooms}</div>
              <div className="qs-label">Total Rooms</div>
            </div>
            <div className="qs-item">
              <div className="qs-val">{roomsLoading ? '—' : ongoingRooms}</div>
              <div className="qs-label">Ongoing</div>
            </div>
          </div>
        </div>

        <div className="history-panel">
          <div className="section-header">
            <h2 className="section-title">My Rooms</h2>
            <span className="badge badge-gray">{statusLabel}</span>
          </div>
          <RoomHistoryList
            rooms={filteredRooms}
            counts={counts}
            matchesByRoomId={matchesByRoomId}
            matchResultsByRoomId={matchResultsByRoomId}
            loading={initializing || roomsLoading}
            error={roomsError}
          />
        </div>
      </div>

      {createOpen && (
        <div className="modal-overlay modal-overlay-top" onClick={(event) => event.currentTarget === event.target && !creating && setCreateOpen(false)}>
          <div className="modal modal-room">
            <div className="modal-header">
              <h2 className="modal-title">Create Room</h2>
              <p className="modal-copy">
                {auctionMode === MATCH_AUCTION_MODE
                  ? 'Set up a fast head-to-head Match Auction room.'
                  : auctionMode === LEGENDS_AUCTION_MODE
                    ? legendsComingSoonMessage
                  : 'Set up your auction room. You will control the room as host.'}
              </p>
            </div>
            <div className="modal-form modal-body-scroll">
              <div className="input-group">
                <label className="input-label">Room Name</label>
                <input
                  className="input-field"
                  type="text"
                  placeholder="e.g. Mumbai Friends Auction 2026"
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                />
              </div>
              <div className="input-group">
                <label className="input-label">Your Team Name</label>
                <input
                  className="input-field"
                  type="text"
                  placeholder="e.g. Midnight Strikers"
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                />
              </div>
              {auctionMode === MATCH_AUCTION_MODE && (
                <MatchAuctionFields
                  matches={availableMatches}
                  loading={matchesLoading}
                  error={matchesError}
                  selectedMatchId={selectedMatchId}
                  onSelectedMatchIdChange={setSelectedMatchId}
                />
              )}
              {modalError}
              <div className="modal-actions modal-footer">
                <button className="btn btn-ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={() => void handleCreate()} disabled={creating || isLegendsComingSoon}>
                  {isLegendsComingSoon ? 'Coming Soon' : creating ? 'Creating…' : 'Create Room'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {joinOpen && (
        <div className="modal-overlay modal-overlay-top" onClick={(event) => event.currentTarget === event.target && !joining && setJoinOpen(false)}>
          <div className="modal modal-room">
            <div className="modal-header">
              <h2 className="modal-title">Join Room</h2>
              <p className="modal-copy">Enter the 7-digit room code shared by the host.</p>
            </div>
            <div className="modal-form modal-body-scroll">
              <div className="input-group">
                <label className="input-label">Room Code</label>
                <input
                  className="input-field font-mono"
                  type="text"
                  placeholder="e.g. 7492816"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, ''))}
                  maxLength={7}
                  style={{ fontSize: '1.4rem', letterSpacing: '0.3em', textAlign: 'center' }}
                />
              </div>
              <div className="input-group">
                <label className="input-label">Your Team Name</label>
                <input
                  className="input-field"
                  type="text"
                  placeholder="e.g. Harbour Kings"
                  value={joinTeam}
                  onChange={(event) => setJoinTeam(event.target.value)}
                />
              </div>
              {modalError}
              <div className="modal-actions modal-footer">
                <button className="btn btn-ghost" onClick={() => setJoinOpen(false)} disabled={joining}>
                  Cancel
                </button>
                <button className="btn btn-secondary" onClick={() => void handleJoin()} disabled={joining}>
                  {joining ? 'Joining…' : 'Join Auction'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="home-footer-stack">
        <CreatorBranding variant="home" />
        <UnofficialDisclaimer compact className="home-footer-disclaimer" />
      </div>
    </div>
  )
}
