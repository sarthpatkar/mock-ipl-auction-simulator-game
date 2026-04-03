'use client'

import { useState } from 'react'
import { formatPrice } from '@/lib/auction-helpers'
import { formatMatchScore, getMatchResultStatusLabel } from '@/lib/match-auction'
import { Match, MatchAuctionResult, MatchPlayerStat, Player, Room, RoomParticipant, SquadPlayer, TeamResult } from '@/types'

type Props = {
  room: Room
  match: Match | null
  participants: RoomParticipant[]
  projectedResults: TeamResult[]
  matchResults: MatchAuctionResult[]
  matchPlayerStats: MatchPlayerStat[]
  squads: SquadPlayer[]
  playersById: Record<string, Player>
  currentUserId: string | null
}

function formatTimestamp(value?: string | null) {
  if (!value) return 'Not updated yet'
  return new Date(value).toLocaleString()
}

function formatRoleShortLabel(role: Player['role'] | null | undefined) {
  if (role === 'wicketkeeper') return 'WK'
  if (role === 'allrounder') return 'AR'
  if (role === 'bowler') return 'BOWL'
  if (role === 'batter') return 'BAT'
  return '—'
}

function getPlayerTone(player: Player | undefined) {
  const score = player?.performance_score ?? 0
  if (score >= 85) return 'star'
  if (score >= 72) return 'strong'
  if (score < 60) return 'weak'
  return 'steady'
}

function formatPlayerRating(score: number | null | undefined) {
  if (score == null || Number.isNaN(score)) return '--'
  return score.toFixed(0).replace(/\.0+$/, '')
}

export function MatchAuctionResultsExperience({
  room,
  match,
  participants,
  projectedResults,
  matchResults,
  matchPlayerStats,
  squads,
  playersById,
  currentUserId
}: Props) {
  const projectedByUserId = projectedResults.reduce<Record<string, TeamResult>>((acc, result) => {
    acc[result.user_id] = result
    return acc
  }, {})

  const finalByUserId = matchResults.reduce<Record<string, MatchAuctionResult>>((acc, result) => {
    acc[result.user_id] = result
    return acc
  }, {})

  const teams = participants
    .map((participant) => {
      const projected = projectedByUserId[participant.user_id] ?? null
      const final = finalByUserId[participant.user_id] ?? null
      const squad = squads.filter((entry) => entry.participant_id === participant.id)

      return {
        participant,
        projectedScore: projected ? Number(projected.team_score) : 0,
        finalScore: final?.actual_score == null ? null : Number(final.actual_score),
        projectedRank: projected?.rank ?? null,
        finalRank: final?.rank ?? null,
        squad,
        isMe: participant.user_id === currentUserId
      }
    })
    .sort((left, right) => {
      const leftValue = left.finalScore ?? left.projectedScore
      const rightValue = right.finalScore ?? right.projectedScore
      return rightValue - leftValue
    })

  const topTeam = teams[0] ?? null
  const secondTeam = teams[1] ?? null
  const resultStatus = matchResults[0]?.result_status ?? 'waiting_for_match'
  const lastUpdated = matchResults[0]?.last_result_updated_at ?? match?.last_scorecard_upload_at ?? null
  const isFinal = resultStatus === 'final_ready'
  const isAbandoned = resultStatus === 'match_abandoned'
  const scoreGap =
    topTeam && secondTeam ? Math.abs((topTeam.finalScore ?? topTeam.projectedScore) - (secondTeam.finalScore ?? secondTeam.projectedScore)) : 0
  const topMatchPerformers = [...matchPlayerStats]
    .sort((left, right) => right.fantasy_points - left.fantasy_points || left.player_name_snapshot.localeCompare(right.player_name_snapshot))
    .slice(0, 10)
  const [expandedParticipantId, setExpandedParticipantId] = useState<string | null>(teams[0]?.participant.id ?? null)

  return (
    <section className="results-experience" aria-label="Match Auction results">
      <div className="card">
        <div className="section-header">
          <div>
            <span className="status-label">Match Auction Results</span>
            <h1 className="section-title" style={{ marginTop: 8 }}>
              {match ? `${match.team_a_code} vs ${match.team_b_code}` : room.name}
            </h1>
            <p className="text-muted text-sm">See who is leading right now, then come back for the final match points once the real game is complete.</p>
          </div>
          <span className={`badge ${isFinal ? 'badge-gold' : 'badge-blue'}`}>{getMatchResultStatusLabel(resultStatus)}</span>
        </div>

        <div style={{ display: 'grid', gap: 12, marginTop: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="card">
            <span className="status-label">{isFinal ? 'Match winner' : 'Current leader'}</span>
            <strong style={{ display: 'block', marginTop: 8 }}>{isAbandoned ? 'No result available' : topTeam?.participant.team_name || 'Teams will appear soon'}</strong>
            {!isAbandoned && (
              <p className="text-secondary text-sm mt-2">
                {isFinal ? `Final points: ${formatMatchScore(topTeam?.finalScore ?? 0)}` : `Projected points: ${formatMatchScore(topTeam?.projectedScore ?? 0)}`}
              </p>
            )}
          </div>
          <div className="card">
            <span className="status-label">Status</span>
            <strong style={{ display: 'block', marginTop: 8 }}>
              {isFinal ? 'Final points are in' : isAbandoned ? 'Match called off' : 'Final points are not ready yet'}
            </strong>
            <p className="text-secondary text-sm mt-2">
              {isAbandoned ? 'This match did not produce a final result.' : 'Final points usually appear within about 8 hours of the real match ending.'}
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14 }}>
        {teams.map((team) => (
          <article key={team.participant.id} className="card">
            <button
              type="button"
              className="team-panel-summary"
              onClick={() => setExpandedParticipantId((current) => (current === team.participant.id ? null : team.participant.id))}
            >
              <div className="team-panel-identity">
                <p className="team-panel-name">
                  {team.participant.team_name} {team.isMe && <span className="badge badge-gold ml-2">You</span>}
                </p>
                <p className="team-panel-owner">{isFinal ? 'Final points ready' : 'Projected points ready'}</p>
              </div>
              <p className="team-panel-metrics">
                {isFinal ? (
                  <span>{team.finalScore == null ? 'Final pending' : `${formatMatchScore(team.finalScore)} final`}</span>
                ) : (
                  <>
                    <span>{formatMatchScore(team.projectedScore)} projected</span>
                    <span>{team.finalScore == null ? 'Pending final' : `${formatMatchScore(team.finalScore)} final`}</span>
                  </>
                )}
              </p>
            </button>

            {expandedParticipantId === team.participant.id && (
              <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                {!isFinal && (
                  <div className="card">
                    <span className="status-label">Projected Points</span>
                    <strong style={{ display: 'block', marginTop: 8 }}>{formatMatchScore(team.projectedScore)}</strong>
                    <p className="text-secondary text-sm mt-2">
                      {team.projectedRank ? `Projected rank: #${team.projectedRank}` : 'Projected rank will appear once the standings are ready.'}
                    </p>
                  </div>
                )}

                <div className="card">
                  <span className="status-label">Final Points</span>
                  <strong style={{ display: 'block', marginTop: 8 }}>{team.finalScore == null ? 'Pending' : formatMatchScore(team.finalScore)}</strong>
                  <p className="text-secondary text-sm mt-2">
                    {team.finalRank ? `Final rank: #${team.finalRank}` : 'Available once the final match result is published.'}
                  </p>
                </div>

                <div className="card">
                  <span className="status-label">Squad</span>
                  <div className="results-player-grid is-compact">
                    {team.squad.length === 0 && <p className="text-secondary text-sm">No players bought.</p>}
                    {[...team.squad]
                      .sort((left, right) => {
                        const rightScore = playersById[right.player_id]?.performance_score ?? 0
                        const leftScore = playersById[left.player_id]?.performance_score ?? 0
                        if (rightScore !== leftScore) return rightScore - leftScore
                        return right.price_paid - left.price_paid
                      })
                      .map((entry) => {
                        const player = playersById[entry.player_id]
                        const tone = getPlayerTone(player)
                        return (
                          <div key={entry.id} className={`results-player-row is-${tone}`}>
                            <span className={`results-player-dot is-${tone}`} aria-hidden="true" />
                            <div className="results-player-main">
                              <strong>{player?.name || entry.player_id}</strong>
                              <span className={`results-player-role${player?.role ? ` is-${player.role}` : ''}`}>{formatRoleShortLabel(player?.role)}</span>
                            </div>
                            <div className="results-player-values">
                              <span className={`results-player-points is-${tone}`}>{formatPlayerRating(player?.performance_score)} pts</span>
                              <span className="results-player-price">{formatPrice(entry.price_paid)}</span>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="card">
        <span className="status-label">{isFinal ? 'Winning Margin' : 'Projected Margin'}</span>
        <p className="text-secondary text-sm mt-2">
          {isAbandoned
            ? 'The real match did not produce a final result.'
            : `${topTeam?.participant.team_name || 'The leading team'} is ahead by ${formatMatchScore(scoreGap)} ${isFinal ? 'points' : 'projected points'}.`}
        </p>
        <p className="text-secondary text-sm mt-2">Last updated: {formatTimestamp(lastUpdated)}</p>
      </div>

      {topMatchPerformers.length > 0 && (
        <div className="card">
          <div className="section-header">
            <div>
              <span className="status-label">Top Match Performers</span>
              <h2 className="section-title" style={{ marginTop: 8 }}>Top 10 players in this match</h2>
              <p className="text-secondary text-sm mt-2">Published match points for the best individual performances.</p>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
            {topMatchPerformers.map((entry, index) => (
              <div
                key={entry.player_id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                  paddingBottom: 10,
                  borderBottom: index === topMatchPerformers.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.08)'
                }}
              >
                <div>
                  <strong>{playersById[entry.player_id]?.name || entry.player_name_snapshot}</strong>
                  <p className="text-secondary text-sm">
                    {[playersById[entry.player_id]?.role || null, entry.team_code].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <strong>{formatMatchScore(entry.fantasy_points)} pts</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default MatchAuctionResultsExperience
