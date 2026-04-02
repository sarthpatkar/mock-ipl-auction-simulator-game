'use client'

import { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '@/lib/supabase'
import { RoomParticipant } from '@/types'

const MESSAGE_RETENTION_MS = 5 * 60 * 1000
const PRUNE_INTERVAL_MS = 10 * 1000
const SEND_COOLDOWN_MS = 700
const MAX_MESSAGE_LENGTH = 200
const MAX_MESSAGE_BUFFER = 120
const EMOJI_REGEX = /[\p{Extended_Pictographic}\uFE0F]/u
const CHAT_POSITION_STORAGE_KEY = 'auction:chat-dock-position:v1'
const CHAT_DEFAULT_RIGHT_OFFSET = 16
const CHAT_DEFAULT_BOTTOM_OFFSET = 100
const CHAT_MOBILE_DEFAULT_BOTTOM_OFFSET = 96
const CHAT_POSITION_MARGIN = 10
const TRIGGER_FALLBACK_WIDTH = 92
const TRIGGER_FALLBACK_HEIGHT = 38
const PANEL_SNAP_THRESHOLD = 220

type RoomChatMessage = {
  id: string
  text: string
  participantId: string
  senderLabel: string
  createdAt: string
}

type Props = {
  roomId: string
  auctionSessionId: string | null
  participant: RoomParticipant | undefined
  participants: RoomParticipant[]
}

type ChatDockPosition = {
  x: number
  y: number
}

function createMessageId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function getParticipantLabel(participant: RoomParticipant | undefined) {
  if (!participant) return 'Player'
  return participant.team_name || participant.profiles?.username || 'Player'
}

function formatMessageTime(isoValue: string) {
  const parsed = new Date(isoValue)
  if (Number.isNaN(parsed.getTime())) return '--:--'

  return parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function pruneExpiredMessages(messages: RoomChatMessage[], nowMs = Date.now()) {
  const filtered = messages.filter((message) => {
    const createdAtMs = new Date(message.createdAt).getTime()
    if (Number.isNaN(createdAtMs)) return false
    return nowMs - createdAtMs < MESSAGE_RETENTION_MS
  })

  return filtered.slice(-MAX_MESSAGE_BUFFER)
}

function isValidIncoming(payload: unknown): payload is RoomChatMessage {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Partial<RoomChatMessage>
  if (typeof candidate.id !== 'string' || !candidate.id) return false
  if (typeof candidate.text !== 'string' || !candidate.text.trim()) return false
  if (typeof candidate.participantId !== 'string' || !candidate.participantId) return false
  if (typeof candidate.senderLabel !== 'string' || !candidate.senderLabel.trim()) return false
  if (typeof candidate.createdAt !== 'string') return false

  const createdAtMs = new Date(candidate.createdAt).getTime()
  if (Number.isNaN(createdAtMs)) return false
  return normalizeText(candidate.text).length <= MAX_MESSAGE_LENGTH
}

function getTriggerSize(button: HTMLButtonElement | null) {
  const width = button?.offsetWidth ?? TRIGGER_FALLBACK_WIDTH
  const height = button?.offsetHeight ?? TRIGGER_FALLBACK_HEIGHT
  return { width, height }
}

function clampDockPosition(position: ChatDockPosition, viewport: { width: number; height: number }, triggerSize: { width: number; height: number }) {
  const maxX = Math.max(CHAT_POSITION_MARGIN, viewport.width - triggerSize.width - CHAT_POSITION_MARGIN)
  const maxY = Math.max(CHAT_POSITION_MARGIN, viewport.height - triggerSize.height - CHAT_POSITION_MARGIN)
  return {
    x: Math.min(Math.max(CHAT_POSITION_MARGIN, position.x), maxX),
    y: Math.min(Math.max(CHAT_POSITION_MARGIN, position.y), maxY)
  }
}

function getDefaultDockPosition(viewport: { width: number; height: number }, triggerSize: { width: number; height: number }) {
  const isMobileViewport = viewport.width <= 1024
  const bottomOffset = isMobileViewport ? CHAT_MOBILE_DEFAULT_BOTTOM_OFFSET : CHAT_DEFAULT_BOTTOM_OFFSET
  return clampDockPosition(
    {
      x: viewport.width - triggerSize.width - CHAT_DEFAULT_RIGHT_OFFSET,
      y: viewport.height - triggerSize.height - bottomOffset
    },
    viewport,
    triggerSize
  )
}

export function AuctionRoomChat({ roomId, auctionSessionId, participant, participants }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<RoomChatMessage[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [dockPosition, setDockPosition] = useState<ChatDockPosition | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const channelRef = useRef<ReturnType<typeof supabaseClient.channel> | null>(null)
  const seenMessageIdsRef = useRef<Set<string>>(new Set())
  const openRef = useRef(false)
  const lastSentAtRef = useRef(0)
  const allowedParticipantIdsRef = useRef<Set<string>>(new Set())
  const participantLabelByIdRef = useRef<Map<string, string>>(new Map())
  const myParticipantIdRef = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; origin: ChatDockPosition } | null>(null)
  const didDragRef = useRef(false)

  const canChat = Boolean(participant && auctionSessionId)
  const channelName = useMemo(() => (auctionSessionId ? `auction-chat:${roomId}:${auctionSessionId}` : null), [auctionSessionId, roomId])

  const appendMessage = useCallback((incoming: RoomChatMessage) => {
    setMessages((current) => {
      if (current.some((message) => message.id === incoming.id)) return current
      return pruneExpiredMessages([...current, incoming])
    })

    if (!openRef.current && incoming.participantId !== myParticipantIdRef.current) {
      setUnreadCount((value) => Math.min(99, value + 1))
    }
  }, [])

  useEffect(() => {
    setMessages([])
    setUnreadCount(0)
    setText('')
    setError(null)
    seenMessageIdsRef.current = new Set()
  }, [channelName])

  useEffect(() => {
    openRef.current = isOpen
    if (isOpen) {
      setUnreadCount(0)
    }
  }, [isOpen])

  useEffect(() => {
    allowedParticipantIdsRef.current = new Set(participants.map((entry) => entry.id))
    participantLabelByIdRef.current = new Map(participants.map((entry) => [entry.id, getParticipantLabel(entry)]))
    myParticipantIdRef.current = participant?.id ?? null
  }, [participant?.id, participants])

  useEffect(() => {
    if (!canChat || !channelName) return

    const channel = supabaseClient.channel(channelName)
    channelRef.current = channel

    channel.on('broadcast', { event: 'message' }, ({ payload }) => {
      if (!isValidIncoming(payload)) return
      if (seenMessageIdsRef.current.has(payload.id)) return
      if (!allowedParticipantIdsRef.current.has(payload.participantId)) return

      const createdAtMs = new Date(payload.createdAt).getTime()
      if (Date.now() - createdAtMs >= MESSAGE_RETENTION_MS) return

      seenMessageIdsRef.current.add(payload.id)
      appendMessage({
        ...payload,
        senderLabel: participantLabelByIdRef.current.get(payload.participantId) || payload.senderLabel
      })
    })

    void channel.subscribe()

    return () => {
      channelRef.current = null
      void supabaseClient.removeChannel(channel)
    }
  }, [appendMessage, canChat, channelName])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setMessages((current) => pruneExpiredMessages(current))
    }, PRUNE_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const list = listRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
  }, [isOpen, messages.length])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncViewportAndPosition = () => {
      const nextViewport = { width: window.innerWidth, height: window.innerHeight }
      const triggerSize = getTriggerSize(triggerRef.current)
      setViewportSize(nextViewport)

      setDockPosition((current) => {
        if (current) return clampDockPosition(current, nextViewport, triggerSize)

        try {
          const raw = window.localStorage.getItem(CHAT_POSITION_STORAGE_KEY)
          if (!raw) return getDefaultDockPosition(nextViewport, triggerSize)
          const parsed = JSON.parse(raw) as Partial<ChatDockPosition> | null
          if (!parsed || typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
            return getDefaultDockPosition(nextViewport, triggerSize)
          }
          return clampDockPosition({ x: parsed.x, y: parsed.y }, nextViewport, triggerSize)
        } catch {
          return getDefaultDockPosition(nextViewport, triggerSize)
        }
      })
    }

    syncViewportAndPosition()
    window.addEventListener('resize', syncViewportAndPosition)
    return () => window.removeEventListener('resize', syncViewportAndPosition)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !dockPosition) return
    try {
      window.localStorage.setItem(CHAT_POSITION_STORAGE_KEY, JSON.stringify(dockPosition))
    } catch {}
  }, [dockPosition])

  const stopDragging = useCallback(() => {
    dragStateRef.current = null
    setIsDragging(false)
  }, [])

  const onTriggerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dockPosition) return

      didDragRef.current = false
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: dockPosition
      }

      event.currentTarget.setPointerCapture(event.pointerId)
      setIsDragging(false)
    },
    [dockPosition]
  )

  const onTriggerPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) return

      const deltaX = event.clientX - dragState.startX
      const deltaY = event.clientY - dragState.startY
      if (!didDragRef.current && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
        didDragRef.current = true
      }

      const nextPosition = {
        x: dragState.origin.x + deltaX,
        y: dragState.origin.y + deltaY
      }

      const triggerSize = getTriggerSize(triggerRef.current)
      const safeViewport = viewportSize.width > 0 && viewportSize.height > 0
        ? viewportSize
        : { width: window.innerWidth, height: window.innerHeight }
      setDockPosition(clampDockPosition(nextPosition, safeViewport, triggerSize))
      setIsDragging(true)
    },
    [viewportSize]
  )

  const onTriggerPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) return
      stopDragging()
    },
    [stopDragging]
  )

  const onTriggerClick = useCallback(() => {
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    setIsOpen((value) => !value)
  }, [])

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      if (!canChat || !participant || !channelRef.current) return

      const normalizedText = normalizeText(text)
      if (!normalizedText) return

      if (normalizedText.length > MAX_MESSAGE_LENGTH) {
        setError(`Keep messages under ${MAX_MESSAGE_LENGTH} characters.`)
        return
      }

      if (EMOJI_REGEX.test(normalizedText)) {
        setError('Chat supports text only. Emojis are disabled.')
        return
      }

      const now = Date.now()
      if (now - lastSentAtRef.current < SEND_COOLDOWN_MS) {
        setError('Sending too fast. Please wait a moment.')
        return
      }

      const outgoing: RoomChatMessage = {
        id: createMessageId(),
        text: normalizedText,
        participantId: participant.id,
        senderLabel: getParticipantLabel(participant),
        createdAt: new Date(now).toISOString()
      }

      lastSentAtRef.current = now
      seenMessageIdsRef.current.add(outgoing.id)
      appendMessage(outgoing)
      setText('')
      setError(null)
      setIsSending(true)

      const result = await channelRef.current.send({
        type: 'broadcast',
        event: 'message',
        payload: outgoing
      })

      if (result !== 'ok') {
        setError('Message could not be delivered. Try again.')
      }

      setIsSending(false)
    },
    [appendMessage, canChat, participant, text]
  )

  if (!canChat) return null

  const panelAlign = dockPosition && viewportSize.width > 0
    ? dockPosition.x <= PANEL_SNAP_THRESHOLD || dockPosition.x < viewportSize.width / 2
      ? 'is-left'
      : 'is-right'
    : 'is-right'

  const dockStyle: CSSProperties | undefined = dockPosition
    ? {
        left: `${dockPosition.x}px`,
        top: `${dockPosition.y}px`,
        right: 'auto',
        bottom: 'auto'
      }
    : undefined

  return (
    <aside className={`auction-chat-dock ${isOpen ? 'is-open' : ''}`} style={dockStyle} aria-label="Room chat">
      <button
        ref={triggerRef}
        type="button"
        className={`auction-chat-trigger ${isOpen ? 'is-open' : ''} ${isDragging ? 'is-dragging' : ''}`}
        aria-expanded={isOpen}
        aria-label="Open room chat"
        onPointerDown={onTriggerPointerDown}
        onPointerMove={onTriggerPointerMove}
        onPointerUp={onTriggerPointerUp}
        onPointerCancel={stopDragging}
        onLostPointerCapture={stopDragging}
        onClick={onTriggerClick}
      >
        <span>Chat</span>
        {unreadCount > 0 && <small>{unreadCount > 99 ? '99+' : unreadCount}</small>}
      </button>

      {isOpen && (
        <section className={`auction-chat-panel card ${panelAlign}`} role="dialog" aria-label="Room chat panel" aria-live="polite">
          <header className="auction-chat-header">
            <div>
              <span className="status-label">Room chat</span>
              <p className="auction-chat-note">Realtime, text-only, auto-clears in 5 minutes.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm auction-chat-close" onClick={() => setIsOpen(false)}>
              Close
            </button>
          </header>

          <div className="auction-chat-messages" ref={listRef}>
            {messages.length === 0 ? (
              <p className="auction-chat-empty">No messages yet. Start the room chat.</p>
            ) : (
              messages.map((message) => {
                const isMine = message.participantId === participant.id
                return (
                  <article key={message.id} className={`auction-chat-message ${isMine ? 'is-mine' : ''}`}>
                    <div className="auction-chat-message-meta">
                      <strong>{isMine ? 'You' : message.senderLabel}</strong>
                      <time>{formatMessageTime(message.createdAt)}</time>
                    </div>
                    <p>{message.text}</p>
                  </article>
                )
              })
            )}
          </div>

          <form className="auction-chat-form" onSubmit={(event) => void onSubmit(event)}>
            <input
              type="text"
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                if (error) setError(null)
              }}
              placeholder="Type a message"
              maxLength={MAX_MESSAGE_LENGTH}
              aria-label="Chat message"
            />
            <button type="submit" className="btn btn-blue btn-sm" disabled={isSending || !text.trim()}>
              Send
            </button>
          </form>

          {error && <p className="auction-chat-error">{error}</p>}
        </section>
      )}
    </aside>
  )
}

export default AuctionRoomChat
