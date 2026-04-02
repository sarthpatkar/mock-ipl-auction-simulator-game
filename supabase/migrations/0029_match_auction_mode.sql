alter table public.rooms
  add column if not exists auction_mode text not null default 'full_auction',
  add column if not exists match_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rooms_auction_mode_check'
      and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_auction_mode_check
      check (auction_mode in ('full_auction', 'match_auction'));
  end if;
end
$$;

alter table public.room_participants
  add column if not exists match_finish_confirmed_at timestamptz;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  season text,
  match_slug text not null unique,
  team_a_code text not null,
  team_b_code text not null,
  team_a_name text not null,
  team_b_name text not null,
  match_date timestamptz not null,
  venue text,
  status text not null default 'upcoming',
  external_match_id text,
  auction_enabled boolean not null default true,
  last_scorecard_upload_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('upcoming', 'live', 'completed', 'abandoned', 'cancelled'))
);

create index if not exists idx_rooms_auction_mode on public.rooms(auction_mode);
create index if not exists idx_rooms_match_id on public.rooms(match_id);
create index if not exists idx_matches_match_slug on public.matches(match_slug);
create index if not exists idx_matches_match_date on public.matches(match_date);
create index if not exists idx_matches_status on public.matches(status);

alter table public.matches enable row level security;

drop policy if exists "Authenticated users can read matches" on public.matches;
create policy "Authenticated users can read matches"
on public.matches
for select
using (auth.role() = 'authenticated');

alter table public.rooms
  drop constraint if exists rooms_match_id_fkey;

alter table public.rooms
  add constraint rooms_match_id_fkey
  foreign key (match_id) references public.matches(id) on delete set null deferrable initially deferred;

create table if not exists public.match_player_stats (
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  player_name_snapshot text not null,
  source_player_name text,
  team_code text not null,
  did_play boolean not null default true,
  is_playing_xi boolean not null default true,
  is_substitute boolean not null default false,
  parse_confidence numeric,
  runs integer not null default 0,
  balls integer not null default 0,
  fours integer not null default 0,
  sixes integer not null default 0,
  wickets integer not null default 0,
  overs numeric(4,1) not null default 0,
  maidens integer not null default 0,
  economy numeric(5,2),
  catches integer not null default 0,
  stumpings integer not null default 0,
  run_outs integer not null default 0,
  fantasy_points integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(match_id, player_id),
  check (parse_confidence is null or (parse_confidence >= 0 and parse_confidence <= 1))
);

create index if not exists idx_match_player_stats_match_id on public.match_player_stats(match_id);

alter table public.match_player_stats enable row level security;

drop policy if exists "Authenticated users can read match player stats" on public.match_player_stats;
create policy "Authenticated users can read match player stats"
on public.match_player_stats
for select
using (auth.role() = 'authenticated');

create table if not exists public.match_auction_results (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  projected_score integer not null default 0,
  actual_score integer,
  result_status text not null default 'provisional',
  rank integer,
  winner_user_id uuid references public.profiles(id) on delete set null,
  last_updated_at timestamptz not null default now(),
  last_result_updated_at timestamptz not null default now(),
  published_stats_version integer,
  unique(room_id, user_id),
  check (result_status in ('provisional', 'waiting_for_match', 'match_live', 'final_ready', 'match_abandoned'))
);

create index if not exists idx_match_auction_results_room_id on public.match_auction_results(room_id);

alter table public.match_auction_results enable row level security;

drop policy if exists "Room members can read match auction results" on public.match_auction_results;
create policy "Room members can read match auction results"
on public.match_auction_results
for select
using (
  exists (
    select 1
    from public.rooms r
    where r.id = match_auction_results.room_id
      and (r.admin_id = auth.uid() or public.is_room_member(r.id))
  )
);

create table if not exists public.raw_match_scorecards (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  raw_scorecard_text text not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  parsing_status text not null default 'pending',
  provider text,
  model text,
  raw_ai_response text,
  normalized_parsed_json jsonb,
  content_hash text,
  scorecard_version integer not null default 1,
  published_at timestamptz,
  published_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_raw_match_scorecards_match_id on public.raw_match_scorecards(match_id);

alter table public.raw_match_scorecards enable row level security;

create table if not exists public.match_scorecard_audit_logs (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  scorecard_id uuid references public.raw_match_scorecards(id) on delete set null,
  action_type text not null,
  acted_by uuid references public.profiles(id) on delete set null,
  acted_at timestamptz not null default now(),
  manual_row_change_count integer not null default 0,
  metadata_json jsonb,
  check (action_type in ('parsed', 'edited', 'published'))
);

alter table public.match_scorecard_audit_logs enable row level security;

drop function if exists public.create_room_with_admin(text, text, jsonb);

create or replace function public.get_available_match_auctions()
returns table (
  id uuid,
  season text,
  match_slug text,
  team_a_code text,
  team_b_code text,
  team_a_name text,
  team_b_name text,
  match_date timestamptz,
  venue text,
  status text,
  external_match_id text,
  auction_enabled boolean,
  eligible_player_count bigint,
  last_scorecard_upload_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    m.id,
    m.season,
    m.match_slug,
    m.team_a_code,
    m.team_b_code,
    m.team_a_name,
    m.team_b_name,
    m.match_date,
    m.venue,
    m.status,
    m.external_match_id,
    m.auction_enabled,
    (
      select count(*)
      from public.players p
      where p.team_code in (m.team_a_code, m.team_b_code)
    )::bigint as eligible_player_count,
    m.last_scorecard_upload_at
  from public.matches m
  where m.auction_enabled = true
    and m.status = 'upcoming'
    and m.match_date <= now() + interval '48 hours'
  order by m.match_date asc;
$$;

create or replace function public.clear_match_finish_confirmations(
  p_room_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.room_participants
  set match_finish_confirmed_at = null
  where room_id = p_room_id
    and removed_at is null
    and match_finish_confirmed_at is not null;
end;
$$;

create or replace function public.refresh_match_auction_provisional_results(
  p_room_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_match public.matches%rowtype;
  v_winner_user_id uuid;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id;

  if not found or v_room.auction_mode <> 'match_auction' or v_room.match_id is null then
    return;
  end if;

  select * into v_match
  from public.matches
  where id = v_room.match_id;

  delete from public.match_auction_results
  where room_id = p_room_id;

  with participant_scores as (
    select
      rp.room_id,
      rp.user_id,
      rp.joined_at,
      coalesce(
        sum(
          round(
            coalesce(p.performance_score, 0) * 0.55
            + coalesce(p.recent_form_score, 0) * 0.25
            + coalesce(p.consistency_score, 0) * 0.20
          )
        ),
        0
      )::int as projected_score
    from public.room_participants rp
    left join public.squad_players sp
      on sp.participant_id = rp.id
     and sp.room_id = rp.room_id
    left join public.players p
      on p.id = sp.player_id
    where rp.room_id = p_room_id
      and rp.removed_at is null
    group by rp.room_id, rp.user_id, rp.joined_at
  ),
  ranked as (
    select
      ps.*,
      dense_rank() over (order by ps.projected_score desc) as score_rank,
      row_number() over (order by ps.projected_score desc, ps.joined_at asc) as placement
    from participant_scores ps
  )
  select user_id into v_winner_user_id
  from ranked
  where placement = 1;

  insert into public.match_auction_results (
    room_id,
    user_id,
    projected_score,
    actual_score,
    result_status,
    rank,
    winner_user_id,
    last_updated_at,
    last_result_updated_at,
    published_stats_version
  )
  select
    p_room_id,
    ranked.user_id,
    ranked.projected_score,
    null,
    case
      when v_match.status = 'live' then 'match_live'
      when v_match.status in ('abandoned', 'cancelled') then 'match_abandoned'
      else 'waiting_for_match'
    end,
    ranked.score_rank,
    case when v_match.status in ('abandoned', 'cancelled') then null else v_winner_user_id end,
    now(),
    now(),
    null
  from ranked;
end;
$$;

create or replace function public.create_room_with_admin(
  p_name text,
  p_team_name text,
  p_settings jsonb default null,
  p_auction_mode text default 'full_auction',
  p_match_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_participant_id uuid;
  v_settings jsonb;
  v_match public.matches%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if nullif(trim(coalesce(p_name, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Room name is required');
  end if;

  if nullif(trim(coalesce(p_team_name, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Team name is required');
  end if;

  if coalesce(p_auction_mode, 'full_auction') not in ('full_auction', 'match_auction') then
    return jsonb_build_object('success', false, 'error', 'Invalid auction mode');
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
  ) then
    return jsonb_build_object('success', false, 'error', 'Profile not found');
  end if;

  v_settings := coalesce(
    p_settings,
    case
      when p_auction_mode = 'match_auction' then
        jsonb_build_object(
          'budget', 500000000,
          'squad_size', 7,
          'timer_seconds', 10,
          'player_order', 'random',
          'min_participants', 2,
          'max_participants', 2,
          'minimum_squad_size', 5
        )
      else
        jsonb_build_object(
          'budget', 1000000000,
          'squad_size', 20,
          'timer_seconds', 15,
          'player_order', 'category'
        )
    end
  );

  if p_auction_mode = 'match_auction' then
    if p_match_id is null then
      return jsonb_build_object('success', false, 'error', 'Match selection is required');
    end if;

    select * into v_match
    from public.matches
    where id = p_match_id
    for update;

    if not found or v_match.auction_enabled = false or v_match.status <> 'upcoming' then
      return jsonb_build_object('success', false, 'error', 'Selected match is not available');
    end if;

    if v_match.match_date > now() + interval '48 hours' then
      return jsonb_build_object('success', false, 'error', 'Selected match is outside the current auction window');
    end if;

    if coalesce((v_settings->>'budget')::bigint, 0) not in (500000000, 1000000000) then
      return jsonb_build_object('success', false, 'error', 'Match Auction purse must be 50 Cr or 100 Cr');
    end if;

    if coalesce((v_settings->>'squad_size')::int, 0) < 7 or coalesce((v_settings->>'squad_size')::int, 0) > 11 then
      return jsonb_build_object('success', false, 'error', 'Match Auction squad size must be between 7 and 11');
    end if;

    if coalesce((v_settings->>'min_participants')::int, 0) <> 2
       or coalesce((v_settings->>'max_participants')::int, 0) <> 2 then
      return jsonb_build_object('success', false, 'error', 'Match Auction requires exactly 2 participants');
    end if;

    if coalesce((v_settings->>'minimum_squad_size')::int, 0) <> 5 then
      return jsonb_build_object('success', false, 'error', 'Match Auction minimum squad size must be 5');
    end if;

    v_settings := jsonb_set(v_settings, '{player_order}', '"random"');
    v_settings := jsonb_set(v_settings, '{timer_seconds}', to_jsonb(10));
  end if;

  insert into public.rooms (
    name,
    admin_id,
    auction_mode,
    match_id,
    settings
  )
  values (
    trim(p_name),
    auth.uid(),
    coalesce(p_auction_mode, 'full_auction'),
    p_match_id,
    v_settings
  )
  returning * into v_room;

  insert into public.room_participants (
    room_id,
    user_id,
    team_name,
    budget_remaining
  )
  values (
    v_room.id,
    auth.uid(),
    trim(p_team_name),
    coalesce((v_settings->>'budget')::bigint, 1000000000)
  )
  returning id into v_participant_id;

  return jsonb_build_object(
    'success', true,
    'room_id', v_room.id,
    'participant_id', v_participant_id,
    'code', v_room.code
  );
end;
$$;

create or replace function public.join_room_by_code(
  p_code text,
  p_team_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_count int;
  v_participant_id uuid;
  v_limit int;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select * into v_room
  from public.rooms
  where code = p_code;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  select count(*) into v_count
  from public.room_participants
  where room_id = v_room.id
    and removed_at is null;

  v_limit := coalesce((v_room.settings->>'max_participants')::int, 10);

  if v_count >= v_limit and not exists (
    select 1
    from public.room_participants
    where room_id = v_room.id
      and user_id = auth.uid()
  ) then
    return jsonb_build_object('success', false, 'error', 'Room is full');
  end if;

  insert into public.room_participants (room_id, user_id, team_name, budget_remaining, removed_at, removal_reason, removed_by_user_id)
  values (
    v_room.id,
    auth.uid(),
    p_team_name,
    coalesce((v_room.settings->>'budget')::bigint, 1000000000),
    null,
    null,
    null
  )
  on conflict (room_id, user_id)
  do update set
    team_name = excluded.team_name,
    removed_at = null,
    removal_reason = null,
    removed_by_user_id = null
  returning id into v_participant_id;

  return jsonb_build_object(
    'success', true,
    'room_id', v_room.id,
    'participant_id', v_participant_id
  );
end;
$$;

create or replace function public.place_bid(
  p_auction_session_id uuid,
  p_bidder_participant_id uuid,
  p_bid_amount bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auction_sessions%rowtype;
  v_participant public.room_participants%rowtype;
  v_room public.rooms%rowtype;
  v_timer_seconds int;
  v_delta bigint;
begin
  select * into v_auction
  from public.auction_sessions
  where id = p_auction_session_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  if v_auction.status = 'paused' then
    return jsonb_build_object('success', false, 'error', 'Auction is paused');
  end if;

  if v_auction.status != 'live' then
    return jsonb_build_object('success', false, 'error', 'Auction not live');
  end if;

  if v_auction.ends_at is null or v_auction.ends_at <= now() then
    return jsonb_build_object('success', false, 'error', 'Timer expired');
  end if;

  if v_auction.highest_bidder_id = p_bidder_participant_id then
    return jsonb_build_object('success', false, 'error', 'Already highest bidder');
  end if;

  select * into v_room
  from public.rooms
  where id = v_auction.room_id;

  if v_auction.highest_bidder_id is null then
    if p_bid_amount != v_auction.current_price then
      return jsonb_build_object('success', false, 'error', 'Opening bid must match the base price');
    end if;
  else
    v_delta := p_bid_amount - v_auction.current_price;

    if p_bid_amount <= v_auction.current_price then
      return jsonb_build_object('success', false, 'error', 'Bid too low');
    end if;

    if v_room.auction_mode = 'match_auction' and v_delta not in (5000000, 20000000, 40000000) then
      return jsonb_build_object('success', false, 'error', 'Match Auction only allows +50 L, +2 Cr, or +4 Cr bids');
    end if;
  end if;

  if not (v_auction.active_bidders @> array[p_bidder_participant_id]) then
    return jsonb_build_object('success', false, 'error', 'You are not an active bidder for this player');
  end if;

  select * into v_participant
  from public.room_participants
  where id = p_bidder_participant_id
  for update;

  if not found or v_participant.user_id != auth.uid() or v_participant.removed_at is not null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized bidder');
  end if;

  if v_participant.budget_remaining < p_bid_amount then
    return jsonb_build_object('success', false, 'error', 'Insufficient budget');
  end if;

  v_timer_seconds := (v_room.settings->>'timer_seconds')::int;

  if v_participant.squad_count >= (v_room.settings->>'squad_size')::int then
    return jsonb_build_object('success', false, 'error', 'Squad full');
  end if;

  perform public.clear_match_finish_confirmations(v_room.id);

  update public.auction_sessions
  set
    current_price = p_bid_amount,
    highest_bidder_id = p_bidder_participant_id,
    ends_at = now() + (v_timer_seconds || ' seconds')::interval,
    skipped_bidders = '{}'
  where id = p_auction_session_id;

  insert into public.bids (auction_session_id, player_id, bidder_id, amount)
  values (p_auction_session_id, v_auction.current_player_id, p_bidder_participant_id, p_bid_amount);

  return jsonb_build_object(
    'success', true,
    'new_price', p_bid_amount,
    'ends_at', now() + (v_timer_seconds || ' seconds')::interval
  );
end;
$$;

create or replace function public.advance_to_next_player(
  p_auction_session_id uuid,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auction_sessions%rowtype;
  v_room public.rooms%rowtype;
  v_next_player_id uuid;
  v_timer_seconds int;
  v_active_participants uuid[];
  v_round_two_pool uuid[];
  v_selection_result jsonb;
begin
  select * into v_auction
  from public.auction_sessions
  where id = p_auction_session_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  select * into v_room
  from public.rooms
  where id = v_auction.room_id;

  if not exists (
    select 1
    from public.room_participants
    where room_id = v_auction.room_id
      and user_id = auth.uid()
      and removed_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_auction.status = 'paused' then
    return jsonb_build_object('success', false, 'error', 'Auction is paused');
  end if;

  if v_auction.status not in ('sold', 'unsold', 'waiting') then
    return jsonb_build_object('success', true, 'result', 'noop', 'status', v_auction.status);
  end if;

  select queued.player_id into v_next_player_id
  from unnest(coalesce(v_auction.player_queue, '{}')) with ordinality as queued(player_id, position)
  where not (queued.player_id = any(coalesce(v_auction.completed_players, '{}')))
  order by queued.position
  limit 1;

  if v_next_player_id is null then
    update public.auction_sessions
    set
      status = 'completed',
      current_player_id = null,
      highest_bidder_id = null,
      ends_at = null,
      paused_remaining_ms = null,
      active_bidders = '{}',
      skipped_bidders = '{}'
    where id = p_auction_session_id;

    if v_room.auction_mode = 'match_auction' then
      update public.rooms
      set
        status = 'completed',
        results_reveal_at = null
      where id = v_auction.room_id;

      perform public.refresh_match_auction_provisional_results(v_auction.room_id);
      return jsonb_build_object('success', true, 'result', 'completed');
    end if;

    if coalesce(v_auction.round_number, 1) = 1 then
      v_round_two_pool := public.compute_accelerated_round_pool(v_auction.room_id, v_auction.player_queue);
      if coalesce(array_length(v_round_two_pool, 1), 0) > 0 then
        select public.begin_accelerated_selection(v_auction.room_id) into v_selection_result;
        return coalesce(v_selection_result, jsonb_build_object('success', true, 'result', 'accelerated_selection'));
      end if;
    end if;

    perform public.complete_room_results_reveal(v_auction.room_id, coalesce(v_auction.round_number, 1) >= 2);
    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  v_timer_seconds := (v_room.settings->>'timer_seconds')::int;

  select array_agg(id order by joined_at) into v_active_participants
  from public.room_participants rp
  where rp.room_id = v_auction.room_id
    and rp.removed_at is null
    and rp.budget_remaining >= (select base_price from public.players where id = v_next_player_id)
    and rp.squad_count < (v_room.settings->>'squad_size')::int;

  perform public.clear_match_finish_confirmations(v_room.id);

  if v_active_participants is null or array_length(v_active_participants, 1) is null then
    update public.auction_sessions
    set
      current_player_id = v_next_player_id,
      current_price = (select base_price from public.players where id = v_next_player_id),
      highest_bidder_id = null,
      ends_at = null,
      paused_remaining_ms = null,
      status = 'unsold',
      completed_players = case
        when completed_players @> array[v_next_player_id] then completed_players
        else array_append(completed_players, v_next_player_id)
      end,
      active_bidders = '{}',
      skipped_bidders = '{}'
    where id = p_auction_session_id;

    return jsonb_build_object('success', true, 'result', 'auto_unsold', 'player', v_next_player_id);
  end if;

  update public.auction_sessions
  set
    current_player_id = v_next_player_id,
    current_price = (select base_price from public.players where id = v_next_player_id),
    highest_bidder_id = null,
    ends_at = now() + (v_timer_seconds || ' seconds')::interval,
    paused_remaining_ms = null,
    status = 'live',
    active_bidders = coalesce(v_active_participants, '{}'),
    skipped_bidders = '{}'
  where id = p_auction_session_id;

  return jsonb_build_object('success', true, 'result', 'advanced', 'next_player', v_next_player_id);
end;
$$;

create or replace function public.confirm_match_finish_early(
  p_room_id uuid,
  p_participant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_auction public.auction_sessions%rowtype;
  v_participant public.room_participants%rowtype;
  v_minimum_squad_size int;
  v_confirmed_count int;
  v_ready_count int;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found or v_room.auction_mode <> 'match_auction' then
    return jsonb_build_object('success', false, 'error', 'Match Auction room not found');
  end if;

  if v_room.status <> 'auction' then
    return jsonb_build_object('success', false, 'error', 'Finish Early is only available during the auction');
  end if;

  select * into v_participant
  from public.room_participants
  where id = p_participant_id
    and room_id = p_room_id
    and removed_at is null
  for update;

  if not found or v_participant.user_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized participant');
  end if;

  v_minimum_squad_size := coalesce((v_room.settings->>'minimum_squad_size')::int, 5);

  if v_participant.squad_count < v_minimum_squad_size then
    return jsonb_build_object('success', false, 'error', 'Minimum squad size not reached');
  end if;

  update public.room_participants
  set match_finish_confirmed_at = now()
  where id = p_participant_id;

  select count(*)
  into v_confirmed_count
  from public.room_participants
  where room_id = p_room_id
    and removed_at is null
    and match_finish_confirmed_at is not null;

  select count(*)
  into v_ready_count
  from public.room_participants
  where room_id = p_room_id
    and removed_at is null
    and squad_count >= v_minimum_squad_size;

  if v_confirmed_count >= 2 and v_ready_count >= 2 then
    select * into v_auction
    from public.auction_sessions
    where room_id = p_room_id
    for update;

    if found then
      update public.auction_sessions
      set
        status = 'completed',
        current_player_id = null,
        highest_bidder_id = null,
        ends_at = null,
        paused_remaining_ms = null,
        active_bidders = '{}',
        skipped_bidders = '{}'
      where id = v_auction.id;
    end if;

    update public.rooms
    set
      status = 'completed',
      results_reveal_at = null
    where id = p_room_id;

    perform public.refresh_match_auction_provisional_results(p_room_id);

    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  return jsonb_build_object(
    'success', true,
    'result', 'waiting',
    'confirmed_count', v_confirmed_count
  );
end;
$$;
