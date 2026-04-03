import { supabaseClient } from '@/lib/supabase'
import { RoomSettings, Room, AuctionMode } from '@/types'
import {
  FULL_AUCTION_MODE,
  LEGENDS_AUCTION_MODE,
  LEGENDS_ROOM_MINIMUM_PARTICIPANTS,
  LEGENDS_ROOM_PARTICIPANT_LIMIT,
  LEGENDS_ROOM_SQUAD_SIZE,
  MATCH_AUCTION_MODE,
  MATCH_ROOM_BUDGET_OPTIONS,
  MATCH_ROOM_MINIMUM_SQUAD_SIZE,
  MATCH_ROOM_PARTICIPANT_LIMIT,
  MATCH_ROOM_PLAYER_ORDER,
  MATCH_ROOM_TIMER_SECONDS
} from '@/lib/match-auction'

const ROOM_LIST_SELECT = 'id, code, name, admin_id, auction_mode, match_id, status, settings, results_reveal_at, created_at'

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  budget: 1_000_000_000,
  squad_size: 20,
  timer_seconds: 15,
  player_order: 'category'
}

export const MATCH_AUCTION_DEFAULT_SETTINGS: RoomSettings = {
  budget: MATCH_ROOM_BUDGET_OPTIONS[0],
  squad_size: 7,
  timer_seconds: MATCH_ROOM_TIMER_SECONDS,
  player_order: MATCH_ROOM_PLAYER_ORDER,
  min_participants: MATCH_ROOM_PARTICIPANT_LIMIT,
  max_participants: MATCH_ROOM_PARTICIPANT_LIMIT,
  minimum_squad_size: MATCH_ROOM_MINIMUM_SQUAD_SIZE
}

export const LEGENDS_AUCTION_DEFAULT_SETTINGS: RoomSettings = {
  budget: DEFAULT_ROOM_SETTINGS.budget,
  squad_size: LEGENDS_ROOM_SQUAD_SIZE,
  timer_seconds: DEFAULT_ROOM_SETTINGS.timer_seconds,
  player_order: DEFAULT_ROOM_SETTINGS.player_order,
  min_participants: LEGENDS_ROOM_MINIMUM_PARTICIPANTS,
  max_participants: LEGENDS_ROOM_PARTICIPANT_LIMIT
}

type CreateRoomResult = {
  room_id: string
  participant_id: string
  code?: string
}

type CreateRoomOptions = {
  auctionMode?: AuctionMode
  matchId?: string | null
  settings?: RoomSettings
}

export async function createRoomWithAdmin(
  name: string,
  teamName: string,
  settingsOrOptions: RoomSettings | CreateRoomOptions = DEFAULT_ROOM_SETTINGS
) {
  const isDirectSettings = 'budget' in settingsOrOptions
  const auctionMode = isDirectSettings ? FULL_AUCTION_MODE : settingsOrOptions.auctionMode ?? FULL_AUCTION_MODE
  const settings = isDirectSettings
    ? settingsOrOptions
    : settingsOrOptions.settings ??
      (auctionMode === MATCH_AUCTION_MODE
        ? MATCH_AUCTION_DEFAULT_SETTINGS
        : auctionMode === LEGENDS_AUCTION_MODE
          ? LEGENDS_AUCTION_DEFAULT_SETTINGS
          : DEFAULT_ROOM_SETTINGS)
  const matchId = isDirectSettings ? null : settingsOrOptions.matchId ?? null

  const { data, error } = await supabaseClient.rpc('create_room_with_admin', {
    p_name: name.trim(),
    p_team_name: teamName.trim(),
    p_settings: settings,
    p_auction_mode: auctionMode,
    p_match_id: matchId
  })

  if (error) throw error
  if (!data?.success) {
    throw new Error(data?.error || 'Failed to create room')
  }

  return data as CreateRoomResult & { success: true }
}

export async function fetchUserRooms(userId: string) {
  const [{ data: membershipRows, error: membershipError }, { data: adminRooms, error: adminRoomsError }] = await Promise.all([
    supabaseClient.from('room_participants').select('room_id').eq('user_id', userId).is('removed_at', null),
    supabaseClient.from('rooms').select(ROOM_LIST_SELECT).eq('admin_id', userId).order('created_at', { ascending: false })
  ])

  if (membershipError) throw membershipError
  if (adminRoomsError) throw adminRoomsError

  const adminRoomList = (adminRooms as Room[] | null) ?? []
  const adminRoomIds = new Set(adminRoomList.map((room) => room.id))
  const participantRoomIds = ((membershipRows as { room_id: string }[] | null) ?? [])
    .map((membership) => membership.room_id)
    .filter((roomId) => !adminRoomIds.has(roomId))

  let participantRooms: Room[] = []

  if (participantRoomIds.length > 0) {
    const { data: memberRooms, error: memberRoomsError } = await supabaseClient
      .from('rooms')
      .select(ROOM_LIST_SELECT)
      .in('id', participantRoomIds)
      .order('created_at', { ascending: false })

    if (memberRoomsError) throw memberRoomsError
    participantRooms = (memberRooms as Room[] | null) ?? []
  }

  const rooms = [...adminRoomList, ...participantRooms].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  )

  if (rooms.length === 0) {
    return { rooms: [], counts: {} as Record<string, number> }
  }

  const roomIds = rooms.map((room) => room.id)
  const counts: Record<string, number> = {}
  const { data: participantCounts, error: participantCountsError } = await supabaseClient.rpc('get_room_participant_counts', {
    p_room_ids: roomIds
  })

  if (!participantCountsError) {
    ;((participantCounts as { room_id: string; participant_count: number }[] | null) ?? []).forEach((row) => {
      counts[row.room_id] = Number(row.participant_count)
    })
    return { rooms, counts }
  }

  const { data: participantRows, error: participantRowsError } = await supabaseClient
    .from('room_participants')
    .select('room_id')
    .in('room_id', roomIds)
    .is('removed_at', null)

  if (participantRowsError) throw participantRowsError

  ;((participantRows as { room_id: string }[] | null) ?? []).forEach((row) => {
    counts[row.room_id] = (counts[row.room_id] ?? 0) + 1
  })

  return { rooms, counts }
}
