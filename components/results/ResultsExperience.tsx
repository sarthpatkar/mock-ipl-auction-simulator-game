'use client'

import { MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RoomResultsBoard } from '@/components/results/RoomResultsBoard'
import { AwardShareCard, ComparisonShareCard, SpotlightShareCard, TeamShareCard } from '@/components/results/ResultsShareCards'
import { useShareCard } from '@/hooks/useShareCard'
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

function getShareFileName(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function getTeamLabel(team: ResultsDerivedTeam | undefined) {
  return team?.participant?.team_name || 'Franchise'
}

function getShareDialogTop(anchorTop: number | null) {
  if (typeof window === 'undefined') return 32
  if (anchorTop == null) return 32
  return Math.min(Math.max(16, anchorTop - 16), Math.max(32, window.innerHeight - 180))
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
    () =>
      `Think you can build a better team next time?\n\nOr new to the game?\n\nI played this IPL auction game with friends and it was fantastic.\n\nLet's play IPL auction together:\nhttps://mock-ipl-auction-simulator-game.vercel.app`,
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

              <div className="results-compare-metrics">
                {comparison.metrics.map((metric) => (
                  <div key={metric.id} className="results-compare-metric-row">
                    <strong className={metric.winner === 'left' ? 'is-winning' : ''}>{metric.leftValue}</strong>
                    <span>{metric.label}</span>
                    <strong className={metric.winner === 'right' ? 'is-winning' : ''}>{metric.rightValue}</strong>
                  </div>
                ))}
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
        <div className="results-share-dialog-backdrop" role="presentation" style={{ paddingTop: `${shareDialogTop}px` }} onClick={() => setShareTarget(null)}>
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
              <span className="status-label">Run It Back</span>
              <h2 className="section-title">Think you can build a better team next time?</h2>
              <p>Create another room or send this code to the same group and start a fresh auction war.</p>
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
              <span>Room code: {room.code}</span>
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
