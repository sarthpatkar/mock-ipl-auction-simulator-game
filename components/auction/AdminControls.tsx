'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatAuctionStatus } from '@/lib/auction-helpers'
import { createIdempotencyKey } from '@/lib/idempotency'
import { supabaseClient } from '@/lib/supabase'

type Props = {
  auctionSessionId: string
  status: 'waiting' | 'live' | 'paused' | 'sold' | 'unsold' | 'completed'
  compact?: boolean
}

type Feedback = {
  tone: 'neutral' | 'success' | 'error'
  text: string
} | null

type InactiveParticipantCandidate = {
  participant_id: string
  user_id: string
  team_name: string
  username: string | null
  joined_at: string
}

type InactiveParticipantsResponse = {
  success?: boolean
  error?: string
  completed_count?: number
  required_count?: number
  eligible_participants?: InactiveParticipantCandidate[]
}

export function AdminControls({ auctionSessionId, status, compact = false }: Props) {
  const [loading, setLoading] = useState<null | 'pause' | 'resume' | 'end' | 'stop'>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [inactiveCandidates, setInactiveCandidates] = useState<InactiveParticipantCandidate[]>([])
  const [inactiveCompletedCount, setInactiveCompletedCount] = useState(0)
  const [inactiveRequiredCount, setInactiveRequiredCount] = useState(25)
  const [inactiveLoading, setInactiveLoading] = useState(false)
  const [removingParticipantId, setRemovingParticipantId] = useState<string | null>(null)
  const canRemoveInactiveParticipant = status === 'waiting' || status === 'sold' || status === 'unsold'

  const loadInactiveCandidates = useCallback(async () => {
    setInactiveLoading(true)

    try {
      const { data, error } = await supabaseClient.rpc('list_inactive_participants_for_removal', {
        p_auction_session_id: auctionSessionId
      })

      if (error) {
        setInactiveCandidates([])
        setFeedback({ tone: 'error', text: error.message })
        return
      }

      const result = (data ?? {}) as InactiveParticipantsResponse
      if (result.success === false) {
        setInactiveCandidates([])
        setFeedback({ tone: 'error', text: result.error || 'Failed to load inactive participants.' })
        return
      }

      setInactiveCandidates(result.eligible_participants ?? [])
      setInactiveCompletedCount(result.completed_count ?? 0)
      setInactiveRequiredCount(result.required_count ?? 25)
    } finally {
      setInactiveLoading(false)
    }
  }, [auctionSessionId])

  useEffect(() => {
    void loadInactiveCandidates()
  }, [loadInactiveCandidates, status])

  const runAdminAction = async (
    rpcName: 'pause_auction' | 'resume_auction' | 'stop_auction',
    loadingKey: 'pause' | 'resume' | 'stop',
    successText: string
  ) => {
    setLoading(loadingKey)
    setFeedback(null)

    try {
      const { data, error } = await supabaseClient.rpc(rpcName, {
        p_auction_session_id: auctionSessionId,
        p_idempotency_key: createIdempotencyKey(rpcName, auctionSessionId)
      })
      if (error) {
        setFeedback({ tone: 'error', text: error.message })
      } else if (data?.success === false) {
        setFeedback({ tone: 'error', text: data.error || 'Admin action rejected.' })
      } else {
        setFeedback({ tone: 'success', text: successText })
      }
    } finally {
      setLoading(null)
    }
  }

  const endRound = async () => {
    setLoading('end')
    setFeedback(null)
    try {
      const { data, error } = await supabaseClient.rpc('end_auction_round', { p_auction_session_id: auctionSessionId })
      if (error) {
        setFeedback({ tone: 'error', text: error.message })
      } else if (data?.success === false) {
        setFeedback({ tone: 'error', text: data.error || 'End round failed.' })
      } else {
        setFeedback({ tone: 'success', text: 'Round ended. The next stage will appear shortly.' })
      }
    } finally {
      setLoading(null)
    }
  }

  const removeInactiveParticipant = async (participantId: string) => {
    setRemovingParticipantId(participantId)
    setFeedback(null)

    try {
      const { data, error } = await supabaseClient.rpc('remove_inactive_participant', {
        p_auction_session_id: auctionSessionId,
        p_participant_id: participantId
      })

      if (error) {
        setFeedback({ tone: 'error', text: error.message })
        return
      }

      if (data?.success === false) {
        setFeedback({ tone: 'error', text: data.error || 'Failed to remove participant.' })
        return
      }

      setFeedback({ tone: 'success', text: 'Inactive participant removed from the room.' })
      await loadInactiveCandidates()
    } finally {
      setRemovingParticipantId(null)
    }
  }

  const renderInactiveParticipantsPanel = () => {
    const hasWindow = inactiveCompletedCount >= inactiveRequiredCount

    return (
      <div className={`admin-inactive-panel ${compact ? 'is-compact' : ''}`}>
        <div className="admin-inactive-panel-head">
          <div>
            <span className="status-label">Inactive Last 25 Players</span>
            {!compact && (
              <p className="admin-inactive-panel-copy">
                Remove participants who have not placed a single bid in the last {inactiveRequiredCount} completed players of this round.
              </p>
            )}
          </div>
          <span className="status-chip">{Math.min(inactiveCompletedCount, inactiveRequiredCount)}/{inactiveRequiredCount}</span>
        </div>

        {inactiveLoading ? (
          <div className="admin-inactive-empty">Checking inactivity window…</div>
        ) : !hasWindow ? (
          <div className="admin-inactive-empty">Available after {inactiveRequiredCount} completed players. Current progress: {inactiveCompletedCount}/{inactiveRequiredCount}.</div>
        ) : inactiveCandidates.length === 0 ? (
          <div className="admin-inactive-empty">No participants are inactive across the last {inactiveRequiredCount} players.</div>
        ) : (
          <div className="admin-inactive-list">
            {inactiveCandidates.map((candidate) => {
              const isRemoving = removingParticipantId === candidate.participant_id

              return (
                <div key={candidate.participant_id} className="admin-inactive-item">
                  <div className="admin-inactive-item-copy">
                    <strong>{candidate.team_name}</strong>
                    <span>{candidate.username || 'Franchise Owner'}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={!canRemoveInactiveParticipant || isRemoving}
                    onClick={() => void removeInactiveParticipant(candidate.participant_id)}
                  >
                    {isRemoving ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {!canRemoveInactiveParticipant && hasWindow && inactiveCandidates.length > 0 && (
          <div className="admin-inactive-empty">Removal is only allowed between players, after a player resolves and before the next one goes live.</div>
        )}
      </div>
    )
  }

  if (compact) {
    return (
      <section className="admin-controls-inline" aria-label="Admin controls">
        <div className="admin-controls-inline-buttons">
          <button
            onClick={() => void runAdminAction('pause_auction', 'pause', 'Auction paused.')}
            disabled={loading !== null || status !== 'live'}
            className="btn btn-ghost btn-sm"
            title="Pause auction"
          >
            {loading === 'pause' ? 'Pausing…' : 'Pause'}
          </button>
          <button
            onClick={() => void runAdminAction('resume_auction', 'resume', 'Auction resumed.')}
            disabled={loading !== null || status !== 'paused'}
            className="btn btn-green btn-sm"
            title="Resume auction"
          >
            {loading === 'resume' ? 'Resuming…' : 'Resume'}
          </button>
          <button onClick={endRound} disabled={loading !== null || status === 'completed'} className="btn btn-primary btn-sm" title="End round">
            {loading === 'end' ? 'Ending…' : 'End Round'}
          </button>
          <button
            onClick={() => void runAdminAction('stop_auction', 'stop', 'Auction stopped.')}
            disabled={loading !== null}
            className="btn btn-danger btn-sm"
            title="Stop auction"
          >
            {loading === 'stop' ? 'Stopping…' : 'Stop'}
          </button>
        </div>
        {renderInactiveParticipantsPanel()}
        {feedback && <span className={`admin-controls-inline-feedback is-${feedback.tone}`}>{feedback.text}</span>}
      </section>
    )
  }

  return (
    <section className="card admin-controls-card" aria-label="Admin controls">
      <div className="admin-controls-head">
        <div>
          <span className="status-label">Admin controls</span>
          <p className="admin-controls-caption">Pause, resume, or close the current round.</p>
        </div>
        <span className={`status-chip is-${status}`}>{formatAuctionStatus(status)}</span>
      </div>

      <div className="admin-controls-grid">
        <button
          onClick={() => void runAdminAction('pause_auction', 'pause', 'Auction paused.')}
          disabled={loading !== null || status !== 'live'}
          className="btn btn-ghost btn-sm"
        >
          {loading === 'pause' ? 'Pausing…' : 'Pause'}
        </button>
        <button
          onClick={() => void runAdminAction('resume_auction', 'resume', 'Auction resumed.')}
          disabled={loading !== null || status !== 'paused'}
          className="btn btn-green btn-sm"
        >
          {loading === 'resume' ? 'Resuming…' : 'Resume'}
        </button>
        <button onClick={endRound} disabled={loading !== null || status === 'completed'} className="btn btn-primary btn-sm">
          {loading === 'end' ? 'Ending…' : 'End Round'}
        </button>
        <button
          onClick={() => void runAdminAction('stop_auction', 'stop', 'Auction stopped.')}
          disabled={loading !== null}
          className="btn btn-danger btn-sm"
        >
          {loading === 'stop' ? 'Stopping…' : 'Stop'}
        </button>
      </div>

      {renderInactiveParticipantsPanel()}

      {feedback && <div className={`auction-feedback-copy ${feedback ? `is-${feedback.tone}` : ''}`}>{feedback.text}</div>}
    </section>
  )
}

export default AdminControls
