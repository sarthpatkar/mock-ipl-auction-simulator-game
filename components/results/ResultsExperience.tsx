'use client'

import { MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RoomResultsBoard } from '@/components/results/RoomResultsBoard'
import { AwardShareCard, ComparisonShareCard, SpotlightShareCard, TeamShareCard } from '@/components/results/ResultsShareCards'
import { useShareCard } from '@/hooks/useShareCard'
import { formatPrice, getTeamThemeClass, getTeamThemeStyle } from '@/lib/auction-helpers'
import { APP_NAME } from '@/lib/branding'
import { buildResultsTeams, buildTeamComparison, deriveAwardBadges, derivePurchaseSpotlights, getInviteText, PurchaseSpotlightModel, ResultsDerivedTeam, TeamComparisonModel } from '@/lib/results-virality'
import { renderAwardShareCardBlob, renderComparisonShareCardBlob, renderSpotlightShareCardBlob, renderTeamShareCardBlob } from '@/lib/results-share-export'
import { Player, Room, RoomParticipant, SquadPlayer, TeamResult } from '@/types'

type Props = {
  room: Room
  participants: RoomParticipant[]
  results: TeamResult[]
  squads: SquadPlayer[]
  playersById: Record<string, Player>
  currentUserId?: string | null
}

type ShareTarget =
  | { kind: 'team'; userId: string }
  | { kind: 'award'; id: string }
  | { kind: 'spotlight'; id: PurchaseSpotlightModel['id'] }
  | { kind: 'comparison' }

const COMPARE_ROLE_META: Array<{ role: Player['role']; shortLabel: string }> = [
  { role: 'batter', shortLabel: 'BAT' },
  { role: 'wicketkeeper', shortLabel: 'WK' },
  { role: 'allrounder', shortLabel: 'AR' },
  { role: 'bowler', shortLabel: 'BWL' }
]

function getShareFileName(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function getTeamLabel(team: ResultsDerivedTeam | undefined) {
  return team?.participant?.team_name || 'Franchise'
}

function getShareDialogTop(anchorTop: number | null) {
  if (typeof window === 'undefined') return 32
  const viewportTopGap = Math.min(Math.max(20, Math.round(window.innerHeight * 0.06)), 44)
  if (anchorTop == null) return viewportTopGap
  return Math.min(Math.max(viewportTopGap, anchorTop - 12), viewportTopGap + 12)
}

function formatRoleLabel(role: Player['role']) {
  if (role === 'wicketkeeper') return 'Wicketkeeper'
  if (role === 'allrounder') return 'All-Rounder'
  if (role === 'bowler') return 'Bowler'
  return 'Batter'
}

function formatRoleShortLabel(role: Player['role'] | null | undefined) {
  if (role === 'wicketkeeper') return 'WK'
  if (role === 'allrounder') return 'AR'
  if (role === 'bowler') return 'BOWL'
  if (role === 'batter') return 'BAT'
  return '—'
}

function getPlayerTone(player: Player) {
  const score = player.performance_score ?? 0
  if (score >= 85) return 'star'
  if (score >= 72) return 'strong'
  if (score < 60) return 'weak'
  return 'steady'
}

function formatPlayerRating(score: number | null | undefined) {
  if (score == null || Number.isNaN(score)) return '--'
  return score.toFixed(0)
}

function buildRoleCounts(team: ResultsDerivedTeam) {
  return team.squad.reduce<Record<Player['role'], number>>(
    (acc, player) => {
      acc[player.role] += 1
      return acc
    },
    {
      batter: 0,
      wicketkeeper: 0,
      allrounder: 0,
      bowler: 0
    }
  )
}

function ComparisonSquadPanel({ team, side }: { team: ResultsDerivedTeam; side: 'left' | 'right' }) {
  const roleCounts = buildRoleCounts(team)
  const headliner = team.purchases[0]?.player ?? null
  const visiblePurchases = team.purchases

  return (
    <aside
      className={`results-compare-squad team-theme ${getTeamThemeClass(team.participant?.team_name)} is-${side}`}
      style={getTeamThemeStyle(team.participant?.team_name)}
    >
      <div className="results-compare-squad-head">
        <strong>{getTeamLabel(team)}</strong>
        <span>{team.participant?.profiles?.username || 'Franchise Owner'}</span>
      </div>

      <div className="results-compare-squad-meta">
        <span>Rank #{team.result.rank}</span>
        <span>{team.squad.length} players</span>
      </div>

      <div className="results-compare-rolechips">
        {COMPARE_ROLE_META.map(({ role, shortLabel }) => (
          <div key={role} className="results-compare-rolechip">
            <span>{shortLabel}</span>
            <strong>{roleCounts[role]}</strong>
          </div>
        ))}
      </div>

      {headliner && (
        <div className="results-compare-headliner">
          <span>Headliner</span>
          <strong>{headliner.name}</strong>
          <small>
            {formatRoleLabel(headliner.role)} | Rating {formatPlayerRating(headliner.performance_score)}
          </small>
        </div>
      )}

      <div className="results-compare-squad-list">
        <div className="results-player-grid is-compact">
          {visiblePurchases.map((purchase) => {
            const { player } = purchase
            const tone = getPlayerTone(player)
            return (
              <div key={purchase.row.id} className={`results-player-row is-${tone}`}>
                <span className={`results-player-dot is-${tone}`} aria-hidden="true" />
                <div className="results-player-main">
                  <strong>{player.name}</strong>
                  <span className={`results-player-role is-${player.role}`}>{formatRoleShortLabel(player.role)}</span>
                </div>
                <div className="results-player-values">
                  <span className={`results-player-points is-${tone}`}>{formatPlayerRating(player.performance_score)} pts</span>
                  <span className="results-player-price">{formatPrice(purchase.pricePaid)}</span>
                </div>
              </div>
            )
          })}
          {visiblePurchases.length === 0 && <div className="results-compare-more">No squad players found.</div>}
        </div>
      </div>
    </aside>
  )
}

function ResultsShareButton({ onClick }: { onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm results-viral-share" onClick={onClick}>
      Share
    </button>
  )
}

async function copyTextWithFallback(text: string) {
  if (typeof document === 'undefined') return false

  if (navigator.clipboard && document.hasFocus()) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to manual copy path below
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  try {
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}

export function ResultsExperience({ room, participants, results, squads, playersById, currentUserId }: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'overview' | 'compare'>('overview')
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null)
  const [leftUserId, setLeftUserId] = useState<string | null>(null)
  const [rightUserId, setRightUserId] = useState<string | null>(null)
  const [shareDialogTop, setShareDialogTop] = useState(32)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const { busy, error, setError, downloadCard, shareCard } = useShareCard()

  const teams = useMemo(
    () =>
      buildResultsTeams({
        participants,
        results,
        squads,
        playersById,
        currentUserId
      }),
    [currentUserId, participants, playersById, results, squads]
  )

  const awards = useMemo(() => deriveAwardBadges(teams), [teams])
  const spotlights = useMemo(() => derivePurchaseSpotlights(teams), [teams])
  const teamsByUserId = useMemo(
    () =>
      teams.reduce<Record<string, ResultsDerivedTeam>>((acc, team) => {
        acc[team.result.user_id] = team
        return acc
      }, {}),
    [teams]
  )

  useEffect(() => {
    if (!teams.length) return
    const myTeam = teams.find((team) => team.isMine)
    const winner = teams[0]
    const fallbackRight = teams.find((team) => team.result.user_id !== (myTeam?.result.user_id ?? winner.result.user_id)) ?? winner

    setLeftUserId((value) => value ?? (myTeam?.result.user_id || winner.result.user_id))
    setRightUserId((value) => value ?? fallbackRight.result.user_id)
  }, [teams])

  useEffect(() => {
    if (typeof window === 'undefined' || !room?.id || results.length === 0) return
    const key = `results:invite-modal:${room.id}`
    if (window.sessionStorage.getItem(key) === '1') return
    window.sessionStorage.setItem(key, '1')
    setInviteOpen(true)
  }, [results.length, room?.id])

  const comparison = useMemo<TeamComparisonModel | null>(() => {
    const left = leftUserId ? teamsByUserId[leftUserId] : null
    const right = rightUserId ? teamsByUserId[rightUserId] : null
    if (!left || !right || left.result.user_id === right.result.user_id) return null
    return buildTeamComparison(left, right)
  }, [leftUserId, rightUserId, teamsByUserId])

  const comparisonSquadInsights = useMemo(() => {
    if (!comparison) return null
    const leftIds = new Set(comparison.left.squad.map((player) => player.id))
    const rightIds = new Set(comparison.right.squad.map((player) => player.id))
    const sharedPlayers = comparison.left.squad.filter((player) => rightIds.has(player.id))
    const leftUnique = comparison.left.squad.filter((player) => !rightIds.has(player.id)).length
    const rightUnique = comparison.right.squad.filter((player) => !leftIds.has(player.id)).length
    return {
      sharedPlayers,
      leftUnique,
      rightUnique
    }
  }, [comparison])

  const selectedAward = useMemo(
    () => (shareTarget?.kind === 'award' ? awards.find((award) => award.id === shareTarget.id) : undefined),
    [awards, shareTarget]
  )
  const selectedSpotlight = useMemo(
    () => (shareTarget?.kind === 'spotlight' ? spotlights.find((spotlight) => spotlight.id === shareTarget.id) : undefined),
    [shareTarget, spotlights]
  )
  const selectedTeam = useMemo(
    () => (shareTarget?.kind === 'team' ? teamsByUserId[shareTarget.userId] ?? null : null),
    [shareTarget, teamsByUserId]
  )

  const shareMeta = useMemo(() => {
    if (!shareTarget) return null

    if (shareTarget.kind === 'team' && selectedTeam) {
      const teamName = getTeamLabel(selectedTeam)
      return {
        fileName: getShareFileName(`${teamName}-share-card`),
        title: `${teamName} squad`,
        text: `${teamName} is locked in. Think you can build a better franchise?`
      }
    }

    if (shareTarget.kind === 'award' && selectedAward) {
      return {
        fileName: getShareFileName(selectedAward.title),
        title: selectedAward.title,
        text: `${selectedAward.title}: ${getTeamLabel(selectedAward.team)}`
      }
    }

    if (shareTarget.kind === 'spotlight' && selectedSpotlight) {
      return {
        fileName: getShareFileName(selectedSpotlight.title),
        title: selectedSpotlight.title,
        text: `${selectedSpotlight.title}: ${selectedSpotlight.purchase.player.name} for ${getTeamLabel(selectedSpotlight.team)}`
      }
    }

    if (shareTarget.kind === 'comparison' && comparison) {
      return {
        fileName: getShareFileName(`${getTeamLabel(comparison.left)}-vs-${getTeamLabel(comparison.right)}`),
        title: `${getTeamLabel(comparison.left)} vs ${getTeamLabel(comparison.right)}`,
        text: `Head-to-head: ${getTeamLabel(comparison.left)} vs ${getTeamLabel(comparison.right)}`
      }
    }

    return null
  }, [comparison, selectedAward, selectedSpotlight, selectedTeam, shareTarget])

  const inviteShareText = useMemo(
    () => {
      if (typeof window === 'undefined') return ''
      return `Think you can build a better team next time?\n\nI played ${APP_NAME} with friends and it was a great franchise auction room.\n\nPlay here:\n${window.location.origin}\n\nUnofficial fan-made simulator. Not affiliated with or endorsed by the BCCI, IPL, or any franchise.`
    },
    []
  )

  const roomCopyText = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return getInviteText(room.name, room.code, window.location.origin)
  }, [room.code, room.name])

  const preview = useMemo(() => {
    if (!shareTarget) return null
    if (shareTarget.kind === 'team' && selectedTeam) return <TeamShareCard team={selectedTeam} />
    if (shareTarget.kind === 'award' && selectedAward) return <AwardShareCard award={selectedAward} />
    if (shareTarget.kind === 'spotlight' && selectedSpotlight) return <SpotlightShareCard spotlight={selectedSpotlight} />
    if (shareTarget.kind === 'comparison' && comparison) return <ComparisonShareCard comparison={comparison} />
    return null
  }, [comparison, selectedAward, selectedSpotlight, selectedTeam, shareTarget])

  const exportBlobFactory = useMemo(() => {
    if (!shareTarget) return null
    if (shareTarget.kind === 'team' && selectedTeam) return () => renderTeamShareCardBlob(selectedTeam)
    if (shareTarget.kind === 'award' && selectedAward) return () => renderAwardShareCardBlob(selectedAward)
    if (shareTarget.kind === 'spotlight' && selectedSpotlight) return () => renderSpotlightShareCardBlob(selectedSpotlight)
    if (shareTarget.kind === 'comparison' && comparison) return () => renderComparisonShareCardBlob(comparison)
    return null
  }, [comparison, selectedAward, selectedSpotlight, selectedTeam, shareTarget])

  const openShareTarget = (target: ShareTarget, anchorTop: number | null) => {
    setShareDialogTop(getShareDialogTop(anchorTop))
    setInviteFeedback(null)
    setError(null)
    setShareTarget(target)
  }

  const handleDownload = async () => {
    if (!shareMeta || !exportBlobFactory) return
    await downloadCard(previewRef.current, shareMeta.fileName, exportBlobFactory)
  }

  const handleShare = async () => {
    if (!shareMeta || !exportBlobFactory) return
    const result = await shareCard(previewRef.current, shareMeta, exportBlobFactory)
    if (result === 'copied') {
      setInviteFeedback('Share text copied to clipboard.')
    }
  }

  const handleInviteFriends = async () => {
    if (!inviteShareText) return

    if (navigator.share) {
      try {
        await navigator.share({
          title: room.name,
          text: inviteShareText
        })
        setInviteFeedback('Invite shared.')
        return
      } catch {
        // fall back to clipboard below
      }
    }

    const copied = await copyTextWithFallback(inviteShareText)
    setInviteFeedback(copied ? 'Invite text copied.' : 'Could not auto-copy invite text. Tap again after refocusing the page.')
  }

  const handleCopyRoom = async () => {
    if (!roomCopyText) return
    const copied = await copyTextWithFallback(roomCopyText)
    setInviteFeedback(copied ? 'Room code and join link copied.' : 'Could not auto-copy room code. Tap again after refocusing the page.')
  }

  return (
    <>
      <div className="results-top-rail">
        <div className="results-replay-inline">
          <div className="results-replay-inline-copy">
            <span className="status-label">Run It Back</span>
            <p>Think you can build a better team next time?</p>
          </div>
          <div className="results-replay-inline-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => router.push('/room/create')}>
              Run Another Auction
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleInviteFriends()}>
              Invite Friends
            </button>
          </div>
        </div>

        <div className="results-experience-tabs">
          <button type="button" className={`results-experience-tab ${activeTab === 'overview' ? 'is-active' : ''}`} onClick={() => setActiveTab('overview')}>
            Overview
          </button>
          <button type="button" className={`results-experience-tab ${activeTab === 'compare' ? 'is-active' : ''}`} onClick={() => setActiveTab('compare')}>
            Compare Teams
          </button>
        </div>
      </div>

      {activeTab === 'overview' ? (
        <>
          <section className="results-virality-section">
            <div className="results-virality-head">
              <div>
                <span className="status-label">Shareable Highlights</span>
                <h2 className="section-title">Awards and auction moments worth posting</h2>
              </div>
            </div>

            <div className="results-viral-grid">
              {awards.map((award) => (
                <article key={award.id} className={`results-viral-card ${award.id === 'auction-winner' ? 'is-primary' : ''}`}>
                  <div className="results-viral-card-head">
                    <div>
                      <span className="status-label">{award.title}</span>
                      <strong>{getTeamLabel(award.team)}</strong>
                    </div>
                    <ResultsShareButton onClick={(event) => openShareTarget({ kind: 'award', id: award.id }, event.currentTarget.getBoundingClientRect().top)} />
                  </div>
                  <div className="results-viral-card-metric">{award.valueLabel}</div>
                  <p>{award.supportingCopy}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="results-virality-section">
            <div className="results-virality-head">
              <div>
                <span className="status-label">Auction Spotlights</span>
                <h2 className="section-title">The swings, steals, and overpays of the room</h2>
              </div>
            </div>

            <div className="results-viral-grid">
              {spotlights.map((spotlight) => (
                <article key={spotlight.id} className={`results-viral-card is-${spotlight.id}`}>
                  <div className="results-viral-card-head">
                    <div>
                      <span className="status-label">{spotlight.title}</span>
                      <strong>{spotlight.purchase.player.name}</strong>
                    </div>
                    <ResultsShareButton onClick={(event) => openShareTarget({ kind: 'spotlight', id: spotlight.id }, event.currentTarget.getBoundingClientRect().top)} />
                  </div>
                  <div className="results-viral-card-metric">{getTeamLabel(spotlight.team)}</div>
                  <p>{spotlight.supportingCopy}</p>
                </article>
              ))}
            </div>
          </section>

          <RoomResultsBoard
            roomName={room.name}
            totalPurse={room.settings.budget}
            participants={participants}
            results={results}
            squads={squads}
            playersById={playersById}
            currentUserId={currentUserId}
            onShareTeam={(userId: string, anchorTop?: number) => openShareTarget({ kind: 'team', userId }, anchorTop ?? null)}
          />
        </>
      ) : (
        <section className="results-compare-shell">
          <div className="results-virality-head">
            <div>
              <span className="status-label">Compare Teams</span>
              <h2 className="section-title">Head-to-head on batting, bowling, purse, stars, rating, and balance</h2>
            </div>
            <ResultsShareButton
              onClick={(event) => {
                if (comparison) {
                  openShareTarget({ kind: 'comparison' }, event.currentTarget.getBoundingClientRect().top)
                }
              }}
            />
          </div>

          <div className="results-compare-controls">
            <label className="results-compare-picker">
              <span>Left Team</span>
              <select value={leftUserId ?? ''} onChange={(event) => setLeftUserId(event.target.value)}>
                {teams.map((team) => (
                  <option key={team.result.user_id} value={team.result.user_id}>
                    {getTeamLabel(team)}
                  </option>
                ))}
              </select>
            </label>

            <label className="results-compare-picker">
              <span>Right Team</span>
              <select value={rightUserId ?? ''} onChange={(event) => setRightUserId(event.target.value)}>
                {teams.map((team) => (
                  <option key={team.result.user_id} value={team.result.user_id}>
                    {getTeamLabel(team)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {comparison ? (
            <div className="results-compare-board">
              <div className="results-compare-summary">
                <div className={`results-compare-summary-card ${comparison.overallWinner === 'left' ? 'is-winning' : ''}`}>
                  <strong>{getTeamLabel(comparison.left)}</strong>
                  <span>{comparison.leftWins} category wins</span>
                </div>
                <div className="results-compare-versus">VS</div>
                <div className={`results-compare-summary-card ${comparison.overallWinner === 'right' ? 'is-winning' : ''}`}>
                  <strong>{getTeamLabel(comparison.right)}</strong>
                  <span>{comparison.rightWins} category wins</span>
                </div>
              </div>

              <div className="results-compare-arena">
                <ComparisonSquadPanel team={comparison.left} side="left" />

                <div className="results-compare-metrics-shell">
                  <div className="results-compare-metrics">
                    {comparison.metrics.map((metric) => (
                      <div key={metric.id} className="results-compare-metric-row">
                        <strong className={metric.winner === 'left' ? 'is-winning' : ''}>{metric.leftValue}</strong>
                        <span>{metric.label}</span>
                        <strong className={metric.winner === 'right' ? 'is-winning' : ''}>{metric.rightValue}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="results-compare-shared-core">
                    <div className="results-compare-shared-head">
                      <strong>Squad Overlap</strong>
                      <span>{comparisonSquadInsights?.sharedPlayers.length ?? 0} shared picks</span>
                    </div>
                    <div className="results-compare-shared-pills">
                      {(comparisonSquadInsights?.sharedPlayers.slice(0, 6) ?? []).map((player) => (
                        <span key={player.id} className="results-compare-shared-pill">
                          {player.name}
                        </span>
                      ))}
                      {(comparisonSquadInsights?.sharedPlayers.length ?? 0) === 0 && <span className="results-compare-shared-empty">No overlapping players.</span>}
                    </div>
                    <div className="results-compare-unique-row">
                      <span>{getTeamLabel(comparison.left)} unique: {comparisonSquadInsights?.leftUnique ?? 0}</span>
                      <span>{getTeamLabel(comparison.right)} unique: {comparisonSquadInsights?.rightUnique ?? 0}</span>
                    </div>
                  </div>

                  <div className="results-compare-purse-grid">
                    {[
                      { key: 'left', team: comparison.left },
                      { key: 'right', team: comparison.right }
                    ].map(({ key, team }) => {
                      const spendPercent = room.settings.budget > 0 ? Math.min(100, (team.totalSpend / room.settings.budget) * 100) : 0
                      return (
                        <div key={key} className="results-compare-purse-card">
                          <div className="results-compare-purse-head">
                            <strong>{getTeamLabel(team)}</strong>
                            <span>{spendPercent.toFixed(0)}% used</span>
                          </div>
                          <div className="results-compare-purse-track">
                            <div className="results-compare-purse-fill" style={{ width: `${spendPercent}%` }} />
                          </div>
                          <small>
                            Spent {formatPrice(team.totalSpend)} | Left {formatPrice(team.remainingPurse)}
                          </small>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <ComparisonSquadPanel team={comparison.right} side="right" />
              </div>
            </div>
          ) : (
            <div className="card">
              <p className="text-sm text-muted">Choose two different teams to compare.</p>
            </div>
          )}
        </section>
      )}

      {shareTarget && preview && (
        <div
          className="results-share-dialog-backdrop"
          role="presentation"
          style={{ paddingTop: `calc(env(safe-area-inset-top, 0px) + ${shareDialogTop}px)` }}
          onClick={() => setShareTarget(null)}
        >
          <div className="results-share-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="results-share-dialog-head">
              <div>
                <span className="status-label">Share Card</span>
                <h2 className="section-title">Download or share this result card</h2>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShareTarget(null)}>
                Close
              </button>
            </div>

            <div className="results-share-preview-wrap">
              <div ref={previewRef}>{preview}</div>
            </div>

            <div className="results-share-dialog-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleDownload()} disabled={busy}>
                {busy ? 'Preparing…' : 'Download PNG'}
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleShare()} disabled={busy}>
                {busy ? 'Preparing…' : 'Share'}
              </button>
            </div>

            {(error || inviteFeedback) && <p className="results-share-feedback">{error || inviteFeedback}</p>}
          </div>
        </div>
      )}

      {inviteOpen && (
        <div className="results-invite-backdrop" role="presentation" onClick={() => setInviteOpen(false)}>
          <div className="results-invite-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="results-invite-copy">
              <span className="status-label">Thank You</span>
              <h2 className="section-title">Share this auction with friends and run it back</h2>
              <p>Thanks for playing. Start another room or send an invite to the same group for the next auction battle.</p>
            </div>

            <div className="results-invite-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => router.push('/room/create')}>
                Run Another Auction
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleInviteFriends()}>
                Invite Friends
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleCopyRoom()}>
                Copy Room Code / Link
              </button>
            </div>

            <div className="results-invite-meta">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInviteOpen(false)}>
                Maybe later
              </button>
            </div>

            {inviteFeedback && <p className="results-share-feedback">{inviteFeedback}</p>}
          </div>
        </div>
      )}
    </>
  )
}

export default ResultsExperience
