'use client'

import { useEffect, useMemo, useState } from 'react'
import { fetchPlayersByTeamCodes } from '@/lib/player-catalog'
import { supabaseClient } from '@/lib/supabase'
import type { ParseAttemptDiagnostic, ParsedMatchStatRow } from '@/lib/scorecard-parser'
import { Match, Player } from '@/types'

type ParseResponse = {
  scorecardId: string | null
  scorecardVersion: number
  provider: string | null
  model: string | null
  payload: {
    match_id: string
    rows: ParsedMatchStatRow[]
    unresolved_rows: Array<{ source_text: string; reason: string }>
  }
  diagnostics?: ParseAttemptDiagnostic[]
}

const ADMIN_VISIBLE_MATCH_STATUSES = ['live', 'completed', 'abandoned', 'cancelled'] as const
const ADMIN_VISIBLE_MATCH_STATUS_SET = new Set<Match['status']>(ADMIN_VISIBLE_MATCH_STATUSES)

function createEmptyRow(teamCode = ''): ParsedMatchStatRow {
  return {
    source_player_name: '',
    mapped_player_id: null,
    player_name_snapshot: '',
    team_code: teamCode,
    did_play: true,
    is_playing_xi: true,
    is_substitute: false,
    parse_confidence: null,
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    wickets: 0,
    overs: 0,
    maidens: 0,
    economy: null,
    catches: 0,
    stumpings: 0,
    run_outs: 0,
    row_status: 'needs_review'
  }
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function isSameLocalDay(date: Date, dayStart: Date, nextDayStart: Date) {
  return date >= dayStart && date < nextDayStart
}

export function MatchResultsAdminClient() {
  const [matches, setMatches] = useState<Match[]>([])
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [rawScorecardText, setRawScorecardText] = useState('')
  const [rows, setRows] = useState<ParsedMatchStatRow[]>([])
  const [initialRowsSnapshot, setInitialRowsSnapshot] = useState<string>('[]')
  const [unresolvedRows, setUnresolvedRows] = useState<Array<{ source_text: string; reason: string }>>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [loadingMatches, setLoadingMatches] = useState(true)
  const [parseLoading, setParseLoading] = useState(false)
  const [publishLoading, setPublishLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [scorecardId, setScorecardId] = useState<string | null>(null)
  const [scorecardVersion, setScorecardVersion] = useState<number | null>(null)
  const [providerLabel, setProviderLabel] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<ParseAttemptDiagnostic[]>([])

  const parseWithTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs: number) => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await fetch(input, { ...init, signal: controller.signal })
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const selectedMatch = useMemo(() => matches.find((match) => match.id === selectedMatchId) ?? null, [matches, selectedMatchId])
  const manualRowChangeCount = useMemo(() => {
    const initial = JSON.parse(initialRowsSnapshot) as ParsedMatchStatRow[]
    const maxLength = Math.max(initial.length, rows.length)
    let count = 0

    for (let index = 0; index < maxLength; index += 1) {
      if (JSON.stringify(initial[index] ?? null) !== JSON.stringify(rows[index] ?? null)) {
        count += 1
      }
    }

    return count
  }, [initialRowsSnapshot, rows])

  useEffect(() => {
    let active = true

    const todayStart = startOfLocalDay(new Date())
    const tomorrowStart = new Date(todayStart)
    tomorrowStart.setDate(tomorrowStart.getDate() + 1)

    void supabaseClient
      .from('matches')
      .select('id, season, match_slug, team_a_code, team_b_code, team_a_name, team_b_name, match_date, venue, status, external_match_id, auction_enabled, last_scorecard_upload_at')
      .in('status', [...ADMIN_VISIBLE_MATCH_STATUSES, 'upcoming'])
      .order('match_date', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return
        setLoadingMatches(false)
        if (error) {
          setMessage(error.message)
          return
        }
        const nextMatches = ((data as Match[] | null) ?? [])
          .filter((match) => {
            if (ADMIN_VISIBLE_MATCH_STATUS_SET.has(match.status)) {
              return true
            }

            if (match.status !== 'upcoming') {
              return false
            }

            return isSameLocalDay(new Date(match.match_date), todayStart, tomorrowStart)
          })
          .sort((left, right) => {
            const leftDate = new Date(left.match_date)
            const rightDate = new Date(right.match_date)
            const leftIsTodayUpcoming = left.status === 'upcoming' && isSameLocalDay(leftDate, todayStart, tomorrowStart)
            const rightIsTodayUpcoming = right.status === 'upcoming' && isSameLocalDay(rightDate, todayStart, tomorrowStart)

            if (leftIsTodayUpcoming && rightIsTodayUpcoming) {
              return leftDate.getTime() - rightDate.getTime()
            }

            if (leftIsTodayUpcoming) {
              return -1
            }

            if (rightIsTodayUpcoming) {
              return 1
            }

            return rightDate.getTime() - leftDate.getTime()
          })
        setMatches(nextMatches)
        setSelectedMatchId(nextMatches[0]?.id ?? '')
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selectedMatch) {
      setPlayers([])
      return
    }

    let active = true
    void fetchPlayersByTeamCodes([selectedMatch.team_a_code, selectedMatch.team_b_code], 'id, name, team_code, role')
      .then((map) => {
        if (!active) return
        setPlayers(Object.values(map))
      })
      .catch((error) => {
        if (!active) return
        setMessage(error instanceof Error ? error.message : 'Failed to load match players')
      })

    return () => {
      active = false
    }
  }, [selectedMatch])

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section className="card">
        <div className="section-header">
          <div>
            <h1 className="section-title">Match Result Admin</h1>
            <p className="text-muted text-sm">Paste a scorecard, review parsed rows, then publish final Match Auction results.</p>
          </div>
        </div>

        <div className="input-group" style={{ marginTop: 16 }}>
          <label className="input-label">Match</label>
          <select className="input-field" value={selectedMatchId} onChange={(event) => setSelectedMatchId(event.target.value)} disabled={loadingMatches}>
            <option value="">{loadingMatches ? 'Loading matches…' : 'Select a match'}</option>
            {matches.map((match) => (
              <option key={match.id} value={match.id}>
                {match.team_a_code} vs {match.team_b_code} · {new Date(match.match_date).toLocaleString()}
              </option>
            ))}
          </select>
        </div>

        <div className="input-group">
          <label className="input-label">Raw scorecard text</label>
          <textarea
            className="input-field"
            rows={12}
            value={rawScorecardText}
            onChange={(event) => setRawScorecardText(event.target.value)}
            placeholder="Paste the full scorecard here"
          />
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={parseLoading || !selectedMatchId || !rawScorecardText.trim()}
            onClick={async () => {
              setParseLoading(true)
              setMessage(null)
              try {
                const session = await supabaseClient.auth.getSession()
                const token = session.data.session?.access_token
                const response = await parseWithTimeout('/api/admin/match-results/parse', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                  },
                  body: JSON.stringify({
                    matchId: selectedMatchId,
                    rawScorecardText
                  })
                }, 75_000)

                const payload = (await response.json()) as ParseResponse & { error?: string }
                if (!response.ok) throw new Error(payload.error || 'Failed to parse scorecard')

                setRows(payload.payload.rows)
                setInitialRowsSnapshot(JSON.stringify(payload.payload.rows))
                setUnresolvedRows(payload.payload.unresolved_rows)
                setScorecardId(payload.scorecardId)
                setScorecardVersion(payload.scorecardVersion)
                setProviderLabel(payload.provider ? `${payload.provider}${payload.model ? ` · ${payload.model}` : ''}` : 'Manual review')
                setDiagnostics(payload.diagnostics ?? [])
                setMessage(`Parsed ${payload.payload.rows.length} rows${payload.payload.unresolved_rows.length ? ` with ${payload.payload.unresolved_rows.length} unresolved lines` : ''}.`)
              } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') {
                  setMessage('Parsing timed out. The server did not return within 75 seconds.')
                } else {
                  setMessage(error instanceof Error ? error.message : 'Failed to parse scorecard')
                }
              } finally {
                setParseLoading(false)
              }
            }}
          >
            {parseLoading ? 'Parsing…' : 'Generate Match Results'}
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            disabled={!selectedMatch}
            onClick={() => setRows((current) => [...current, createEmptyRow(selectedMatch?.team_a_code || '')])}
          >
            Add Row
          </button>
        </div>

        {providerLabel && <p className="text-secondary text-sm mt-3">Parser: {providerLabel} · Scorecard version {scorecardVersion}</p>}
        {message && <p className="text-secondary text-sm mt-3">{message}</p>}
        {diagnostics.length > 0 && (
          <div className="mt-3" style={{ display: 'grid', gap: 8 }}>
            {diagnostics.map((entry, index) => (
              <div key={`${entry.provider}-${entry.model}-${index}`} className="card" style={{ padding: 12 }}>
                <strong className="text-sm">{entry.provider} · {entry.model}</strong>
                <p className="text-secondary text-sm mt-1">
                  {entry.status} {entry.message ? `· ${entry.message}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {unresolvedRows.length > 0 && (
        <section className="card">
          <span className="status-label">Incomplete rows</span>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {unresolvedRows.map((row, index) => (
              <div key={`${row.source_text}-${index}`} className="card">
                <strong>{row.source_text}</strong>
                <p className="text-secondary text-sm mt-2">{row.reason}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <section className="card">
          <div className="section-header">
            <div>
              <h2 className="section-title">Review Parsed Stats</h2>
              <p className="text-muted text-sm">You can edit, add, or delete rows before publish.</p>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
            {rows.map((row, index) => (
              <div key={`${row.source_player_name}-${index}`} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <strong>Row {index + 1}</strong>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>
                    Delete
                  </button>
                </div>
                <div style={{ display: 'grid', gap: 12, marginTop: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                  <label className="input-group">
                    <span className="input-label">Source player name</span>
                    <input className="input-field" value={row.source_player_name} onChange={(event) => setRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, source_player_name: event.target.value } : entry))} />
                  </label>
                  <label className="input-group">
                    <span className="input-label">Mapped player</span>
                    <select
                      className="input-field"
                      value={row.mapped_player_id ?? ''}
                      onChange={(event) => {
                        const selectedPlayer = players.find((player) => player.id === event.target.value) ?? null
                        setRows((current) =>
                          current.map((entry, rowIndex) =>
                            rowIndex === index
                              ? {
                                  ...entry,
                                  mapped_player_id: event.target.value || null,
                                  player_name_snapshot: selectedPlayer?.name || entry.player_name_snapshot,
                                  team_code: selectedPlayer?.team_code || entry.team_code
                                }
                              : entry
                          )
                        )
                      }}
                    >
                      <option value="">Unmapped</option>
                      {players.map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.name} · {player.team_code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="input-group">
                    <span className="input-label">Team code</span>
                    <input className="input-field" value={row.team_code} onChange={(event) => setRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, team_code: event.target.value.toUpperCase() } : entry))} />
                  </label>
                  <label className="input-group">
                    <span className="input-label">Row status</span>
                    <select className="input-field" value={row.row_status} onChange={(event) => setRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, row_status: event.target.value as ParsedMatchStatRow['row_status'] } : entry))}>
                      <option value="parsed">parsed</option>
                      <option value="needs_review">needs_review</option>
                      <option value="ignored">ignored</option>
                    </select>
                  </label>
                  {(['runs', 'balls', 'fours', 'sixes', 'wickets', 'overs', 'maidens', 'economy', 'catches', 'stumpings', 'run_outs'] as const).map((field) => (
                    <label key={field} className="input-group">
                      <span className="input-label">{field}</span>
                      <input
                        className="input-field"
                        type="number"
                        step={field === 'overs' || field === 'economy' ? '0.1' : '1'}
                        value={row[field] ?? ''}
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((entry, rowIndex) =>
                              rowIndex === index
                                ? {
                                    ...entry,
                                    [field]: event.target.value === '' ? null : Number(event.target.value)
                                  }
                                : entry
                            )
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={publishLoading || !scorecardId}
              onClick={async () => {
                setPublishLoading(true)
                setMessage(null)
                try {
                  const session = await supabaseClient.auth.getSession()
                  const token = session.data.session?.access_token
                  const response = await fetch('/api/admin/match-results/publish', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...(token ? { Authorization: `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify({
                      matchId: selectedMatchId,
                      scorecardId,
                      rows,
                      manualRowChangeCount
                    })
                  })

                  const payload = (await response.json()) as { error?: string; success?: boolean; publishedRoomCount?: number; publishedStatsVersion?: number }
                  if (!response.ok) throw new Error(payload.error || 'Failed to publish results')

                  setMessage(`Published version ${payload.publishedStatsVersion} to ${payload.publishedRoomCount} linked room(s).`)
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : 'Failed to publish results')
                } finally {
                  setPublishLoading(false)
                }
              }}
            >
              {publishLoading ? 'Publishing…' : 'Publish Match Results'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

export default MatchResultsAdminClient
