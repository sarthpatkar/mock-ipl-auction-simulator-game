'use client'

import { useEffect, useState } from 'react'
import { formatPrice, getTeamThemeClass, getTeamThemeStyle } from '@/lib/auction-helpers'
import { Bid, RoomParticipant } from '@/types'

type Props = {
  currentPrice: number
  highestBidderId: string | null
  participants: RoomParticipant[]
  bidHistory: Bid[]
  themeTeam?: string | null
  hideSummary?: boolean
}

export function BidBar({ currentPrice, highestBidderId, participants, bidHistory, themeTeam, hideSummary = false }: Props) {
  const bidder = participants.find((p) => p.id === highestBidderId)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    setFlash(true)
    const timeout = setTimeout(() => setFlash(false), 220)
    return () => clearTimeout(timeout)
  }, [currentPrice, highestBidderId])

  return (
    <div className={`bid-bar-shell team-theme ${getTeamThemeClass(themeTeam) || 'team-neutral'} ${flash ? 'bid-bar-flash' : ''}`} style={getTeamThemeStyle(themeTeam)}>
      {!hideSummary && (
        <div className="card bid-bar-main">
          <div className="bid-bar-price">
            <p className="status-label">Current price</p>
            <p className="bid-bar-price-value">{formatPrice(currentPrice)}</p>
          </div>
          <div className="bid-bar-bidder">
            <p className="status-label">Highest bidder</p>
            <p className="bid-bar-bidder-value">{bidder ? bidder.team_name : 'No bids yet'}</p>
            <p className="bid-bar-bidder-meta">{bidder ? bidder.profiles?.username || 'Franchise Owner' : 'Waiting for the first bid'}</p>
          </div>
        </div>
      )}

      <div className="card bid-ribbon-card">
        <div className="bid-ribbon-head">
          <span className="status-label">Recent bids</span>
        </div>
        <div className="bid-ribbon-track" role="list" aria-label="Recent bids">
          {bidHistory.slice(0, 12).map((bid) => {
            const bidOwner = participants.find((participant) => participant.id === bid.bidder_id)
            return (
              <div
                key={bid.id}
                className={`bid-ribbon-item team-theme ${getTeamThemeClass(bidOwner?.team_name)}`}
                style={getTeamThemeStyle(bidOwner?.team_name)}
                role="listitem"
              >
                <span className="bid-ribbon-team">{bidOwner?.team_name || 'Bid'}</span>
                <span className="bid-ribbon-price">{formatPrice(bid.amount)}</span>
              </div>
            )
          })}
          {bidHistory.length === 0 && <div className="bid-ribbon-empty">No bids yet</div>}
        </div>
      </div>
    </div>
  )
}

export default BidBar
