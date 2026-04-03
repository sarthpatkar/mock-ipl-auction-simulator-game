'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageNavbar } from '@/components/shared/PageNavbar'
import { UnofficialDisclaimer } from '@/components/shared/UnofficialDisclaimer'
import {
  createRoomWithAdmin,
  DEFAULT_ROOM_SETTINGS,
  LEGENDS_AUCTION_DEFAULT_SETTINGS,
  MATCH_AUCTION_DEFAULT_SETTINGS
} from '@/lib/room-client'
import { AuctionModeSelector } from '@/components/home/AuctionModeSelector'
import { MatchAuctionFields } from '@/components/home/MatchAuctionFields'
import { fetchAvailableMatches } from '@/lib/match-client'
import { LEGENDS_AUCTION_MODE, MATCH_AUCTION_MODE, MATCH_ROOM_BUDGET_OPTIONS, MATCH_ROOM_SQUAD_OPTIONS } from '@/lib/match-auction'
import { AuctionMode, Match } from '@/types'

export default function CreateRoomPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [teamName, setTeamName] = useState('')
  const [auctionMode, setAuctionMode] = useState<AuctionMode>('full_auction')
  const [matches, setMatches] = useState<Match[]>([])
  const [matchesLoading, setMatchesLoading] = useState(false)
  const [matchesError, setMatchesError] = useState<string | null>(null)
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [budget, setBudget] = useState<number>(MATCH_ROOM_BUDGET_OPTIONS[0])
  const [squadSize, setSquadSize] = useState<number>(MATCH_ROOM_SQUAD_OPTIONS[0])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (auctionMode !== MATCH_AUCTION_MODE) return

    let active = true
    setMatchesLoading(true)
    setMatchesError(null)

    void fetchAvailableMatches()
      .then((available) => {
        if (!active) return
        setMatches(available)
        setSelectedMatchId((current) => current || available[0]?.id || '')
      })
      .catch((loadError) => {
        if (!active) return
        setMatchesError(loadError instanceof Error ? loadError.message : 'Failed to load upcoming matches')
      })
      .finally(() => {
        if (active) setMatchesLoading(false)
      })

    return () => {
      active = false
    }
  }, [auctionMode])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    setLoading(true)

    try {
      const isMatchAuction = auctionMode === MATCH_AUCTION_MODE
      const isLegendsAuction = auctionMode === LEGENDS_AUCTION_MODE
      const settings = isMatchAuction
        ? {
            ...MATCH_AUCTION_DEFAULT_SETTINGS,
            budget,
            squad_size: squadSize
          }
        : isLegendsAuction
          ? LEGENDS_AUCTION_DEFAULT_SETTINGS
          : DEFAULT_ROOM_SETTINGS

      const result = await createRoomWithAdmin(name, teamName, {
        auctionMode,
        matchId: isMatchAuction ? selectedMatchId : null,
        settings
      })
      router.push(`/room/${result.room_id}/lobby`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create room')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="screen page-with-navbar form-page">
      <PageNavbar subtitle="CREATE ROOM" showHome />
      <main className="themed-form-page">
        <div className="themed-form-shell">
          <h1 className="themed-form-title">Create Room</h1>
          <UnofficialDisclaimer compact className="themed-form-disclaimer" />
          <form onSubmit={handleCreate} className="card themed-form-card">
            <AuctionModeSelector value={auctionMode} onChange={setAuctionMode} />
            <label className="input-group">
              <span className="input-label">Room name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="input-field"
            />
          </label>
            <label className="input-group">
              <span className="input-label">Your team name</span>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              required
              className="input-field"
            />
          </label>
            {auctionMode === MATCH_AUCTION_MODE && (
              <MatchAuctionFields
                matches={matches}
                loading={matchesLoading}
                error={matchesError}
                selectedMatchId={selectedMatchId}
                onSelectedMatchIdChange={setSelectedMatchId}
              />
            )}
            {error && <p className="text-red text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
              className="btn btn-primary btn-lg w-full"
          >
            {loading ? 'Creating…' : 'Create Room'}
          </button>
          </form>
        </div>
      </main>
    </div>
  )
}
