'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRoom } from '@/hooks/useRoom'
import { useTimer } from '@/hooks/useTimer'
import { fetchPlayersByIds, SUMMARY_PLAYER_COLUMNS } from '@/lib/player-catalog'
import { PageNavbar } from '@/components/shared/PageNavbar'
import { useForcedTheme } from '@/components/theme/ThemeProvider'
import { getBrowserSessionUser, supabaseClient } from '@/lib/supabase'
import { Player } from '@/types'

export default function AcceleratedRoundPage() {
  useForcedTheme('dark')

  const params = useParams()
  const roomId = params?.roomId as string
  const router = useRouter()
  const { room, participants, loading: roomLoading, error: roomError } = useRoom(roomId)
  const [userId, setUserId] = useState<string | null>(null)
  const [auctionId, setAuctionId] = useState<string | null>(null)
  const [selectionEndsAt, setSelectionEndsAt] = useState<string | null>(null)
  const [sourcePlayers, setSourcePlayers] = useState<Player[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const me = useMemo(() => participants.find((participant) => participant.user_id === userId), [participants, userId])
  const submittedCount = useMemo(
    () => participants.filter((participant) => participant.accelerated_round_submitted_at).length,
    [participants]
  )
  const allSubmitted = participants.length > 0 && submittedCount === participants.length
  const filteredPlayers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return sourcePlayers

    return sourcePlayers.filter((player) =>
      [player.name, player.team_code, player.role, player.base_price_label].some((value) => value?.toLowerCase().includes(query))
    )
  }, [searchQuery, sourcePlayers])

  const hydrateSelection = useCallback(async () => {
    if (!roomId) return

    const { data: auction } = await supabaseClient
      .from('auction_sessions')
      .select('id, selection_ends_at, accelerated_source_players')
      .eq('room_id', roomId)
      .maybeSingle()

    if (!auction) return

    setAuctionId(auction.id)
    setSelectionEndsAt(auction.selection_ends_at)

    const sourceIds = (auction.accelerated_source_players as string[] | null) ?? []
    if (sourceIds.length === 0) {
      setSourcePlayers([])
      setSelectedIds([])
      return
    }

    const players = await fetchPlayersByIds(sourceIds, SUMMARY_PLAYER_COLUMNS)
    if (players) {
      const order = new Map(sourceIds.map((id, index) => [id, index]))
      const ordered = Object.values(players).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      setSourcePlayers(ordered)
    }

    if (me?.id) {
      const { data: selections } = await supabaseClient
        .from('accelerated_round_selections')
        .select('player_id')
        .eq('room_id', roomId)
        .eq('participant_id', me.id)
      if (selections) {
        setSelectedIds(selections.map((selection) => selection.player_id))
      }
    }
  }, [me?.id, roomId])

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
    if (room.status === 'auction') {
      router.push(`/room/${room.id}/auction`)
    } else if (room.status === 'completed') {
      router.push(`/room/${room.id}/results`)
    } else if (room.status === 'lobby') {
      router.push(`/room/${room.id}/lobby`)
    }
  }, [room, router])

  useEffect(() => {
    void hydrateSelection()
  }, [hydrateSelection])

  const finalizeSelection = useCallback(async () => {
    if (!roomId || finalizing) return
    setFinalizing(true)
    const { data, error } = await supabaseClient.rpc('finalize_accelerated_selection', { p_room_id: roomId })
    if (error) {
      setMessage(error.message)
      setFinalizing(false)
      return
    }

    if (data?.success === false) {
      setMessage(data.error || 'Failed to finalize accelerated round')
      setFinalizing(false)
      return
    }

    if (data?.result === 'waiting') {
      setFinalizing(false)
      return
    }

    if (data?.result === 'completed') {
      router.push(`/room/${roomId}/results`)
      return
    }

    router.push(`/room/${roomId}/auction`)
  }, [finalizing, roomId, router])

  const { remaining } = useTimer(selectionEndsAt, async () => {
    await finalizeSelection()
  })

  useEffect(() => {
    if (allSubmitted) {
      void finalizeSelection()
    }
  }, [allSubmitted, finalizeSelection])

  const togglePlayer = (playerId: string) => {
    setSelectedIds((prev) => (prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]))
  }

  const submitSelection = async () => {
    if (!roomId || !me) return
    setSaving(true)
    setMessage(null)
    const { data, error } = await supabaseClient.rpc('submit_accelerated_selection', {
      p_room_id: roomId,
      p_participant_id: me.id,
      p_player_ids: selectedIds
    })

    if (error) {
      setMessage(error.message)
    } else if (data?.success === false) {
      setMessage(data.error || 'Failed to submit selection')
    } else {
      setMessage('Selection submitted')
      await hydrateSelection()
    }
    setSaving(false)
  }

  return (
    <div className="screen accelerated-page page-with-navbar">
      <PageNavbar
        subtitle="ACCELERATED ROUND"
        showHome
        showThemeToggle={false}
        actions={
          <>
            <div className="badge badge-gold">{submittedCount}/{participants.length || 0} submitted</div>
            <div className="badge badge-blue">{remaining}s left</div>
          </>
        }
      />

      <div className="accelerated-shell">
        {roomError && (
          <div className="card live-banner is-warning">
            <div>
              <span className="status-label">Room sync</span>
              <p className="live-banner-copy">{roomError}</p>
            </div>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void hydrateSelection()}>
              Retry
            </button>
          </div>
        )}
        <div className="card accelerated-hero">
          <p className="text-gold text-xs font-mono uppercase tracking-[0.24em]">Round 2</p>
          <h1 className="text-4xl font-display">Accelerated Round</h1>
          <p className="text-secondary mt-3">
            Select any eligible Round 1 player for Round 2. The pool includes all unsold and not-yet-auctioned Round 1 players, excluding sold players.
          </p>
        </div>

        <div className="accelerated-layout">
          <div className="card accelerated-grid">
            <div className="accelerated-grid-toolbar">
              <div className="accelerated-grid-heading">
                <h2 className="section-title">Round 2 Player Pool</h2>
                <p className="text-sm text-muted">
                  {searchQuery ? `${filteredPlayers.length} of ${sourcePlayers.length} players shown` : `${sourcePlayers.length} eligible players`}
                </p>
              </div>
              <div className="accelerated-grid-actions">
                <span className="text-sm text-muted">{selectedIds.length} selected</span>
                <label className="accelerated-search">
                  <span className="sr-only">Search players</span>
                  <input
                    type="search"
                    className="input-field accelerated-search-input"
                    placeholder="Search by name, team, role, or base price"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="accelerated-player-list">
              {roomLoading && sourcePlayers.length === 0 && (
                <>
                  <div className="accelerated-player skeleton-card skeleton-block-sm" />
                  <div className="accelerated-player skeleton-card skeleton-block-sm" />
                  <div className="accelerated-player skeleton-card skeleton-block-sm" />
                </>
              )}
              {filteredPlayers.map((player) => {
                const selected = selectedIds.includes(player.id)
                return (
                  <button
                    key={player.id}
                    type="button"
                    className={`accelerated-player ${selected ? 'selected' : ''}`}
                    onClick={() => togglePlayer(player.id)}
                  >
                    <div>
                      <div className="font-semibold">{player.name}</div>
                      <div className="text-xs text-muted">
                        {player.team_code || 'FA'} · {player.role} · {player.base_price_label || '—'}
                      </div>
                    </div>
                    <div className={`badge ${selected ? 'badge-gold' : 'badge-gray'}`}>{selected ? 'Selected' : 'Add'}</div>
                  </button>
                )
              })}
              {sourcePlayers.length === 0 && <div className="text-sm text-muted">No eligible players are available for Accelerated Round.</div>}
              {sourcePlayers.length > 0 && filteredPlayers.length === 0 && (
                <div className="text-sm text-muted">No players match your search.</div>
              )}
            </div>
          </div>

          <div className="card accelerated-sidebar">
            <h3 className="section-title">Submission Status</h3>
            <div className="accelerated-status-list">
              {participants.map((participant) => (
                <div key={participant.id} className="accelerated-status-row">
                  <div>
                    <div className="font-semibold">{participant.team_name}</div>
                    <div className="text-xs text-muted">{participant.profiles?.username || 'Franchise Owner'}</div>
                  </div>
                  <span
                    className={`badge ${participant.accelerated_round_submitted_at ? 'badge-green' : 'badge-gray'}`}
                  >
                    {participant.accelerated_round_submitted_at ? 'Submitted' : 'Pending'}
                  </span>
                </div>
              ))}
            </div>

            <button className="btn btn-primary w-full mt-5" type="button" onClick={submitSelection} disabled={saving || !me}>
              {saving ? 'Submitting…' : 'Confirm Selection'}
            </button>
            <button className="btn btn-ghost w-full mt-3" type="button" onClick={() => void finalizeSelection()} disabled={finalizing}>
              {finalizing ? 'Finalizing…' : 'Check Round Status'}
            </button>
            {message && <p className="text-sm text-secondary mt-3">{message}</p>}
            {auctionId && <p className="text-xs text-muted mt-4">Auction Session: {auctionId.slice(0, 8)}…</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
