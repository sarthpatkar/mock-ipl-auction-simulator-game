'use client'

import { useMemo, useRef, useState } from 'react'
import { AuctionReactions } from '@/components/auction/AuctionReactions'
import { getBidIncrements, formatPrice } from '@/lib/auction-helpers'
import { createIdempotencyKey } from '@/lib/idempotency'
import { MATCH_AUCTION_MODE, MATCH_QUICK_BID_INCREMENTS } from '@/lib/match-auction'
import { supabaseClient } from '@/lib/supabase'
import { AuctionMode } from '@/types'

type Props = {
  auctionSessionId: string
  auctionMode?: AuctionMode
  participantId: string
  currentPrice: number
  hasHighestBid: boolean
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
  auctionMode = 'full_auction',
  participantId,
  currentPrice,
  hasHighestBid,
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
  const matchReactionAnchorRef = useRef<HTMLButtonElement | null>(null)
  const isOpeningBid = !hasHighestBid
  const increments =
    isOpeningBid
      ? [{ label: 'Base', amount: 0 }]
      : auctionMode === MATCH_AUCTION_MODE
        ? [...MATCH_QUICK_BID_INCREMENTS]
        : getBidIncrements(currentPrice)
  const minimumRequiredBid = currentPrice + (increments[0]?.amount ?? 0)
  const hasInsufficientBudget = budgetRemaining < minimumRequiredBid
  const isViewerOnly = isHighestBidder || squadCount >= squadLimit || hasInsufficientBudget

  const disabled = isPaused || isExpired || isViewerOnly
  const disabledReason = useMemo(() => {
    if (isPaused) return 'The auction is paused right now.'
    if (isExpired) return 'Time is up. Waiting for the result.'
    if (isHighestBidder) return 'You already have the top bid. Waiting for a challenger.'
    if (squadCount >= squadLimit) return 'Your squad is full.'
    if (hasInsufficientBudget) return `You need at least ${formatPrice(minimumRequiredBid)} to place the next valid bid.`
    if (skipped) return 'Pass recorded. You can still re-enter by placing a bid before this player resolves.'
    return 'Place a bid or skip this player.'
  }, [hasInsufficientBudget, isExpired, isHighestBidder, isPaused, minimumRequiredBid, skipped, squadCount, squadLimit])

  const placeBid = async (delta: number) => {
    if (disabled) return
    setLoadingAction('bid')
    setMessage(null)
    const bidAmount = currentPrice + delta
    const { data, error } = await supabaseClient.rpc('place_bid', {
      p_auction_session_id: auctionSessionId,
      p_bidder_participant_id: participantId,
      p_bid_amount: bidAmount,
      p_idempotency_key: createIdempotencyKey('bid', auctionSessionId)
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
    if (isPaused || isExpired || isViewerOnly || loadingAction !== null) return
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
    <section
      className={`card auction-action-card ${auctionMode === MATCH_AUCTION_MODE ? 'is-match-auction' : ''} ${isOpeningBid ? 'is-opening-bid' : ''}`}
      aria-label="Auction actions"
    >
      <div className="auction-action-head">
        <div className="auction-action-copy">
          <span className="status-label">Your Move</span>
          <p className="auction-action-caption">{disabledReason}</p>
        </div>
        <div className="auction-action-budget">
          <span className="status-label">Budget left</span>
          <strong>{formatPrice(budgetRemaining)}</strong>
        </div>
      </div>

      <div className="auction-action-body">
        {isViewerOnly ? (
          <div className="text-sm text-muted">
            {isHighestBidder
              ? 'You lead this player right now. Wait for another franchise to bid or for the timer to expire.'
              : squadCount >= squadLimit
                ? 'Your squad is full. You stay connected as a viewer for this player.'
                : hasInsufficientBudget
                  ? `You need at least ${formatPrice(minimumRequiredBid)} to place the next valid bid. You stay connected as a viewer for this player.`
                  : `Pass recorded · ${skipCount}/${activeCount} franchises skipped. You can still place a bid.`}
          </div>
        ) : (
          <>
            <div className="auction-bid-buttons">
              {increments.map((inc, index) => {
                const target = currentPrice + inc.amount
                const unavailable = disabled || budgetRemaining < target || loadingAction !== null
                const isReactionAnchor = auctionMode === MATCH_AUCTION_MODE && index === increments.length - 1

                return (
                  <button
                    key={inc.label}
                    ref={isReactionAnchor ? matchReactionAnchorRef : undefined}
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
              <AuctionReactions
                auctionSessionId={auctionSessionId}
                anchorRef={auctionMode === MATCH_AUCTION_MODE ? matchReactionAnchorRef : skipStackRef}
                anchorPlacement={auctionMode === MATCH_AUCTION_MODE ? 'top-right' : 'default'}
              />
              <button
                onClick={skip}
                disabled={loadingAction !== null || skipped || isPaused || isExpired || isViewerOnly}
                className="btn btn-danger btn-sm auction-skip-button"
              >
                {loadingAction === 'skip' ? 'Submitting…' : skipped ? `${skipCount}/${activeCount} skipped` : 'Skip'}
              </button>
            </div>
          </>
        )}
      </div>
      {message && <p className={`auction-feedback-copy ${message ? `is-${message.tone}` : ''}`}>{message.text}</p>}
    </section>
  )
}

export default BidActions
