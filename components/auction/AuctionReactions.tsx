'use client'

import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabaseClient } from '@/lib/supabase'

const REACTION_EMOJIS = ['🤑', '❤️', '😂', '😎', '😜', '🤡', '💰'] as const

type FloatingReaction = {
  id: string
  emoji: string
  startX: number
  startY: number
  deltaX: number
  deltaY: number
  swayX: number
}

type AnchorPoint = {
  x: number
  y: number
}

type Props = {
  auctionSessionId: string
  anchorRef: RefObject<HTMLElement | null>
  anchorPlacement?: 'default' | 'top-right'
}

function createReactionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getRectCenter(rect: DOMRect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  }
}

function getReactionTargetPoint() {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 }
  }

  const target = document.querySelector<HTMLElement>('[data-auction-player-target="current-name"]')
  if (target) {
    const rect = target.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    }
  }

  return {
    x: window.innerWidth / 2,
    y: Math.min(window.innerHeight * 0.22, 164)
  }
}

export const AuctionReactions = memo(function AuctionReactions({ auctionSessionId, anchorRef, anchorPlacement = 'default' }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [anchorPoint, setAnchorPoint] = useState<AnchorPoint | null>(null)
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([])
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const channelRef = useRef<ReturnType<typeof supabaseClient.channel> | null>(null)
  const seenReactionIdsRef = useRef<Set<string>>(new Set())

  const updateAnchorPoint = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth
    const buttonHalf = 18
    let x = rect.left + rect.width / 2

    if (anchorPlacement === 'top-right') {
      x = rect.right - buttonHalf
    } else if (viewportWidth >= 1025) {
      x = rect.left + buttonHalf + 6
    } else if (viewportWidth < 640) {
      x = rect.right - buttonHalf - 6
    }

    setAnchorPoint({
      x,
      y: rect.top - 44
    })
  }, [anchorPlacement, anchorRef])

  useEffect(() => {
    updateAnchorPoint()

    if (typeof window === 'undefined') return

    const sync = () => updateAnchorPoint()
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)

    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [updateAnchorPoint])

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: Event) => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setIsOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [isOpen])

  const spawnFloatingReaction = useCallback((emoji: string, sourceCenter?: { x: number; y: number }) => {
    if (typeof window === 'undefined') return

    const anchor = anchorRef.current
    const fallbackAnchorRect = anchor?.getBoundingClientRect()
    const fallbackSource = fallbackAnchorRect
      ? {
          x: fallbackAnchorRect.left + fallbackAnchorRect.width / 2,
          y: fallbackAnchorRect.top - 18
        }
      : {
          x: window.innerWidth - 64,
          y: window.innerHeight - 132
        }

    const start = sourceCenter ?? fallbackSource
    const target = getReactionTargetPoint()
    const endX = target.x + (Math.random() * 26 - 13)
    const endY = target.y + (Math.random() * 16 - 8)
    const nextReaction: FloatingReaction = {
      id: createReactionId(),
      emoji,
      startX: start.x,
      startY: start.y,
      deltaX: endX - start.x,
      deltaY: endY - start.y,
      swayX: Math.random() * 28 - 14
    }

    setFloatingReactions((current) => [...current, nextReaction])
  }, [anchorRef])

  useEffect(() => {
    const channel = supabaseClient.channel(`auction-reactions:${auctionSessionId}`)
    channelRef.current = channel

    channel.on('broadcast', { event: 'reaction' }, ({ payload }) => {
      const reactionId = typeof payload?.id === 'string' ? payload.id : null
      const emoji = typeof payload?.emoji === 'string' ? payload.emoji : null
      if (!reactionId || !emoji) return
      if (seenReactionIdsRef.current.has(reactionId)) return

      seenReactionIdsRef.current.add(reactionId)
      spawnFloatingReaction(emoji)
    })

    void channel.subscribe()

    return () => {
      channelRef.current = null
      void supabaseClient.removeChannel(channel)
    }
  }, [auctionSessionId, spawnFloatingReaction])

  const launchReaction = useCallback(async (emoji: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    const reactionId = createReactionId()
    seenReactionIdsRef.current.add(reactionId)

    const rect = event.currentTarget.getBoundingClientRect()
    spawnFloatingReaction(emoji, getRectCenter(rect))

    await channelRef.current?.send({
      type: 'broadcast',
      event: 'reaction',
      payload: {
        id: reactionId,
        emoji
      }
    })
  }, [spawnFloatingReaction])

  const floatingStyle = useMemo(() => {
    if (!anchorPoint) return undefined

    return {
      left: `${anchorPoint.x}px`,
      top: `${anchorPoint.y}px`
    }
  }, [anchorPoint])

  const floatingUi = anchorPoint ? (
    <div className="auction-reaction-floating" style={floatingStyle}>
      {isOpen && (
        <div ref={menuRef} className="auction-reaction-menu" role="menu" aria-label="Emoji reactions">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="auction-reaction-emoji"
              onClick={(event) => void launchReaction(emoji, event)}
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        className={`auction-reaction-trigger ${isOpen ? 'is-open' : ''}`}
        aria-expanded={isOpen}
        aria-label="Open reactions"
        onClick={() => setIsOpen((value) => !value)}
      >
        🙂
      </button>
    </div>
  ) : null

  const floatingLayer = (
    <div className="auction-reaction-layer" aria-hidden="true">
      {floatingReactions.map((reaction) => (
        <span
          key={reaction.id}
          className="auction-floating-reaction"
          style={{
            left: `${reaction.startX}px`,
            top: `${reaction.startY}px`,
            ['--reaction-dx' as string]: `${reaction.deltaX}px`,
            ['--reaction-dy' as string]: `${reaction.deltaY}px`,
            ['--reaction-sway' as string]: `${reaction.swayX}px`
          }}
          onAnimationEnd={() => {
            setFloatingReactions((current) => current.filter((item) => item.id !== reaction.id))
          }}
        >
          {reaction.emoji}
        </span>
      ))}
    </div>
  )

  return (
    <>
      {typeof document !== 'undefined' && floatingUi ? createPortal(floatingUi, document.body) : floatingUi}
      {typeof document !== 'undefined' ? createPortal(floatingLayer, document.body) : floatingLayer}
    </>
  )
})

export default AuctionReactions
