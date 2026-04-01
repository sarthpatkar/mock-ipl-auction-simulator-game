'use client'

import { useState } from 'react'
import { formatPrice } from '@/lib/auction-helpers'
import { getMatchResultStatusLabel } from '@/lib/match-auction'
import { Match, MatchAuctionResult, Player, Room, RoomParticipant, SquadPlayer, TeamResult } from '@/types'

type Props = {
  room: Room
  match: Match | null
  participants: RoomParticipant[]
  projectedResults: TeamResult[]
  matchResults: MatchAuctionResult[]
  squads: SquadPlayer[]
  playersById: Record<string, Player>
  currentUserId: string | null
}

function formatTimestamp(value?: string | null) {
  if (!value) return 'Not updated yet'
  return new Date(value).toLocaleString()
}

export function MatchAuctionResultsExperience({
  room,
  match,
  participants,
  projectedResults,
  matchResults,
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
  const [expandedParticipantId, setExpandedParticipantId] = useState<string | null>(teams[0]?.participant.id ?? null)

  return (
    <section className="results-experience" aria-label="Match Auction results">
      <div className="card">
        <div className="section-header">
          <div>
            <span className="status-label">Unofficial Match Result</span>
            <h1 className="section-title" style={{ marginTop: 8 }}>
              {match ? `${match.team_a_code} vs ${match.team_b_code}` : room.name}
            </h1>
            <p className="text-muted text-sm">Basic head-to-head scoring using the same projected result logic as Full Auction.</p>
          </div>
          <span className={`badge ${isFinal ? 'badge-gold' : 'badge-blue'}`}>{getMatchResultStatusLabel(resultStatus)}</span>
        </div>

        <div style={{ display: 'grid', gap: 12, marginTop: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="card">
            <span className="status-label">{isFinal ? 'Winner' : 'Projected winner'}</span>
            <strong style={{ display: 'block', marginTop: 8 }}>{isAbandoned ? 'No Final Result' : topTeam?.participant.team_name || 'Awaiting teams'}</strong>
            {!isAbandoned && (
              <p className="text-secondary text-sm mt-2">
                {isFinal ? `Final score: ${topTeam?.finalScore ?? 0}` : `Projected score: ${topTeam?.projectedScore ?? 0}`}
              </p>
            )}
          </div>
          <div className="card">
            <span className="status-label">Status</span>
            <strong style={{ display: 'block', marginTop: 8 }}>
              {isFinal ? 'Final Result Ready' : isAbandoned ? 'Match Abandoned' : 'Final result not published yet'}
            </strong>
            <p className="text-secondary text-sm mt-2">
              {isAbandoned ? 'No Final Result' : 'You will get the final result around 8 hours after the real match completes.'}
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
                <p className="team-panel-owner">{isFinal ? 'Final score available' : 'Projected result available'}</p>
              </div>
              <p className="team-panel-metrics">
                <span>{team.projectedScore} projected</span>
                <span>{team.finalScore ?? 'Pending'} final</span>
              </p>
            </button>

            {expandedParticipantId === team.participant.id && (
              <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                <div className="card">
                  <span className="status-label">Projected Score</span>
                  <strong style={{ display: 'block', marginTop: 8 }}>{team.projectedScore}</strong>
                  <p className="text-secondary text-sm mt-2">
                    {team.projectedRank ? `Projected rank: #${team.projectedRank}` : 'Projected rank will appear after scoring.'}
                  </p>
                </div>

                <div className="card">
                  <span className="status-label">Final Score</span>
                  <strong style={{ display: 'block', marginTop: 8 }}>{team.finalScore ?? 'Pending'}</strong>
                  <p className="text-secondary text-sm mt-2">
                    {team.finalRank ? `Final rank: #${team.finalRank}` : 'Available after the real match result is published.'}
                  </p>
                </div>

                <div className="card">
                  <span className="status-label">Squad</span>
                  <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    {team.squad.length === 0 && <p className="text-secondary text-sm">No players bought.</p>}
                    {team.squad.map((entry) => (
                      <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <strong>{playersById[entry.player_id]?.name || entry.player_id}</strong>
                          <p className="text-secondary text-sm">{playersById[entry.player_id]?.role || 'Player'}</p>
                        </div>
                        <strong>{formatPrice(entry.price_paid)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="card">
        <span className="status-label">{isFinal ? 'Final score gap' : 'Projected score gap'}</span>
        <p className="text-secondary text-sm mt-2">
          {isAbandoned
            ? 'The real match did not produce a final result.'
            : `${topTeam?.participant.team_name || 'Leading team'} leads by ${scoreGap} ${isFinal ? 'points' : 'projected points'}.`}
        </p>
        <p className="text-secondary text-sm mt-2">Last updated: {formatTimestamp(lastUpdated)}</p>
      </div>
    </section>
  )
}

export default MatchAuctionResultsExperience
