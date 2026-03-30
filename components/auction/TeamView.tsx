'use client'

import { useEffect, useMemo, useState } from 'react'
import { Player, RoomParticipant, SquadPlayer } from '@/types'
import { formatPrice, formatRole, getTeamThemeClass, getTeamThemeStyle } from '@/lib/auction-helpers'

type Props = {
  participants: RoomParticipant[]
  squads: SquadPlayer[]
  playersById: Record<string, Player>
  currentUserId?: string | null
  variant?: 'default' | 'mobileLike'
}

export function TeamView({ participants, squads, playersById, currentUserId, variant = 'default' }: Props) {
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(true)
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)
  const [teamsOpen, setTeamsOpen] = useState(false)
  const orderedParticipants = useMemo(() => {
    const mine = participants.find((participant) => participant.user_id === currentUserId)
    const others = participants.filter((participant) => participant.user_id !== currentUserId)
    return mine ? [mine, ...others] : participants
  }, [currentUserId, participants])
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null)

  useEffect(() => {
    if (!orderedParticipants.length) {
      setSelectedParticipantId(null)
      return
    }

    setSelectedParticipantId((current) =>
      current && orderedParticipants.some((participant) => participant.id === current) ? current : orderedParticipants[0]?.id ?? null
    )
  }, [orderedParticipants])

  const selectedParticipant = useMemo(
    () => orderedParticipants.find((participant) => participant.id === selectedParticipantId) ?? null,
    [orderedParticipants, selectedParticipantId]
  )
  const selectedSquad = useMemo(
    () => (selectedParticipant ? squads.filter((entry) => entry.participant_id === selectedParticipant.id) : []),
    [selectedParticipant, squads]
  )

  if (variant === 'mobileLike') {
    return (
      <div className="team-view-mobile-like">
        <section className="card mobile-auction-teams" aria-label="Team selector">
          <div className="mobile-auction-teams-head">
            <span className="status-label">View teams</span>
            <button className="btn btn-ghost btn-sm mobile-auction-teams-toggle" type="button" onClick={() => setTeamsOpen((value) => !value)}>
              {teamsOpen ? 'Hide Teams' : 'Show Teams'}
            </button>
          </div>

          <div className="mobile-auction-teams-strip" role="tablist" aria-label="Participant teams">
            {orderedParticipants.map((participant) => {
              const isSelected = participant.id === selectedParticipantId
              const isMine = participant.user_id === currentUserId
              return (
                <button
                  key={participant.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className={`mobile-auction-team-chip ${isSelected ? 'is-selected' : ''} ${isMine ? 'is-mine' : ''}`}
                  onClick={() => {
                    setSelectedParticipantId(participant.id)
                    setTeamsOpen(true)
                  }}
                >
                  <span>{isMine ? 'My Team' : 'Team'}</span>
                  <strong>{participant.team_name}</strong>
                </button>
              )
            })}
          </div>
        </section>

        {teamsOpen && (
          <section className="card mobile-auction-teams-panel" aria-label="Selected team squad">
            <div className="mobile-auction-team-summary">
              <div>
                <span className="status-label">Selected team</span>
                <strong>{selectedParticipant?.team_name || 'No team selected'}</strong>
              </div>
              {selectedParticipant && (
                <div className="mobile-auction-team-summary-metrics">
                  <span>{selectedParticipant.squad_count} players</span>
                  <span>{formatPrice(selectedParticipant.budget_remaining)} left</span>
                </div>
              )}
            </div>

            <div className="mobile-auction-panel-list">
              {selectedParticipant && selectedSquad.length > 0 ? (
                selectedSquad.map((entry) => {
                  const player = playersById[entry.player_id]
                  return (
                    <div key={entry.id} className="mobile-auction-panel-row">
                      <div>
                        <strong>{player?.name || entry.player_id}</strong>
                        <span>{player ? formatRole(player.role) : 'Player'}</span>
                      </div>
                      <strong className="mobile-auction-panel-price">{formatPrice(entry.price_paid)}</strong>
                    </div>
                  )
                })
              ) : (
                <div className="mobile-auction-panel-empty">No picks yet.</div>
              )}
            </div>
          </section>
        )}
      </div>
    )
  }

  return (
    <div className={`team-view-shell ${open ? 'is-open' : ''} ${visible ? 'is-visible' : 'is-hidden'}`}>
      <div className="card team-view-card">
        <div className="flex items-center justify-between">
          <h3 className="section-title">Teams</h3>
          <div className="team-view-actions">
            <button className="btn btn-ghost btn-sm team-view-desktop-toggle" type="button" onClick={() => setVisible((value) => !value)}>
              {visible ? 'Hide Teams' : 'View Teams'}
            </button>
            <button className="btn btn-ghost btn-sm team-view-mobile-toggle" type="button" onClick={() => setOpen((value) => !value)}>
              {open ? 'Close Teams' : 'View Teams'}
            </button>
          </div>
        </div>
        <div className="team-view-hint">
          {visible ? 'Tap a team to expand its squad. Tap again to collapse it.' : 'Teams are hidden. Use View Teams to open the panel.'}
        </div>
        <div className={`team-view-desktop ${visible ? 'is-visible' : 'is-hidden'}`}>
          <div className="mt-4 grid gap-4">
            {orderedParticipants.map((p) => {
              const teamSquad = squads.filter((s) => s.participant_id === p.id)
              const isExpanded = expandedTeamId === p.id
              const isMine = p.user_id === currentUserId

              return (
                <div
                  key={p.id}
                  className={`team-panel team-theme ${getTeamThemeClass(p.team_name)} ${isMine ? 'is-mine' : ''}`}
                  style={getTeamThemeStyle(p.team_name)}
                >
                  <button className="team-panel-summary" type="button" onClick={() => setExpandedTeamId(isExpanded ? null : p.id)}>
                    <div className="team-panel-identity">
                      <p className="team-panel-name">
                        {p.team_name} {isMine && <span className="badge badge-gold ml-2">Your Team</span>}
                      </p>
                      <p className="team-panel-owner">{p.profiles?.username || 'Franchise Owner'}</p>
                    </div>
                    <p className="team-panel-metrics">
                      <span>{p.squad_count} players</span>
                      <span>{formatPrice(p.budget_remaining)} left</span>
                    </p>
                  </button>
                  {isExpanded && (
                    <ul className="team-panel-list">
                      {teamSquad.map((s) => {
                        const player = playersById[s.player_id]
                        return (
                          <li key={s.id} className="team-panel-player">
                            <div>
                              <div>{player ? player.name : s.player_id}</div>
                              <div className="text-xs text-muted">{player ? formatRole(player.role) : 'Player'}</div>
                            </div>
                            <span className="text-amber-300">{formatPrice(s.price_paid)}</span>
                          </li>
                        )
                      })}
                      {teamSquad.length === 0 && <li className="text-xs text-muted">No picks yet</li>}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {open && <button className="team-view-backdrop" type="button" aria-label="Close teams" onClick={() => setOpen(false)} />}
      <div className={`team-view-mobile ${open ? 'is-open' : ''}`}>
        <div className="card team-view-drawer">
          <div className="flex items-center justify-between">
            <h3 className="section-title">Teams</h3>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <div className="mt-4 grid gap-4">
          {orderedParticipants.map((p) => {
            const teamSquad = squads.filter((s) => s.participant_id === p.id)
            const isExpanded = expandedTeamId === p.id
            const isMine = p.user_id === currentUserId

            return (
              <div
                key={p.id}
                className={`team-panel team-theme ${getTeamThemeClass(p.team_name)} ${isMine ? 'is-mine' : ''}`}
                style={getTeamThemeStyle(p.team_name)}
              >
                <button className="team-panel-summary" type="button" onClick={() => setExpandedTeamId(isExpanded ? null : p.id)}>
                  <div className="team-panel-identity">
                    <p className="team-panel-name">
                      {p.team_name} {isMine && <span className="badge badge-gold ml-2">Your Team</span>}
                    </p>
                    <p className="team-panel-owner">{p.profiles?.username || 'Franchise Owner'}</p>
                  </div>
                  <p className="team-panel-metrics">
                    <span>{p.squad_count} players</span>
                    <span>{formatPrice(p.budget_remaining)} left</span>
                  </p>
                </button>
                {isExpanded && (
                  <ul className="team-panel-list">
                    {teamSquad.map((s) => {
                      const player = playersById[s.player_id]
                      return (
                        <li key={s.id} className="team-panel-player">
                          <div>
                            <div>{player ? player.name : s.player_id}</div>
                            <div className="text-xs text-muted">{player ? formatRole(player.role) : 'Player'}</div>
                          </div>
                          <span className="text-amber-300">{formatPrice(s.price_paid)}</span>
                        </li>
                      )
                    })}
                    {teamSquad.length === 0 && <li className="text-xs text-muted">No picks yet</li>}
                  </ul>
                )}
              </div>
            )
          })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TeamView
