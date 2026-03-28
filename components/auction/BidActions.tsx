'use client'

import { useMemo, useRef, useState } from 'react'
import { AuctionReactions } from '@/components/auction/AuctionReactions'
import { getBidIncrements, formatPrice } from '@/lib/auction-helpers'
import { supabaseClient } from '@/lib/supabase'

type Props = {
  auctionSessionId: string
  participantId: string
  currentPrice: number
  budgetRemaining: number
  squadCount: number
  squadLimit: number
  isPaused: boolean
  isExpired: boolean
  skipped: boolean
  isHighestBidder: boolean
  skipCount: number
  activeCount: number
}

type ActionState = {
  tone: 'neutral' | 'success' | 'error'
  text: string
} | null

export function BidActions({
  auctionSessionId,
  participantId,
  currentPrice,
  budgetRemaining,
  squadCount,
  squadLimit,
  isPaused,
  isExpired,
  skipped,
  isHighestBidder,
  skipCount,
  activeCount
}: Props) {
  const [loadingAction, setLoadingAction] = useState<'bid' | 'skip' | null>(null)
  const [message, setMessage] = useState<ActionState>(null)
  const skipStackRef = useRef<HTMLDivElement | null>(null)
  const increments = getBidIncrements(currentPrice)

  const disabled = isPaused || isExpired || isHighestBidder || squadCount >= squadLimit || budgetRemaining <= currentPrice
  const disabledReason = useMemo(() => {
    if (isPaused) return 'Host has paused the auction.'
    if (isExpired) return 'Timer expired. Waiting for result.'
    if (isHighestBidder) return 'You already hold the highest confirmed bid.'
    if (squadCount >= squadLimit) return 'Your squad limit is full.'
    if (budgetRemaining <= currentPrice) return 'Available budget is below the current price.'
    if (skipped) return `Pass recorded · ${skipCount}/${activeCount} franchises skipped`
    return 'Place a bid or skip this player.'
  }, [activeCount, budgetRemaining, currentPrice, isExpired, isHighestBidder, isPaused, skipCount, skipped, squadCount, squadLimit])

  const placeBid = async (delta: number) => {
    if (disabled) return
    setLoadingAction('bid')
    setMessage(null)
    const bidAmount = currentPrice + delta
    const { data, error } = await supabaseClient.rpc('place_bid', {
      p_auction_session_id: auctionSessionId,
      p_bidder_participant_id: participantId,
      p_bid_amount: bidAmount
    })

    if (error) {
      setMessage({ tone: 'error', text: error.message })
    } else if (data?.success === false) {
      setMessage({ tone: 'error', text: data.error || 'Bid rejected.' })
    } else {
      setMessage({ tone: 'success', text: 'Bid placed.' })
    }

    setLoadingAction(null)
  }

  const skip = async () => {
    setLoadingAction('skip')
    setMessage(null)
    const { data, error } = await supabaseClient.rpc('skip_player', {
      p_auction_session_id: auctionSessionId,
      p_participant_id: participantId
    })

    if (error) {
      setMessage({ tone: 'error', text: error.message })
    } else if (data?.success === false) {
      setMessage({ tone: 'error', text: data.error || 'Skip failed.' })
    } else {
      setMessage({ tone: 'success', text: 'Pass recorded.' })
    }

    setLoadingAction(null)
  }

  return (
    <section className="card auction-action-card" aria-label="Auction actions">
      <div className="auction-action-head">
        <div className="auction-action-copy">
          <span className="status-label">Action bar</span>
          <p className="auction-action-caption">{disabledReason}</p>
        </div>
        <div className="auction-action-budget">
          <span className="status-label">Budget left</span>
          <strong>{formatPrice(budgetRemaining)}</strong>
        </div>
      </div>

      <div className="auction-action-body">
        <div className="auction-bid-buttons">
          {increments.map((inc) => {
            const target = currentPrice + inc.amount
            const unavailable = disabled || budgetRemaining < target || loadingAction !== null

            return (
              <button
                key={inc.label}
                onClick={() => placeBid(inc.amount)}
                disabled={unavailable}
                className="btn btn-green btn-sm auction-bid-button"
              >
                <span>{inc.label}</span>
                <strong>{formatPrice(target)}</strong>
              </button>
            )
          })}
        </div>

        <div ref={skipStackRef} className="auction-skip-stack">
          <AuctionReactions auctionSessionId={auctionSessionId} anchorRef={skipStackRef} />
          <button
            onClick={skip}
            disabled={loadingAction !== null || skipped || isPaused || isExpired || isHighestBidder}
            className="btn btn-danger btn-sm auction-skip-button"
          >
            {loadingAction === 'skip' ? 'Submitting…' : skipped ? `${skipCount}/${activeCount} skipped` : 'Skip'}
          </button>
        </div>
      </div>
      {message && <p className={`auction-feedback-copy ${message ? `is-${message.tone}` : ''}`}>{message.text}</p>}
    </section>
  )
}

export default BidActions
