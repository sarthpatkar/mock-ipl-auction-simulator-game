import { NextResponse } from 'next/server'
import { getAuthenticatedApiUser, isMatchResultsAdmin, requireServiceRole } from '@/lib/server-auth'

type RoomMetadataRow = {
  id: string
  code: string
  name: string
  auction_mode: string
  status: string
}

type RuntimeCacheRow = {
  room_id: string
  current_player_id: string | null
  highest_bid: number
  highest_bidder_id: string | null
  timer_end: string | null
  live_participant_count: number
  current_room_status: string
  state_version: number
  room_health_status: string
  abandoned_at: string | null
  updated_at: string
}

type FailedEventRow = {
  id: number
  room_id: string
  event_id: string | null
  failure_reason: string
  retry_count: number
  created_at: string
}

type RollupRow = {
  room_id: string
  bucket_at: string
  room_join_time_p95_ms: number | null
  room_hydrate_time_p95_ms: number | null
  replay_recovery_time_p95_ms: number | null
  bid_acceptance_time_p95_ms: number | null
  next_player_transition_time_p95_ms: number | null
  event_delivery_lag_p95_ms: number | null
  reconnect_recovery_time_p95_ms: number | null
}

function boolFlag(name: string, fallback: boolean) {
  const value = process.env[name]
  if (value == null) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function stringFlag(name: string, fallback: string) {
  const value = process.env[name]
  return value == null || value.trim() === '' ? fallback : value.trim()
}

function intFlag(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedApiUser(request)
    if (!user || !isMatchResultsAdmin(user.id)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const service = requireServiceRole()
    const [runtimeCacheResult, failedEventsResult, rollupsResult] = await Promise.all([
      service
        .from('room_runtime_cache')
        .select(
          'room_id, current_player_id, highest_bid, highest_bidder_id, timer_end, live_participant_count, current_room_status, state_version, room_health_status, abandoned_at, updated_at'
        )
        .order('updated_at', { ascending: false })
        .limit(25),
      service
        .from('failed_room_events')
        .select('id, room_id, event_id, failure_reason, retry_count, created_at')
        .order('created_at', { ascending: false })
        .limit(25),
      service
        .from('room_latency_rollups_5m')
        .select(
          'room_id, bucket_at, room_join_time_p95_ms, room_hydrate_time_p95_ms, replay_recovery_time_p95_ms, bid_acceptance_time_p95_ms, next_player_transition_time_p95_ms, event_delivery_lag_p95_ms, reconnect_recovery_time_p95_ms'
        )
        .order('bucket_at', { ascending: false })
        .limit(25)
    ])

    if (runtimeCacheResult.error) throw runtimeCacheResult.error
    if (failedEventsResult.error) throw failedEventsResult.error
    if (rollupsResult.error) throw rollupsResult.error

    const runtimeCaches = (runtimeCacheResult.data ?? []) as RuntimeCacheRow[]
    const failedEvents = (failedEventsResult.data ?? []) as FailedEventRow[]
    const rollups = (rollupsResult.data ?? []) as RollupRow[]

    const roomIds = [...new Set([...runtimeCaches.map((row) => row.room_id), ...failedEvents.map((row) => row.room_id), ...rollups.map((row) => row.room_id)])]

    let roomsById = new Map<string, RoomMetadataRow>()

    if (roomIds.length > 0) {
      const { data: roomRows, error: roomError } = await service
        .from('rooms')
        .select('id, code, name, auction_mode, status')
        .in('id', roomIds)

      if (roomError) throw roomError
      roomsById = new Map(((roomRows ?? []) as RoomMetadataRow[]).map((room) => [room.id, room]))
    }

    const healthCounts = runtimeCaches.reduce<Record<string, number>>((counts, row) => {
      counts[row.room_health_status] = (counts[row.room_health_status] ?? 0) + 1
      return counts
    }, {})

    const statusCounts = runtimeCaches.reduce<Record<string, number>>((counts, row) => {
      counts[row.current_room_status] = (counts[row.current_room_status] ?? 0) + 1
      return counts
    }, {})

    const retryableFailures = failedEvents.filter((event) => event.retry_count < 5 && event.failure_reason.startsWith('Broadcast')).length

    return NextResponse.json({
      rollout: {
        newRoomStore: boolFlag('NEXT_PUBLIC_FLAG_NEW_ROOM_STORE', true),
        replayRecovery: boolFlag('NEXT_PUBLIC_FLAG_REPLAY_RECOVERY', true),
        cronFinalizeAdvance: boolFlag('NEXT_PUBLIC_FLAG_CRON_FINALIZE_ADVANCE', true),
        roomBroadcastChannel: boolFlag('NEXT_PUBLIC_FLAG_ROOM_BROADCAST_CHANNEL', true),
        roomCacheLayer: boolFlag('NEXT_PUBLIC_FLAG_ROOM_CACHE_LAYER', true),
        rolloutStrategy: stringFlag('NEXT_PUBLIC_REALTIME_ROLLOUT_STRATEGY', 'all'),
        limitedPercent: intFlag('NEXT_PUBLIC_REALTIME_LIMITED_PERCENT', 10),
        internalRoomCount: stringFlag('NEXT_PUBLIC_REALTIME_INTERNAL_ROOM_IDS', '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean).length,
        limitedRoomCount: stringFlag('NEXT_PUBLIC_REALTIME_LIMITED_ROOM_IDS', '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean).length
      },
      summary: {
        trackedRoomCount: runtimeCaches.length,
        failedEventCount: failedEvents.length,
        retryableFailureCount: retryableFailures,
        healthCounts,
        statusCounts
      },
      hotRooms: runtimeCaches.map((row) => ({
        ...row,
        room: roomsById.get(row.room_id) ?? null
      })),
      failedEvents: failedEvents.map((row) => ({
        ...row,
        room: roomsById.get(row.room_id) ?? null
      })),
      rollups: rollups.map((row) => ({
        ...row,
        room: roomsById.get(row.room_id) ?? null
      }))
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load realtime diagnostics' }, { status: 500 })
  }
}
