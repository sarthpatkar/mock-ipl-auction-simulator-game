import { supabaseClient } from '@/lib/supabase'
import { RoomSettings, Room } from '@/types'

const ROOM_LIST_SELECT = 'id, code, name, admin_id, status, settings, created_at'

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  budget: 1_000_000_000,
  squad_size: 20,
  timer_seconds: 15,
  player_order: 'category'
}

type CreateRoomResult = {
  room_id: string
  participant_id: string
  code?: string
}

export async function createRoomWithAdmin(name: string, teamName: string, settings: RoomSettings = DEFAULT_ROOM_SETTINGS) {
  const { data, error } = await supabaseClient.rpc('create_room_with_admin', {
    p_name: name.trim(),
    p_team_name: teamName.trim(),
    p_settings: settings
  })

  if (error) throw error
  if (!data?.success) {
    throw new Error(data?.error || 'Failed to create room')
  }

  return data as CreateRoomResult & { success: true }
}

export async function fetchUserRooms(userId: string) {
  const [{ data: membershipRows, error: membershipError }, { data: adminRooms, error: adminRoomsError }] = await Promise.all([
    supabaseClient.from('room_participants').select('room_id').eq('user_id', userId),
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

  if (participantRowsError) throw participantRowsError

  ;((participantRows as { room_id: string }[] | null) ?? []).forEach((row) => {
    counts[row.room_id] = (counts[row.room_id] ?? 0) + 1
  })

  return { rooms, counts }
}
