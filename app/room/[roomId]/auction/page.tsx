'use client'

import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuction } from '@/hooks/useAuction'
import { useTimer } from '@/hooks/useTimer'
import { AUCTION_PLAYER_COLUMNS, fetchPlayerCatalog, fetchPlayersByTeamCodes } from '@/lib/player-catalog'
import { LEGENDS_AUCTION_MODE, LEGENDS_PLAYER_POOL, MATCH_AUCTION_MODE, SEASON_PLAYER_POOL } from '@/lib/match-auction'
import { realtimeFeatureFlags } from '@/lib/realtime-flags'
import { getBrowserSessionUser, supabaseClient } from '@/lib/supabase'
import { Player, RoomParticipant } from '@/types'
import { PlayerCard } from '@/components/auction/PlayerCard'
import { BidBar } from '@/components/auction/BidBar'
import { BidActions } from '@/components/auction/BidActions'
import { TimerRing } from '@/components/auction/TimerRing'
import { TeamView } from '@/components/auction/TeamView'
import { SoldModal } from '@/components/auction/SoldModal'
import { AdminControls } from '@/components/auction/AdminControls'
import { MobileAuctionLayout } from '@/components/auction/MobileAuctionLayout'
import { AuctionRoomChat } from '@/components/auction/AuctionRoomChat'
import { PageNavbar } from '@/components/shared/PageNavbar'
import { useForcedTheme } from '@/components/theme/ThemeProvider'
import { formatAuctionStatus, formatPrice, formatRolePlural, getTeamThemeStyle } from '@/lib/auction-helpers'

const SOUND_STORAGE_KEY = 'auction:sound-enabled'
const HIGH_BID_ALERT_THRESHOLD = 15 * 10_000_000
const MARQUEE_BID_SONG_THRESHOLD = 25 * 10_000_000
const CRON_BACKUP_FINALIZE_DELAY_MS = 1200
const CRON_BACKUP_ADVANCE_DELAY_MS = 2000

function buildFinalizeIdempotencyKey(auctionSessionId: string, playerId: string, endsAt: string) {
  return `client-finalize:${auctionSessionId}:${playerId}:${new Date(endsAt).getTime()}`
}

function buildAdvanceIdempotencyKey(auctionSessionId: string, resolutionKey: string) {
  return `client-advance:${auctionSessionId}:${resolutionKey}`
}

function isResolvedAuctionResult(value: unknown): value is 'sold' | 'unsold' {
  return value === 'sold' || value === 'unsold'
}

function isSuccessfulRpcResult(value: unknown) {
  return !(value && typeof value === 'object' && 'success' in value && value.success === false)
}

function playTone(enabled: boolean, frequency: number, duration: number, type: OscillatorType) {
  if (!enabled || typeof window === 'undefined' || !('AudioContext' in window)) return

  const context = new window.AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()

  oscillator.type = type
  oscillator.frequency.value = frequency
  gain.gain.value = 0.015

  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + duration)
  oscillator.onended = () => void context.close()
}

export default function AuctionPage() {
  useForcedTheme('dark')

  const params = useParams()
  const roomId = params?.roomId as string
  const router = useRouter()
  const [playersById, setPlayersById] = useState<Record<string, Player>>({})
  const [user, setUser] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [playersLoading, setPlayersLoading] = useState(true)
  const [playersError, setPlayersError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ visible: boolean; type: 'sold' | 'unsold' }>({
    visible: false,
    type: 'unsold'
  })
  const [actionBarStyle, setActionBarStyle] = useState<CSSProperties | undefined>(undefined)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isTablet, setIsTablet] = useState(false)
  const [tabletMenuOpen, setTabletMenuOpen] = useState(false)
  const [showStageScrollCue, setShowStageScrollCue] = useState(false)
  const [sessionProgressIds, setSessionProgressIds] = useState<{ completedPlayers: string[]; playerQueue: string[] }>({
    completedPlayers: [],
    playerQueue: []
  })
  const lastBidIdRef = useRef<string | null>(null)
  const lastTickRef = useRef<number | null>(null)
  const previousPriceRef = useRef<number | null>(null)
  const trackedPlayerKeyRef = useRef<string | null>(null)
  const alertedPlayerKeyRef = useRef<string | null>(null)
  const highBidAlertAudioRef = useRef<HTMLAudioElement | null>(null)
  const marqueeBidSongAudioRef = useRef<HTMLAudioElement | null>(null)
  const marqueeBidSongPlayerKeyRef = useRef<string | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)

  const stopMarqueeBidSong = () => {
    const audio = marqueeBidSongAudioRef.current
    if (!audio) return

    audio.pause()
    audio.currentTime = 0
  }

  useEffect(() => {
    let active = true

    getBrowserSessionUser().then((currentUser) => {
      if (!active) return
      if (!currentUser) {
        router.push('/auth/login')
        return
      }
      setUser(currentUser.id)
      setAuthLoading(false)
    })

    return () => {
      active = false
    }
  }, [router])

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      setSoundEnabled(window.localStorage.getItem(SOUND_STORAGE_KEY) === '1')
    } catch {
      setSoundEnabled(false)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mobileMedia = window.matchMedia('(max-width: 640px)')
    const tabletMedia = window.matchMedia('(min-width: 641px) and (max-width: 1024px)')
    const sync = () => {
      setIsMobile(mobileMedia.matches)
      setIsTablet(tabletMedia.matches)
    }

    sync()
    mobileMedia.addEventListener('change', sync)
    tabletMedia.addEventListener('change', sync)
    return () => {
      mobileMedia.removeEventListener('change', sync)
      tabletMedia.removeEventListener('change', sync)
    }
  }, [])

  useEffect(() => {
    if (isMobile) {
      setTabletMenuOpen(false)
    }
  }, [isMobile])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const audio = new Audio('/high-bid-alert.mp3')
    audio.preload = 'auto'
    highBidAlertAudioRef.current = audio

    return () => {
      audio.pause()
      audio.src = ''
      highBidAlertAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const audio = new Audio('/marquee-bid-song.mp3')
    audio.preload = 'auto'
    audio.loop = false
    marqueeBidSongAudioRef.current = audio

    return () => {
      audio.pause()
      audio.src = ''
      marqueeBidSongAudioRef.current = null
    }
  }, [])

  const {
    room,
    auction,
    bidHistory,
    participants,
    squads,
    refetch,
    loading: auctionLoading,
    error: auctionError,
    connectionState,
    isStale
  } = useAuction(roomId)
  const screenLoading = authLoading || playersLoading || (auctionLoading && !auction)
  const screenError = playersError || auctionError
  const hasCriticalState = Boolean(screenError)
  const showLiveIssueBanner = Boolean(screenError)
  const me = useMemo(() => participants.find((participant) => participant.user_id === user), [participants, user])
  const roomAuctionMode = room?.auction_mode
  const roomMatchId = room?.match_id

  useEffect(() => {
    if (!roomAuctionMode) return

    let active = true
    setPlayersLoading(true)
    setPlayersError(null)

    void (async () => {
      try {
        if (roomAuctionMode === MATCH_AUCTION_MODE && roomMatchId) {
          const { data: matchRow, error: matchError } = await supabaseClient
            .from('matches')
            .select('id, season, match_slug, team_a_code, team_b_code, team_a_name, team_b_name, match_date, venue, status, external_match_id, auction_enabled, last_scorecard_upload_at')
            .eq('id', roomMatchId)
            .maybeSingle()

          if (matchError) throw matchError
          if (!matchRow) throw new Error('Match data is unavailable for this room')

          const typedMatch = matchRow as { team_a_code: string; team_b_code: string }
          const map = await fetchPlayersByTeamCodes([typedMatch.team_a_code, typedMatch.team_b_code], AUCTION_PLAYER_COLUMNS, { pool: SEASON_PLAYER_POOL })

          if (!active) return
          setPlayersById(map)
          return
        }

        const map = await fetchPlayerCatalog(AUCTION_PLAYER_COLUMNS, {
          pool: roomAuctionMode === LEGENDS_AUCTION_MODE ? LEGENDS_PLAYER_POOL : SEASON_PLAYER_POOL
        })
        if (!active) return
        setPlayersById(map)
      } catch (fetchError) {
        if (active) {
          setPlayersError(fetchError instanceof Error ? fetchError.message : 'Failed to load players')
        }
      } finally {
        if (active) setPlayersLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [roomAuctionMode, roomMatchId])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof window === 'undefined') return

    const syncActionBar = () => {
      if (!stageRef.current || window.innerWidth <= 1024) {
        setActionBarStyle(undefined)
        return
      }

      const rect = stageRef.current.getBoundingClientRect()
      const dockWidth = Math.min(rect.width, 760)
      setActionBarStyle({
        left: `${Math.round(rect.left)}px`,
        width: `${Math.round(dockWidth)}px`,
        transform: 'none'
      })
    }

    syncActionBar()

    const observer = new ResizeObserver(syncActionBar)
    observer.observe(stage)
    window.addEventListener('resize', syncActionBar)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncActionBar)
    }
  }, [])

  const scrollToOtherDetails = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return

    stage.scrollBy({
      top: Math.max(220, Math.round(stage.clientHeight * 0.42)),
      behavior: 'smooth'
    })
  }, [])

  useEffect(() => {
    if (isMobile || !auction || !me || typeof window === 'undefined') {
      setShowStageScrollCue(false)
      return
    }

    if (isTablet) {
      const updateScrollCue = () => {
        const root = document.documentElement
        const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight)
        const hasMoreBelow = window.scrollY < maxScroll - 16
        setShowStageScrollCue(hasMoreBelow && !tabletMenuOpen)
      }

      updateScrollCue()
      window.addEventListener('scroll', updateScrollCue, { passive: true })
      window.addEventListener('resize', updateScrollCue)

      return () => {
        window.removeEventListener('scroll', updateScrollCue)
        window.removeEventListener('resize', updateScrollCue)
      }
    }

    const stage = stageRef.current
    if (!stage) {
      setShowStageScrollCue(false)
      return
    }

    const updateScrollCue = () => {
      const shortDesktopViewport = window.innerWidth > 1025 && window.innerHeight < 687
      if (!shortDesktopViewport) {
        setShowStageScrollCue(false)
        return
      }

      const maxScroll = Math.max(0, stage.scrollHeight - stage.clientHeight)
      const hasMoreBelow = stage.scrollTop < maxScroll - 16
      setShowStageScrollCue(hasMoreBelow && !tabletMenuOpen)
    }

    updateScrollCue()

    const observer = new ResizeObserver(updateScrollCue)
    observer.observe(stage)
    stage.addEventListener('scroll', updateScrollCue, { passive: true })
    window.addEventListener('resize', updateScrollCue)

    return () => {
      observer.disconnect()
      stage.removeEventListener('scroll', updateScrollCue)
      window.removeEventListener('resize', updateScrollCue)
    }
  }, [isMobile, isTablet, tabletMenuOpen, auction, me, screenLoading])

  useEffect(() => {
    if (!room) return

    if (room.status === 'accelerated_selection') {
      router.push(`/room/${room.id}/accelerated`)
      return
    }

    if (room.status === 'completed' || auction?.status === 'completed') {
      router.push(`/room/${room.id}/results`)
      return
    }

    if (room.status === 'lobby') {
      router.push(`/room/${room.id}/lobby`)
    }
  }, [auction?.status, room, router])

  useEffect(() => {
    if (!auction) return
    if (auction.status === 'live' || auction.status === 'completed') {
      setModal((value) => (value.visible ? { ...value, visible: false } : value))
    }
  }, [auction])

  const finalizeExpiredPlayer = useCallback(async () => {
    if (!(auction?.status === 'live' && me && auction.auction_session_id && auction.current_player_id && auction.ends_at)) {
      return
    }

    const finalizeKey = buildFinalizeIdempotencyKey(auction.auction_session_id, auction.current_player_id, auction.ends_at)
    const { data, error } = await supabaseClient.rpc('finalize_player', {
      p_auction_session_id: auction.auction_session_id,
      p_idempotency_key: finalizeKey
    })

    if (error || !isSuccessfulRpcResult(data)) {
      await refetch()
      return
    }

    await refetch()
  }, [auction?.auction_session_id, auction?.current_player_id, auction?.ends_at, auction?.status, me, refetch])

  const handleExpiredAuctionTick = useCallback(async () => {
    if (realtimeFeatureFlags.cronFinalizeAdvance) {
      window.setTimeout(() => {
        void finalizeExpiredPlayer()
      }, CRON_BACKUP_FINALIZE_DELAY_MS)
      return
    }

    await finalizeExpiredPlayer()
  }, [finalizeExpiredPlayer])

  const desktopTimerEndsAt = isMobile ? null : auction?.ends_at ?? null
  const { remaining: desktopRemaining, isDanger } = useTimer(desktopTimerEndsAt, async () => {
    if (realtimeFeatureFlags.cronFinalizeAdvance) {
      window.setTimeout(() => {
        void finalizeExpiredPlayer()
      }, CRON_BACKUP_FINALIZE_DELAY_MS)
      return
    }

    await finalizeExpiredPlayer()
  })

  const currentPlayer = auction?.current_player_id ? playersById[auction.current_player_id] : null
  const completedCount = auction?.completed_count ?? 0
  const totalPlayers = auction?.queue_count ?? 0
  const pausedRemaining = useMemo(() => {
    if (!auction?.paused_remaining_ms) return 0
    return Math.max(0, Math.ceil(auction.paused_remaining_ms / 1000))
  }, [auction?.paused_remaining_ms])
  const displayedRemaining = auction?.status === 'paused' ? pausedRemaining : desktopRemaining
  const isExpired = !isMobile && auction?.status === 'live' && Boolean(desktopTimerEndsAt) && desktopRemaining <= 0
  const currentPlayerThemeStyle = useMemo(() => getTeamThemeStyle(currentPlayer?.team_code), [currentPlayer?.team_code])
  const resolutionKey = useMemo(() => {
    if (!auction || !auction.current_player_id || !['sold', 'unsold'].includes(auction.status)) return null
    return `${auction.auction_session_id}:${auction.current_player_id}:${auction.status}`
  }, [auction])
  const resolutionType = useMemo<'sold' | 'unsold' | null>(() => {
    if (!resolutionKey) return null
    return resolutionKey.endsWith(':sold') ? 'sold' : 'unsold'
  }, [resolutionKey])
  const skipTargetCount = useMemo(() => {
    if (!auction) return 0
    const activeCount = auction.active_bidders?.length || 0
    return Math.max(0, activeCount - (auction.highest_bidder_id ? 1 : 0))
  }, [auction])
  const skippedBidderIds = auction?.skipped_bidders ?? []

  const displayRoundLabel = useMemo(() => {
    if (auction?.round_number === 2) return 'Accelerated Round'
    if (!room?.settings || !currentPlayer) return auction?.round_label ?? 'Round 1'
    return room.settings.player_order === 'random' ? 'Round 1 – Random' : `Round 1 – ${formatRolePlural(currentPlayer.role)}`
  }, [auction?.round_label, auction?.round_number, currentPlayer, room?.settings])

  useEffect(() => {
    if (!auction?.auction_session_id) {
      setSessionProgressIds({ completedPlayers: [], playerQueue: [] })
      return
    }

    let cancelled = false

    void supabaseClient
      .from('auction_sessions')
      .select('completed_players, player_queue')
      .eq('id', auction.auction_session_id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error) return
        setSessionProgressIds({
          completedPlayers: (data?.completed_players as string[] | null) ?? [],
          playerQueue: (data?.player_queue as string[] | null) ?? []
        })
      })

    return () => {
      cancelled = true
    }
  }, [auction?.auction_session_id, completedCount, totalPlayers])

  const progressCount = useMemo(() => {
    if (!auction || !room?.settings) return '0/0'
    if (auction.round_number === 2) {
      return `${completedCount}/${totalPlayers}`
    }

    if (room.settings.player_order === 'random' || !currentPlayer) {
      return `${completedCount}/${totalPlayers}`
    }

    const queueIds = sessionProgressIds.playerQueue
    const completedIds = sessionProgressIds.completedPlayers

    if (queueIds.length === 0) {
      return `${completedCount}/${totalPlayers}`
    }

    const roleTotal = queueIds.reduce((count, playerId) => {
      return playersById[playerId]?.role === currentPlayer.role ? count + 1 : count
    }, 0)

    const roleCompleted = completedIds.reduce((count, playerId) => {
      return playersById[playerId]?.role === currentPlayer.role ? count + 1 : count
    }, 0)

    return `${roleCompleted}/${roleTotal || 0}`
  }, [auction, room?.settings, currentPlayer, completedCount, totalPlayers, sessionProgressIds, playersById])

  const tabletProgressLabel = useMemo(() => progressCount, [progressCount])
  const tabletBudgetLabel = useMemo(() => (me ? formatPrice(me.budget_remaining) : '—'), [me])
  const tabletSquadLabel = useMemo(() => `${me?.squad_count ?? 0} / ${room?.settings.squad_size || 20}`, [me, room?.settings.squad_size])
  const highestBidder = useMemo(
    () => participants.find((participant) => participant.id === auction?.highest_bidder_id),
    [auction?.highest_bidder_id, participants]
  )
  const allMatchAuctionSquadsFull = useMemo(() => {
    if (room?.auction_mode !== MATCH_AUCTION_MODE) return false
    if (!participants.length) return false

    return participants.every((participant) => participant.squad_count >= (room?.settings.minimum_squad_size || room?.settings.squad_size || 0))
  }, [participants, room?.auction_mode, room?.settings.minimum_squad_size, room?.settings.squad_size])

  useEffect(() => {
    if (!bidHistory.length) return
    const latestBid = bidHistory[0]
    if (!latestBid || latestBid.id === lastBidIdRef.current) return

    lastBidIdRef.current = latestBid.id
    playTone(soundEnabled, 880, 0.08, 'square')
  }, [bidHistory, soundEnabled])

  useEffect(() => {
    if (auction?.status === 'paused') return
    if (!isDanger || desktopRemaining <= 0 || desktopRemaining === lastTickRef.current) return
    lastTickRef.current = desktopRemaining
    playTone(soundEnabled, 520, 0.05, 'triangle')
  }, [auction?.status, desktopRemaining, isDanger, soundEnabled])

  useEffect(() => {
    const playerKey = auction?.current_player_id ? `${auction.auction_session_id}:${auction.current_player_id}` : null

    if (!auction || !playerKey) {
      stopMarqueeBidSong()
      previousPriceRef.current = null
      trackedPlayerKeyRef.current = null
      alertedPlayerKeyRef.current = null
      marqueeBidSongPlayerKeyRef.current = null
      return
    }

    if (trackedPlayerKeyRef.current !== playerKey) {
      stopMarqueeBidSong()
      trackedPlayerKeyRef.current = playerKey
      alertedPlayerKeyRef.current = null
      marqueeBidSongPlayerKeyRef.current = null
      previousPriceRef.current = auction?.current_price ?? 0
      return
    }

    const previousPrice = previousPriceRef.current ?? auction.current_price
    const currentPrice = auction.current_price
    const crossedThreshold = previousPrice <= HIGH_BID_ALERT_THRESHOLD && currentPrice > HIGH_BID_ALERT_THRESHOLD
    const crossedMarqueeThreshold = previousPrice <= MARQUEE_BID_SONG_THRESHOLD && currentPrice > MARQUEE_BID_SONG_THRESHOLD

    if (crossedThreshold && soundEnabled && highBidAlertAudioRef.current && alertedPlayerKeyRef.current !== playerKey) {
      highBidAlertAudioRef.current.currentTime = 0
      void highBidAlertAudioRef.current.play().catch(() => {})
      alertedPlayerKeyRef.current = playerKey
    }

    if (crossedMarqueeThreshold && marqueeBidSongAudioRef.current && marqueeBidSongPlayerKeyRef.current !== playerKey) {
      stopMarqueeBidSong()
      void marqueeBidSongAudioRef.current.play().catch(() => {})
      marqueeBidSongPlayerKeyRef.current = playerKey
    }

    previousPriceRef.current = currentPrice
  }, [auction, soundEnabled])

  useEffect(() => {
    if (auction?.status !== 'sold') return
    stopMarqueeBidSong()
  }, [auction?.status])

  useEffect(() => {
    if (!resolutionType || !auction?.auction_session_id || !user || !resolutionKey) return

    let cancelled = false
    const storageKey = `auction-resolution:${resolutionKey}`
    let alreadySeen = false

    try {
      alreadySeen = sessionStorage.getItem(storageKey) === '1'
      if (!alreadySeen) {
        sessionStorage.setItem(storageKey, '1')
      }
    } catch {
      alreadySeen = false
    }

    if (!alreadySeen) {
      setModal({ visible: true, type: resolutionType })
    } else {
      setModal((value) => (value.visible ? { ...value, visible: false } : value))
    }

    const hideTimer = !alreadySeen
      ? setTimeout(() => {
          if (!cancelled) {
            setModal((value) => (value.visible ? { ...value, visible: false } : value))
          }
        }, 2000)
      : null

    const advanceDelayMs = alreadySeen
      ? 0
      : realtimeFeatureFlags.cronFinalizeAdvance
        ? CRON_BACKUP_ADVANCE_DELAY_MS
        : 2000

    const advanceTimer = setTimeout(async () => {
      if (cancelled) return
      await supabaseClient.rpc('advance_to_next_player', {
        p_auction_session_id: auction.auction_session_id,
        p_admin_user_id: room?.admin_id || user,
        p_idempotency_key: buildAdvanceIdempotencyKey(auction.auction_session_id, resolutionKey)
      })
      await refetch()
    }, advanceDelayMs)

    return () => {
      cancelled = true
      if (advanceTimer) clearTimeout(advanceTimer)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [auction?.auction_session_id, refetch, resolutionKey, resolutionType, room?.admin_id, user])

  useEffect(() => {
    if (!auction?.auction_session_id || !user) return

    const expiredAuctionKey =
      !isMobile && auction.status === 'live' && auction.current_player_id && desktopTimerEndsAt && desktopRemaining <= 0
        ? `${auction.auction_session_id}:${auction.current_player_id}:${auction.ends_at}`
        : null

    if (!expiredAuctionKey && !resolutionKey) return

    let cancelled = false

    const recoverTransition = async () => {
      if (cancelled) return

      if (expiredAuctionKey) {
        await finalizeExpiredPlayer()
        return
      }

      if (!resolutionKey) return

      await supabaseClient.rpc('advance_to_next_player', {
        p_auction_session_id: auction.auction_session_id,
        p_admin_user_id: room?.admin_id || user,
        p_idempotency_key: buildAdvanceIdempotencyKey(auction.auction_session_id, resolutionKey)
      })
      await refetch()
    }

    const timeout = window.setTimeout(() => {
      void recoverTransition()
    }, expiredAuctionKey ? 1200 : 2200)

    const interval = window.setInterval(() => {
      void recoverTransition()
    }, 2500)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [
    auction?.auction_session_id,
    auction?.current_player_id,
    auction?.ends_at,
    auction?.status,
    desktopRemaining,
    desktopTimerEndsAt,
    finalizeExpiredPlayer,
    isMobile,
    refetch,
    resolutionKey,
    room?.admin_id,
    user
  ])

  const isAdmin = Boolean(room?.admin_id && user === room.admin_id)

  const toggleSound = () => {
    setSoundEnabled((value) => {
      const next = !value
      try {
        window.localStorage.setItem(SOUND_STORAGE_KEY, next ? '1' : '0')
      } catch {}
      return next
    })
  }

  return (
    <div className={`auction-page ${isMobile ? 'auction-page-mobile' : 'page-with-navbar'}`} style={currentPlayerThemeStyle}>
      {isMobile ? (
        <MobileAuctionLayout
          room={room}
          auction={auction}
          currentPlayer={currentPlayer}
          roundLabel={displayRoundLabel}
          progressCount={progressCount}
          participants={participants}
          bidHistory={bidHistory}
          squads={squads}
          playersById={playersById}
          currentUserId={user}
          me={me}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          onExpire={handleExpiredAuctionTick}
          screenLoading={screenLoading}
          screenError={screenError}
          connectionState={connectionState}
          isStale={isStale}
          onRefetch={refetch}
          skipTargetCount={skipTargetCount}
        />
      ) : (
        <>
          <PageNavbar
            subtitle={auction?.round_number === 2 ? 'ACCELERATED ROUND' : 'LIVE AUCTION'}
            showHome
            showThemeToggle={false}
            actions={
              auction ? (
                isTablet ? (
                  <div className="auction-navbar-tools auction-navbar-tools-tablet">
                    <div className="auction-tablet-navbar-summary" aria-label="Auction status summary">
                      <span className="auction-tablet-navbar-metric">
                        <em>Round</em>
                        <strong title={displayRoundLabel}>{displayRoundLabel}</strong>
                      </span>
                      <span className="auction-tablet-navbar-metric">
                        <em>Progress</em>
                        <strong title={tabletProgressLabel}>{tabletProgressLabel}</strong>
                      </span>
                      <span className="auction-tablet-navbar-metric">
                        <em>Purse</em>
                        <strong>{tabletBudgetLabel}</strong>
                      </span>
                      <span className="auction-tablet-navbar-metric">
                        <em>Squad</em>
                        <strong>{tabletSquadLabel}</strong>
                      </span>
                    </div>
                    <div className="auction-navbar-status">
                      <span className={`auction-status-pill is-${auction.status}`}>{formatAuctionStatus(auction.status)}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm mobile-auction-admin-trigger"
                      aria-expanded={tabletMenuOpen}
                      aria-label="Auction tools"
                      onClick={() => setTabletMenuOpen((value) => !value)}
                    >
                      ⋮
                    </button>
                  </div>
                ) : (
                  <div className="auction-navbar-tools auction-navbar-tools-desktop">
                    <div className="auction-navbar-summary-desktop" aria-label="Auction status summary">
                      <span className="auction-navbar-metric">
                        <em>Round</em>
                        <strong title={displayRoundLabel}>{displayRoundLabel}</strong>
                      </span>
                      <span className="auction-navbar-metric">
                        <em>Progress</em>
                        <strong title={tabletProgressLabel}>{tabletProgressLabel}</strong>
                      </span>
                      <span className="auction-navbar-metric">
                        <em>Purse</em>
                        <strong>{tabletBudgetLabel}</strong>
                      </span>
                      <span className="auction-navbar-metric">
                        <em>Squad</em>
                        <strong>{tabletSquadLabel}</strong>
                      </span>
                    </div>
                    <div className="auction-navbar-status">
                      <span className={`auction-status-pill is-${auction.status}`}>{formatAuctionStatus(auction.status)}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm mobile-auction-admin-trigger"
                      aria-expanded={tabletMenuOpen}
                      aria-label="Auction tools"
                      onClick={() => setTabletMenuOpen((value) => !value)}
                    >
                      ⋮
                    </button>
                  </div>
                )
              ) : null
            }
          />

          {!isMobile && tabletMenuOpen && (
            <button
              className="mobile-auction-admin-backdrop"
              type="button"
              aria-label="Close auction tools"
              onClick={() => setTabletMenuOpen(false)}
            />
          )}
          {!isMobile && tabletMenuOpen && auction && (
            <div className="mobile-auction-admin-menu">
              <button
                type="button"
                className={`btn btn-ghost btn-sm auction-sound-toggle mobile-auction-admin-sound ${soundEnabled ? 'is-enabled' : 'is-disabled'}`}
                aria-pressed={soundEnabled}
                aria-label={`Turn sound ${soundEnabled ? 'off' : 'on'}`}
                onClick={toggleSound}
              >
                <span className="auction-sound-toggle-copy">
                  <strong>Sound Toggle</strong>
                  <small>{soundEnabled ? 'On' : 'Off'}</small>
                </span>
                <span className={`auction-sound-toggle-switch ${soundEnabled ? 'is-enabled' : 'is-disabled'}`} aria-hidden="true">
                  <span className="auction-sound-toggle-switch-thumb" />
                </span>
              </button>
              {isAdmin && <AdminControls auctionSessionId={auction.auction_session_id} status={auction.status} compact />}
            </div>
          )}

          <div className="auction-body">
            <div className="auction-stage" ref={stageRef}>
              {screenLoading ? (
                <>
                  <div className="card auction-status-grid skeleton-card skeleton-block-lg" />
                  <div className="card player-card skeleton-card skeleton-player-card" />
                  <div className="card skeleton-card skeleton-block-md" />
                  <div className="card skeleton-card skeleton-block-md" />
                </>
              ) : (
                <>
                  {showLiveIssueBanner && (
                    <div className={`card live-banner auction-live-banner auction-live-banner-primary ${hasCriticalState ? 'is-error' : connectionState === 'offline' ? 'is-danger' : 'is-warning'}`}>
                      <div>
                        <span className="status-label">{hasCriticalState ? 'Live Update Issue' : connectionState === 'offline' ? 'Connection lost' : 'Updating Board'}</span>
                        <p className="live-banner-copy">
                          {screenError ||
                            (connectionState === 'offline'
                              ? 'The live board lost connection. Reconnect and refresh to catch up.'
                              : connectionState === 'degraded'
                                ? 'Updates are taking a little longer than usual. Fresh activity will appear shortly.'
                                : 'Refreshing the latest auction activity.')}
                        </p>
                      </div>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => void refetch()}>
                        Refresh Board
                      </button>
                    </div>
                  )}

                  <div className="auction-tablet-player">
                    <PlayerCard player={currentPlayer} />
                  </div>
                  {showLiveIssueBanner && (
                    <div className={`card live-banner auction-live-banner auction-live-banner-tablet ${hasCriticalState ? 'is-error' : connectionState === 'offline' ? 'is-danger' : 'is-warning'}`}>
                      <div>
                        <span className="status-label">{hasCriticalState ? 'Live Update Issue' : connectionState === 'offline' ? 'Connection lost' : 'Updating Board'}</span>
                        <p className="live-banner-copy">
                          {screenError ||
                            (connectionState === 'offline'
                              ? 'The live board lost connection. Reconnect and refresh to catch up.'
                              : connectionState === 'degraded'
                                ? 'Updates are taking a little longer than usual. Fresh activity will appear shortly.'
                                : 'Refreshing the latest auction activity.')}
                        </p>
                      </div>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => void refetch()}>
                        Refresh Board
                      </button>
                    </div>
                  )}
                  {auction && (
                    <div className="auction-tablet-timer-inline">
                      <TimerRing
                        remaining={displayedRemaining}
                        total={room?.settings.timer_seconds || 15}
                        paused={auction.status === 'paused'}
                        status={auction.status}
                        themeTeam={currentPlayer?.team_code}
                        currentPrice={auction.current_price}
                        highestBidderLabel={highestBidder?.team_name || 'No bids yet'}
                        highestBidderMeta={highestBidder ? highestBidder.profiles?.username || 'Franchise Owner' : 'Waiting for the first bid'}
                      />
                    </div>
                  )}
                  {auction && (
                    <div className="auction-tablet-bidbar">
                      <BidBar
                        currentPrice={auction.current_price}
                        highestBidderId={auction.highest_bidder_id}
                        participants={participants}
                        bidHistory={bidHistory}
                        themeTeam={currentPlayer?.team_code}
                        hideSummary={isTablet}
                      />
                    </div>
                  )}
                  {auction && me && <div className="auction-stage-spacer" aria-hidden="true" />}
                  {!auction && !screenError && (
                    <div className="card player-card-empty">
                      <div className="player-card-empty-copy">
                        <span className="status-label">Getting Ready</span>
                        <strong className="player-card-empty-title">Auction board is almost ready</strong>
                        <p className="text-muted">The live auction screen will appear here as soon as the room is ready.</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="auction-sidebar">
              {screenLoading ? (
                <>
                  <div className="card skeleton-card skeleton-timer-card" />
                  <div className="card skeleton-card skeleton-block-lg" />
                  <div className="card skeleton-card skeleton-block-sm" />
                </>
              ) : (
                <>
                  {auction && (
                    <div className="auction-timer-sticky auction-tablet-sidebar-timer">
                      <TimerRing
                        remaining={displayedRemaining}
                        total={room?.settings.timer_seconds || 15}
                        paused={auction.status === 'paused'}
                        status={auction.status}
                        themeTeam={currentPlayer?.team_code}
                        currentPrice={isTablet ? auction.current_price : undefined}
                        highestBidderLabel={isTablet ? highestBidder?.team_name || 'No bids yet' : undefined}
                        highestBidderMeta={isTablet ? (highestBidder ? highestBidder.profiles?.username || 'Franchise Owner' : 'Waiting for the first bid') : undefined}
                      />
                    </div>
                  )}
                  {auction && (
                    <div className="auction-tablet-teams">
                      <TeamView participants={participants} squads={squads} playersById={playersById} currentUserId={user} variant={isTablet ? 'mobileLike' : 'default'} />
                    </div>
                  )}
                  {auction && me && auction.highest_bidder_id === me.id && (
                    <div className="card live-callout is-success auction-tablet-callout">
                      <span className="status-label">Live advantage</span>
                      <p>You currently lead the bidding.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {showStageScrollCue && (
            <button
              type="button"
              className={`auction-scroll-cue ${auction && me ? 'is-docked' : ''}`}
              aria-label="Scroll to see other details"
              onClick={scrollToOtherDetails}
              onMouseEnter={scrollToOtherDetails}
              onFocus={scrollToOtherDetails}
            >
              <span className="auction-scroll-cue-arrow" aria-hidden="true">↓</span>
              <span className="auction-scroll-cue-text">Scroll to see other details</span>
            </button>
          )}

          {auction && me && (
            <div className="auction-actions-float" style={actionBarStyle}>
              <div className="auction-actions-float-inner">
                <BidActions
                  auctionSessionId={auction.auction_session_id}
                  auctionMode={room?.auction_mode}
                  participantId={me.id}
                  currentPrice={auction.current_price}
                  hasHighestBid={Boolean(auction.highest_bidder_id)}
                  budgetRemaining={me.budget_remaining}
                  squadCount={me.squad_count}
                  squadLimit={room?.settings.squad_size || 20}
                  isPaused={auction.status === 'paused'}
                  isExpired={isExpired}
                  skipped={skippedBidderIds.includes(me.id)}
                  isHighestBidder={auction.highest_bidder_id === me.id}
                  skipCount={skippedBidderIds.length}
                  activeCount={skipTargetCount}
                />
              </div>
            </div>
          )}
        </>
      )}

      {auction && currentPlayer && (
        <SoldModal
          visible={modal.visible}
          type={modal.type}
          playerName={currentPlayer.name}
          teamName={participants.find((participant) => participant.id === auction.highest_bidder_id)?.team_name}
          price={auction.current_price}
        />
      )}

      <AuctionRoomChat roomId={roomId} auctionSessionId={auction?.auction_session_id ?? null} participant={me} participants={participants} />
    </div>
  )
}
