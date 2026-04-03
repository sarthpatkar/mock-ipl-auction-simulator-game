'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { getBrowserSessionUser, supabaseClient } from '@/lib/supabase'
import { realtimeFeatureFlags } from '@/lib/realtime-flags'
import { AuctionLiveState, Room, RoomEventEnvelope, RoomHealthStatus, RoomParticipant, RoomRuntimeSnapshot, SquadPlayer, Bid } from '@/types'

export type RealtimeStatus = 'connecting' | 'live' | 'degraded' | 'offline'

type RoomRuntimeState = {
  room: Room | null
  auction: AuctionLiveState | null
  bidHistory: Bid[]
  participants: RoomParticipant[]
  squads: SquadPlayer[]
  loading: boolean
  error: string | null
  connectionState: RealtimeStatus
  isStale: boolean
  stateVersion: number
  roomHealthStatus: RoomHealthStatus | null
}

type RoomRuntimeSnapshotResponse = RoomRuntimeSnapshot | null

const INITIAL_STATE: RoomRuntimeState = {
  room: null,
  auction: null,
  bidHistory: [],
  participants: [],
  squads: [],
  loading: true,
  error: null,
  connectionState: 'connecting',
  isStale: false,
  stateVersion: 0,
  roomHealthStatus: null
}

const DISABLED_STATE: RoomRuntimeState = {
  ...INITIAL_STATE,
  loading: false,
  connectionState: 'offline'
}

const PARTICIPANT_SELECT =
  'id, room_id, user_id, team_name, budget_remaining, squad_count, joined_at, accelerated_round_submitted_at, match_finish_confirmed_at, removed_at, removed_by_user_id, removal_reason, owner_profile:profiles!room_participants_user_id_fkey(username)'
const METRIC_FLUSH_MS = 30_000
const PRESENCE_HEARTBEAT_MS = 15_000

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

function normalizeParticipant(row: any): RoomParticipant {
  const profileValue = Array.isArray(row?.owner_profile) ? row.owner_profile[0] ?? null : row?.owner_profile ?? row?.profiles ?? null

  return {
    ...row,
    profiles: profileValue ? { username: profileValue.username } : null
  } as RoomParticipant
}

function sortParticipants(rows: RoomParticipant[]) {
  return [...rows].sort((left, right) => new Date(left.joined_at).getTime() - new Date(right.joined_at).getTime())
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

function createConnectionId(roomId: string) {
  const token =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${roomId}:${token}`
}

function normalizeEventEnvelope(value: any): RoomEventEnvelope | null {
  const source = value?.new ?? value
  if (!source || typeof source !== 'object') return null
  if (typeof source.event_id !== 'string' || typeof source.version !== 'number') return null

  return {
    event_id: source.event_id,
    version: Number(source.version),
    auction_session_id: source.auction_session_id ?? null,
    event_type: String(source.event_type ?? ''),
    payload: (source.payload as Record<string, unknown> | null) ?? null,
    server_generated_at: String(source.server_generated_at ?? source.created_at ?? new Date().toISOString()),
    created_at: String(source.created_at ?? source.server_generated_at ?? new Date().toISOString()),
    total_gap_count: source.total_gap_count == null ? null : Number(source.total_gap_count)
  }
}

function parseSnapshot(data: unknown): RoomRuntimeSnapshotResponse {
  if (!data || typeof data !== 'object') return null
  const snapshot = data as Record<string, unknown>
  if (snapshot.success === false) return (snapshot as unknown) as RoomRuntimeSnapshot
  return {
    success: Boolean(snapshot.success),
    error: typeof snapshot.error === 'string' ? snapshot.error : undefined,
    room: (snapshot.room as Room | null) ?? null,
    auction: (snapshot.auction as AuctionLiveState | null) ?? null,
    participants: (((snapshot.participants as unknown) as any[] | null) ?? []).map(normalizeParticipant),
    squads: ((snapshot.squads as SquadPlayer[] | null) ?? []) as SquadPlayer[],
    bid_history: ((snapshot.bid_history as Bid[] | null) ?? []) as Bid[],
    runtime_cache: (snapshot.runtime_cache as any) ?? null,
    state_version: Number(snapshot.state_version ?? 0),
    room_health_status: (snapshot.room_health_status as RoomHealthStatus | null) ?? null,
    server_time: String(snapshot.server_time ?? new Date().toISOString())
  }
}

class RoomRuntimeStore {
  readonly roomId: string
  private state: RoomRuntimeState = INITIAL_STATE
  private listeners = new Set<() => void>()
  private started = false
  private startingPromise: Promise<void> | null = null
  private channel: ReturnType<typeof supabaseClient.channel> | null = null
  private reconnectTimer: number | null = null
  private replayTimer: number | null = null
  private heartbeatTimer: number | null = null
  private metricTimer: number | null = null
  private connectionId: string
  private currentUserId: string | null = null
  private currentParticipantId: string | null = null
  private channelTransport: 'broadcast' | 'postgres' = realtimeFeatureFlags.roomBroadcastChannel ? 'broadcast' : 'postgres'
  private reconnectCount = 0
  private replayGapCount = 0
  private duplicateEventCount = 0
  private totalDeliveryLagMs = 0
  private totalDeliveryLagSamples = 0
  private lastSnapshotHydrateDurationMs = 0
  private lastReplayRecoveryDurationMs = 0
  private bufferedEvents = new Map<number, RoomEventEnvelope>()
  private seenEventIds: string[] = []

  constructor(roomId: string) {
    this.roomId = roomId
    this.connectionId = createConnectionId(roomId)
  }

  getSnapshot = () => this.state

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    void this.ensureStarted()

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.teardown()
      }
    }
  }

  refetch = async () => {
    await this.hydrate('manual')
  }

  private emit() {
    this.listeners.forEach((listener) => listener())
  }

  private setState(next: RoomRuntimeState | ((current: RoomRuntimeState) => RoomRuntimeState)) {
    this.state = typeof next === 'function' ? next(this.state) : next
    this.emit()
  }

  private async ensureStarted() {
    if (this.started) return
    if (this.startingPromise) return this.startingPromise

    this.startingPromise = (async () => {
      this.started = true
      this.currentUserId = (await getBrowserSessionUser())?.id ?? null
      await this.hydrate('initial')
      this.connectChannel()
      this.startMetricFlush()
    })().finally(() => {
      this.startingPromise = null
    })

    return this.startingPromise
  }

  private teardown() {
    this.started = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.replayTimer) clearTimeout(this.replayTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.metricTimer) clearInterval(this.metricTimer)
    this.reconnectTimer = null
    this.replayTimer = null
    this.heartbeatTimer = null
    this.metricTimer = null
    this.bufferedEvents.clear()
    this.currentParticipantId = null
    if (this.channel) {
      void supabaseClient.removeChannel(this.channel)
      this.channel = null
    }
    roomStoreRegistry.delete(this.roomId)
  }

  private connectChannel() {
    if (!this.roomId || this.channel) return

    this.setState((current) => ({ ...current, connectionState: 'connecting' }))
    const useBroadcastChannel = this.channelTransport === 'broadcast'
    let channel = supabaseClient.channel(`room:${this.roomId}`, {
      config: {
        private: useBroadcastChannel,
        presence: {
          key: this.connectionId
        }
      }
    })

    if (useBroadcastChannel) {
      channel = channel.on('broadcast', { event: 'room_event' }, ({ payload }) => {
        const event = normalizeEventEnvelope(payload)
        if (!event) return
        this.ingestEvent(event)
      })
    } else {
      channel = channel
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${this.roomId}` }, (payload) => {
          this.setState((current) => ({
            ...current,
            room: { ...(current.room ?? {}), ...(payload.new as Room) } as Room
          }))
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_id=eq.${this.roomId}` }, async (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { id: string }
            this.setState((current) => ({
              ...current,
              participants: removeById(current.participants, oldRow.id)
            }))
            return
          }

          const participantId = String((payload.new as { id?: string })?.id ?? '')
          if (!participantId) return

          const snapshot = await this.fetchParticipantSnapshot(participantId)
          if (!snapshot) {
            this.setState((current) => ({
              ...current,
              participants: removeById(current.participants, participantId)
            }))
            return
          }

          this.setState((current) => ({
            ...current,
            participants: sortParticipants(mergeById(current.participants, snapshot))
          }))
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_live_state', filter: `room_id=eq.${this.roomId}` }, (payload) => {
          if (payload.eventType === 'DELETE') {
            this.setState((current) => ({ ...current, auction: null }))
            return
          }

          this.setState((current) => ({
            ...current,
            auction: { ...(current.auction ?? {}), ...(payload.new as AuctionLiveState) } as AuctionLiveState
          }))
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'squad_players', filter: `room_id=eq.${this.roomId}` }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { id: string }
            this.setState((current) => ({
              ...current,
              squads: removeById(current.squads, oldRow.id)
            }))
            return
          }

          const squad = payload.new as SquadPlayer
          this.setState((current) => ({
            ...current,
            squads: mergeById(current.squads, squad)
          }))
        })
    }

    this.channel = channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          this.reconnectCount = 0
          this.setState((current) => ({
            ...current,
            connectionState: 'live',
            error: null,
            isStale: false
          }))
          void this.sendPresence()
          void this.recover()
          this.startPresenceHeartbeat()
          return
        }

        if (useBroadcastChannel && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
          void this.switchToPostgresChannel()
          return
        }

        if (status === 'CHANNEL_ERROR') {
          this.setState((current) => ({ ...current, connectionState: 'degraded', isStale: true }))
          this.scheduleReconnect()
          return
        }

        if (status === 'TIMED_OUT' || status === 'CLOSED') {
          this.setState((current) => ({ ...current, connectionState: 'offline', isStale: true }))
          this.scheduleReconnect()
        }
      })
  }

  private async switchToPostgresChannel() {
    if (!this.started || this.channelTransport === 'postgres') return

    this.channelTransport = 'postgres'

    if (this.channel) {
      await supabaseClient.removeChannel(this.channel)
      this.channel = null
    }

    this.setState((current) => ({
      ...current,
      connectionState: 'connecting',
      error: null
    }))

    this.connectChannel()
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.started) return

    this.reconnectCount += 1
    const delay =
      this.reconnectCount <= 3 ? this.reconnectCount * 500 : Math.min(15_000, 1_000 * 2 ** (this.reconnectCount - 3))

    if (this.reconnectCount >= 5) {
      void this.hydrate('forced-refresh')
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      if (this.channel) {
        void supabaseClient.removeChannel(this.channel)
        this.channel = null
      }
      this.connectChannel()
    }, delay)
  }

  private startPresenceHeartbeat() {
    if (this.heartbeatTimer) return

    this.heartbeatTimer = window.setInterval(() => {
      void this.sendPresence()
    }, PRESENCE_HEARTBEAT_MS)
  }

  private startMetricFlush() {
    if (this.metricTimer) return

    this.metricTimer = window.setInterval(() => {
      void this.flushMetrics()
    }, METRIC_FLUSH_MS)
  }

  private async hydrate(reason: 'initial' | 'manual' | 'recover' | 'forced-refresh') {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

    this.setState((current) => ({
      ...current,
      loading: reason === 'initial' ? true : current.loading,
      error: null
    }))

    try {
      const { data, error } = await supabaseClient.rpc('get_room_runtime_snapshot', {
        p_room_id: this.roomId
      })

      if (error) throw error
      const snapshot = parseSnapshot(data)
      if (!snapshot) throw new Error('Invalid runtime snapshot')
      if (snapshot.success === false) throw new Error(snapshot.error || 'Failed to load room snapshot')

      const participants = sortParticipants(snapshot.participants)
      const room = snapshot.room
      const nextStateVersion = Number(snapshot.state_version ?? room?.state_version ?? 0)

      this.currentParticipantId = participants.find((participant) => participant.user_id === this.currentUserId && !participant.removed_at)?.id ?? null

      this.setState((current) => ({
        ...current,
        room,
        auction: snapshot.auction,
        participants,
        squads: snapshot.squads,
        bidHistory: snapshot.bid_history,
        roomHealthStatus: snapshot.room_health_status,
        stateVersion: nextStateVersion,
        loading: false,
        error: null,
        isStale: false
      }))

      this.lastSnapshotHydrateDurationMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt)
      this.trimSeenEventIds()
    } catch (error) {
      this.setState((current) => ({
        ...current,
        loading: false,
        error: getErrorMessage(error, 'Failed to load room runtime'),
        isStale: true
      }))
    }
  }

  private async recover() {
    if (!realtimeFeatureFlags.replayRecovery || this.state.stateVersion <= 0) return

    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

    try {
      const { data, error } = await supabaseClient.rpc('get_room_events_since', {
        p_room_id: this.roomId,
        p_after_version: this.state.stateVersion
      })

      if (error) throw error
      const rows = Array.isArray(data) ? data : []
      const events = rows.map(normalizeEventEnvelope).filter((value): value is RoomEventEnvelope => Boolean(value))
      const totalGapCount = Number(events[0]?.total_gap_count ?? rows[0]?.total_gap_count ?? 0)

      if (totalGapCount > 100) {
        this.replayGapCount += 1
        await this.hydrate('recover')
        return
      }

      if (events.length > 0) {
        this.applyEventBatch(events)
      }

      this.lastReplayRecoveryDurationMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt)
    } catch {
      await this.hydrate('recover')
    }
  }

  private ingestEvent(event: RoomEventEnvelope) {
    const now = Date.now()
    const eventTimestamp = new Date(event.server_generated_at).getTime()
    if (Number.isFinite(eventTimestamp)) {
      this.totalDeliveryLagMs += Math.max(0, now - eventTimestamp)
      this.totalDeliveryLagSamples += 1
    }

    if (this.hasSeenEvent(event.event_id) || event.version <= this.state.stateVersion) {
      this.duplicateEventCount += 1
      return
    }

    if (event.version > this.state.stateVersion + 1) {
      this.bufferedEvents.set(event.version, event)
      this.replayGapCount += 1

      if (!this.replayTimer) {
        this.replayTimer = window.setTimeout(() => {
          this.replayTimer = null
          void this.recover()
        }, 250)
      }
      return
    }

    this.applyEventBatch([event])
    this.flushBufferedEvents()
  }

  private flushBufferedEvents() {
    const ready: RoomEventEnvelope[] = []
    let nextVersion = this.state.stateVersion + 1

    while (this.bufferedEvents.has(nextVersion)) {
      const event = this.bufferedEvents.get(nextVersion)
      if (!event) break
      ready.push(event)
      this.bufferedEvents.delete(nextVersion)
      nextVersion += 1
    }

    if (ready.length > 0) {
      this.applyEventBatch(ready)
    }
  }

  private applyEventBatch(events: RoomEventEnvelope[]) {
    if (events.length === 0) return

    this.setState((current) => {
      let next = current

      for (const event of events) {
        this.markSeenEvent(event.event_id)
        next = this.reduceEvent(next, event)
      }

      return next
    })
  }

  private reduceEvent(state: RoomRuntimeState, event: RoomEventEnvelope): RoomRuntimeState {
    const payload = (event.payload ?? {}) as Record<string, unknown>
    const roomPayload = payload.room as Partial<Room> | undefined
    const auctionPayload = payload.auction as Partial<AuctionLiveState> | undefined
    const participantPayload = payload.participant ? normalizeParticipant(payload.participant) : null
    const bidPayload = (payload.bid as Bid | undefined) ?? null
    const roomStatus = typeof payload.room_status === 'string' ? (payload.room_status as Room['status']) : null
    const participantId = typeof payload.participant_id === 'string' ? payload.participant_id : null
    const roomHealthStatus = (payload.room_health_status as RoomHealthStatus | undefined) ?? state.roomHealthStatus

    let room = state.room
    let auction = state.auction
    let participants = state.participants
    let squads = state.squads
    let bidHistory = state.bidHistory

    if (roomPayload) {
      room = { ...(room ?? {}), ...roomPayload } as Room
    }

    if (roomStatus && room) {
      room = { ...room, status: roomStatus }
    }

    if (auctionPayload) {
      auction = { ...(auction ?? {}), ...auctionPayload } as AuctionLiveState
    }

    if (participantPayload) {
      if (participantPayload.removed_at) {
        participants = removeById(participants, participantPayload.id)
      } else {
        participants = sortParticipants(mergeById(participants, participantPayload))
      }
    } else if (participantId && event.event_type === 'participant_removed') {
      participants = removeById(participants, participantId)
    }

    if (Array.isArray(payload.squad)) {
      ;(payload.squad as SquadPlayer[]).forEach((squadPlayer) => {
        squads = mergeById(squads, squadPlayer)
      })
    } else if (payload.squad && typeof payload.squad === 'object' && 'id' in (payload.squad as Record<string, unknown>)) {
      squads = mergeById(squads, payload.squad as SquadPlayer)
    }

    if (bidPayload) {
      if (!bidHistory.some((bid) => bid.id === bidPayload.id)) {
        bidHistory = [bidPayload, ...bidHistory].slice(0, 50)
      }
    }

    return {
      ...state,
      room,
      auction,
      participants,
      squads,
      bidHistory,
      stateVersion: Math.max(state.stateVersion, event.version),
      roomHealthStatus,
      error: null,
      isStale: false
    }
  }

  private async fetchParticipantSnapshot(participantId: string) {
    const { data, error } = await supabaseClient
      .from('room_participants')
      .select(PARTICIPANT_SELECT)
      .eq('id', participantId)
      .maybeSingle()

    if (error) throw error
    return data ? normalizeParticipant(data) : null
  }

  private async sendPresence() {
    if (!this.currentParticipantId) return

    try {
      await supabaseClient.rpc('upsert_room_participant_presence', {
        p_room_id: this.roomId,
        p_participant_id: this.currentParticipantId,
        p_connection_id: this.connectionId,
        p_status: 'connected',
        p_reconnect_count: this.reconnectCount
      })
    } catch {
      return
    }

    if (!this.channel) return

    try {
      await this.channel.track({
        participant_id: this.currentParticipantId,
        connection_id: this.connectionId,
        reconnect_count: this.reconnectCount,
        last_seen_at: new Date().toISOString()
      })
    } catch {
      // Presence tracking is supplementary to the RPC-backed heartbeat and should not break the live board.
    }
  }

  private async flushMetrics() {
    if (!this.started) return

    const averageDeliveryLagMs =
      this.totalDeliveryLagSamples > 0 ? Math.round(this.totalDeliveryLagMs / this.totalDeliveryLagSamples) : 0

    await supabaseClient.rpc('record_room_metric_sample', {
      p_room_id: this.roomId,
      p_reconnect_count: this.reconnectCount,
      p_replay_gap_count: this.replayGapCount,
      p_duplicate_event_count: this.duplicateEventCount,
      p_average_delivery_lag_ms: averageDeliveryLagMs,
      p_snapshot_hydrate_duration_ms: this.lastSnapshotHydrateDurationMs,
      p_replay_recovery_time_ms: this.lastReplayRecoveryDurationMs,
      p_room_hydrate_time_ms: this.lastSnapshotHydrateDurationMs,
      p_event_delivery_lag_ms: averageDeliveryLagMs,
      p_reconnect_recovery_time_ms: this.lastReplayRecoveryDurationMs
    })

    this.totalDeliveryLagMs = 0
    this.totalDeliveryLagSamples = 0
    this.replayGapCount = 0
    this.duplicateEventCount = 0
  }

  private hasSeenEvent(eventId: string) {
    return this.seenEventIds.includes(eventId)
  }

  private markSeenEvent(eventId: string) {
    this.seenEventIds.push(eventId)
    this.trimSeenEventIds()
  }

  private trimSeenEventIds() {
    if (this.seenEventIds.length > 1000) {
      this.seenEventIds = this.seenEventIds.slice(-500)
    }
  }
}

const roomStoreRegistry = new Map<string, RoomRuntimeStore>()

function getRoomRuntimeStore(roomId: string | null) {
  if (!roomId) return null
  const existing = roomStoreRegistry.get(roomId)
  if (existing) return existing

  const store = new RoomRuntimeStore(roomId)
  roomStoreRegistry.set(roomId, store)
  return store
}

export function useRoomRuntimeStore(roomId: string | null, enabled = true) {
  const store = useMemo(() => (enabled ? getRoomRuntimeStore(roomId) : null), [enabled, roomId])
  const snapshot = useSyncExternalStore(
    store ? store.subscribe : () => () => undefined,
    store ? store.getSnapshot : () => DISABLED_STATE,
    () => DISABLED_STATE
  )

  return {
    ...snapshot,
    refetch: store ? store.refetch : async () => undefined
  }
}
