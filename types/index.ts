export type UUID = string

export type AuctionMode = 'full_auction' | 'match_auction' | 'legends_auction'
export type MatchStatus = 'upcoming' | 'live' | 'completed' | 'abandoned' | 'cancelled'
export type MatchAuctionResultStatus = 'provisional' | 'waiting_for_match' | 'match_live' | 'final_ready' | 'match_abandoned'

export type RoomSettings = {
  budget: number
  squad_size: number
  timer_seconds: number
  player_order: 'category' | 'random'
  min_participants?: number
  max_participants?: number
  minimum_squad_size?: number
}

export type Profile = {
  id: UUID
  username: string
  created_at: string
}

export type Room = {
  id: UUID
  code: string
  name: string
  admin_id: UUID
  auction_mode: AuctionMode
  match_id?: UUID | null
  status: 'lobby' | 'auction' | 'accelerated_selection' | 'completed'
  settings: RoomSettings
  results_reveal_at?: string | null
  created_at: string
  state_version?: number
  match?: Match | null
  match_result_status?: MatchAuctionResultStatus | null
}

export type RoomSoundtrackPhase = 'accelerated_transition' | 'results_hold' | 'results_live' | 'idle'

export type RoomSoundtrackState = {
  enabled: boolean
  isPlaying: boolean
  phase: RoomSoundtrackPhase
}

export type RoomParticipant = {
  id: UUID
  room_id: UUID
  user_id: UUID
  team_name: string
  budget_remaining: number
  squad_count: number
  joined_at: string
  accelerated_round_submitted_at?: string | null
  match_finish_confirmed_at?: string | null
  removed_at?: string | null
  removed_by_user_id?: UUID | null
  removal_reason?: string | null
  profiles?: {
    username: string
  } | null
}

export type Player = {
  id: UUID
  name: string
  age: number | null
  nationality: string | null
  team_code: string | null
  role: 'batter' | 'wicketkeeper' | 'allrounder' | 'bowler'
  category: 'capped' | 'uncapped'
  batting_style: string | null
  bowling_style: string | null
  image_url: string | null
  base_price: number
  base_price_label: string | null
  spouse: string | null
  created_at: string
  matches?: number | null
  batting_avg?: number | null
  strike_rate?: number | null
  wickets?: number | null
  economy?: number | null
  performance_score?: number | null
  consistency_score?: number | null
  recent_form_score?: number | null
  experience_level?: string | null
  impact_type?: string | null
  player_pool?: 'season' | 'legends' | null
  legend_player_id?: UUID | null
}

export type AuctionSession = {
  id: UUID
  room_id: UUID
  current_player_id: UUID | null
  current_price: number
  highest_bidder_id: UUID | null
  ends_at: string | null
  status: 'waiting' | 'live' | 'paused' | 'sold' | 'unsold' | 'completed'
  player_queue: UUID[] | null
  completed_players: UUID[]
  active_bidders: UUID[]
  skipped_bidders: UUID[]
  round_label: string
  round_number?: number
  paused_remaining_ms?: number | null
  selection_ends_at?: string | null
  accelerated_source_players?: UUID[]
  created_at: string
  updated_at?: string | null
}

export type Match = {
  id: UUID
  season: string | null
  match_slug: string
  team_a_code: string
  team_b_code: string
  team_a_name: string
  team_b_name: string
  match_date: string
  venue: string | null
  status: MatchStatus
  external_match_id: string | null
  auction_enabled: boolean
  eligible_player_count?: number | null
  last_scorecard_upload_at?: string | null
}

export type MatchAuctionResult = {
  room_id: UUID
  user_id: UUID
  projected_score: number
  actual_score: number | null
  result_status: MatchAuctionResultStatus
  rank: number | null
  winner_user_id: UUID | null
  last_updated_at: string
  last_result_updated_at: string
  published_stats_version: number | null
}

export type MatchPlayerStat = {
  match_id: UUID
  player_id: UUID
  player_name_snapshot: string
  source_player_name: string | null
  team_code: string
  did_play: boolean
  is_playing_xi: boolean
  is_substitute: boolean
  parse_confidence: number | null
  runs: number
  balls: number
  fours: number
  sixes: number
  wickets: number
  overs: number
  maidens: number
  economy: number | null
  catches: number
  stumpings: number
  run_outs: number
  fantasy_points: number
  updated_at?: string | null
}

export type RawMatchScorecard = {
  id: UUID
  match_id: UUID
  raw_scorecard_text: string
  uploaded_by: UUID
  uploaded_at: string
  parsing_status: string
  provider: string | null
  model: string | null
  raw_ai_response: string | null
  normalized_parsed_json: Record<string, unknown> | null
  content_hash: string | null
  scorecard_version: number
  published_at: string | null
  published_by: UUID | null
}

export type MatchScorecardAuditLog = {
  id: UUID
  match_id: UUID
  scorecard_id: UUID | null
  action_type: 'parsed' | 'edited' | 'published'
  acted_by: UUID
  acted_at: string
  manual_row_change_count: number
  metadata_json: Record<string, unknown> | null
}

export type Bid = {
  id: UUID
  auction_session_id: UUID
  player_id: UUID
  bidder_id: UUID
  amount: number
  created_at: string
}

export type SquadPlayer = {
  id: UUID
  room_id: UUID
  participant_id: UUID
  player_id: UUID
  price_paid: number
  acquired_at: string
}

export type AuctionLiveState = {
  auction_session_id: UUID
  room_id: UUID
  current_player_id: UUID | null
  current_price: number
  highest_bidder_id: UUID | null
  ends_at: string | null
  status: AuctionSession['status']
  round_label?: string | null
  round_number?: number
  active_bidders?: UUID[]
  skipped_bidders?: UUID[]
  paused_remaining_ms?: number | null
  completed_count?: number
  queue_count?: number
  updated_at?: string | null
}

export type RoomHealthStatus = 'healthy' | 'recovering' | 'degraded' | 'desynced'

export type RoomRuntimeCache = {
  room_id: UUID
  current_player_id: UUID | null
  highest_bid: number
  highest_bidder_id: UUID | null
  timer_end: string | null
  live_participant_count: number
  current_room_status: Room['status']
  state_version: number
  room_health_status: RoomHealthStatus
  abandoned_at?: string | null
  updated_at: string
}

export type RoomEventEnvelope = {
  event_id: UUID
  version: number
  auction_session_id?: UUID | null
  event_type: string
  payload: Record<string, unknown> | null
  server_generated_at: string
  created_at: string
  total_gap_count?: number | null
}

export type RoomRuntimeSnapshot = {
  success: boolean
  error?: string
  room: Room | null
  auction: AuctionLiveState | null
  participants: RoomParticipant[]
  squads: SquadPlayer[]
  bid_history: Bid[]
  runtime_cache: RoomRuntimeCache | null
  state_version: number
  room_health_status: RoomHealthStatus | null
  server_time: string
}

export type AcceleratedRoundSelection = {
  id: UUID
  room_id: UUID
  participant_id: UUID
  player_id: UUID
  created_at: string
}

export type TeamResultComponent = {
  score: number
  max: number
}

export type TeamResultPenaltyItem = {
  code: string
  factor: string
  points: number
  message: string
}

export type TeamResultComparisonReason = {
  factor: string
  your_value: number
  winner_value: number
  impact: number
  message: string
}

export type TeamResultBreakdown = {
  team_score: number
  rank: number
  components: {
    player_strength: TeamResultComponent
    team_balance: TeamResultComponent
    role_coverage: TeamResultComponent
    star_power: TeamResultComponent
    synergy: TeamResultComponent
  }
  penalties: {
    total: number
    items: TeamResultPenaltyItem[]
  }
  best_xi_player_ids: UUID[]
  balance_detail: {
    role_counts: Record<string, number>
    deviations: Record<string, number>
    ideal_ranges: Record<string, { min: number; max: number }>
    total_deviation_cost: number
  }
  coverage_detail: {
    present_roles: string[]
    missing_roles: string[]
    present_count: number
    max_roles: number
    per_role_points: number
    score: number
  }
  star_detail: {
    star_count: number
    star_player_ids: UUID[]
    raw_score: number
    normalization_multiplier: number
    threshold: number
    score: number
    max: number
  }
  synergy_detail: {
    score: number
    max: number
    batting_depth: {
      score: number
      contributors: number
    }
    bowling_network: {
      score: number
      contributors: number
      specialist_bowlers: number
    }
    allrounder_support: {
      score: number
      count: number
    }
    experience_blend: {
      score: number
      rookie_count: number
      mid_count: number
      veteran_count: number
      rookie_share: number
    }
  }
  comparison: {
    winner_user_id: UUID
    winner_team_name: string
    winner_team_score: number
    score_gap: number
    component_deltas: Record<string, number>
    penalty_delta: number
    missing_roles_relative_to_winner: string[]
    star_count_delta: number
    best_xi_avg_delta: number
  } | null
  loss_reasons: TeamResultComparisonReason[]
  strength_highlights: string[]
  insights: string[]
  team_archetype: string
  near_miss: {
    is_near_miss: boolean
    score_gap: number | null
    closest_factor: string | null
    closest_impact: number | null
    message: string | null
  }
  ranking_tiebreak: {
    player_strength: number
    synergy: number
    budget_remaining: number
    joined_at: string
    user_id: UUID
  }
  raw_metrics: Record<string, unknown>
}

export type TeamResult = {
  room_id: UUID
  user_id: UUID
  team_score: number
  rank: number
  breakdown_json: TeamResultBreakdown
  created_at: string
  updated_at: string
}
