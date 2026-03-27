'use client'

import { useState } from 'react'
import { formatAuctionStatus } from '@/lib/auction-helpers'
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

export function AdminControls({ auctionSessionId, status, compact = false }: Props) {
  const [loading, setLoading] = useState<null | 'pause' | 'resume' | 'end' | 'stop'>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const runAdminAction = async (
    rpcName: 'pause_auction' | 'resume_auction' | 'stop_auction',
    loadingKey: 'pause' | 'resume' | 'stop',
    successText: string
  ) => {
    setLoading(loadingKey)
    setFeedback(null)

    try {
      const { data, error } = await supabaseClient.rpc(rpcName, { p_auction_session_id: auctionSessionId })
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
        setFeedback({ tone: 'success', text: 'Round action confirmed. Waiting for the live board to transition.' })
      }
    } finally {
      setLoading(null)
    }
  }

  if (compact) {
    return (
      <section className="admin-controls-inline" aria-label="Admin controls">
        <div className="admin-controls-inline-buttons">
          <button
            onClick={() => void runAdminAction('pause_auction', 'pause', 'Pause request confirmed.')}
            disabled={loading !== null || status !== 'live'}
            className="btn btn-ghost btn-sm"
            title="Pause auction"
          >
            {loading === 'pause' ? 'Pausing…' : 'Pause'}
          </button>
          <button
            onClick={() => void runAdminAction('resume_auction', 'resume', 'Resume request confirmed.')}
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
            onClick={() => void runAdminAction('stop_auction', 'stop', 'Stop request confirmed.')}
            disabled={loading !== null}
            className="btn btn-danger btn-sm"
            title="Stop auction"
          >
            {loading === 'stop' ? 'Stopping…' : 'Stop'}
          </button>
        </div>
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
          onClick={() => void runAdminAction('pause_auction', 'pause', 'Pause request confirmed.')}
          disabled={loading !== null || status !== 'live'}
          className="btn btn-ghost btn-sm"
        >
          {loading === 'pause' ? 'Pausing…' : 'Pause'}
        </button>
        <button
          onClick={() => void runAdminAction('resume_auction', 'resume', 'Resume request confirmed.')}
          disabled={loading !== null || status !== 'paused'}
          className="btn btn-green btn-sm"
        >
          {loading === 'resume' ? 'Resuming…' : 'Resume'}
        </button>
        <button onClick={endRound} disabled={loading !== null || status === 'completed'} className="btn btn-primary btn-sm">
          {loading === 'end' ? 'Ending…' : 'End Round'}
        </button>
        <button
          onClick={() => void runAdminAction('stop_auction', 'stop', 'Stop request confirmed.')}
          disabled={loading !== null}
          className="btn btn-danger btn-sm"
        >
          {loading === 'stop' ? 'Stopping…' : 'Stop'}
        </button>
      </div>

      {feedback && <div className={`auction-feedback-copy ${feedback ? `is-${feedback.tone}` : ''}`}>{feedback.text}</div>}
    </section>
  )
}

export default AdminControls
