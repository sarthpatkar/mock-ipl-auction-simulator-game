'use client'

import { Match } from '@/types'

type Props = {
  matches: Match[]
  loading: boolean
  error?: string | null
  selectedMatchId: string
  onSelectedMatchIdChange: (value: string) => void
}

export function MatchAuctionFields({
  matches,
  loading,
  error = null,
  selectedMatchId,
  onSelectedMatchIdChange
}: Props) {
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? null

  return (
    <>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <span className="status-label">Quick mode</span>
        <p className="text-muted text-sm" style={{ marginTop: 6 }}>
          1v1 quick auction mode using players from one upcoming match only.
        </p>
      </div>

      <div className="input-group">
        <label className="input-label">Upcoming Match</label>
        <select className="input-field" value={selectedMatchId} onChange={(event) => onSelectedMatchIdChange(event.target.value)} disabled={loading}>
          <option value="">{loading ? 'Loading matches…' : 'Select a match'}</option>
          {matches.map((match) => (
            <option key={match.id} value={match.id}>
              {match.team_a_code} vs {match.team_b_code} · {new Date(match.match_date).toLocaleString()}
            </option>
          ))}
        </select>
        {error && <p className="text-red text-sm mt-2">{error}</p>}
        {selectedMatch && (
          <p className="text-secondary text-sm mt-2">
            {selectedMatch.team_a_name} vs {selectedMatch.team_b_name} · {selectedMatch.venue || 'Venue TBD'} ·{' '}
            {selectedMatch.eligible_player_count ?? 0} eligible players
          </p>
        )}
      </div>
    </>
  )
}

export default MatchAuctionFields
