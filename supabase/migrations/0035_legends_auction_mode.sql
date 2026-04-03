create table if not exists public.legend_players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  role text not null check (role in ('batter', 'wicketkeeper', 'allrounder', 'bowler')),
  category text not null default 'capped' check (category in ('capped', 'uncapped')),
  nationality text,
  latest_team_code text,
  batting_style text,
  bowling_style text,
  image_url text,
  base_price bigint not null,
  base_price_label text,
  team_history jsonb not null default '[]'::jsonb,
  ipl_seasons jsonb not null default '[]'::jsonb,
  career_batting_stats jsonb not null default '{}'::jsonb,
  career_bowling_stats jsonb not null default '{}'::jsonb,
  career_fielding_stats jsonb not null default '{}'::jsonb,
  overall_rating numeric,
  special_tags jsonb not null default '[]'::jsonb,
  matches int,
  batting_avg numeric,
  strike_rate numeric,
  wickets int,
  economy numeric,
  performance_score numeric,
  consistency_score numeric,
  recent_form_score numeric,
  experience_level text,
  impact_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.legend_players enable row level security;

drop policy if exists "Anyone can read legend players" on public.legend_players;
create policy "Anyone can read legend players"
on public.legend_players
for select
using (true);

drop policy if exists "No public insert legend players" on public.legend_players;
create policy "No public insert legend players"
on public.legend_players
for insert
with check (false);

drop policy if exists "No public update legend players" on public.legend_players;
create policy "No public update legend players"
on public.legend_players
for update
using (false);

alter table public.players
  add column if not exists player_pool text not null default 'season',
  add column if not exists legend_player_id uuid;

update public.players
set player_pool = 'season'
where player_pool is null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'rooms_auction_mode_check'
      and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      drop constraint rooms_auction_mode_check;
  end if;

  alter table public.rooms
    add constraint rooms_auction_mode_check
    check (auction_mode in ('full_auction', 'match_auction', 'legends_auction'));
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_player_pool_check'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_player_pool_check
      check (player_pool in ('season', 'legends'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_legend_player_id_fkey'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_legend_player_id_fkey
      foreign key (legend_player_id) references public.legend_players(id) on delete set null;
  end if;
end
$$;

create index if not exists idx_players_player_pool on public.players(player_pool);
create index if not exists idx_players_team_code_player_pool on public.players(team_code, player_pool);
create unique index if not exists idx_players_legend_player_id_unique on public.players(legend_player_id) where legend_player_id is not null;

create or replace function public.touch_legend_players_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_legend_players_updated_at on public.legend_players;
create trigger trg_touch_legend_players_updated_at
before update on public.legend_players
for each row
execute function public.touch_legend_players_updated_at();

create or replace function public.upsert_legend_player_engine_row(
  p_legend_player_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_legend public.legend_players%rowtype;
  v_engine_player_id uuid;
  v_matches int;
  v_batting_avg numeric;
  v_strike_rate numeric;
  v_wickets int;
  v_economy numeric;
  v_performance numeric;
  v_consistency numeric;
  v_recent numeric;
begin
  select * into v_legend
  from public.legend_players
  where id = p_legend_player_id;

  if not found then
    return null;
  end if;

  v_matches := coalesce(
    v_legend.matches,
    nullif(v_legend.career_batting_stats->>'matches', '')::int,
    nullif(v_legend.career_bowling_stats->>'matches', '')::int,
    case
      when jsonb_typeof(v_legend.ipl_seasons) = 'array' then jsonb_array_length(v_legend.ipl_seasons)
      else null
    end
  );
  v_batting_avg := coalesce(v_legend.batting_avg, nullif(v_legend.career_batting_stats->>'batting_avg', '')::numeric);
  v_strike_rate := coalesce(v_legend.strike_rate, nullif(v_legend.career_batting_stats->>'strike_rate', '')::numeric);
  v_wickets := coalesce(v_legend.wickets, nullif(v_legend.career_bowling_stats->>'wickets', '')::int);
  v_economy := coalesce(v_legend.economy, nullif(v_legend.career_bowling_stats->>'economy', '')::numeric);
  v_performance := coalesce(v_legend.performance_score, v_legend.overall_rating, 0);
  v_consistency := coalesce(v_legend.consistency_score, v_legend.overall_rating, v_performance, 0);
  v_recent := coalesce(v_legend.recent_form_score, v_legend.overall_rating, v_performance, 0);

  select id into v_engine_player_id
  from public.players
  where legend_player_id = v_legend.id
  limit 1;

  if v_engine_player_id is null then
    insert into public.players (
      name,
      nationality,
      team_code,
      role,
      category,
      batting_style,
      bowling_style,
      image_url,
      base_price,
      base_price_label,
      spouse,
      matches,
      batting_avg,
      strike_rate,
      wickets,
      economy,
      performance_score,
      consistency_score,
      recent_form_score,
      experience_level,
      impact_type,
      player_pool,
      legend_player_id
    )
    values (
      v_legend.name,
      v_legend.nationality,
      v_legend.latest_team_code,
      v_legend.role,
      v_legend.category,
      v_legend.batting_style,
      v_legend.bowling_style,
      v_legend.image_url,
      v_legend.base_price,
      v_legend.base_price_label,
      null,
      v_matches,
      v_batting_avg,
      v_strike_rate,
      v_wickets,
      v_economy,
      v_performance,
      v_consistency,
      v_recent,
      coalesce(v_legend.experience_level, 'legend'),
      v_legend.impact_type,
      'legends',
      v_legend.id
    )
    returning id into v_engine_player_id;
  else
    update public.players
    set
      name = v_legend.name,
      nationality = v_legend.nationality,
      team_code = v_legend.latest_team_code,
      role = v_legend.role,
      category = v_legend.category,
      batting_style = v_legend.batting_style,
      bowling_style = v_legend.bowling_style,
      image_url = v_legend.image_url,
      base_price = v_legend.base_price,
      base_price_label = v_legend.base_price_label,
      matches = v_matches,
      batting_avg = v_batting_avg,
      strike_rate = v_strike_rate,
      wickets = v_wickets,
      economy = v_economy,
      performance_score = v_performance,
      consistency_score = v_consistency,
      recent_form_score = v_recent,
      experience_level = coalesce(v_legend.experience_level, 'legend'),
      impact_type = v_legend.impact_type,
      player_pool = 'legends',
      legend_player_id = v_legend.id
    where id = v_engine_player_id;
  end if;

  return v_engine_player_id;
end;
$$;

create or replace function public.sync_legend_player_to_engine()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.upsert_legend_player_engine_row(new.id);
  return new;
end;
$$;

drop trigger if exists trg_sync_legend_player_to_engine on public.legend_players;
create trigger trg_sync_legend_player_to_engine
after insert or update on public.legend_players
for each row
execute function public.sync_legend_player_to_engine();

do $$
declare
  v_legend record;
begin
  for v_legend in
    select id
    from public.legend_players
  loop
    perform public.upsert_legend_player_engine_row(v_legend.id);
  end loop;
end
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

  if coalesce(p_auction_mode, 'full_auction') not in ('full_auction', 'match_auction', 'legends_auction') then
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
      when p_auction_mode = 'legends_auction' then
        jsonb_build_object(
          'budget', 1000000000,
          'squad_size', 11,
          'timer_seconds', 15,
          'player_order', 'category',
          'min_participants', 2,
          'max_participants', 10
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
  elsif p_auction_mode = 'legends_auction' then
    v_settings := jsonb_set(v_settings, '{squad_size}', to_jsonb(11));
    v_settings := jsonb_set(v_settings, '{min_participants}', to_jsonb(2));
    v_settings := jsonb_set(v_settings, '{max_participants}', to_jsonb(10));
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
    case when p_auction_mode = 'match_auction' then p_match_id else null end,
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
