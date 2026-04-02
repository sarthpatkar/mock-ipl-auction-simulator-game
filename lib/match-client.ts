import { MATCH_DROPDOWN_CACHE_TTL_MS } from '@/lib/match-auction'
import { supabaseClient } from '@/lib/supabase'
import { Match } from '@/types'

type MatchCacheEntry = {
  expiresAt: number
  data: Match[]
}

let availableMatchCache: MatchCacheEntry | null = null

const MATCH_HISTORY_SELECT = 'id, season, match_slug, team_a_code, team_b_code, team_a_name, team_b_name, match_date, venue, status, external_match_id, auction_enabled, last_scorecard_upload_at'

export async function fetchAvailableMatches(force = false) {
  const now = Date.now()
  if (!force && availableMatchCache && availableMatchCache.expiresAt > now) {
    return availableMatchCache.data
  }

  const { data, error } = await supabaseClient.rpc('get_available_match_auctions')
  if (error) throw error

  const matches = ((data as Match[] | null) ?? []).map((match) => ({
    ...match,
    eligible_player_count: Number(match.eligible_player_count ?? 0)
  }))

  availableMatchCache = {
    expiresAt: now + MATCH_DROPDOWN_CACHE_TTL_MS,
    data: matches
  }

  return matches
}

export async function fetchMatchesByIds(matchIds: string[]) {
  if (matchIds.length === 0) return {} as Record<string, Match>

  const { data, error } = await supabaseClient.from('matches').select(MATCH_HISTORY_SELECT).in('id', matchIds)
  if (error) throw error

  return (((data as Match[] | null) ?? []) as Match[]).reduce<Record<string, Match>>((acc, match) => {
    acc[match.id] = match
    return acc
  }, {})
}

