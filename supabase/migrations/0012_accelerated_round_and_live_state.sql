do $$
declare
  v_constraint_name text;
begin
  select conname
  into v_constraint_name
  from pg_constraint
  where conrelid = 'public.rooms'::regclass
    and contype = 'c'
    and conname like '%status_check'
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.rooms drop constraint %I', v_constraint_name);
  end if;
end
$$;

alter table public.rooms
  add constraint rooms_status_check
  check (status in ('lobby', 'auction', 'accelerated_selection', 'completed'));

alter table public.auction_sessions
  add column if not exists round_number int not null default 1,
  add column if not exists paused_remaining_ms int,
  add column if not exists selection_ends_at timestamptz,
  add column if not exists accelerated_source_players uuid[] not null default '{}';

alter table public.room_participants
  add column if not exists accelerated_round_submitted_at timestamptz;

create table if not exists public.accelerated_round_selections (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete cascade not null,
  participant_id uuid references public.room_participants(id) on delete cascade not null,
  player_id uuid references public.players(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique (room_id, participant_id, player_id)
);

create index if not exists idx_accel_room_participant on public.accelerated_round_selections(room_id, participant_id);

alter table public.accelerated_round_selections enable row level security;

drop policy if exists "Room members can read accelerated selections" on public.accelerated_round_selections;
create policy "Room members can read accelerated selections"
on public.accelerated_round_selections
for select
using (is_room_member(room_id));

create table if not exists public.auction_live_state (
  auction_session_id uuid primary key references public.auction_sessions(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade not null unique,
  current_price bigint not null default 0,
  highest_bidder_id uuid references public.room_participants(id),
  ends_at timestamptz,
  status text not null,
  updated_at timestamptz default now()
);

alter table public.auction_live_state enable row level security;

drop policy if exists "Room members can read live auction state" on public.auction_live_state;
create policy "Room members can read live auction state"
on public.auction_live_state
for select
using (is_room_member(room_id));

create or replace function public.sync_auction_live_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.auction_live_state (
    auction_session_id,
    room_id,
    current_price,
    highest_bidder_id,
    ends_at,
    status,
    updated_at
  )
  values (
    new.id,
    new.room_id,
    coalesce(new.current_price, 0),
    new.highest_bidder_id,
    new.ends_at,
    new.status,
    coalesce(new.updated_at, now())
  )
  on conflict (auction_session_id) do update
  set
    room_id = excluded.room_id,
    current_price = excluded.current_price,
    highest_bidder_id = excluded.highest_bidder_id,
    ends_at = excluded.ends_at,
    status = excluded.status,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

drop trigger if exists trg_sync_auction_live_state on public.auction_sessions;
create trigger trg_sync_auction_live_state
after insert or update on public.auction_sessions
for each row execute function public.sync_auction_live_state();

insert into public.auction_live_state (
  auction_session_id,
  room_id,
  current_price,
  highest_bidder_id,
  ends_at,
  status,
  updated_at
)
select
  a.id,
  a.room_id,
  coalesce(a.current_price, 0),
  a.highest_bidder_id,
  a.ends_at,
  a.status,
  coalesce(a.updated_at, now())
from public.auction_sessions a
on conflict (auction_session_id) do update
set
  room_id = excluded.room_id,
  current_price = excluded.current_price,
  highest_bidder_id = excluded.highest_bidder_id,
  ends_at = excluded.ends_at,
  status = excluded.status,
  updated_at = excluded.updated_at;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'auction_live_state'
    ) then
      alter publication supabase_realtime add table public.auction_live_state;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'accelerated_round_selections'
    ) then
      alter publication supabase_realtime add table public.accelerated_round_selections;
    end if;
  end if;
end
$$;

create or replace function public.compute_unsold_round_pool(
  p_room_id uuid,
  p_completed_players uuid[]
)
returns uuid[]
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    array_agg(source.player_id order by source.position),
    '{}'::uuid[]
  )
  from unnest(coalesce(p_completed_players, '{}')) with ordinality as source(player_id, position)
  where not exists (
    select 1
    from public.squad_players sp
    where sp.room_id = p_room_id
      and sp.player_id = source.player_id
  );
$$;

create or replace function public.begin_accelerated_selection(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_auction public.auction_sessions%rowtype;
  v_unsold_pool uuid[];
begin
  select * into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  select * into v_auction
  from public.auction_sessions
  where room_id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  if not exists (
    select 1
    from public.room_participants
    where room_id = p_room_id
      and user_id = auth.uid()
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  v_unsold_pool := public.compute_unsold_round_pool(p_room_id, v_auction.completed_players);

  if coalesce(array_length(v_unsold_pool, 1), 0) = 0 then
    return jsonb_build_object('success', true, 'result', 'no_unsold_players');
  end if;

  delete from public.accelerated_round_selections where room_id = p_room_id;

  update public.room_participants
  set accelerated_round_submitted_at = null
  where room_id = p_room_id;

  update public.auction_sessions
  set
    status = 'waiting',
    current_player_id = null,
    current_price = 0,
    highest_bidder_id = null,
    ends_at = null,
    paused_remaining_ms = null,
    selection_ends_at = now() + interval '4 minutes',
    accelerated_source_players = v_unsold_pool,
    active_bidders = '{}',
    skipped_bidders = '{}',
    round_label = 'Accelerated Round'
  where id = v_auction.id;

  update public.rooms
  set status = 'accelerated_selection'
  where id = p_room_id;

  return jsonb_build_object(
    'success', true,
    'result', 'accelerated_selection',
    'player_count', coalesce(array_length(v_unsold_pool, 1), 0)
  );
end;
$$;

create or replace function public.submit_accelerated_selection(
  p_room_id uuid,
  p_participant_id uuid,
  p_player_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auction_sessions%rowtype;
  v_participant public.room_participants%rowtype;
begin
  select * into v_auction
  from public.auction_sessions
  where room_id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  if v_auction.selection_ends_at is null then
    return jsonb_build_object('success', false, 'error', 'Accelerated selection is not active');
  end if;

  if v_auction.selection_ends_at <= now() then
    return jsonb_build_object('success', false, 'error', 'Selection window closed');
  end if;

  select * into v_participant
  from public.room_participants
  where id = p_participant_id
    and room_id = p_room_id;

  if not found or v_participant.user_id != auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized participant');
  end if;

  delete from public.accelerated_round_selections
  where room_id = p_room_id
    and participant_id = p_participant_id;

  insert into public.accelerated_round_selections (room_id, participant_id, player_id)
  select
    p_room_id,
    p_participant_id,
    player_id
  from unnest(coalesce(p_player_ids, '{}')) as player_id
  where player_id = any(coalesce(v_auction.accelerated_source_players, '{}'))
  on conflict (room_id, participant_id, player_id) do nothing;

  update public.room_participants
  set accelerated_round_submitted_at = now()
  where id = p_participant_id;

  return jsonb_build_object(
    'success', true,
    'result', 'submitted',
    'selection_count', (
      select count(*)
      from public.accelerated_round_selections
      where room_id = p_room_id
        and participant_id = p_participant_id
    )
  );
end;
$$;

create or replace function public.finalize_accelerated_selection(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_auction public.auction_sessions%rowtype;
  v_total_participants int;
  v_submitted_participants int;
  v_final_pool uuid[];
  v_result jsonb;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  select * into v_auction
  from public.auction_sessions
  where room_id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  if not exists (
    select 1
    from public.room_participants
    where room_id = p_room_id
      and user_id = auth.uid()
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_room.status <> 'accelerated_selection' then
    return jsonb_build_object('success', true, 'result', 'noop', 'status', v_room.status);
  end if;

  select count(*), count(accelerated_round_submitted_at)
  into v_total_participants, v_submitted_participants
  from public.room_participants
  where room_id = p_room_id;

  if coalesce(v_submitted_participants, 0) < coalesce(v_total_participants, 0)
     and coalesce(v_auction.selection_ends_at, now() + interval '1 second') > now() then
    return jsonb_build_object(
      'success', true,
      'result', 'waiting',
      'submitted', coalesce(v_submitted_participants, 0),
      'total', coalesce(v_total_participants, 0)
    );
  end if;

  select coalesce(
    array_agg(source.player_id order by source.position),
    '{}'::uuid[]
  )
  into v_final_pool
  from unnest(coalesce(v_auction.accelerated_source_players, '{}')) with ordinality as source(player_id, position)
  where exists (
    select 1
    from public.accelerated_round_selections ars
    where ars.room_id = p_room_id
      and ars.player_id = source.player_id
  );

  if coalesce(array_length(v_final_pool, 1), 0) = 0 then
    update public.auction_sessions
    set
      status = 'completed',
      current_player_id = null,
      highest_bidder_id = null,
      current_price = 0,
      ends_at = null,
      paused_remaining_ms = null,
      selection_ends_at = null,
      active_bidders = '{}',
      skipped_bidders = '{}',
      round_number = 2,
      round_label = 'Accelerated Round'
    where id = v_auction.id;

    update public.rooms
    set status = 'completed'
    where id = p_room_id;

    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  update public.auction_sessions
  set
    round_number = 2,
    round_label = 'Accelerated Round',
    player_queue = v_final_pool,
    completed_players = '{}',
    current_player_id = null,
    current_price = 0,
    highest_bidder_id = null,
    ends_at = null,
    paused_remaining_ms = null,
    selection_ends_at = null,
    status = 'waiting',
    active_bidders = '{}',
    skipped_bidders = '{}'
  where id = v_auction.id;

  update public.rooms
  set status = 'auction'
  where id = p_room_id;

  select public.advance_to_next_player(v_auction.id, auth.uid()) into v_result;
  return coalesce(v_result, jsonb_build_object('success', true, 'result', 'accelerated_started'));
end;
$$;

create or replace function public.pause_auction(
  p_auction_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auction_sessions%rowtype;
  v_room public.rooms%rowtype;
  v_remaining_ms int;
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

  if v_room.admin_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Not admin');
  end if;

  if v_auction.status <> 'live' then
    return jsonb_build_object('success', false, 'error', 'Auction is not live');
  end if;

  v_remaining_ms := greatest(
    0,
    floor(extract(epoch from coalesce(v_auction.ends_at, now()) - now()) * 1000)::int
  );

  update public.auction_sessions
  set
    status = 'paused',
    paused_remaining_ms = v_remaining_ms,
    ends_at = null
  where id = p_auction_session_id;

  return jsonb_build_object('success', true, 'result', 'paused', 'remaining_ms', v_remaining_ms);
end;
$$;

create or replace function public.resume_auction(
  p_auction_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auction_sessions%rowtype;
  v_room public.rooms%rowtype;
  v_remaining_ms int;
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

  if v_room.admin_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Not admin');
  end if;

  if v_auction.status <> 'paused' then
    return jsonb_build_object('success', false, 'error', 'Auction is not paused');
  end if;

  v_remaining_ms := greatest(coalesce(v_auction.paused_remaining_ms, 0), 0);

  update public.auction_sessions
  set
    status = 'live',
    ends_at = now() + (v_remaining_ms || ' milliseconds')::interval,
    paused_remaining_ms = null
  where id = p_auction_session_id;

  return jsonb_build_object('success', true, 'result', 'live');
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
  v_unsold_pool uuid[];
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
    if coalesce(v_auction.round_number, 1) = 1 then
      v_unsold_pool := public.compute_unsold_round_pool(v_auction.room_id, v_auction.completed_players);
      if coalesce(array_length(v_unsold_pool, 1), 0) > 0 then
        select public.begin_accelerated_selection(v_auction.room_id) into v_selection_result;
        return coalesce(v_selection_result, jsonb_build_object('success', true, 'result', 'accelerated_selection'));
      end if;
    end if;

    update public.auction_sessions
    set
      status = 'completed',
      current_player_id = null,
      highest_bidder_id = null,
      ends_at = null,
      paused_remaining_ms = null
    where id = p_auction_session_id;

    update public.rooms
    set status = 'completed'
    where id = v_auction.room_id;

    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  v_timer_seconds := (v_room.settings->>'timer_seconds')::int;

  select array_agg(id order by joined_at) into v_active_participants
  from public.room_participants rp
  where rp.room_id = v_auction.room_id
    and rp.budget_remaining >= (select base_price from public.players where id = v_next_player_id)
    and rp.squad_count < (v_room.settings->>'squad_size')::int;

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
