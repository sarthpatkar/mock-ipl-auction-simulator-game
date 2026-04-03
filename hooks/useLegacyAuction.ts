'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBrowserSessionUser, supabaseClient } from '@/lib/supabase'
import { AuctionLiveState, Bid, Room, RoomParticipant, SquadPlayer } from '@/types'

export type LegacyAuctionRealtimeStatus = 'connecting' | 'live' | 'degraded' | 'offline'

const ROOM_SELECT = 'id, code, name, admin_id, auction_mode, match_id, status, settings, results_reveal_at, created_at'
const LIVE_STATE_SELECT = [
  'auction_session_id',
  'room_id',
  'current_player_id',
  'current_price',
  'highest_bidder_id',
  'ends_at',
  'status',
  'round_number',
  'round_label',
  'active_bidders',
  'skipped_bidders',
  'paused_remaining_ms',
  'completed_count',
  'queue_count',
  'updated_at'
].join(', ')
const BID_SELECT = 'id, auction_session_id, player_id, bidder_id, amount, created_at'
const PARTICIPANT_SELECT =
  'id, room_id, user_id, team_name, budget_remaining, squad_count, joined_at, accelerated_round_submitted_at, match_finish_confirmed_at, removed_at, removed_by_user_id, removal_reason, owner_profile:profiles!room_participants_user_id_fkey(username)'
const SQUAD_SELECT = 'id, room_id, participant_id, player_id, price_paid, acquired_at'

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

function normalizeParticipant(row: any): RoomParticipant {
  const profileValue = Array.isArray(row?.owner_profile) ? row.owner_profile[0] ?? null : row?.owner_profile ?? null
  return {
    ...row,
    profiles: profileValue ? { username: profileValue.username } : null
  } as RoomParticipant
}

function mergeById<T extends { id: string }>(rows: T[], incoming: T) {
  const index = rows.findIndex((row) => row.id === incoming.id)
  if (index === -1) return [...rows, incoming]
  const next = [...rows]
  next[index] = { ...next[index], ...incoming }
  return next
}

function removeById<T extends { id: string }>(rows: T[], id: string) {
  return rows.filter((row) => row.id !== id)
}

function sortParticipants(rows: RoomParticipant[]) {
  return [...rows].sort((left, right) => new Date(left.joined_at).getTime() - new Date(right.joined_at).getTime())
}

type UseLegacyAuctionOptions = {
  enabled?: boolean
}

export function useLegacyAuction(roomId: string | null, options: UseLegacyAuctionOptions = {}) {
  const enabled = options.enabled ?? true
  const [room, setRoom] = useState<Room | null>(null)
  const [auction, setAuction] = useState<AuctionLiveState | null>(null)
  const [bidHistory, setBidHistory] = useState<Bid[]>([])
  const [participants, setParticipants] = useState<RoomParticipant[]>([])
  const [squads, setSquads] = useState<SquadPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<LegacyAuctionRealtimeStatus>('connecting')
  const hasHydratedRef = useRef(false)
  const priorConnectionRef = useRef<LegacyAuctionRealtimeStatus>('connecting')

  const fetchParticipantSnapshot = useCallback(async (participantId: string) => {
    const { data, error: participantError } = await supabaseClient
      .from('room_participants')
      .select(PARTICIPANT_SELECT)
      .eq('id', participantId)
      .is('removed_at', null)
      .maybeSingle()

    if (participantError) throw participantError
    return data ? normalizeParticipant(data) : null
  }, [])

  const hydrate = useCallback(async () => {
    if (!enabled || !roomId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    let authPending = false

    try {
      const sessionUser = await getBrowserSessionUser()
      if (!sessionUser) {
        authPending = true
        setConnectionState('connecting')
        return
      }

      const { data: roomData, error: roomError } = await supabaseClient.from('rooms').select(ROOM_SELECT).eq('id', roomId).maybeSingle()
      if (roomError) throw roomError
      setRoom((roomData as Room | null) ?? null)

      const [
        { data: liveStateData, error: liveStateError },
        { data: participantsData, error: participantsError },
        { data: squadsData, error: squadsError }
      ] = await Promise.all([
        supabaseClient.from('auction_live_state').select(LIVE_STATE_SELECT).eq('room_id', roomId).maybeSingle(),
        supabaseClient.from('room_participants').select(PARTICIPANT_SELECT).eq('room_id', roomId).is('removed_at', null).order('joined_at', { ascending: true }),
        supabaseClient.from('squad_players').select(SQUAD_SELECT).eq('room_id', roomId)
      ])

      if (liveStateError) throw liveStateError
      if (participantsError) throw participantsError
      if (squadsError) throw squadsError

      const liveAuction = (liveStateData as AuctionLiveState | null) ?? null

      setAuction(liveAuction)
      setParticipants(sortParticipants((((participantsData as unknown) as any[] | null) ?? []).map(normalizeParticipant)))
      setSquads((squadsData as SquadPlayer[] | null) ?? [])

      if (liveAuction?.auction_session_id) {
        const { data: bidsData, error: bidsError } = await supabaseClient
          .from('bids')
          .select(BID_SELECT)
          .eq('auction_session_id', liveAuction.auction_session_id)
          .order('created_at', { ascending: false })
          .limit(50)

        if (bidsError) throw bidsError
        setBidHistory((bidsData as Bid[] | null) ?? [])
      } else {
        setBidHistory([])
      }

      hasHydratedRef.current = true
      setConnectionState((value) => (value === 'offline' ? value : 'live'))
    } catch (fetchError) {
      setError(getErrorMessage(fetchError, 'Failed to load live auction state'))
      setConnectionState((value) => (value === 'offline' ? value : 'degraded'))
    } finally {
      if (!authPending) {
        setLoading(false)
      }
    }
  }, [enabled, roomId])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      setError(null)
      setConnectionState('offline')
      return
    }

    const {
      data: { subscription }
    } = supabaseClient.auth.onAuthStateChange(() => {
      void hydrate()
    })

    void hydrate()

    return () => {
      subscription.unsubscribe()
    }
  }, [enabled, hydrate])

  useEffect(() => {
    if (!enabled || !roomId) return

    setConnectionState('connecting')

    const channel = supabaseClient
      .channel(`auction-room:${roomId}:${auction?.auction_session_id ?? 'pending'}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          setRoom((prev) => ({ ...(prev ?? {}), ...(payload.new as Room) } as Room))
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'auction_live_state', filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setAuction(null)
            setBidHistory([])
            return
          }

          const next = payload.new as AuctionLiveState
          setAuction((prev) => ({ ...(prev ?? next), ...next }))
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bids', filter: `auction_session_id=eq.${auction?.auction_session_id ?? ''}` },
        (payload) => {
          const incoming = payload.new as Bid
          setBidHistory((prev) => {
            if (prev.some((bid) => bid.id === incoming.id)) return prev
            return [incoming, ...prev].slice(0, 50)
          })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_participants', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          try {
            if (payload.eventType === 'DELETE') {
              const oldRow = payload.old as { id: string }
              setParticipants((prev) => removeById(prev, oldRow.id))
              return
            }

            const row = normalizeParticipant(payload.new)
            if (row.removed_at) {
              setParticipants((prev) => removeById(prev, row.id))
              return
            }

            if (payload.eventType === 'INSERT') {
              const snapshot = await fetchParticipantSnapshot(row.id)
              if (!snapshot) return
              setParticipants((prev) => sortParticipants(mergeById(prev, snapshot)))
              return
            }

            setParticipants((prev) =>
              sortParticipants(
                mergeById(
                  prev,
                  ({
                    ...prev.find((participant) => participant.id === row.id),
                    ...row
                  } as RoomParticipant)
                )
              )
            )
          } catch (participantError) {
            setError(getErrorMessage(participantError, 'Failed to sync participants'))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'squad_players', filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { id: string }
            setSquads((prev) => removeById(prev, oldRow.id))
            return
          }

          const row = payload.new as SquadPlayer
          setSquads((prev) => mergeById(prev, row))
        }
      )
      .subscribe((status) => {
        const previous = priorConnectionRef.current
        priorConnectionRef.current = status === 'SUBSCRIBED' ? 'live' : previous

        if (status === 'SUBSCRIBED') {
          setConnectionState('live')
          setError(null)
          if (hasHydratedRef.current && previous !== 'live') {
            void hydrate()
          }
          return
        }

        if (status === 'CHANNEL_ERROR') {
          setConnectionState('degraded')
          setError((value) => value ?? 'Realtime subscription failed. Check that required tables are enabled for Supabase Realtime.')
          priorConnectionRef.current = 'degraded'
          return
        }

        if (status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnectionState('offline')
          setError((value) => value ?? 'Realtime connection lost. Reconnecting…')
          priorConnectionRef.current = 'offline'
        }
      })

    return () => {
      void supabaseClient.removeChannel(channel)
    }
  }, [auction?.auction_session_id, enabled, fetchParticipantSnapshot, hydrate, roomId])

  return {
    room,
    auction,
    bidHistory,
    participants,
    squads,
    loading,
    error,
    connectionState,
    isStale: false,
    refetch: hydrate
  }
}
