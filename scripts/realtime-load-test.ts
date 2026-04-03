import { createClient, RealtimeChannel, SupabaseClient, User } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

type AuctionMode = 'full_auction' | 'match_auction' | 'legends_auction'

type BotCredential = {
  email: string
  password: string
  teamName?: string
  label?: string
}

type BotSession = {
  credential: BotCredential
  client: SupabaseClient
  user: User
  participantId: string | null
  channel: RealtimeChannel | null
  lastSeenVersion: number
  eventCount: number
  duplicateCount: number
  totalDeliveryLagMs: number
  reconnectCount: number
}

type RuntimeSnapshot = {
  success?: boolean
  error?: string
  room?: {
    id: string
    code: string
    admin_id: string
    auction_mode: AuctionMode
    settings: {
      budget: number
      squad_size: number
      timer_seconds: number
      player_order: 'category' | 'random'
    }
    status: string
  } | null
  auction?: {
    auction_session_id: string
    current_player_id: string | null
    current_price: number
    highest_bidder_id: string | null
    status: string
    ends_at: string | null
    active_bidders?: string[]
    skipped_bidders?: string[]
  } | null
  participants?: Array<{
    id: string
    user_id: string
    team_name: string
    budget_remaining: number
    squad_count: number
    removed_at?: string | null
  }>
}

type ScenarioMetrics = {
  joinLatenciesMs: number[]
  bidLatenciesMs: number[]
  reconnectLatenciesMs: number[]
  eventDeliveryLagMs: number[]
  duplicateEvents: number
  totalEvents: number
}

type RoomScenario = {
  roomId: string
  roomCode: string
  host: BotSession
  bots: BotSession[]
  metrics: ScenarioMetrics
}

type Mode = 'bots' | 'load'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.resolve(__dirname, '../.env.local')
const DEFAULT_ACTION_INTERVAL_MS = 1_250
const DEFAULT_DURATION_MS = 45_000
const DEFAULT_ROOM_SIZE = 5
const DEFAULT_STAGES = [50, 100, 500, 1000]
const ROOM_SELECT = 'id, code, admin_id, auction_mode, settings, status'

function loadLocalEnv() {
  if (!existsSync(envPath)) return

  const envText = readFileSync(envPath, 'utf8')
  for (const rawLine of envText.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')

    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

function getEnv(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback
  if (value == null) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function getOptionalEnv(name: string, fallback?: string) {
  return process.env[name] ?? fallback
}

function readNumberEnv(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readStages() {
  const raw = getOptionalEnv('ROOM_LOAD_STAGES')
  if (!raw) return DEFAULT_STAGES

  return raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
}

function parseBotCredentials() {
  const inline = getOptionalEnv('ROOM_BOT_USERS_JSON')
  const filePath = getOptionalEnv('ROOM_BOT_USERS_FILE')

  if (inline) {
    return JSON.parse(inline) as BotCredential[]
  }

  if (filePath) {
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
    return JSON.parse(readFileSync(resolvedPath, 'utf8')) as BotCredential[]
  }

  throw new Error('Set ROOM_BOT_USERS_JSON or ROOM_BOT_USERS_FILE with bot email/password credentials.')
}

function createIdempotencyKey(prefix: string, scope: string) {
  return `${prefix}:${scope}:${crypto.randomUUID()}`
}

function percentile(values: number[], target: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((target / 100) * sorted.length) - 1))
  return sorted[index]
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function summarize(label: string, values: number[]) {
  return {
    label,
    count: values.length,
    avg: average(values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99)
  }
}

function printSummary(title: string, metrics: ScenarioMetrics) {
  const join = summarize('join_visible_ms', metrics.joinLatenciesMs)
  const bid = summarize('bid_visible_ms', metrics.bidLatenciesMs)
  const reconnect = summarize('reconnect_recovery_ms', metrics.reconnectLatenciesMs)
  const delivery = summarize('event_delivery_lag_ms', metrics.eventDeliveryLagMs)

  console.log(`\n=== ${title} ===`)
  console.table([join, bid, reconnect, delivery])
  console.log(
    JSON.stringify(
      {
        duplicateEvents: metrics.duplicateEvents,
        totalEvents: metrics.totalEvents
      },
      null,
      2
    )
  )
}

function createBotClient() {
  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL')
  const supabaseAnonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
      detectSessionInUrl: false
    }
  })
}

async function authenticateBot(credential: BotCredential): Promise<BotSession> {
  const client = createBotClient()
  const { data, error } = await client.auth.signInWithPassword({
    email: credential.email,
    password: credential.password
  })

  if (error || !data.user) {
    throw new Error(`Failed to authenticate ${credential.email}: ${error?.message ?? 'Unknown error'}`)
  }

  return {
    credential,
    client,
    user: data.user,
    participantId: null,
    channel: null,
    lastSeenVersion: 0,
    eventCount: 0,
    duplicateCount: 0,
    totalDeliveryLagMs: 0,
    reconnectCount: 0
  }
}

async function waitForRoomStatus(client: SupabaseClient, roomId: string, expectedStatus: string, timeoutMs = 20_000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await getRuntimeSnapshot(client, roomId)
    if (snapshot.room?.status === expectedStatus) return snapshot
    await sleep(300)
  }

  throw new Error(`Timed out waiting for room ${roomId} to reach status ${expectedStatus}`)
}

async function getRuntimeSnapshot(client: SupabaseClient, roomId: string) {
  const { data, error } = await client.rpc('get_room_runtime_snapshot', { p_room_id: roomId })
  if (error) throw error
  const snapshot = (data ?? null) as RuntimeSnapshot | null
  if (!snapshot?.success) {
    throw new Error(snapshot?.error || 'Failed to fetch room runtime snapshot')
  }
  return snapshot
}

async function createRoom(host: BotSession, roomName: string, auctionMode: AuctionMode) {
  const { data, error } = await host.client.rpc('create_room_with_admin', {
    p_name: roomName,
    p_team_name: host.credential.teamName || `Host ${host.user.email?.split('@')[0] ?? 'Admin'}`,
    p_auction_mode: auctionMode
  })

  if (error || !data?.success) {
    throw new Error(`Failed to create room: ${error?.message ?? data?.error ?? 'Unknown error'}`)
  }

  const roomId = String(data.room_id)
  const roomCode = String(data.code)
  const snapshot = await getRuntimeSnapshot(host.client, roomId)
  host.participantId = snapshot.participants?.find((participant) => participant.user_id === host.user.id)?.id ?? null

  return { roomId, roomCode }
}

async function joinRoom(bot: BotSession, roomCode: string, roomId: string, metrics: ScenarioMetrics) {
  const startedAt = Date.now()
  const { data, error } = await bot.client.rpc('join_room_by_code', {
    p_code: roomCode,
    p_team_name: bot.credential.teamName || bot.credential.label || bot.user.email?.split('@')[0] || 'Bot Team'
  })

  if (error || !data?.success) {
    throw new Error(`Failed to join room ${roomCode}: ${error?.message ?? data?.error ?? 'Unknown error'}`)
  }

  bot.participantId = String(data.participant_id)

  await waitForParticipant(bot.client, roomId, bot.user.id)
  metrics.joinLatenciesMs.push(Date.now() - startedAt)
}

async function waitForParticipant(client: SupabaseClient, roomId: string, userId: string, timeoutMs = 20_000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await getRuntimeSnapshot(client, roomId)
    if (snapshot.participants?.some((participant) => participant.user_id === userId && !participant.removed_at)) return
    await sleep(250)
  }

  throw new Error(`Timed out waiting for participant ${userId} to appear in room ${roomId}`)
}

async function subscribeRoom(bot: BotSession, roomId: string, metrics: ScenarioMetrics) {
  if (bot.channel) return
  if (typeof WebSocket === 'undefined') {
    throw new Error('Node WebSocket global is unavailable. Use Node 20+ for realtime bot scripts.')
  }

  const channel = bot.client.channel(`room:${roomId}`, {
    config: {
      private: true
    }
  })

  channel.on('broadcast', { event: 'room_event' }, ({ payload }) => {
    const event = payload as { event_id?: string; version?: number; server_generated_at?: string }

    if (typeof event.version === 'number') {
      if (event.version <= bot.lastSeenVersion) {
        bot.duplicateCount += 1
        metrics.duplicateEvents += 1
      } else {
        bot.lastSeenVersion = event.version
      }
    }

    bot.eventCount += 1
    metrics.totalEvents += 1

    if (typeof event.server_generated_at === 'string') {
      const lag = Date.now() - new Date(event.server_generated_at).getTime()
      if (Number.isFinite(lag) && lag >= 0) {
        bot.totalDeliveryLagMs += lag
        metrics.eventDeliveryLagMs.push(lag)
      }
    }
  })

  const status = await new Promise<string>((resolve, reject) => {
    channel.subscribe((value) => {
      if (value === 'SUBSCRIBED') resolve(value)
      if (value === 'CHANNEL_ERROR' || value === 'TIMED_OUT') reject(new Error(`Channel subscribe failed: ${value}`))
    })
  })

  if (status !== 'SUBSCRIBED') {
    throw new Error(`Failed to subscribe room channel for ${roomId}`)
  }

  bot.channel = channel
}

async function reconnectBot(bot: BotSession, roomId: string, metrics: ScenarioMetrics) {
  const startedAt = Date.now()
  bot.reconnectCount += 1

  if (bot.channel) {
    await bot.client.removeChannel(bot.channel)
    bot.channel = null
  }

  await sleep(300)
  await subscribeRoom(bot, roomId, metrics)
  await getRuntimeSnapshot(bot.client, roomId)
  metrics.reconnectLatenciesMs.push(Date.now() - startedAt)
}

async function startAuction(host: BotSession, roomId: string) {
  const { data, error } = await host.client.rpc('start_auction_session', {
    p_room_id: roomId,
    p_idempotency_key: createIdempotencyKey('load-start', roomId)
  })

  if (error || !data?.success) {
    throw new Error(`Failed to start auction for room ${roomId}: ${error?.message ?? data?.error ?? 'Unknown error'}`)
  }
}

async function pauseAuction(host: BotSession, auctionSessionId: string) {
  const { data, error } = await host.client.rpc('pause_auction', {
    p_auction_session_id: auctionSessionId,
    p_idempotency_key: createIdempotencyKey('load-pause', auctionSessionId)
  })

  if (error || data?.success === false) {
    throw new Error(`Failed to pause auction ${auctionSessionId}: ${error?.message ?? data?.error ?? 'Unknown error'}`)
  }
}

async function resumeAuction(host: BotSession, auctionSessionId: string) {
  const { data, error } = await host.client.rpc('resume_auction', {
    p_auction_session_id: auctionSessionId,
    p_idempotency_key: createIdempotencyKey('load-resume', auctionSessionId)
  })

  if (error || data?.success === false) {
    throw new Error(`Failed to resume auction ${auctionSessionId}: ${error?.message ?? data?.error ?? 'Unknown error'}`)
  }
}

async function placeBid(bot: BotSession, auctionSessionId: string, bidAmount: number, metrics: ScenarioMetrics) {
  if (!bot.participantId) return

  const startedAt = Date.now()
  const { data, error } = await bot.client.rpc('place_bid', {
    p_auction_session_id: auctionSessionId,
    p_bidder_participant_id: bot.participantId,
    p_bid_amount: bidAmount,
    p_idempotency_key: createIdempotencyKey('load-bid', auctionSessionId)
  })

  if (error || data?.success === false) return
  metrics.bidLatenciesMs.push(Date.now() - startedAt)
}

async function skipPlayer(bot: BotSession, auctionSessionId: string) {
  if (!bot.participantId) return

  await bot.client.rpc('skip_player', {
    p_auction_session_id: auctionSessionId,
    p_participant_id: bot.participantId
  })
}

function pickRandom<T>(values: T[]) {
  if (values.length === 0) return null
  return values[Math.floor(Math.random() * values.length)] ?? null
}

async function runActions(room: RoomScenario, durationMs: number, actionIntervalMs: number, reconnectEveryMs: number, pauseResumeEveryMs: number) {
  const startedAt = Date.now()
  let lastReconnectAt = startedAt
  let lastPauseToggleAt = startedAt
  let paused = false

  while (Date.now() - startedAt < durationMs) {
    const snapshot = await getRuntimeSnapshot(room.host.client, room.roomId)
    const auction = snapshot.auction
    const participants = snapshot.participants?.filter((participant) => !participant.removed_at) ?? []

    if (auction?.auction_session_id && auction.status === 'live') {
      const eligibleBots = room.bots.filter((bot) => {
        const participant = participants.find((entry) => entry.user_id === bot.user.id)
        if (!participant?.id) return false
        if (participant.id === auction.highest_bidder_id) return false
        if (participant.squad_count >= snapshot.room!.settings.squad_size) return false
        return participant.budget_remaining > auction.current_price
      })

      const actor = pickRandom(eligibleBots)
      if (actor) {
        const participant = participants.find((entry) => entry.user_id === actor.user.id)
        const bidIncrement = auction.highest_bidder_id ? 10_000_000 : 0

        if (participant && Math.random() < 0.72) {
          await placeBid(actor, auction.auction_session_id, auction.current_price + bidIncrement, room.metrics)
        } else if (participant) {
          await skipPlayer(actor, auction.auction_session_id)
        }
      }
    }

    if (auction?.auction_session_id && pauseResumeEveryMs > 0 && Date.now() - lastPauseToggleAt >= pauseResumeEveryMs) {
      if (paused) {
        await resumeAuction(room.host, auction.auction_session_id)
      } else {
        await pauseAuction(room.host, auction.auction_session_id)
      }
      paused = !paused
      lastPauseToggleAt = Date.now()
    }

    if (reconnectEveryMs > 0 && Date.now() - lastReconnectAt >= reconnectEveryMs) {
      const reconnectTarget = pickRandom(room.bots)
      if (reconnectTarget) {
        await reconnectBot(reconnectTarget, room.roomId, room.metrics)
      }
      lastReconnectAt = Date.now()
    }

    await sleep(actionIntervalMs)
  }
}

async function teardownRoom(room: RoomScenario) {
  await Promise.all(
    room.bots.map(async (bot) => {
      if (bot.channel) {
        await bot.client.removeChannel(bot.channel)
        bot.channel = null
      }
      try {
        await bot.client.rpc('leave_room', { p_room_id: room.roomId })
      } catch {}
      await bot.client.auth.signOut().catch(() => undefined)
    })
  )

  try {
    await room.host.client.from('rooms').delete().eq('id', room.roomId)
  } catch {}
  if (room.host.channel) {
    await room.host.client.removeChannel(room.host.channel)
    room.host.channel = null
  }
  await room.host.client.auth.signOut().catch(() => undefined)
}

async function createScenario(bots: BotCredential[], roomName: string, auctionMode: AuctionMode) {
  if (bots.length < 2) {
    throw new Error('Each room scenario requires at least 2 bot credentials.')
  }

  const host = await authenticateBot(bots[0]!)
  const { roomId, roomCode } = await createRoom(host, roomName, auctionMode)
  const scenarioBots = await Promise.all(bots.slice(1).map((credential) => authenticateBot(credential)))
  const metrics: ScenarioMetrics = {
    joinLatenciesMs: [],
    bidLatenciesMs: [],
    reconnectLatenciesMs: [],
    eventDeliveryLagMs: [],
    duplicateEvents: 0,
    totalEvents: 0
  }

  await subscribeRoom(host, roomId, metrics)

  for (const bot of scenarioBots) {
    await joinRoom(bot, roomCode, roomId, metrics)
    await subscribeRoom(bot, roomId, metrics)
  }

  return {
    roomId,
    roomCode,
    host,
    bots: scenarioBots,
    metrics
  } satisfies RoomScenario
}

async function runBotMode(credentials: BotCredential[]) {
  const roomSize = readNumberEnv('ROOM_BOT_COUNT', DEFAULT_ROOM_SIZE)
  const durationMs = readNumberEnv('ROOM_BOT_DURATION_MS', DEFAULT_DURATION_MS)
  const actionIntervalMs = readNumberEnv('ROOM_BOT_ACTION_INTERVAL_MS', DEFAULT_ACTION_INTERVAL_MS)
  const reconnectEveryMs = readNumberEnv('ROOM_BOT_RECONNECT_INTERVAL_MS', 12_000)
  const pauseResumeEveryMs = readNumberEnv('ROOM_BOT_PAUSE_RESUME_INTERVAL_MS', 18_000)
  const auctionMode = (getOptionalEnv('ROOM_BOT_AUCTION_MODE', 'full_auction') as AuctionMode) || 'full_auction'

  const scenario = await createScenario(credentials.slice(0, roomSize), `Realtime Bot Room ${Date.now()}`, auctionMode)

  try {
    await startAuction(scenario.host, scenario.roomId)
    await waitForRoomStatus(scenario.host.client, scenario.roomId, 'auction')
    await runActions(scenario, durationMs, actionIntervalMs, reconnectEveryMs, pauseResumeEveryMs)
    printSummary(`Bot Simulation Room ${scenario.roomCode}`, scenario.metrics)
  } finally {
    await teardownRoom(scenario)
  }
}

async function runLoadMode(credentials: BotCredential[]) {
  const roomSize = readNumberEnv('ROOM_LOAD_ROOM_SIZE', DEFAULT_ROOM_SIZE)
  const durationMs = readNumberEnv('ROOM_LOAD_DURATION_MS', DEFAULT_DURATION_MS)
  const actionIntervalMs = readNumberEnv('ROOM_LOAD_ACTION_INTERVAL_MS', DEFAULT_ACTION_INTERVAL_MS)
  const reconnectEveryMs = readNumberEnv('ROOM_LOAD_RECONNECT_INTERVAL_MS', 15_000)
  const pauseResumeEveryMs = readNumberEnv('ROOM_LOAD_PAUSE_RESUME_INTERVAL_MS', 22_000)
  const auctionMode = (getOptionalEnv('ROOM_LOAD_AUCTION_MODE', 'full_auction') as AuctionMode) || 'full_auction'
  const stages = readStages()

  for (const stage of stages) {
    const activeRooms = Math.ceil(stage / roomSize)
    const requiredBots = activeRooms * roomSize

    if (credentials.length < requiredBots) {
      throw new Error(`Stage ${stage} needs ${requiredBots} credentials for ${activeRooms} rooms of size ${roomSize}. Only ${credentials.length} provided.`)
    }

    const rooms: RoomScenario[] = []

    try {
      for (let index = 0; index < activeRooms; index += 1) {
        const sliceStart = index * roomSize
        const roomBots = credentials.slice(sliceStart, sliceStart + roomSize)
        const room = await createScenario(roomBots, `Load Stage ${stage} Room ${index + 1}`, auctionMode)
        rooms.push(room)
      }

      await Promise.all(rooms.map((room) => startAuction(room.host, room.roomId)))
      await Promise.all(rooms.map((room) => waitForRoomStatus(room.host.client, room.roomId, 'auction')))
      await Promise.all(rooms.map((room) => runActions(room, durationMs, actionIntervalMs, reconnectEveryMs, pauseResumeEveryMs)))

      const aggregated: ScenarioMetrics = {
        joinLatenciesMs: rooms.flatMap((room) => room.metrics.joinLatenciesMs),
        bidLatenciesMs: rooms.flatMap((room) => room.metrics.bidLatenciesMs),
        reconnectLatenciesMs: rooms.flatMap((room) => room.metrics.reconnectLatenciesMs),
        eventDeliveryLagMs: rooms.flatMap((room) => room.metrics.eventDeliveryLagMs),
        duplicateEvents: rooms.reduce((sum, room) => sum + room.metrics.duplicateEvents, 0),
        totalEvents: rooms.reduce((sum, room) => sum + room.metrics.totalEvents, 0)
      }

      printSummary(`Load Stage ${stage} Users Across ${activeRooms} Rooms`, aggregated)
    } finally {
      await Promise.all(rooms.map((room) => teardownRoom(room)))
    }
  }
}

async function main() {
  loadLocalEnv()

  const modeArg = process.argv.find((value) => value.startsWith('--mode='))?.split('=')[1] as Mode | undefined
  const mode = modeArg || ((getOptionalEnv('ROOM_TEST_MODE', 'bots') as Mode) || 'bots')
  const credentials = parseBotCredentials()

  if (mode === 'load') {
    await runLoadMode(credentials)
    return
  }

  await runBotMode(credentials)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
