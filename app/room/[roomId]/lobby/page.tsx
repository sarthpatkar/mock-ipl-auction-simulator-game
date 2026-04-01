'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { RoomCodeDisplay } from '@/components/lobby/RoomCodeDisplay'
import { ParticipantList } from '@/components/lobby/ParticipantList'
import { AdminSettings } from '@/components/lobby/AdminSettings'
import { PageNavbar } from '@/components/shared/PageNavbar'
import { UnofficialDisclaimer } from '@/components/shared/UnofficialDisclaimer'
import { useRoom } from '@/hooks/useRoom'
import { getRoomMinimumParticipants, getRoomParticipantLimit, isMatchAuctionRoom } from '@/lib/match-auction'
import { getBrowserSessionUser, supabaseClient } from '@/lib/supabase'
import { buildCategoryQueue, buildRandomQueue } from '@/lib/player-queue'
import { Match, Player } from '@/types'

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
    const playerQuery = supabaseClient.from('players').select('id, role, category, team_code')
    const playerRequest =
      isMatchRoom && roomMatch
        ? playerQuery.in('team_code', [roomMatch.team_a_code, roomMatch.team_b_code])
        : playerQuery
    const { data: players, error: playersError } = await playerRequest
    if (playersError) {
      setStartError(playersError.message)
      return
    }
    const typedPlayers = (players as Player[] | null) ?? []
    if (typedPlayers.length === 0) {
      setStartError('Players table is empty. Run: npm run seed:players')
      return
    }
    const queue =
      room.settings.player_order === 'category'
        ? buildCategoryQueue(typedPlayers)
        : buildRandomQueue(typedPlayers)
    if (queue.length === 0) {
      setStartError('Could not build player queue from players data.')
      return
    }
    const { data: existing, error: existingError } = await supabaseClient
      .from('auction_sessions')
      .select('id')
      .eq('room_id', room.id)
      .maybeSingle()
    if (existingError) {
      setStartError(existingError.message)
      return
    }
    let sessionId: string | undefined = existing?.id
    if (existing) {
      await supabaseClient.from('room_participants').update({ match_finish_confirmed_at: null }).eq('room_id', room.id).is('removed_at', null)
      const { error } = await supabaseClient
        .from('auction_sessions')
        .update({
          player_queue: queue,
          status: 'waiting',
          completed_players: [],
          current_player_id: null,
          current_price: 0,
          highest_bidder_id: null,
          ends_at: null,
          paused_remaining_ms: null,
          selection_ends_at: null,
          accelerated_source_players: [],
          active_bidders: [],
          skipped_bidders: [],
          round_number: 1,
          round_label: 'Round 1'
        })
        .eq('room_id', room.id)
      if (error) {
        setStartError(error.message)
        return
      }
    } else {
      const { data: created, error } = await supabaseClient
        .from('auction_sessions')
        .insert({
          room_id: room.id,
          player_queue: queue,
          status: 'waiting',
          round_number: 1,
          round_label: 'Round 1'
        })
        .select('id')
        .maybeSingle()
      if (error) {
        setStartError(error.message)
        return
      }
      sessionId = created?.id
    }
    const { error: roomError } = await supabaseClient
      .from('rooms')
      .update({ status: 'auction', results_reveal_at: null })
      .eq('id', room.id)
    if (roomError) {
      setStartError(roomError.message)
      return
    }
    const targetSession = sessionId || existing?.id
    if (targetSession) {
      const { data: result, error } = await supabaseClient.rpc('advance_to_next_player', {
        p_auction_session_id: targetSession,
        p_admin_user_id: room.admin_id
      })
      if (error) {
        setStartError(error.message)
        return
      }
      if (result?.success === false) {
        setStartError(result.error || 'Failed to start auction')
        return
      }
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

    await supabaseClient.from('room_participants').delete().eq('room_id', targetRoomId).eq('user_id', userId)
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
          <ParticipantList participants={participants} limit={participantLimit} adminUserId={room?.admin_id} />
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
