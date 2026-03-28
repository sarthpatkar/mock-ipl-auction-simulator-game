'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { getTeamThemeClass, getTeamThemeStyle } from '@/lib/auction-helpers'
import { applyProjectedLeaderboardTick, generateInitialProjectedLeaderboard } from '@/lib/results-reveal-projections'
import { Player, RoomParticipant, SquadPlayer, TeamResult } from '@/types'

const TOTAL_REVEAL_SECONDS = 90
const IMPACT_ROLES = new Set(['anchor', 'finisher', 'death_bowler', 'spinner', 'powerplay_bowler', 'all_rounder'])
const LEADERBOARD_ROW_HEIGHT = 84
const COMPACT_LEADERBOARD_ROW_HEIGHT = 104

const HOLD_PHASES = [
  { label: 'Building Best XI', copy: 'Locking the strongest core from every squad.' },
  { label: 'Measuring Balance', copy: 'Checking role distribution across all franchises.' },
  { label: 'Checking Impact Roles', copy: 'Scanning for anchors, finishers, and strike bowlers.' },
  { label: 'Ranking Franchises', copy: 'Comparing every roster against the winner profile.' },
  { label: 'Locking Final Table', copy: 'Final verification before the reveal drops.' }
]

type Props = {
  revealAt: string
  remaining: number
  participants: RoomParticipant[]
  results: TeamResult[]
  squads: SquadPlayer[]
  playersById: Record<string, Player>
  revealPhase?: 'projection' | 'revealing'
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatScore(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '0.00'
  return value.toFixed(2)
}

type ProjectionMovement = 'up' | 'down' | 'none'

type LeaderboardTeam = {
  id: string
  finalRank: number
  teamName: string
  ownerName: string
  teamScore: number
  teamArchetype: string
  isMine: boolean
}

type AnimatedLeaderboardTeam = LeaderboardTeam & {
  movement: ProjectionMovement
}

function clearMovement<T extends { movement: ProjectionMovement }>(rows: T[]) {
  if (rows.every((row) => row.movement === 'none')) return rows
  return rows.map((row) => ({ ...row, movement: 'none' }))
}

function applyMovementMetadata(nextRows: LeaderboardTeam[], previousRows: AnimatedLeaderboardTeam[]) {
  const previousPositions = new Map(previousRows.map((row, index) => [row.id, index]))
  return nextRows.map((row, index) => {
    const previousIndex = previousPositions.get(row.id)
    const movement: ProjectionMovement =
      previousIndex == null || previousIndex === index ? 'none' : previousIndex > index ? 'up' : 'down'

    return {
      ...row,
      movement
    }
  })
}

function sameAnimatedState(left: AnimatedLeaderboardTeam[], right: AnimatedLeaderboardTeam[]) {
  return left.length === right.length && left.every((row, index) => right[index]?.id === row.id && right[index]?.movement === row.movement)
}

export function ResultsRevealHold({ revealAt, remaining, participants, results, squads, playersById, revealPhase = 'projection' }: Props) {
  const countdown = formatCountdown(Math.max(0, remaining))
  const progress = Math.max(0, Math.min(1, (TOTAL_REVEAL_SECONDS - Math.min(TOTAL_REVEAL_SECONDS, remaining)) / TOTAL_REVEAL_SECONDS))
  const currentPhaseIndex = Math.min(HOLD_PHASES.length - 1, Math.floor(progress * HOLD_PHASES.length))
  const currentPhase = HOLD_PHASES[currentPhaseIndex]
  const tickerRef = useRef<number | null>(null)
  const [rowHeight, setRowHeight] = useState(LEADERBOARD_ROW_HEIGHT)

  const teaserCards = useMemo(() => {
    return participants.map((participant) => {
      const squadRows = squads.filter((item) => item.participant_id === participant.id)
      const squad = squadRows
        .map((item) => playersById[item.player_id])
        .filter((player): player is Player => Boolean(player))

      const roleMix = squad.reduce<Record<string, number>>((acc, player) => {
        acc[player.role] = (acc[player.role] ?? 0) + 1
        return acc
      }, {})

      const starCount = squad.filter((player) => (player.performance_score ?? 0) >= 85).length
      const impactCoverage = new Set(
        squad
          .map((player) => player.impact_type)
          .filter((impact): impact is string => Boolean(impact) && IMPACT_ROLES.has(impact as string))
      ).size

      return {
        participant,
        squadCount: squadRows.length,
        roleMix,
        starCount,
        impactCoverage
      }
    })
  }, [participants, playersById, squads])

  const participantByUserId = useMemo(
    () =>
      participants.reduce<Record<string, RoomParticipant>>((acc, participant) => {
        acc[participant.user_id] = participant
        return acc
      }, {}),
    [participants]
  )

  const finalLeaderboard = useMemo<LeaderboardTeam[]>(() => {
    return results.map((result, index) => {
      const participant = participantByUserId[result.user_id]
      return {
        id: result.user_id,
        finalRank: Number(result.rank) || index + 1,
        teamName: participant?.team_name || 'Franchise',
        ownerName: participant?.profiles?.username || 'Franchise Owner',
        teamScore: Number(result.team_score) || 0,
        teamArchetype: result.breakdown_json.team_archetype,
        isMine: false
      }
    })
  }, [participantByUserId, results])

  const leaderboardPhase = useMemo(() => {
    if (revealPhase === 'revealing') return 'revealing' as const
    if (remaining > 80) return 'stable' as const
    if (remaining > 15) return 'active' as const
    if (remaining > 5) return 'slow' as const
    return 'freeze' as const
  }, [remaining, revealPhase])

  const [animatedLeaderboard, setAnimatedLeaderboard] = useState<AnimatedLeaderboardTeam[]>([])

  useEffect(() => {
    const syncRowHeight = () => {
      setRowHeight(window.innerWidth < 771 ? COMPACT_LEADERBOARD_ROW_HEIGHT : LEADERBOARD_ROW_HEIGHT)
    }

    syncRowHeight()
    window.addEventListener('resize', syncRowHeight)
    return () => window.removeEventListener('resize', syncRowHeight)
  }, [])

  useEffect(() => {
    if (finalLeaderboard.length === 0) {
      setAnimatedLeaderboard([])
      return
    }

    const initialProjection = generateInitialProjectedLeaderboard(finalLeaderboard)
    setAnimatedLeaderboard(initialProjection.map((row) => ({ ...row, movement: 'none' })))
  }, [finalLeaderboard])

  useEffect(() => {
    if (tickerRef.current) {
      window.clearTimeout(tickerRef.current)
      tickerRef.current = null
    }

    if (animatedLeaderboard.length === 0) return

    if (leaderboardPhase === 'revealing') {
      setAnimatedLeaderboard((previousRows) => {
        const nextRows = applyMovementMetadata(finalLeaderboard, previousRows)
        return sameAnimatedState(previousRows, nextRows) ? previousRows : nextRows
      })
      return
    }

    if (leaderboardPhase === 'stable' || leaderboardPhase === 'freeze') {
      setAnimatedLeaderboard((previousRows) => clearMovement(previousRows))
      return
    }

    const delay = leaderboardPhase === 'slow' ? randomDelay(4000, 6000) : randomDelay(3000, 5000)
    tickerRef.current = window.setTimeout(() => {
      setAnimatedLeaderboard((previousRows) => {
        const baseRows = previousRows.map(({ movement: _movement, ...row }) => row)
        const nextRows = applyProjectedLeaderboardTick(baseRows, finalLeaderboard, leaderboardPhase)
        return applyMovementMetadata(nextRows, previousRows)
      })
    }, delay)

    return () => {
      if (tickerRef.current) {
        window.clearTimeout(tickerRef.current)
        tickerRef.current = null
      }
    }
  }, [animatedLeaderboard, finalLeaderboard, leaderboardPhase])

  const leaderboardStatus = useMemo(() => {
    if (leaderboardPhase === 'revealing') {
      return {
        eyebrow: 'Final leaderboard locked',
        title: 'Actual standings are now sliding into place.',
        subtitle: 'Official rank order verified. Champion reveal incoming.'
      }
    }

    if (leaderboardPhase === 'freeze') {
      return {
        eyebrow: 'Live leaderboard projections',
        title: 'Final rankings calculating…',
        subtitle: 'Projection movement is frozen while the official table is prepared.'
      }
    }

    return {
      eyebrow: 'Live leaderboard projections',
      title: 'Ranks may still change',
      subtitle: `Final results reveal in ${countdown}`
    }
  }, [countdown, leaderboardPhase])

  return (
    <section className="results-hold-shell">
      <div className="results-hold-hero">
        <span className="results-kicker">Calculating Results</span>
        <h1 className="results-hold-title">Scorecards are locked. Final reveal drops in {countdown}.</h1>
        <p className="results-hold-copy">{currentPhase.copy}</p>

        <div className="results-hold-progress">
          <div className="results-hold-progress-track">
            <div className="results-hold-progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="results-hold-phase">{currentPhase.label}</div>
        </div>

        <div className="results-phase-strip">
          {HOLD_PHASES.map((phase, index) => {
            const state = index < currentPhaseIndex ? 'is-complete' : index === currentPhaseIndex ? 'is-active' : ''
            return (
              <div key={phase.label} className={`results-phase-chip ${state}`}>
                {phase.label}
              </div>
            )
          })}
        </div>

        <div className="results-hold-meta">
          Reveal time: {new Date(revealAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
        </div>
      </div>

      <section className="results-projection-shell">
        <div className="results-projection-head">
          <div>
            <span className="results-projection-eyebrow">{leaderboardStatus.eyebrow}</span>
            <h2 className="results-projection-title">{leaderboardStatus.title}</h2>
          </div>
          <div className="results-projection-status">{leaderboardStatus.subtitle}</div>
        </div>

        {animatedLeaderboard.length > 0 ? (
          <div className="results-projection-board" style={{ height: `${animatedLeaderboard.length * rowHeight}px` }}>
            {animatedLeaderboard.map((team, index) => {
              const isTopThree = index < 3
              const isProjectedLeader = index === 0 && leaderboardPhase !== 'freeze' && leaderboardPhase !== 'revealing'
              const isRevealWinner = leaderboardPhase === 'revealing' && team.finalRank === 1

              return (
                <article
                  key={team.id}
                  className={`results-projection-row team-theme ${getTeamThemeClass(team.teamName)} ${isTopThree ? 'is-top-three' : ''} ${team.movement !== 'none' ? `is-moving-${team.movement}` : ''} ${isProjectedLeader ? 'is-potential-winner' : ''} ${isRevealWinner ? 'is-reveal-winner' : ''}`}
                  style={{
                    ...getTeamThemeStyle(team.teamName),
                    transform: `translateY(${index * rowHeight}px)`
                  }}
                >
                  <div className={`results-projection-rank rank-${Math.min(index + 1, 4)}`}>#{index + 1}</div>
                  <div className="results-projection-main">
                    <div className="results-projection-teamline">
                      <strong>{team.teamName}</strong>
                      {isProjectedLeader && <span className="results-projection-badge">Potential Winner</span>}
                    </div>
                    <span>{team.ownerName}</span>
                  </div>
                  <div className="results-projection-meta">
                    <span>{team.teamArchetype}</span>
                    <span className={`results-projection-delta is-${team.movement}`}>
                      {team.movement === 'up' ? '↑ Rising' : team.movement === 'down' ? '↓ Sliding' : '· Holding'}
                    </span>
                  </div>
                  <div className="results-projection-score">{formatScore(team.teamScore)}</div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="results-projection-loading">Loading leaderboard projections…</div>
        )}
      </section>

      <div className="results-hold-teasers">
        {teaserCards.map(({ participant, squadCount, roleMix, starCount, impactCoverage }) => (
          <article
            key={participant.id}
            className={`results-hold-card team-theme ${getTeamThemeClass(participant.team_name)}`}
            style={getTeamThemeStyle(participant.team_name)}
          >
            <div className="results-hold-card-head">
              <div>
                <strong>{participant.team_name}</strong>
                <span>{participant.profiles?.username || 'Franchise Owner'}</span>
              </div>
              <div className="results-hold-count">{squadCount} players</div>
            </div>

            <div className="results-hold-stats">
              <div className="results-hold-stat">
                <span>Role Mix</span>
                <strong>
                  B {roleMix.batter ?? 0} · WK {roleMix.wicketkeeper ?? 0} · AR {roleMix.allrounder ?? 0} · BW {roleMix.bowler ?? 0}
                </strong>
              </div>
              <div className="results-hold-stat">
                <span>Star Count</span>
                <strong>{starCount}</strong>
              </div>
              <div className="results-hold-stat">
                <span>Impact Coverage</span>
                <strong>{impactCoverage}/6</strong>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export default ResultsRevealHold

function randomDelay(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
