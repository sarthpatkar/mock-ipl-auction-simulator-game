'use client'

import { AuctionMode } from '@/types'

type Props = {
  value: AuctionMode
  onChange: (mode: AuctionMode) => void
}

const OPTIONS: Array<{ mode: AuctionMode; title: string; subtitle: string }> = [
  {
    mode: 'full_auction',
    title: 'Full Auction',
    subtitle: 'Complete multi-round auction with full player pool'
  },
  {
    mode: 'match_auction',
    title: 'Match Auction',
    subtitle: 'Quick head-to-head auction based on a single upcoming match'
  }
]

export function AuctionModeSelector({ value, onChange }: Props) {
  return (
    <div className="auction-mode-toggle" aria-label="Auction mode">
      <div className="auction-mode-toggle-inner" role="tablist" aria-label="Auction mode switch">
        {OPTIONS.map((option) => {
          const active = option.mode === value
          return (
            <button
              key={option.mode}
              type="button"
              onClick={() => onChange(option.mode)}
              role="tab"
              aria-selected={active}
              className={`auction-mode-pill ${active ? 'is-active' : ''}`}
            >
              {option.title}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default AuctionModeSelector
