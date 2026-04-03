'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PageNavbar } from '@/components/shared/PageNavbar'
import { UnofficialDisclaimer } from '@/components/shared/UnofficialDisclaimer'
import { MatchAuctionResultsExperience } from '@/components/results/MatchAuctionResultsExperience'
import { ResultsExperience } from '@/components/results/ResultsExperience'
import { ResultsRevealHold } from '@/components/results/ResultsRevealHold'
import { useForcedTheme } from '@/components/theme/ThemeProvider'
import { useRoom } from '@/hooks/useRoom'
import { useTimer } from '@/hooks/useTimer'
import { MATCH_AUCTION_MODE } from '@/lib/match-auction'
import { fetchPlayersByIds, RESULTS_PLAYER_COLUMNS } from '@/lib/player-catalog'
import { getBrowserSessionUser, supabaseClient } from '@/lib/supabase'
import { Match, MatchAuctionResult, MatchPlayerStat, Player, SquadPlayer, TeamResult } from '@/types'

const RESULTS_SELECT = 'room_id, user_id, team_score, rank, breakdown_json, created_at, updated_at'
const MATCH_RESULTS_SELECT =
  'room_id, user_id, projected_score, actual_score, result_status, rank, winner_user_id, last_updated_at, last_result_updated_at, published_stats_version'
const MATCH_PLAYER_STATS_SELECT = 'match_id, player_id, player_name_snapshot, source_player_name, team_code, fantasy_points, updated_at'
const SQUAD_SELECT = 'id, room_id, participant_id, player_id, price_paid, acquired_at'
const LOCAL_REVEAL_GRACE_MS = 1500
const REVEAL_HOLD_SECONDS = 90
const TRANSIENT_ROOM_REALTIME_ERROR = 'Realtime connection lost. Reconnecting…'

export default function ResultsPage() {
  useForcedTheme('dark')

  const params = useParams()
  const roomId = params?.roomId as string
  const router = useRouter()
  const { room, participants, loading: roomLoading, error: roomError } = useRoom(roomId, { includeRemoved: true })
  const [userId, setUserId] = useState<string | null>(null)
  const [results, setResults] = useState<TeamResult[]>([])
  const [matchResults, setMatchResults] = useState<MatchAuctionResult[]>([])
  const [matchPlayerStats, setMatchPlayerStats] = useState<MatchPlayerStat[]>([])
  const [squads, setSquads] = useState<SquadPlayer[]>([])
  const [playersById, setPlayersById] = useState<Record<string, Player>>({})
  const [match, setMatch] = useState<Match | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRevealAnimating, setIsRevealAnimating] = useState(false)
  const revealAt = room?.results_reveal_at ?? null
  const isMatchAuction = room?.auction_mode === MATCH_AUCTION_MODE
  const effectiveRevealAt = useMemo(() => {
    if (revealAt) return revealAt
    if (room?.status !== 'completed' || results.length === 0) return null

    const latestResultTimestamp = results.reduce((latest, result) => {
      const candidate = new Date(result.updated_at ?? result.created_at).getTime()
      return Number.isFinite(candidate) && candidate > latest ? candidate : latest
    }, 0)

    if (latestResultTimestamp <= 0) return null
    return new Date(latestResultTimestamp + REVEAL_HOLD_SECONDS * 1000).toISOString()
  }, [results, revealAt, room?.status])
  const { remaining: revealRemaining } = useTimer(effectiveRevealAt)

  useEffect(() => {
    getBrowserSessionUser().then((currentUser) => {
      if (!currentUser) {
        router.push('/auth/login')
        return
      }
      setUserId(currentUser.id)
    })
  }, [router])

  useEffect(() => {
    if (!room) return
    if (room.status === 'accelerated_selection') {
      router.push(`/room/${room.id}/accelerated`)
      return
    }
    if (room.status === 'auction') {
      router.push(`/room/${room.id}/auction`)
      return
    }
    if (room.status === 'lobby') {
      router.push(`/room/${room.id}/lobby`)
    }
  }, [room, router])

  useEffect(() => {
    if (!roomId || room?.status !== 'completed') return

    let cancelled = false

    const hydrate = async () => {
      setLoading(true)
      setError(null)

      try {
        if (room?.auction_mode === MATCH_AUCTION_MODE) {
          const [
            { data: matchResultRows, error: matchResultsError },
            { data: squadRows, error: squadError },
            { data: projectedResultRows, error: projectedResultsError },
            { data: matchRow, error: matchError },
            { data: matchPlayerStatRows, error: matchPlayerStatsError }
          ] = await Promise.all([
            supabaseClient.from('match_auction_results').select(MATCH_RESULTS_SELECT).eq('room_id', roomId).order('rank', { ascending: true }),
            supabaseClient.from('squad_players').select(SQUAD_SELECT).eq('room_id', roomId),
            supabaseClient.from('team_results').select(RESULTS_SELECT).eq('room_id', roomId).order('rank', { ascending: true }),
            room.match_id
              ? supabaseClient
                  .from('matches')
                  .select('id, season, match_slug, team_a_code, team_b_code, team_a_name, team_b_name, match_date, venue, status, external_match_id, auction_enabled, last_scorecard_upload_at')
                  .eq('id', room.match_id)
                  .maybeSingle()
              : Promise.resolve({ data: null, error: null }),
            room.match_id
              ? supabaseClient.from('match_player_stats').select(MATCH_PLAYER_STATS_SELECT).eq('match_id', room.match_id)
              : Promise.resolve({ data: null, error: null })
          ])

          if (matchResultsError) throw matchResultsError
          if (squadError) throw squadError
          if (projectedResultsError) throw projectedResultsError
          if (matchError) throw matchError
          if (matchPlayerStatsError) throw matchPlayerStatsError

          let finalMatchResults = (matchResultRows as MatchAuctionResult[] | null) ?? []
          let finalProjectedResults = ((projectedResultRows as TeamResult[] | null) ?? []).map((row) => ({
            ...row,
            team_score: Number(row.team_score),
            rank: Number(row.rank)
          }))

          if (finalProjectedResults.length === 0) {
            const { error: ensureProjectedError } = await supabaseClient.rpc('ensure_room_results', { p_room_id: roomId })
            if (ensureProjectedError) throw ensureProjectedError

            const { data: ensuredProjectedRows, error: ensuredProjectedResultsError } = await supabaseClient
              .from('team_results')
              .select(RESULTS_SELECT)
              .eq('room_id', roomId)
              .order('rank', { ascending: true })

            if (ensuredProjectedResultsError) throw ensuredProjectedResultsError
            finalProjectedResults = ((ensuredProjectedRows as TeamResult[] | null) ?? []).map((row) => ({
              ...row,
              team_score: Number(row.team_score),
              rank: Number(row.rank)
            }))
          }

          if (finalMatchResults.length === 0) {
            const { error: ensureMatchResultsError } = await supabaseClient.rpc('refresh_match_auction_provisional_results', { p_room_id: roomId })
            if (ensureMatchResultsError) throw ensureMatchResultsError
            const { data: ensuredRows, error: ensuredError } = await supabaseClient
              .from('match_auction_results')
              .select(MATCH_RESULTS_SELECT)
              .eq('room_id', roomId)
              .order('rank', { ascending: true })

            if (ensuredError) throw ensuredError
            finalMatchResults = (ensuredRows as MatchAuctionResult[] | null) ?? []
          }

          const finalSquads = (squadRows as SquadPlayer[] | null) ?? []
          const playerIds = [...new Set(finalSquads.map((row) => row.player_id))]
          const players = await fetchPlayersByIds(playerIds, RESULTS_PLAYER_COLUMNS)

          if (cancelled) return

          setMatchResults(
            finalMatchResults.map((row) => ({
              ...row,
              projected_score: Number(row.projected_score),
              actual_score: row.actual_score == null ? null : Number(row.actual_score),
              rank: row.rank == null ? null : Number(row.rank),
              published_stats_version: row.published_stats_version == null ? null : Number(row.published_stats_version)
            }))
          )
          setMatch((matchRow as Match | null) ?? null)
          setResults(finalProjectedResults)
          setMatchPlayerStats(
            ((matchPlayerStatRows as MatchPlayerStat[] | null) ?? []).map((row) => ({
              ...row,
              fantasy_points: Number(row.fantasy_points)
            }))
          )
          setSquads(finalSquads)
          setPlayersById(players as Record<string, Player>)
          return
        }

        const [{ data: initialResults, error: initialResultsError }, { data: squadRows, error: squadError }] = await Promise.all([
          supabaseClient.from('team_results').select(RESULTS_SELECT).eq('room_id', roomId).order('rank', { ascending: true }),
          supabaseClient.from('squad_players').select(SQUAD_SELECT).eq('room_id', roomId)
        ])

        if (initialResultsError) throw initialResultsError
        if (squadError) throw squadError

        let finalResults = ((initialResults as TeamResult[] | null) ?? []).map((row) => ({
          ...row,
          team_score: Number(row.team_score),
          rank: Number(row.rank)
        }))

        if (finalResults.length === 0) {
          const { error: ensureError } = await supabaseClient.rpc('ensure_room_results', { p_room_id: roomId })
          if (ensureError) throw ensureError

          const { data: ensuredResults, error: ensuredResultsError } = await supabaseClient
            .from('team_results')
            .select(RESULTS_SELECT)
            .eq('room_id', roomId)
            .order('rank', { ascending: true })

          if (ensuredResultsError) throw ensuredResultsError
          finalResults = ((ensuredResults as TeamResult[] | null) ?? []).map((row) => ({
            ...row,
            team_score: Number(row.team_score),
            rank: Number(row.rank)
          }))
        }

        const finalSquads = (squadRows as SquadPlayer[] | null) ?? []
        const playerIds = [...new Set(finalSquads.map((row) => row.player_id))]
        const players = await fetchPlayersByIds(playerIds, RESULTS_PLAYER_COLUMNS)

        if (cancelled) return

        setResults(finalResults)
        setMatchResults([])
        setMatchPlayerStats([])
        setSquads(finalSquads)
        setPlayersById(players as Record<string, Player>)
      } catch (hydrateError) {
        if (cancelled) return
        setError(hydrateError instanceof Error ? hydrateError.message : 'Failed to load room results')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void hydrate()

    return () => {
      cancelled = true
    }
  }, [room?.auction_mode, room?.match_id, room?.status, roomId])

  useEffect(() => {
    if (!effectiveRevealAt || room?.status !== 'completed') {
      setIsRevealAnimating(false)
      return
    }

    const revealDeltaMs = Date.now() - new Date(effectiveRevealAt).getTime()
    if (revealDeltaMs < 0 || revealDeltaMs >= LOCAL_REVEAL_GRACE_MS) {
      setIsRevealAnimating(false)
      return
    }

    setIsRevealAnimating(true)

    const timeout = window.setTimeout(() => {
      setIsRevealAnimating(false)
    }, LOCAL_REVEAL_GRACE_MS - revealDeltaMs)

    return () => window.clearTimeout(timeout)
  }, [effectiveRevealAt, revealRemaining, room?.status])

  const shouldSuppressRoomError =
    !error &&
    room?.status === 'completed' &&
    roomError === TRANSIENT_ROOM_REALTIME_ERROR &&
    (results.length > 0 || matchResults.length > 0)
  const pageError = useMemo(() => error ?? (shouldSuppressRoomError ? null : roomError), [error, roomError, shouldSuppressRoomError])
  const isPreReveal = room?.status === 'completed' && Boolean(effectiveRevealAt) && (revealRemaining > 0 || isRevealAnimating)
  const isPageBooting = roomLoading || room?.status !== 'completed'
  const isResultsLoading = loading

  return (
    <div className="screen page-with-navbar results-page">
      <PageNavbar subtitle="RESULTS" showHome showThemeToggle={false} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12">
        {pageError && (
          <div className="card live-banner is-warning">
            <div>
              <span className="status-label">Results Load</span>
              <p className="live-banner-copy">{pageError}</p>
            </div>
          </div>
        )}

        {isPageBooting ? (
          <section className="results-loading-shell">
            <div className="card skeleton-card results-loading-hero" />
            <div className="card skeleton-card results-loading-bar" />
            <div className="card skeleton-card results-loading-card" />
            <div className="card skeleton-card results-loading-card" />
          </section>
        ) : isMatchAuction ? (
          <MatchAuctionResultsExperience
            room={room!}
            match={match}
            participants={participants}
            projectedResults={results}
            matchResults={matchResults}
            matchPlayerStats={matchPlayerStats}
            squads={squads}
            playersById={playersById}
            currentUserId={userId}
          />
        ) : isPreReveal ? (
          <ResultsRevealHold
            revealAt={effectiveRevealAt!}
            remaining={revealRemaining}
            participants={participants}
            results={results}
            squads={squads}
            playersById={playersById}
            revealPhase={revealRemaining > 0 ? 'projection' : 'revealing'}
          />
        ) : isResultsLoading ? (
          <section className="results-loading-shell">
            <div className="card skeleton-card results-loading-hero" />
            <div className="card skeleton-card results-loading-bar" />
            <div className="card skeleton-card results-loading-card" />
            <div className="card skeleton-card results-loading-card" />
          </section>
        ) : (
          <ResultsExperience room={room!} participants={participants} results={results} squads={squads} playersById={playersById} currentUserId={userId} />
        )}

        <UnofficialDisclaimer compact />
      </main>
    </div>
  )
}
