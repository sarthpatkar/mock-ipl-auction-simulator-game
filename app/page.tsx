'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ensureUserProfile } from '@/lib/auth-profiles'
import { getBrowserSessionUser, supabaseClient } from '@/lib/supabase'
import { createRoomWithAdmin, DEFAULT_ROOM_SETTINGS, fetchUserRooms } from '@/lib/room-client'
import { ActionCard } from '@/components/home/ActionCard'
import { RoomHistoryList } from '@/components/home/RoomHistoryList'
import { CreatorBranding } from '@/components/shared/CreatorBranding'
import { PageNavbar } from '@/components/shared/PageNavbar'
import { Room } from '@/types'

export default function HomePage() {
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
  const [error, setError] = useState<string | null>(null)
  const [roomsError, setRoomsError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [roomsLoading, setRoomsLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

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

  const handleCreate = async () => {
    setError(null)

    if (!roomName.trim() || !teamName.trim()) {
      setError('Please fill in room and team name')
      return
    }

    setCreating(true)
    try {
      const result = await createRoomWithAdmin(roomName, teamName, DEFAULT_ROOM_SETTINGS)
      setCreateOpen(false)
      setRoomName('')
      setTeamName('')
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

  const totalRooms = rooms.length
  const ongoingRooms = rooms.filter((room) => room.status !== 'completed').length
  const modalError = error ? <p className="text-red text-sm mt-2">{error}</p> : null
  const actionsDisabled = initializing || signingOut
  const statusLabel = useMemo(() => {
    if (initializing) return 'Loading'
    if (roomsLoading) return 'Syncing'
    return `${rooms.length} rooms`
  }, [initializing, rooms.length, roomsLoading])

  return (
    <div className="home-page screen page-with-navbar">
      <PageNavbar
        subtitle="FRANCHISE MODE"
        actions={
          <>
            <div className="nav-user">
              <div className="nav-avatar">{userInitial}</div>
              <span className="nav-username">Franchise</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => void handleSignOut()} disabled={signingOut || initializing}>
              {signingOut ? 'Signing Out…' : 'Sign Out'}
            </button>
          </>
        }
      />

      <div className="home-hero">
        <p className="home-hero-sub">Season 2026 · Franchise Mode</p>
        <h1 className="home-hero-title">
          BUILD YOUR <em>DREAM TEAM</em>
        </h1>
        <p className="home-hero-desc">Host or join a live IPL auction room with your friends</p>
        <CreatorBranding variant="home" />
      </div>

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
          <RoomHistoryList rooms={rooms} counts={counts} loading={initializing || roomsLoading} error={roomsError} />
        </div>
      </div>

      {createOpen && (
        <div className="modal-overlay" onClick={(event) => event.currentTarget === event.target && !creating && setCreateOpen(false)}>
          <div className="modal modal-room">
            <div className="modal-header">
              <h2 className="modal-title">Create Room</h2>
              <p className="modal-copy">Set up your auction room. You will control the room as host.</p>
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
                  placeholder="e.g. Royal Challengers"
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                />
              </div>
              {modalError}
              <div className="modal-actions modal-footer">
                <button className="btn btn-ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={() => void handleCreate()} disabled={creating}>
                  {creating ? 'Creating…' : 'Create Room'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {joinOpen && (
        <div className="modal-overlay" onClick={(event) => event.currentTarget === event.target && !joining && setJoinOpen(false)}>
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
                  placeholder="e.g. Chennai Super Kings"
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
    </div>
  )
}
