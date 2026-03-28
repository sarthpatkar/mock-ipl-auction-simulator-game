'use client'

import { MouseEvent, useMemo, useState } from 'react'
import { formatPrice, getTeamThemeClass, getTeamThemeStyle } from '@/lib/auction-helpers'
import { Player, RoomParticipant, SquadPlayer, TeamResult, TeamResultBreakdown } from '@/types'

type Props = {
  roomName: string
  totalPurse: number
  participants: RoomParticipant[]
  results: TeamResult[]
  squads: SquadPlayer[]
  playersById: Record<string, Player>
  currentUserId?: string | null
  onShareTeam?: (userId: string, anchorTop?: number) => void
}

type RankedTeam = {
  participant: RoomParticipant | null
  result: TeamResult
  breakdown: TeamResultBreakdown
  squad: Player[]
  squadRows: SquadPlayer[]
  isMine: boolean
}

const COMPONENT_ORDER: Array<{ key: keyof TeamResultBreakdown['components']; label: string }> = [
  { key: 'player_strength', label: 'Player Strength' },
  { key: 'team_balance', label: 'Team Balance' },
  { key: 'role_coverage', label: 'Role Coverage' },
  { key: 'star_power', label: 'Star Power' },
  { key: 'synergy', label: 'Synergy' }
]

function formatScore(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '0.00'
  return value.toFixed(2)
}

function formatShortNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '0'
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2).replace(/\.?0+$/, '')
}

function formatLabel(value: string | null | undefined) {
  if (!value) return '—'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function escapeCsvValue(value: string | number | null | undefined) {
  const normalized = value == null ? '' : String(value)
  return `"${normalized.replaceAll('"', '""')}"`
}

function downloadCsvFile(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function formatRoleForCsv(role: Player['role'] | null | undefined) {
  if (role === 'wicketkeeper') return 'Wicketkeeper'
  if (role === 'allrounder') return 'All-Rounder'
  if (role === 'bowler') return 'Bowler'
  if (role === 'batter') return 'Batsman'
  return '—'
}

function parseMoneyValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function formatBasePriceLabelForCsv(player: Player | undefined) {
  if (!player) return '—'
  const numericBase = parseMoneyValue(player.base_price)

  if (numericBase != null) {
    const cr = numericBase / 10000000
    const formatted = Number.isInteger(cr) ? String(cr) : cr.toFixed(2).replace(/\.?0+$/, '')
    return `₹${formatted} Cr`
  }

  const label = player.base_price_label?.trim()
  if (!label) return '—'

  const normalized = label.replace(/[₹,\s]/g, '').toUpperCase()
  const amount = Number.parseFloat(normalized.replace(/[A-Z]+$/, ''))
  if (!Number.isFinite(amount)) return label

  if (normalized.endsWith('L')) {
    const cr = amount / 100
    const formatted = Number.isInteger(cr) ? String(cr) : cr.toFixed(2).replace(/\.?0+$/, '')
    return `₹${formatted} Cr`
  }

  if (normalized.endsWith('CR')) {
    const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.?0+$/, '')
    return `₹${formatted} Cr`
  }

  return label
}

function formatLakhs(value: number | null | undefined) {
  const numericValue = parseMoneyValue(value)
  if (numericValue == null) return ''
  return String(Math.round(numericValue / 100000))
}

function formatAmountWithUnit(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return ''
  const cr = value / 10000000
  if (cr >= 1) {
    const formatted = Number.isInteger(cr) ? String(cr) : cr.toFixed(2).replace(/\.?0+$/, '')
    return `${formatted} Cr`
  }

  const lakhs = value / 100000
  const formatted = Number.isInteger(lakhs) ? String(lakhs) : lakhs.toFixed(2).replace(/\.?0+$/, '')
  return `${formatted} L`
}

function sanitizeFileSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'results'
}

function getPlayerTone(player: Player) {
  const score = player.performance_score ?? 0
  if (score >= 85) return 'star'
  if (score >= 72) return 'strong'
  if (score < 60) return 'weak'
  return 'steady'
}

function ResultBar({ label, score, max, accent = 'gold' }: { label: string; score: number; max: number; accent?: string }) {
  const width = max > 0 ? Math.min(100, Math.max(0, (score / max) * 100)) : 0
  return (
    <div className="result-bar">
      <div className="result-bar-head">
        <span>{label}</span>
        <strong>
          {formatScore(score)} / {formatShortNumber(max)}
        </strong>
      </div>
      <div className="result-bar-track">
        <div className={`result-bar-fill is-${accent}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function ComparisonTable({ comparison, components }: { comparison: TeamResultBreakdown['comparison']; components: TeamResultBreakdown['components'] }) {
  if (!comparison) return null

  const rows = [
    { label: 'Total Score', your: comparison.winner_team_score - comparison.score_gap, winner: comparison.winner_team_score, delta: comparison.score_gap },
    { label: 'Player Strength', your: components.player_strength.score, winner: components.player_strength.score + comparison.component_deltas.player_strength, delta: comparison.component_deltas.player_strength },
    { label: 'Team Balance', your: components.team_balance.score, winner: components.team_balance.score + comparison.component_deltas.team_balance, delta: comparison.component_deltas.team_balance },
    { label: 'Role Coverage', your: components.role_coverage.score, winner: components.role_coverage.score + comparison.component_deltas.role_coverage, delta: comparison.component_deltas.role_coverage },
    { label: 'Star Power', your: components.star_power.score, winner: components.star_power.score + comparison.component_deltas.star_power, delta: comparison.component_deltas.star_power },
    { label: 'Synergy', your: components.synergy.score, winner: components.synergy.score + comparison.component_deltas.synergy, delta: comparison.component_deltas.synergy },
    { label: 'Penalty Load', your: comparison.penalty_delta, winner: 0, delta: comparison.penalty_delta }
  ]

  return (
    <div className="results-comparison-table">
      <div className="results-comparison-title">Head-to-Head vs Winner</div>
      <div className="results-comparison-grid">
        <div className="results-comparison-row results-comparison-header">
          <span>Factor</span>
          <span>Your Team</span>
          <span>Winner</span>
          <span>Gap</span>
        </div>
        {rows.map((row) => (
          <div key={row.label} className="results-comparison-row">
            <span>{row.label}</span>
            <span>{formatScore(row.your)}</span>
            <span>{formatScore(row.winner)}</span>
            <span className={row.delta > 0 ? 'is-negative' : 'is-even'}>{row.delta > 0 ? `-${formatScore(row.delta)}` : 'Even'}</span>
          </div>
        ))}
      </div>
      {comparison.missing_roles_relative_to_winner.length > 0 && (
        <div className="results-comparison-footnote">
          Missing vs winner: {comparison.missing_roles_relative_to_winner.map(formatLabel).join(', ')}
        </div>
      )}
    </div>
  )
}

function TeamCard({ team, winner, onShareTeam }: { team: RankedTeam; winner: RankedTeam | null; onShareTeam?: (userId: string, anchorTop?: number) => void }) {
  const { participant, result, breakdown, squad, isMine } = team
  const comparison = breakdown.comparison

  return (
    <article
      className={`results-team-card team-theme ${getTeamThemeClass(participant?.team_name)} ${isMine ? 'is-mine' : ''} ${result.rank === 1 ? 'is-winner-card' : ''}`}
      style={getTeamThemeStyle(participant?.team_name)}
    >
      <div className="results-team-card-head">
        <div>
          <div className="results-team-rankline">
            <span className={`results-rank-pill rank-${Math.min(result.rank, 4)}`}>#{result.rank}</span>
            <span className="results-team-archetype">{breakdown.team_archetype}</span>
            {breakdown.near_miss.is_near_miss && <span className="results-near-miss">Near Miss</span>}
            {isMine && <span className="badge badge-gold">Your Team</span>}
          </div>
          <h2 className="results-team-name">{participant?.team_name || 'Franchise'}</h2>
          <p className="results-team-owner">{participant?.profiles?.username || 'Franchise Owner'}</p>
        </div>
        <div className="results-team-scoreblock">
          <span className="results-score-label">Final Score</span>
          <strong className="results-score-value">{formatScore(result.team_score)}</strong>
          {onShareTeam && (
            <button
              type="button"
              className="btn btn-ghost btn-sm results-viral-share"
              onClick={(event: MouseEvent<HTMLButtonElement>) => onShareTeam(result.user_id, event.currentTarget.getBoundingClientRect().top)}
            >
              Share Team
            </button>
          )}
        </div>
      </div>

      <div className="results-card-grid">
        <section className="results-card-panel">
          <h3 className="section-title">Score Breakdown</h3>
          <div className="results-bars">
            {COMPONENT_ORDER.map(({ key, label }) => (
              <ResultBar key={key} label={label} score={breakdown.components[key].score} max={breakdown.components[key].max} accent={key === 'player_strength' ? 'cyan' : key === 'team_balance' ? 'green' : key === 'star_power' ? 'pink' : 'gold'} />
            ))}
          </div>
        </section>

        <section className="results-card-panel">
          <h3 className="section-title">Fine-Grained Balance</h3>
          <div className="results-balance-grid">
            {Object.entries(breakdown.balance_detail.role_counts).map(([role, count]) => {
              const ideal = breakdown.balance_detail.ideal_ranges[role]
              const deviation = breakdown.balance_detail.deviations[role] ?? 0
              return (
                <div key={role} className="results-balance-item">
                  <span>{formatLabel(role)}</span>
                  <strong>{count}</strong>
                  <small>
                    Ideal {ideal.min}-{ideal.max} {deviation > 0 ? `· dev ${deviation}` : '· ideal'}
                  </small>
                </div>
              )
            })}
          </div>
          <div className="results-meta-line">Deviation Cost: {formatScore(breakdown.balance_detail.total_deviation_cost)}</div>
        </section>

        <section className="results-card-panel">
          <h3 className="section-title">Synergy Sub-components</h3>
          <div className="results-bars">
            <ResultBar label="Batting Depth" score={breakdown.synergy_detail.batting_depth.score} max={2.5} accent="cyan" />
            <ResultBar label="Bowling Network" score={breakdown.synergy_detail.bowling_network.score} max={2.5} accent="green" />
            <ResultBar label="All-rounder Support" score={breakdown.synergy_detail.allrounder_support.score} max={2.5} accent="gold" />
            <ResultBar label="Experience Blend" score={breakdown.synergy_detail.experience_blend.score} max={2.5} accent="pink" />
          </div>
        </section>

        <section className="results-card-panel">
          <h3 className="section-title">Strength Highlights</h3>
          <ul className="results-bullet-list">
            {breakdown.strength_highlights.length > 0 ? (
              breakdown.strength_highlights.map((item) => <li key={item}>{item}</li>)
            ) : (
              <li>No standout structural strengths recorded.</li>
            )}
          </ul>
        </section>

        <section className="results-card-panel">
          <h3 className="section-title">Insights</h3>
          <ul className="results-bullet-list">
            {breakdown.insights.length > 0 ? breakdown.insights.map((item) => <li key={item}>{item}</li>) : <li>No additional insights.</li>}
          </ul>
        </section>

        <section className="results-card-panel">
          <h3 className="section-title">Coverage & Stars</h3>
          <div className="results-chip-row">
            {breakdown.coverage_detail.present_roles.map((role) => (
              <span key={role} className="results-chip is-present">
                {formatLabel(role)}
              </span>
            ))}
            {breakdown.coverage_detail.missing_roles.map((role) => (
              <span key={role} className="results-chip is-missing">
                {formatLabel(role)}
              </span>
            ))}
          </div>
          <div className="results-meta-stack">
            <div>Stars: {breakdown.star_detail.star_count}</div>
            <div>Best XI Average: {formatScore(Number(breakdown.raw_metrics.best_xi_avg ?? 0))}</div>
          </div>
        </section>
      </div>

      {breakdown.penalties.items.length > 0 && (
        <section className="results-inline-panel is-warning">
          <h3 className="section-title">Penalty Impact</h3>
          <div className="results-penalty-total">-{formatScore(breakdown.penalties.total)}</div>
          <div className="results-penalty-list">
            {breakdown.penalties.items.map((item) => (
              <div key={item.code} className="results-penalty-item">
                <span>{item.message}</span>
                <strong>-{formatScore(item.points)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {result.rank !== 1 && comparison && winner && (
        <section className="results-inline-panel">
          <h3 className="section-title">Loss Analysis vs Winner</h3>
          <div className="results-loss-gap">
            Lost by <strong>{formatScore(comparison.score_gap)}</strong> points to {winner.participant?.team_name || comparison.winner_team_name}
          </div>
          {breakdown.loss_reasons.length > 0 && (
            <div className="results-loss-reasons">
              {breakdown.loss_reasons.map((reason) => (
                <div key={`${reason.factor}-${reason.message}`} className="results-loss-reason">
                  <div className="results-loss-reason-head">
                    <span>{formatLabel(reason.factor)}</span>
                    <strong>{formatScore(reason.impact)} pts</strong>
                  </div>
                  <p>{reason.message}</p>
                </div>
              ))}
            </div>
          )}
          <ComparisonTable comparison={comparison} components={breakdown.components} />
        </section>
      )}

      <section className="results-inline-panel">
        <h3 className="section-title">Squad Grid</h3>
        <div className="results-player-grid">
          {squad.map((player) => {
            const tone = getPlayerTone(player)
            return (
              <div key={player.id} className={`results-player-tile is-${tone}`}>
                <div className="results-player-head">
                  <strong>{player.name}</strong>
                  <span>{player.performance_score != null ? formatShortNumber(player.performance_score) : '—'}</span>
                </div>
                <div className="results-player-meta">
                  <span>{formatLabel(player.role)}</span>
                  <span>{player.impact_type ? formatLabel(player.impact_type) : 'No Impact Tag'}</span>
                </div>
              </div>
            )
          })}
          {squad.length === 0 && <div className="text-sm text-muted">No squad players found.</div>}
        </div>
      </section>
    </article>
  )
}

export function RoomResultsBoard({ roomName, totalPurse, participants, results, squads, playersById, currentUserId, onShareTeam }: Props) {
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const participantByUserId = useMemo(
    () => participants.reduce<Record<string, RoomParticipant>>((acc, participant) => {
      acc[participant.user_id] = participant
      return acc
    }, {}),
    [participants]
  )

  const squadsByParticipantId = useMemo(
    () =>
      squads.reduce<Record<string, SquadPlayer[]>>((acc, squadPlayer) => {
        acc[squadPlayer.participant_id] = [...(acc[squadPlayer.participant_id] ?? []), squadPlayer]
        return acc
      }, {}),
    [squads]
  )

  const rankedTeams = useMemo<RankedTeam[]>(() => {
    return results.map((result) => {
      const participant = participantByUserId[result.user_id] ?? null
      const teamSquad = participant ? squadsByParticipantId[participant.id] ?? [] : []
      const squad = teamSquad
        .map((row) => playersById[row.player_id])
        .filter((player): player is Player => Boolean(player))
        .sort((left, right) => {
          const rightScore = right.performance_score ?? 0
          const leftScore = left.performance_score ?? 0
          if (rightScore !== leftScore) return rightScore - leftScore
          return (right.recent_form_score ?? 0) - (left.recent_form_score ?? 0)
        })

      return {
        participant,
        result,
        breakdown: result.breakdown_json,
        squad,
        squadRows: teamSquad,
        isMine: result.user_id === currentUserId
      }
    })
  }, [currentUserId, participantByUserId, playersById, results, squadsByParticipantId])

  const winner = rankedTeams[0] ?? null
  const expandedTeam = rankedTeams.find((team) => team.result.user_id === expandedUserId) ?? null

  if (rankedTeams.length === 0) {
    return (
      <div className="card">
        <h2 className="section-title">Results Unavailable</h2>
        <p className="text-sm text-muted mt-3">No persisted room results were found.</p>
      </div>
    )
  }

  const handleDownloadTeamCsv = (team: RankedTeam) => {
    const teamName = team.participant?.team_name || 'Franchise'
    const totalSpent = team.squadRows.reduce((sum, row) => sum + row.price_paid, 0)
    const rows: Array<Array<string | number | null | undefined>> = [
      ['#', 'Player', 'Role', 'IPL Team', 'Base Price', 'Base (₹L)', 'Price', 'impact_type']
    ]

    team.squadRows.forEach((row, index) => {
      const player = playersById[row.player_id]
      rows.push([
        index + 1,
        player?.name ?? 'Unknown Player',
        formatRoleForCsv(player?.role),
        player?.ipl_team ?? '—',
        formatBasePriceLabelForCsv(player),
        formatLakhs(player?.base_price),
        formatPrice(row.price_paid),
        player?.impact_type ?? ''
      ])
    })

    rows.push([])
    rows.push(['', 'TOTAL SPENT', '', '', '', '', formatPrice(totalSpent), formatAmountWithUnit(totalSpent)])
    rows.push(['', 'REMAINING PURSE', '', '', '', '', formatPrice(team.participant?.budget_remaining ?? 0), formatAmountWithUnit(team.participant?.budget_remaining ?? 0)])
    rows.push(['', 'TOTAL PURSE', '', '', '', '', formatPrice(totalPurse), formatAmountWithUnit(totalPurse)])
    rows.push(['', 'PLAYERS BOUGHT', '', '', '', '', team.squadRows.length, team.squadRows.length])
    rows.push(['', 'TOTAL POINTS', '', '', '', '', '', ''])
    rows.push(['', 'SQUAD score', '', '', '', '', `${formatScore(team.result.team_score)}/100`, ''])

    downloadCsvFile(
      `${sanitizeFileSegment(roomName)}_${sanitizeFileSegment(teamName)}_results.csv`,
      rows
    )
  }

  return (
    <div className="results-board">
      {winner && (
        <section className={`results-winner-hero team-theme ${getTeamThemeClass(winner.participant?.team_name)}`} style={getTeamThemeStyle(winner.participant?.team_name)}>
          <div className="results-winner-copy">
            <span className="results-kicker">Champion</span>
            <h1 className="results-winner-title">{winner.participant?.team_name || 'Winning Team'}</h1>
            <p className="results-winner-owner">{winner.participant?.profiles?.username || 'Franchise Owner'}</p>
            <div className="results-highlight-row">
              {winner.breakdown.strength_highlights.map((item) => (
                <span key={item} className="results-highlight-pill">
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div className="results-winner-scorebox">
            <span className="results-score-label">Winning Score</span>
            <strong className="results-winner-score">{formatScore(winner.result.team_score)}</strong>
            <span className="results-team-archetype">{winner.breakdown.team_archetype}</span>
          </div>
        </section>
      )}

      <section className="results-leaderboard">
        {rankedTeams.map((team) => (
          <div
            key={team.result.user_id}
            className={`results-leaderboard-row rank-${Math.min(team.result.rank, 4)} ${team.isMine ? 'is-mine' : ''} ${expandedUserId === team.result.user_id ? 'is-expanded' : ''}`}
            style={{ animationDelay: `${team.result.rank * 90}ms` }}
          >
            <div className="results-leaderboard-rank">#{team.result.rank}</div>
            <button
              type="button"
              className="results-leaderboard-toggle"
              aria-expanded={expandedUserId === team.result.user_id}
              onClick={() => setExpandedUserId((current) => (current === team.result.user_id ? null : team.result.user_id))}
            >
              <div className="results-leaderboard-main">
                <strong>{team.participant?.team_name || 'Franchise'}</strong>
                <span>{team.participant?.profiles?.username || 'Franchise Owner'}</span>
              </div>
              <div className="results-leaderboard-meta">
                <span>{team.breakdown.team_archetype}</span>
                {team.breakdown.near_miss.is_near_miss && <span className="results-near-miss">Near Miss</span>}
              </div>
              <div className="results-leaderboard-score">{formatScore(team.result.team_score)}</div>
            </button>
            <button
              type="button"
              className="results-leaderboard-download"
              onClick={() => handleDownloadTeamCsv(team)}
              aria-label={`Download ${team.participant?.team_name || 'franchise'} squad CSV`}
            >
              <span aria-hidden="true">↓</span>
              <span>CSV</span>
            </button>
          </div>
        ))}
      </section>

      {expandedTeam && (
        <section className="results-team-stack">
          <TeamCard key={expandedTeam.result.user_id} team={expandedTeam} winner={winner} onShareTeam={onShareTeam} />
        </section>
      )}
    </div>
  )
}

export default RoomResultsBoard
