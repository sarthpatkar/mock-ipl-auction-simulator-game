'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '@/lib/supabase'
import { Room, RoomParticipant } from '@/types'
import type { RealtimeStatus } from '@/hooks/useAuction'

const ROOM_SELECT = 'id, code, name, admin_id, status, settings, results_reveal_at, created_at'
const PARTICIPANT_SELECT = 'id, room_id, user_id, team_name, budget_remaining, squad_count, joined_at, accelerated_round_submitted_at, profiles(username)'

function normalizeParticipant(row: any): RoomParticipant {
  const profileValue = Array.isArray(row?.profiles) ? row.profiles[0] ?? null : row?.profiles ?? null
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

function sortParticipants(rows: RoomParticipant[]) {
  return [...rows].sort((left, right) => new Date(left.joined_at).getTime() - new Date(right.joined_at).getTime())
}

export function useRoom(roomId: string | null) {
  const [room, setRoom] = useState<Room | null>(null)
  const [participants, setParticipants] = useState<RoomParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<RealtimeStatus>('connecting')
  const hasHydratedRef = useRef(false)
  const priorConnectionRef = useRef<RealtimeStatus>('connecting')

  const fetchParticipantSnapshot = useCallback(async (participantId: string) => {
    const { data, error: participantError } = await supabaseClient
      .from('room_participants')
      .select(PARTICIPANT_SELECT)
      .eq('id', participantId)
      .maybeSingle()

    if (participantError) throw participantError
    return data ? normalizeParticipant(data) : null
  }, [])

  const hydrate = useCallback(async () => {
    if (!roomId) return

    setLoading(true)
    setError(null)

    try {
      const [{ data: roomData, error: roomError }, { data: participantsData, error: participantsError }] = await Promise.all([
        supabaseClient.from('rooms').select(ROOM_SELECT).eq('id', roomId).maybeSingle(),
        supabaseClient.from('room_participants').select(PARTICIPANT_SELECT).eq('room_id', roomId).order('joined_at', { ascending: true })
      ])

      if (roomError) throw roomError
      if (participantsError) throw participantsError

      setRoom((roomData as Room | null) ?? null)
      setParticipants(sortParticipants((((participantsData as unknown) as any[] | null) ?? []).map(normalizeParticipant)))
      hasHydratedRef.current = true
      setConnectionState((value) => (value === 'offline' ? value : 'live'))
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load room state')
      setConnectionState((value) => (value === 'offline' ? value : 'degraded'))
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    void hydrate()
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
            setError(participantError instanceof Error ? participantError.message : 'Failed to sync participants')
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
  }, [fetchParticipantSnapshot, hydrate, roomId])

  return { room, participants, setRoom, loading, error, connectionState, refetch: hydrate }
}
