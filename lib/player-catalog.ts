import { supabaseClient } from '@/lib/supabase'
import { Player } from '@/types'

export const AUCTION_PLAYER_COLUMNS = [
  'id',
  'name',
  'age',
  'nationality',
  'team_code',
  'role',
  'category',
  'batting_style',
  'bowling_style',
  'image_url',
  'base_price',
  'base_price_label',
  'spouse',
  'created_at'
].join(', ')

export const SUMMARY_PLAYER_COLUMNS = [
  'id',
  'name',
  'team_code',
  'role',
  'base_price_label',
  'image_url'
].join(', ')

export const RESULTS_PLAYER_COLUMNS = [
  'id',
  'name',
  'team_code',
  'role',
  'image_url',
  'impact_type',
  'experience_level',
  'performance_score',
  'consistency_score',
  'recent_form_score',
  'matches',
  'batting_avg',
  'strike_rate',
  'wickets',
  'economy'
].join(', ')

const playerCatalogCache = new Map<string, Promise<Record<string, Player>> | Record<string, Player>>()

function toPlayerMap(players: Player[]) {
  return players.reduce<Record<string, Player>>((acc, player) => {
    acc[player.id] = player
    return acc
  }, {})
}

export async function fetchPlayerCatalog(columns: string) {
  const cached = playerCatalogCache.get(columns)
  if (cached) {
    return await cached
  }

  const pending = (async () => {
    try {
      const { data, error } = await supabaseClient.from('players').select(columns)
      if (error) throw error

      const map = toPlayerMap(((data as unknown) as Player[] | null) ?? [])
      playerCatalogCache.set(columns, map)
      return map
    } catch (error) {
      playerCatalogCache.delete(columns)
      throw error
    }
  })()

  playerCatalogCache.set(columns, pending)
  return await pending
}

export async function fetchPlayersByIds(ids: string[], columns: string) {
  if (ids.length === 0) return {} as Record<string, Player>

  const cached = playerCatalogCache.get(columns)
  if (cached) {
    const map = await cached
    const subset: Record<string, Player> = {}
    ids.forEach((id) => {
      if (map[id]) subset[id] = map[id]
    })
    if (Object.keys(subset).length === ids.length) {
      return subset
    }
  }

  const { data, error } = await supabaseClient.from('players').select(columns).in('id', ids)
  if (error) throw error

  return toPlayerMap(((data as unknown) as Player[] | null) ?? [])
}

export async function fetchPlayersByTeamCodes(teamCodes: string[], columns: string) {
  if (teamCodes.length === 0) return {} as Record<string, Player>

  const { data, error } = await supabaseClient.from('players').select(columns).in('team_code', teamCodes)
  if (error) throw error

  return toPlayerMap(((data as unknown) as Player[] | null) ?? [])
}
