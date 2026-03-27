'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTimer } from '@/hooks/useTimer'
import { supabaseClient } from '@/lib/supabase'
import { Room, RoomSoundtrackPhase, RoomSoundtrackState } from '@/types'

const ROOM_SOUNDTRACK_SELECT = 'id, status, results_reveal_at'
const ROOM_SOUNDTRACK_STORAGE_KEY = 'room:soundtrack-enabled'
const ROOM_SOUNDTRACK_SRC = '/round-transition-soundtrack.mp3'

type Props = {
  roomId: string
}

type SoundtrackRoomState = Pick<Room, 'id' | 'status' | 'results_reveal_at'>

function getPhase(room: SoundtrackRoomState | null, revealRemaining: number): RoomSoundtrackPhase {
  if (!room) return 'idle'
  if (room.status === 'accelerated_selection') return 'accelerated_transition'
  if (room.status === 'completed' && room.results_reveal_at) {
    return revealRemaining > 0 ? 'results_hold' : 'results_live'
  }
  return 'idle'
}

function getPhaseLabel(phase: RoomSoundtrackPhase) {
  if (phase === 'accelerated_transition') return 'Round 2 Transition'
  if (phase === 'results_hold') return 'Results Hold'
  if (phase === 'results_live') return 'Results Live'
  return 'Idle'
}

export function RoomSoundtrackController({ roomId }: Props) {
  const [room, setRoom] = useState<SoundtrackRoomState | null>(null)
  const [state, setState] = useState<RoomSoundtrackState>({
    enabled: true,
    isPlaying: false,
    phase: 'idle'
  })
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { remaining } = useTimer(room?.results_reveal_at ?? null)

  const phase = useMemo(() => getPhase(room, remaining), [remaining, room])
  const shouldPlay = state.enabled && phase !== 'idle'
  const showToggle = phase !== 'idle'

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ROOM_SOUNDTRACK_STORAGE_KEY)
      if (stored === '0') {
        setState((current) => ({ ...current, enabled: false }))
      }
    } catch {}
  }, [])

  useEffect(() => {
    let active = true

    const hydrate = async () => {
      const { data } = await supabaseClient.from('rooms').select(ROOM_SOUNDTRACK_SELECT).eq('id', roomId).maybeSingle()
      if (!active) return
      setRoom((data as SoundtrackRoomState | null) ?? null)
    }

    void hydrate()

    const channel = supabaseClient
      .channel(`room-soundtrack:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          setRoom((prev) => ({ ...(prev ?? {}), ...(payload.new as SoundtrackRoomState) }))
        }
      )
      .subscribe()

    return () => {
      active = false
      supabaseClient.removeChannel(channel)
    }
  }, [roomId])

  useEffect(() => {
    const audio = new Audio(ROOM_SOUNDTRACK_SRC)
    audio.preload = 'auto'
    audio.loop = true
    audio.volume = 0.42

    const syncPlaying = () => {
      setState((current) => ({ ...current, isPlaying: !audio.paused }))
    }

    audio.addEventListener('play', syncPlaying)
    audio.addEventListener('pause', syncPlaying)

    audioRef.current = audio

    return () => {
      audio.removeEventListener('play', syncPlaying)
      audio.removeEventListener('pause', syncPlaying)
      audio.pause()
      audio.currentTime = 0
      audioRef.current = null
    }
  }, [])

  useEffect(() => {
    setState((current) => ({ ...current, phase }))
  }, [phase])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const attemptPlayback = () => {
      if (!shouldPlay) return
      void audio.play().catch(() => {})
    }

    if (shouldPlay) {
      attemptPlayback()
      window.addEventListener('pointerdown', attemptPlayback)
      window.addEventListener('keydown', attemptPlayback)
    } else {
      audio.pause()
      audio.currentTime = 0
    }

    return () => {
      window.removeEventListener('pointerdown', attemptPlayback)
      window.removeEventListener('keydown', attemptPlayback)
    }
  }, [shouldPlay])

  const toggleEnabled = () => {
    setState((current) => {
      const nextEnabled = !current.enabled
      try {
        window.localStorage.setItem(ROOM_SOUNDTRACK_STORAGE_KEY, nextEnabled ? '1' : '0')
      } catch {}

      if (!nextEnabled && audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }

      return {
        ...current,
        enabled: nextEnabled,
        isPlaying: nextEnabled ? current.isPlaying : false
      }
    })
  }

  if (!showToggle) return null

  return (
    <div className="room-soundtrack-dock">
      <button
        type="button"
        className={`btn btn-ghost btn-sm room-soundtrack-toggle ${state.enabled ? 'is-enabled' : 'is-disabled'}`}
        aria-pressed={state.enabled}
        onClick={toggleEnabled}
      >
        <span>{state.enabled ? 'Soundtrack On' : 'Soundtrack Off'}</span>
        <small>{getPhaseLabel(state.phase)}</small>
      </button>
    </div>
  )
}

export default RoomSoundtrackController
