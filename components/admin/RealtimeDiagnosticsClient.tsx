'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabaseClient } from '@/lib/supabase'

type DiagnosticsResponse = {
  rollout: {
    newRoomStore: boolean
    replayRecovery: boolean
    cronFinalizeAdvance: boolean
    roomBroadcastChannel: boolean
    roomCacheLayer: boolean
    rolloutStrategy: string
    limitedPercent: number
    internalRoomCount: number
    limitedRoomCount: number
  }
  summary: {
    trackedRoomCount: number
    failedEventCount: number
    retryableFailureCount: number
    healthCounts: Record<string, number>
    statusCounts: Record<string, number>
  }
  hotRooms: Array<{
    room_id: string
    highest_bid: number
    live_participant_count: number
    current_room_status: string
    state_version: number
    room_health_status: string
    timer_end: string | null
    updated_at: string
    abandoned_at: string | null
    room: {
      code: string
      name: string
      auction_mode: string
      status: string
    } | null
  }>
  failedEvents: Array<{
    id: number
    room_id: string
    event_id: string | null
    failure_reason: string
    retry_count: number
    created_at: string
    room: {
      code: string
      name: string
      auction_mode: string
      status: string
    } | null
  }>
  rollups: Array<{
    room_id: string
    bucket_at: string
    room_join_time_p95_ms: number | null
    room_hydrate_time_p95_ms: number | null
    replay_recovery_time_p95_ms: number | null
    bid_acceptance_time_p95_ms: number | null
    next_player_transition_time_p95_ms: number | null
    event_delivery_lag_p95_ms: number | null
    reconnect_recovery_time_p95_ms: number | null
    room: {
      code: string
      name: string
      auction_mode: string
      status: string
    } | null
  }>
  error?: string
}

function formatNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-IN').format(Math.round(value))
}

function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export function RealtimeDiagnosticsClient() {
  const [data, setData] = useState<DiagnosticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const session = await supabaseClient.auth.getSession()
        const token = session.data.session?.access_token
        const response = await fetch('/api/admin/realtime/status', {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        })
        const payload = (await response.json()) as DiagnosticsResponse

        if (!active) return
        if (!response.ok) {
          setError(payload.error || 'Failed to load realtime diagnostics')
          return
        }

        setData(payload)
        setError(null)
      } catch (fetchError) {
        if (!active) return
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load realtime diagnostics')
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    const timer = window.setInterval(() => {
      void load()
    }, 15_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const healthCounts = useMemo(() => Object.entries(data?.summary.healthCounts ?? {}), [data?.summary.healthCounts])
  const statusCounts = useMemo(() => Object.entries(data?.summary.statusCounts ?? {}), [data?.summary.statusCounts])

  return (
    <div className="realtime-diagnostics-grid">
      <section className="card realtime-diagnostics-panel">
        <div className="realtime-diagnostics-head">
          <div>
            <span className="status-label">Realtime Rollout</span>
            <h2 className="realtime-diagnostics-title">Current rollout and transport flags</h2>
          </div>
          {loading ? <span className="badge badge-gray">Loading</span> : <span className="badge badge-green">Live</span>}
        </div>
        {error && <p className="text-red text-sm">{error}</p>}
        {data && (
          <div className="realtime-chip-grid">
            <span className="badge badge-blue">Strategy: {data.rollout.rolloutStrategy}</span>
            <span className={`badge ${data.rollout.newRoomStore ? 'badge-green' : 'badge-gray'}`}>New Store</span>
            <span className={`badge ${data.rollout.replayRecovery ? 'badge-green' : 'badge-gray'}`}>Replay Recovery</span>
            <span className={`badge ${data.rollout.cronFinalizeAdvance ? 'badge-green' : 'badge-gray'}`}>Cron Finalize</span>
            <span className={`badge ${data.rollout.roomBroadcastChannel ? 'badge-green' : 'badge-gray'}`}>Broadcast</span>
            <span className={`badge ${data.rollout.roomCacheLayer ? 'badge-green' : 'badge-gray'}`}>Cache Layer</span>
            <span className="badge badge-gold">Limited %: {data.rollout.limitedPercent}</span>
            <span className="badge badge-gray">Internal Rooms: {data.rollout.internalRoomCount}</span>
            <span className="badge badge-gray">Limited Rooms: {data.rollout.limitedRoomCount}</span>
          </div>
        )}
      </section>

      <section className="card realtime-diagnostics-panel">
        <div className="realtime-diagnostics-head">
          <div>
            <span className="status-label">Room Health</span>
            <h2 className="realtime-diagnostics-title">Tracked room and failure summary</h2>
          </div>
        </div>
        {data && (
          <>
            <div className="realtime-summary-grid">
              <div className="realtime-summary-card">
                <strong>{data.summary.trackedRoomCount}</strong>
                <span>Tracked rooms</span>
              </div>
              <div className="realtime-summary-card">
                <strong>{data.summary.failedEventCount}</strong>
                <span>Failed events</span>
              </div>
              <div className="realtime-summary-card">
                <strong>{data.summary.retryableFailureCount}</strong>
                <span>Retryable failures</span>
              </div>
            </div>
            <div className="realtime-chip-grid">
              {healthCounts.map(([status, count]) => (
                <span key={status} className="badge badge-blue">
                  {status}: {count}
                </span>
              ))}
              {statusCounts.map(([status, count]) => (
                <span key={status} className="badge badge-gray">
                  {status}: {count}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card realtime-diagnostics-panel">
        <div className="realtime-diagnostics-head">
          <div>
            <span className="status-label">Hot Rooms</span>
            <h2 className="realtime-diagnostics-title">Latest runtime cache state</h2>
          </div>
        </div>
        <div className="realtime-table-wrap">
          <table className="realtime-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Status</th>
                <th>Health</th>
                <th>Live Users</th>
                <th>Bid</th>
                <th>Version</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {(data?.hotRooms ?? []).map((room) => (
                <tr key={room.room_id}>
                  <td>
                    <strong>{room.room?.name || room.room_id}</strong>
                    <div className="text-secondary text-xs">{room.room?.code || room.room_id}</div>
                  </td>
                  <td>{room.current_room_status}</td>
                  <td>{room.room_health_status}</td>
                  <td>{room.live_participant_count}</td>
                  <td>{formatPrice(room.highest_bid)}</td>
                  <td>{formatNumber(room.state_version)}</td>
                  <td>{formatTimestamp(room.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card realtime-diagnostics-panel">
        <div className="realtime-diagnostics-head">
          <div>
            <span className="status-label">Dead Letter</span>
            <h2 className="realtime-diagnostics-title">Recent failed room events</h2>
          </div>
        </div>
        <div className="realtime-table-wrap">
          <table className="realtime-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Failure</th>
                <th>Retries</th>
                <th>Event</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(data?.failedEvents ?? []).map((event) => (
                <tr key={event.id}>
                  <td>
                    <strong>{event.room?.name || event.room_id}</strong>
                    <div className="text-secondary text-xs">{event.room?.code || event.room_id}</div>
                  </td>
                  <td>{event.failure_reason}</td>
                  <td>{event.retry_count}</td>
                  <td>{event.event_id || '—'}</td>
                  <td>{formatTimestamp(event.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card realtime-diagnostics-panel realtime-diagnostics-panel-full">
        <div className="realtime-diagnostics-head">
          <div>
            <span className="status-label">P95 Latency</span>
            <h2 className="realtime-diagnostics-title">Latest 5 minute rollups</h2>
          </div>
        </div>
        <div className="realtime-table-wrap">
          <table className="realtime-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Bucket</th>
                <th>Join</th>
                <th>Hydrate</th>
                <th>Replay</th>
                <th>Bid</th>
                <th>Next Player</th>
                <th>Delivery Lag</th>
                <th>Reconnect</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rollups ?? []).map((row, index) => (
                <tr key={`${row.room_id}-${row.bucket_at}-${index}`}>
                  <td>
                    <strong>{row.room?.name || row.room_id}</strong>
                    <div className="text-secondary text-xs">{row.room?.code || row.room_id}</div>
                  </td>
                  <td>{formatTimestamp(row.bucket_at)}</td>
                  <td>{formatNumber(row.room_join_time_p95_ms)} ms</td>
                  <td>{formatNumber(row.room_hydrate_time_p95_ms)} ms</td>
                  <td>{formatNumber(row.replay_recovery_time_p95_ms)} ms</td>
                  <td>{formatNumber(row.bid_acceptance_time_p95_ms)} ms</td>
                  <td>{formatNumber(row.next_player_transition_time_p95_ms)} ms</td>
                  <td>{formatNumber(row.event_delivery_lag_p95_ms)} ms</td>
                  <td>{formatNumber(row.reconnect_recovery_time_p95_ms)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
