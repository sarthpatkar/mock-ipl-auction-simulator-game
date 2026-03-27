'use client'

import { useMemo, useState } from 'react'

type Props = { code: string }

const DHONI_FACTS = [
  'MS Dhoni won all three ICC white-ball trophies as India captain.',
  'Dhoni finished the 2011 World Cup final with an iconic title-winning six.',
  'He transformed calm finishing into an IPL-era competitive advantage.',
  'Dhoni built CSK into one of the most consistent T20 franchises ever.',
  'Thala is known for taking games deep and still controlling the finish.',
  'Dhoni\'s wicketkeeping speed and decision-making changed T20 standards.',
  'Few captains matched Dhoni\'s record for composure under scoreboard pressure.'
]

function getDhoniFact(code: string) {
  const seed = code.split('').reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0)
  return DHONI_FACTS[seed % DHONI_FACTS.length]
}

export function RoomCodeDisplay({ code }: Props) {
  const [copied, setCopied] = useState(false)
  const fact = useMemo(() => getDhoniFact(code), [code])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="room-code-card">
      <div className="rc-label">Room Code</div>
      <div className="rc-thala text-gold font-display text-lg tracking-[0.18em] uppercase">Thala for a reason</div>
      <div className="rc-code-wrap">
        <div className="rc-code">{code}</div>
        <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      <div className="mt-4 rounded-xl border border-[rgba(245,197,24,0.25)] bg-[rgba(245,197,24,0.08)] px-4 py-3">
        <div className="text-[0.65rem] font-mono uppercase tracking-[0.24em] text-gold">Dhoni Fact</div>
        <p className="mt-2 text-sm text-secondary">{fact}</p>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 10 }}>Share this code with friends</p>
    </div>
  )
}

export default RoomCodeDisplay
