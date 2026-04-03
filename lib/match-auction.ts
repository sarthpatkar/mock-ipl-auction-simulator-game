import { MatchAuctionResultStatus, MatchPlayerStat, Player, Room, RoomParticipant, SquadPlayer } from '@/types'

export const FULL_AUCTION_MODE = 'full_auction'
export const MATCH_AUCTION_MODE = 'match_auction'
export const LEGENDS_AUCTION_MODE = 'legends_auction'

export const SEASON_PLAYER_POOL = 'season'
export const LEGENDS_PLAYER_POOL = 'legends'

export const MATCH_ROOM_BUDGET_OPTIONS = [500_000_000, 1_000_000_000] as const
export const MATCH_ROOM_SQUAD_OPTIONS = [7, 8, 9, 10, 11] as const
export const MATCH_ROOM_MINIMUM_SQUAD_SIZE = 5
export const MATCH_ROOM_PARTICIPANT_LIMIT = 2
export const MATCH_ROOM_TIMER_SECONDS = 10
export const MATCH_ROOM_PLAYER_ORDER = 'random'
export const MATCH_DROPDOWN_CACHE_TTL_MS = 5 * 60 * 1000
export const LEGENDS_ROOM_SQUAD_SIZE = 11
export const LEGENDS_ROOM_PARTICIPANT_LIMIT = 10
export const LEGENDS_ROOM_MINIMUM_PARTICIPANTS = 2

export const MATCH_QUICK_BID_INCREMENTS = [
  { label: '+50 L', amount: 5_000_000 },
  { label: '+2 Cr', amount: 20_000_000 },
  { label: '+4 Cr', amount: 40_000_000 }
] as const

export function isMatchAuctionRoom(room?: Pick<Room, 'auction_mode'> | null) {
  return room?.auction_mode === MATCH_AUCTION_MODE
}

export function isLegendsAuctionRoom(room?: Pick<Room, 'auction_mode'> | null) {
  return room?.auction_mode === LEGENDS_AUCTION_MODE
}

export function getRoomParticipantLimit(room?: Pick<Room, 'settings' | 'auction_mode'> | null) {
  if (isMatchAuctionRoom(room)) {
    return room?.settings.max_participants ?? MATCH_ROOM_PARTICIPANT_LIMIT
  }

  if (isLegendsAuctionRoom(room)) {
    return room?.settings.max_participants ?? LEGENDS_ROOM_PARTICIPANT_LIMIT
  }

  return room?.settings.max_participants ?? 10
}

export function getRoomMinimumParticipants(room?: Pick<Room, 'settings' | 'auction_mode'> | null) {
  if (isMatchAuctionRoom(room)) {
    return room?.settings.min_participants ?? MATCH_ROOM_PARTICIPANT_LIMIT
  }

  if (isLegendsAuctionRoom(room)) {
    return room?.settings.min_participants ?? LEGENDS_ROOM_MINIMUM_PARTICIPANTS
  }

  return room?.settings.min_participants ?? 2
}

export function getRoomMinimumSquadSize(room?: Pick<Room, 'settings' | 'auction_mode'> | null) {
  if (isMatchAuctionRoom(room)) {
    return room?.settings.minimum_squad_size ?? MATCH_ROOM_MINIMUM_SQUAD_SIZE
  }

  return room?.settings.minimum_squad_size ?? 0
}

export function computeProjectedPlayerScore(player?: Partial<Player> | null) {
  const performance = Number(player?.performance_score ?? 0)
  const recent = Number(player?.recent_form_score ?? 0)
  const consistency = Number(player?.consistency_score ?? 0)
  return Math.round(performance * 0.55 + recent * 0.25 + consistency * 0.2)
}

export function computeBestValuePlayer(
  squad: SquadPlayer[],
  playersById: Record<string, Player>
) {
  return squad.reduce<{ player: Player; value: number; pricePaid: number } | null>((best, entry) => {
    const player = playersById[entry.player_id]
    if (!player) return best

    const projected = computeProjectedPlayerScore(player)
    const priceInCrores = Math.max(entry.price_paid / 10_000_000, 0.25)
    const value = projected / priceInCrores

    if (!best || value > best.value) {
      return { player, value, pricePaid: entry.price_paid }
    }

    return best
  }, null)
}

export function computeMostExpensiveBuy(
  squad: SquadPlayer[],
  playersById: Record<string, Player>
) {
  return squad.reduce<{ player: Player; pricePaid: number } | null>((best, entry) => {
    const player = playersById[entry.player_id]
    if (!player) return best
    if (!best || entry.price_paid > best.pricePaid) {
      return { player, pricePaid: entry.price_paid }
    }
    return best
  }, null)
}

export function summarizeRoleBalance(squad: SquadPlayer[], playersById: Record<string, Player>) {
  return squad.reduce<Record<string, number>>((acc, entry) => {
    const role = playersById[entry.player_id]?.role ?? 'unknown'
    acc[role] = (acc[role] ?? 0) + 1
    return acc
  }, {})
}

export function calculateFantasyStylePoints(stat: Partial<MatchPlayerStat>) {
  const runs = Number(stat.runs ?? 0)
  const balls = Number(stat.balls ?? 0)
  const fours = Number(stat.fours ?? 0)
  const sixes = Number(stat.sixes ?? 0)
  const wickets = Number(stat.wickets ?? 0)
  const maidens = Number(stat.maidens ?? 0)
  const overs = Number(stat.overs ?? 0)
  const economy = Number(stat.economy ?? 0)
  const catches = Number(stat.catches ?? 0)
  const stumpings = Number(stat.stumpings ?? 0)
  const runOuts = Number(stat.run_outs ?? 0)

  let total = runs + fours + sixes * 2

  if (runs >= 100) total += 16
  else if (runs >= 50) total += 8

  if (balls >= 10) {
    const strikeRate = balls > 0 ? (runs / balls) * 100 : 0
    if (strikeRate >= 170) total += 6
    else if (strikeRate >= 150) total += 4
    else if (strikeRate >= 130) total += 2
    else if (strikeRate < 50) total -= 6
    else if (strikeRate < 60) total -= 4
    else if (strikeRate < 70) total -= 2
  }

  total += wickets * 25 + maidens * 8
  if (wickets >= 5) total += 16
  else if (wickets >= 3) total += 8

  if (overs >= 2) {
    if (economy < 6) total += 6
    else if (economy < 7) total += 4
    else if (economy < 8) total += 2
    else if (economy >= 12) total -= 6
    else if (economy >= 11) total -= 4
    else if (economy >= 10) total -= 2
  }

  total += catches * 8 + stumpings * 12 + runOuts * 10
  return total
}

export function getMatchResultStatusLabel(status?: MatchAuctionResultStatus | null) {
  if (status === 'waiting_for_match' || status === 'provisional') return 'Match Result Pending'
  if (status === 'match_live') return 'Match In Progress'
  if (status === 'final_ready') return 'Final Scores Ready'
  if (status === 'match_abandoned') return 'Match Abandoned'
  return 'Auction Completed'
}

export function formatMatchScore(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '0.00'
  return Number(value).toFixed(2)
}

export function getProjectedSquadScore(squad: SquadPlayer[], playersById: Record<string, Player>) {
  return squad.reduce((total, entry) => total + computeProjectedPlayerScore(playersById[entry.player_id]), 0)
}

export function getSuggestedCaptain(squad: SquadPlayer[], playersById: Record<string, Player>) {
  return squad.reduce<Player | null>((best, entry) => {
    const player = playersById[entry.player_id]
    if (!player) return best
    if (!best || computeProjectedPlayerScore(player) > computeProjectedPlayerScore(best)) {
      return player
    }
    return best
  }, null)
}

export function canConfirmFinishEarly(participant: RoomParticipant | undefined, room: Pick<Room, 'settings' | 'auction_mode'> | null) {
  if (!participant || !isMatchAuctionRoom(room)) return false
  return participant.squad_count >= getRoomMinimumSquadSize(room)
}
