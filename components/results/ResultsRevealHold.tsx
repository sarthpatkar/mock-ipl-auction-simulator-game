'use client'

import { useMemo } from 'react'
import { getTeamThemeClass, getTeamThemeStyle } from '@/lib/auction-helpers'
import { Player, RoomParticipant, SquadPlayer } from '@/types'

const TOTAL_REVEAL_SECONDS = 90
const IMPACT_ROLES = new Set(['anchor', 'finisher', 'death_bowler', 'spinner', 'powerplay_bowler', 'all_rounder'])

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
  squads: SquadPlayer[]
  playersById: Record<string, Player>
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function ResultsRevealHold({ revealAt, remaining, participants, squads, playersById }: Props) {
  const countdown = formatCountdown(Math.max(0, remaining))
  const progress = Math.max(0, Math.min(1, (TOTAL_REVEAL_SECONDS - Math.min(TOTAL_REVEAL_SECONDS, remaining)) / TOTAL_REVEAL_SECONDS))
  const currentPhaseIndex = Math.min(HOLD_PHASES.length - 1, Math.floor(progress * HOLD_PHASES.length))
  const currentPhase = HOLD_PHASES[currentPhaseIndex]

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
