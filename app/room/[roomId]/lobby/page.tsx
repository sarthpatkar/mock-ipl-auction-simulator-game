'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { RoomCodeDisplay } from '@/components/lobby/RoomCodeDisplay'
import { ParticipantList } from '@/components/lobby/ParticipantList'
import { AdminSettings } from '@/components/lobby/AdminSettings'
import { PageNavbar } from '@/components/shared/PageNavbar'
import { UnofficialDisclaimer } from '@/components/shared/UnofficialDisclaimer'
import { useRoom } from '@/hooks/useRoom'
import { createIdempotencyKey } from '@/lib/idempotency'
import { getRoomMinimumParticipants, getRoomParticipantLimit, isLegendsAuctionRoom, isMatchAuctionRoom } from '@/lib/match-auction'
import { getBrowserSessionUser, supabaseClient } from '@/lib/supabase'
import { Match, RoomParticipant } from '@/types'

function useDebouncedParticipants(participants: RoomParticipant[], delayMs = 120) {
  const [debounced, setDebounced] = useState(participants)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(participants)
    }, delayMs)

    return () => window.clearTimeout(timer)
  }, [delayMs, participants])

  return debounced
}

export default function LobbyPage() {
  const params = useParams()
  const roomId = params?.roomId as string
  const router = useRouter()
  const { room, participants, loading: roomLoading, error: roomError } = useRoom(roomId)
  const [userId, setUserId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [lobbyNotice, setLobbyNotice] = useState('Waiting for participants…')
  const [roomMatch, setRoomMatch] = useState<Match | null>(null)
  const lobbyAudioRef = useRef<HTMLAudioElement | null>(null)
  const participantLimit = useMemo(() => getRoomParticipantLimit(room), [room])
  const minimumParticipants = useMemo(() => getRoomMinimumParticipants(room), [room])
  const debouncedParticipants = useDebouncedParticipants(participants)

  useEffect(() => {
    getBrowserSessionUser().then((currentUser) => {
      if (!currentUser) {
        router.push('/auth/login')
        return
      }
      setUserId(currentUser.id)
    })
  }, [router])

  useEffect(() => {
    if (!room) return
    if (room.status === 'auction') {
      router.push(`/room/${room.id}/auction`)
    }
    if (room.status === 'accelerated_selection') {
      router.push(`/room/${room.id}/accelerated`)
    }
    if (room.status === 'completed') {
      router.push(`/room/${room.id}/results`)
    }
  }, [room, router])

  const isAdmin = room?.admin_id === userId
  const isMatchRoom = isMatchAuctionRoom(room)
  const isLegendsRoom = isLegendsAuctionRoom(room)
  const startDisabled = !isAdmin || (participants?.length ?? 0) < minimumParticipants || (isMatchRoom && (participants?.length ?? 0) !== 2)

  useEffect(() => {
    if (!room?.match_id || !isMatchRoom) {
      setRoomMatch(null)
      return
    }

    let active = true

    void supabaseClient
      .from('matches')
      .select('id, season, match_slug, team_a_code, team_b_code, team_a_name, team_b_name, match_date, venue, status, external_match_id, auction_enabled, last_scorecard_upload_at')
      .eq('id', room.match_id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setRoomMatch((data as Match | null) ?? null)
      })

    return () => {
      active = false
    }
  }, [isMatchRoom, room?.match_id])

  useEffect(() => {
    if (isMatchRoom) {
      if (participants.length >= 2) {
        setLobbyNotice('Both competitors are ready')
      } else {
        setLobbyNotice('Waiting for both competitors')
      }
      return
    }

    if (participants.length >= participantLimit) {
      setLobbyNotice('Auction table is ready')
    } else if (participants.length >= minimumParticipants) {
      setLobbyNotice('Franchises are joining the auction')
    } else {
      setLobbyNotice('Waiting for participants...')
    }
  }, [isMatchRoom, minimumParticipants, participantLimit, participants.length])

  useEffect(() => {
    if (typeof window === 'undefined' || room?.status !== 'lobby') {
      if (lobbyAudioRef.current) {
        lobbyAudioRef.current.pause()
        lobbyAudioRef.current.currentTime = 0
        lobbyAudioRef.current = null
      }
      return
    }

    const audio = new Audio('/lobby-waiting-music.mp3')
    audio.preload = 'auto'
    audio.loop = true
    audio.volume = 0.45
    lobbyAudioRef.current = audio

    const startPlayback = () => {
      void audio.play().catch(() => {})
    }

    startPlayback()
    window.addEventListener('pointerdown', startPlayback, { once: true })
    window.addEventListener('keydown', startPlayback, { once: true })

    return () => {
      window.removeEventListener('pointerdown', startPlayback)
      window.removeEventListener('keydown', startPlayback)
      audio.pause()
      audio.currentTime = 0
      if (lobbyAudioRef.current === audio) {
        lobbyAudioRef.current = null
      }
    }
  }, [room?.status])

  const startAuction = async () => {
    if (!room) return
    if (lobbyAudioRef.current) {
      lobbyAudioRef.current.pause()
      lobbyAudioRef.current.currentTime = 0
    }
    setStartError(null)
    const { data: result, error } = await supabaseClient.rpc('start_auction_session', {
      p_room_id: room.id,
      p_idempotency_key: createIdempotencyKey('start-auction', room.id)
    })
    if (error) {
      setStartError(error.message)
      return
    }
    if (result?.success === false) {
      setStartError(result.error || 'Failed to start auction')
      return
    }
    router.push(`/room/${room.id}/auction`)
  }

  const leaveRoom = async () => {
    if (!userId) return
    const targetRoomId = room?.id ?? roomId
    if (!targetRoomId) return

    const deleteRoomResult = await supabaseClient.from('rooms').delete().eq('id', targetRoomId)
    if (!deleteRoomResult.error) {
      router.push('/')
      return
    }

    await supabaseClient.rpc('leave_room', { p_room_id: targetRoomId })
    router.push('/')
  }

  const code = useMemo(() => room?.code ?? '-------', [room])

  return (
    <div className="lobby-page screen page-with-navbar">
      <PageNavbar
        subtitle="LOBBY"
        showHome
        actions={
          <>
            <button className="btn btn-danger btn-sm" onClick={leaveRoom}>
              Leave Room
            </button>
          </>
        }
      />
      <div className="mx-auto w-full max-w-6xl px-6 pt-4">
        <UnofficialDisclaimer compact />
      </div>

      <div className="lobby-body">
        <div className="lobby-left">
          {roomError && (
            <div className="card live-banner is-warning">
              <div>
                <span className="status-label">Room sync</span>
                <p className="live-banner-copy">{roomError}</p>
              </div>
            </div>
          )}
          <div className="room-header">
            <div>
              <div className="rh-label">Auction Room</div>
              <div className="rh-name">{room?.name || (roomLoading ? 'Loading…' : 'Room unavailable')}</div>
              <div className="rh-meta">
                <span className="badge badge-green">{room?.status === 'lobby' ? 'Waiting' : room?.status}</span>
                {isMatchRoom && <span className="badge badge-blue">Match Auction</span>}
                {isLegendsRoom && <span className="badge badge-gray">Legends Auction</span>}
                {isAdmin && <span className="badge badge-gold">Host</span>}
              </div>
              {isMatchRoom && roomMatch && (
                <div className="rh-meta" style={{ marginTop: 10 }}>
                  <span className="badge badge-gray">
                    {roomMatch.team_a_code} vs {roomMatch.team_b_code}
                  </span>
                  <span className="badge badge-gray">{new Date(roomMatch.match_date).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          <RoomCodeDisplay code={code} />
          <ParticipantList participants={debouncedParticipants} limit={participantLimit} adminUserId={room?.admin_id} />
        </div>

        <div className="settings-panel">
          {room && isAdmin ? (
            <>
              <AdminSettings roomId={room.id} settings={room.settings} auctionMode={room.auction_mode} />
              <div className="start-zone">
                <p className="start-note">
                  <strong>{participants.length} franchises</strong> ready in the lobby. Minimum {minimumParticipants} participants required to start.
                </p>
                {isMatchRoom && <p className="text-secondary text-sm mb-2">Quick auction mode using players from one upcoming match only.</p>}
                {isLegendsRoom && <p className="text-secondary text-sm mb-2">Legends Auction uses the dedicated IPL legends player pool with fixed 11-player squads.</p>}
                <p className="text-secondary text-sm mb-4">{lobbyNotice}</p>
                <button className="btn btn-green btn-lg w-full" disabled={startDisabled} onClick={startAuction}>
                  Start Auction
                </button>
                {startError && <p className="text-red text-sm mt-2">{startError}</p>}
              </div>
            </>
          ) : (
            <div className="non-admin-wait">
              <div className="naw-title">Waiting for host to start…</div>
              <div className="naw-desc">{lobbyNotice}. You will enter the auction room automatically once the host begins.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
