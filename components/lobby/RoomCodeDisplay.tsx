'use client'

import { useMemo, useState } from 'react'

type Props = { code: string }

const AUCTION_TIPS = [
  'Nominate early role players to pressure loose budgets before the star rounds begin.',
  'Balance the squad first. A flashy top order rarely fixes thin bowling depth.',
  'Track which owners still need wicketkeepers or finishers before pushing a bid war.',
  'Save flexibility for the final third of the room when value buys start appearing.',
  'One oversized purchase can distort the rest of a franchise build for several rounds.',
  'If two rivals are low on purse, force contests on players that solve their weak spots.',
  'Strong auction rooms are usually built through role fit and timing, not just star power.'
]

function getAuctionTip(code: string) {
  const seed = code.split('').reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0)
  return AUCTION_TIPS[seed % AUCTION_TIPS.length]
}

export function RoomCodeDisplay({ code }: Props) {
  const [copied, setCopied] = useState(false)
  const fact = useMemo(() => getAuctionTip(code), [code])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="room-code-card">
      <div className="rc-label">Room Code</div>
      <div className="rc-thala text-gold font-display text-lg tracking-[0.18em] uppercase">Auction Room Live</div>
      <div className="rc-code-wrap">
        <div className="rc-code">{code}</div>
        <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      <div className="mt-4 rounded-xl border border-[rgba(245,197,24,0.25)] bg-[rgba(245,197,24,0.08)] px-4 py-3">
        <div className="text-[0.65rem] font-mono uppercase tracking-[0.24em] text-gold">Auction Tip</div>
        <p className="mt-2 text-sm text-secondary">{fact}</p>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 10 }}>Share this code with friends</p>
    </div>
  )
}

export default RoomCodeDisplay
