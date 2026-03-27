'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PageNavbar } from '@/components/shared/PageNavbar'
import { ResultsRevealHold } from '@/components/results/ResultsRevealHold'
import { RoomResultsBoard } from '@/components/results/RoomResultsBoard'
import { useRoom } from '@/hooks/useRoom'
import { useTimer } from '@/hooks/useTimer'
import { fetchPlayersByIds, RESULTS_PLAYER_COLUMNS } from '@/lib/player-catalog'
import { getBrowserSessionUser, supabaseClient } from '@/lib/supabase'
import { Player, SquadPlayer, TeamResult } from '@/types'

const RESULTS_SELECT = 'room_id, user_id, team_score, rank, breakdown_json, created_at, updated_at'
const SQUAD_SELECT = 'id, room_id, participant_id, player_id, price_paid, acquired_at'

export default function ResultsPage() {
  const params = useParams()
  const roomId = params?.roomId as string
  const router = useRouter()
  const { room, participants, loading: roomLoading, error: roomError } = useRoom(roomId)
  const [userId, setUserId] = useState<string | null>(null)
  const [results, setResults] = useState<TeamResult[]>([])
  const [squads, setSquads] = useState<SquadPlayer[]>([])
  const [playersById, setPlayersById] = useState<Record<string, Player>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const revealAt = room?.results_reveal_at ?? null
  const { remaining: revealRemaining } = useTimer(revealAt)

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
  }, [room?.status, roomId])

  const pageError = useMemo(() => error ?? roomError, [error, roomError])
  const isPreReveal = room?.status === 'completed' && Boolean(revealAt) && revealRemaining > 0
  const isPageBooting = roomLoading || room?.status !== 'completed'
  const isResultsLoading = loading

  return (
    <div className="screen page-with-navbar results-page">
      <PageNavbar subtitle="RESULTS" showHome />
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
        ) : isPreReveal ? (
          <ResultsRevealHold revealAt={revealAt!} remaining={revealRemaining} participants={participants} squads={squads} playersById={playersById} />
        ) : isResultsLoading ? (
          <section className="results-loading-shell">
            <div className="card skeleton-card results-loading-hero" />
            <div className="card skeleton-card results-loading-bar" />
            <div className="card skeleton-card results-loading-card" />
            <div className="card skeleton-card results-loading-card" />
          </section>
        ) : (
          <RoomResultsBoard participants={participants} results={results} squads={squads} playersById={playersById} currentUserId={userId} />
        )}
      </main>
    </div>
  )
}
