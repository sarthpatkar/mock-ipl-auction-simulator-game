'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBrowserSessionUser, supabaseClient } from '@/lib/supabase'
import { Room, RoomParticipant } from '@/types'
import type { RealtimeStatus } from '@/hooks/useAuction'

const ROOM_SELECT = 'id, code, name, admin_id, auction_mode, match_id, status, settings, results_reveal_at, created_at'
const PARTICIPANT_SELECT =
  'id, room_id, user_id, team_name, budget_remaining, squad_count, joined_at, accelerated_round_submitted_at, match_finish_confirmed_at, removed_at, removed_by_user_id, removal_reason, owner_profile:profiles!room_participants_user_id_fkey(username)'

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

type UseRoomOptions = {
  includeRemoved?: boolean
}

export function useRoom(roomId: string | null, options: UseRoomOptions = {}) {
  const includeRemoved = options.includeRemoved ?? false
  const [room, setRoom] = useState<Room | null>(null)
  const [participants, setParticipants] = useState<RoomParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<RealtimeStatus>('connecting')
  const hasHydratedRef = useRef(false)
  const priorConnectionRef = useRef<RealtimeStatus>('connecting')

  const fetchParticipantSnapshot = useCallback(async (participantId: string) => {
    let query = supabaseClient.from('room_participants').select(PARTICIPANT_SELECT).eq('id', participantId)
    if (!includeRemoved) {
      query = query.is('removed_at', null)
    }

    const { data, error: participantError } = await query.maybeSingle()

    if (participantError) throw participantError
    return data ? normalizeParticipant(data) : null
  }, [includeRemoved])

  const hydrate = useCallback(async () => {
    if (!roomId) return

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

      let participantsQuery = supabaseClient
        .from('room_participants')
        .select(PARTICIPANT_SELECT)
        .eq('room_id', roomId)
        .order('joined_at', { ascending: true })

      if (!includeRemoved) {
        participantsQuery = participantsQuery.is('removed_at', null)
      }

      const { data: participantsData, error: participantsError } = await participantsQuery
      if (participantsError) throw participantsError

      setParticipants(sortParticipants((((participantsData as unknown) as any[] | null) ?? []).map(normalizeParticipant)))
      hasHydratedRef.current = true
      setConnectionState((value) => (value === 'offline' ? value : 'live'))
    } catch (fetchError) {
      setError(getErrorMessage(fetchError, 'Failed to load room state'))
      setConnectionState((value) => (value === 'offline' ? value : 'degraded'))
    } finally {
      if (!authPending) {
        setLoading(false)
      }
    }
  }, [includeRemoved, roomId])

  useEffect(() => {
    const {
      data: { subscription }
    } = supabaseClient.auth.onAuthStateChange(() => {
      void hydrate()
    })

    void hydrate()

    return () => {
      subscription.unsubscribe()
    }
  }, [hydrate])

  useEffect(() => {
    if (!roomId) return

    setConnectionState('connecting')

    const channel = supabaseClient
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          setRoom((prev) => ({ ...(prev ?? {}), ...(payload.new as Room) } as Room))
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_participants', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          try {
            if (payload.eventType === 'DELETE') {
              const oldRow = payload.old as { id: string }
              setParticipants((prev) => prev.filter((participant) => participant.id !== oldRow.id))
              return
            }

            const row = normalizeParticipant(payload.new)
            if (!includeRemoved && row.removed_at) {
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
      supabaseClient.removeChannel(channel)
    }
  }, [fetchParticipantSnapshot, hydrate, includeRemoved, roomId])

  return { room, participants, setRoom, loading, error, connectionState, refetch: hydrate }
}
