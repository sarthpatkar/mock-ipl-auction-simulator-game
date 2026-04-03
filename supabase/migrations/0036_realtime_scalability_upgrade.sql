alter table public.rooms
  add column if not exists state_version bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'room_health_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.room_health_status as enum ('healthy', 'recovering', 'degraded', 'desynced');
  end if;
end
$$;

create table if not exists public.room_event_log (
  id bigserial primary key,
  event_id uuid not null default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  version bigint not null,
  auction_session_id uuid references public.auction_sessions(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  source text not null default 'rpc',
  server_generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.room_event_log
  add column if not exists event_id uuid default gen_random_uuid(),
  add column if not exists room_id uuid,
  add column if not exists version bigint,
  add column if not exists auction_session_id uuid,
  add column if not exists event_type text,
  add column if not exists payload jsonb default '{}'::jsonb,
  add column if not exists source text default 'rpc',
  add column if not exists server_generated_at timestamptz default now(),
  add column if not exists created_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'room_event_log_room_version_unique'
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.room_event_log
      add constraint room_event_log_room_version_unique unique (room_id, version);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'room_event_log_event_id_unique'
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.room_event_log
      add constraint room_event_log_event_id_unique unique (event_id);
  end if;
end
$$;

create index if not exists idx_room_event_log_room_version_desc on public.room_event_log(room_id, version desc);
create index if not exists idx_room_event_log_created_at on public.room_event_log(created_at desc);

create table if not exists public.processed_request_keys (
  idempotency_key text primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  action_type text not null,
  created_at timestamptz not null default now()
);

alter table public.processed_request_keys
  add column if not exists idempotency_key text,
  add column if not exists room_id uuid,
  add column if not exists action_type text,
  add column if not exists created_at timestamptz default now();

create index if not exists idx_processed_request_keys_created_at on public.processed_request_keys(created_at desc);
create index if not exists idx_processed_request_keys_room_action on public.processed_request_keys(room_id, action_type, created_at desc);

create table if not exists public.room_runtime_cache (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  current_player_id uuid references public.players(id) on delete set null,
  highest_bid bigint not null default 0,
  highest_bidder_id uuid references public.room_participants(id) on delete set null,
  timer_end timestamptz,
  live_participant_count int not null default 0,
  current_room_status text not null default 'lobby',
  state_version bigint not null default 0,
  room_health_status public.room_health_status not null default 'healthy',
  abandoned_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.room_runtime_cache
  add column if not exists room_id uuid,
  add column if not exists current_player_id uuid,
  add column if not exists highest_bid bigint default 0,
  add column if not exists highest_bidder_id uuid,
  add column if not exists timer_end timestamptz,
  add column if not exists live_participant_count int default 0,
  add column if not exists current_room_status text default 'lobby',
  add column if not exists state_version bigint default 0,
  add column if not exists room_health_status public.room_health_status default 'healthy',
  add column if not exists abandoned_at timestamptz,
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_room_runtime_cache_status on public.room_runtime_cache(current_room_status, updated_at desc);

create table if not exists public.room_participant_presence (
  room_id uuid not null references public.rooms(id) on delete cascade,
  participant_id uuid not null references public.room_participants(id) on delete cascade,
  connection_id text not null,
  status text not null default 'connected',
  reconnect_count int not null default 0,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, participant_id, connection_id)
);

alter table public.room_participant_presence
  add column if not exists room_id uuid,
  add column if not exists participant_id uuid,
  add column if not exists connection_id text,
  add column if not exists status text default 'connected',
  add column if not exists reconnect_count int default 0,
  add column if not exists last_seen_at timestamptz default now(),
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_room_presence_room_seen on public.room_participant_presence(room_id, last_seen_at desc);
create index if not exists idx_room_presence_status on public.room_participant_presence(status, last_seen_at desc);

create table if not exists public.failed_room_events (
  id bigserial primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  event_id uuid,
  payload jsonb not null default '{}'::jsonb,
  failure_reason text not null,
  retry_count int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.failed_room_events
  add column if not exists room_id uuid,
  add column if not exists event_id uuid,
  add column if not exists payload jsonb default '{}'::jsonb,
  add column if not exists failure_reason text,
  add column if not exists retry_count int default 0,
  add column if not exists created_at timestamptz default now();

create index if not exists idx_failed_room_events_room_created on public.failed_room_events(room_id, created_at desc);

create table if not exists public.room_metrics_samples (
  id bigserial primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  reconnect_count int not null default 0,
  replay_gap_count int not null default 0,
  duplicate_event_count int not null default 0,
  average_delivery_lag_ms numeric not null default 0,
  stale_duration_ms bigint not null default 0,
  snapshot_hydrate_duration_ms bigint not null default 0,
  bid_acceptance_duration_ms bigint not null default 0,
  room_join_time_ms bigint not null default 0,
  room_hydrate_time_ms bigint not null default 0,
  replay_recovery_time_ms bigint not null default 0,
  next_player_transition_time_ms bigint not null default 0,
  event_delivery_lag_ms bigint not null default 0,
  reconnect_recovery_time_ms bigint not null default 0,
  sampled_at timestamptz not null default now()
);

alter table public.room_metrics_samples
  add column if not exists room_id uuid,
  add column if not exists reconnect_count int default 0,
  add column if not exists replay_gap_count int default 0,
  add column if not exists duplicate_event_count int default 0,
  add column if not exists average_delivery_lag_ms numeric default 0,
  add column if not exists stale_duration_ms bigint default 0,
  add column if not exists snapshot_hydrate_duration_ms bigint default 0,
  add column if not exists bid_acceptance_duration_ms bigint default 0,
  add column if not exists room_join_time_ms bigint default 0,
  add column if not exists room_hydrate_time_ms bigint default 0,
  add column if not exists replay_recovery_time_ms bigint default 0,
  add column if not exists next_player_transition_time_ms bigint default 0,
  add column if not exists event_delivery_lag_ms bigint default 0,
  add column if not exists reconnect_recovery_time_ms bigint default 0,
  add column if not exists sampled_at timestamptz default now();

create index if not exists idx_room_metrics_samples_room_sampled on public.room_metrics_samples(room_id, sampled_at desc);
create index if not exists idx_room_metrics_samples_sampled_at on public.room_metrics_samples(sampled_at desc);

create or replace view public.room_latency_rollups_5m as
with bucketed as (
  select
    room_id,
    date_bin('5 minutes', sampled_at, '1970-01-01 00:00:00+00'::timestamptz) as bucket_at,
    room_join_time_ms::numeric as room_join_time_ms,
    room_hydrate_time_ms::numeric as room_hydrate_time_ms,
    replay_recovery_time_ms::numeric as replay_recovery_time_ms,
    bid_acceptance_duration_ms::numeric as bid_acceptance_duration_ms,
    next_player_transition_time_ms::numeric as next_player_transition_time_ms,
    event_delivery_lag_ms::numeric as event_delivery_lag_ms,
    reconnect_recovery_time_ms::numeric as reconnect_recovery_time_ms
  from public.room_metrics_samples
)
select
  room_id,
  bucket_at,
  percentile_cont(0.50) within group (order by room_join_time_ms) as room_join_time_p50_ms,
  percentile_cont(0.95) within group (order by room_join_time_ms) as room_join_time_p95_ms,
  percentile_cont(0.99) within group (order by room_join_time_ms) as room_join_time_p99_ms,
  percentile_cont(0.50) within group (order by room_hydrate_time_ms) as room_hydrate_time_p50_ms,
  percentile_cont(0.95) within group (order by room_hydrate_time_ms) as room_hydrate_time_p95_ms,
  percentile_cont(0.99) within group (order by room_hydrate_time_ms) as room_hydrate_time_p99_ms,
  percentile_cont(0.50) within group (order by replay_recovery_time_ms) as replay_recovery_time_p50_ms,
  percentile_cont(0.95) within group (order by replay_recovery_time_ms) as replay_recovery_time_p95_ms,
  percentile_cont(0.99) within group (order by replay_recovery_time_ms) as replay_recovery_time_p99_ms,
  percentile_cont(0.50) within group (order by bid_acceptance_duration_ms) as bid_acceptance_time_p50_ms,
  percentile_cont(0.95) within group (order by bid_acceptance_duration_ms) as bid_acceptance_time_p95_ms,
  percentile_cont(0.99) within group (order by bid_acceptance_duration_ms) as bid_acceptance_time_p99_ms,
  percentile_cont(0.50) within group (order by next_player_transition_time_ms) as next_player_transition_time_p50_ms,
  percentile_cont(0.95) within group (order by next_player_transition_time_ms) as next_player_transition_time_p95_ms,
  percentile_cont(0.99) within group (order by next_player_transition_time_ms) as next_player_transition_time_p99_ms,
  percentile_cont(0.50) within group (order by event_delivery_lag_ms) as event_delivery_lag_p50_ms,
  percentile_cont(0.95) within group (order by event_delivery_lag_ms) as event_delivery_lag_p95_ms,
  percentile_cont(0.99) within group (order by event_delivery_lag_ms) as event_delivery_lag_p99_ms,
  percentile_cont(0.50) within group (order by reconnect_recovery_time_ms) as reconnect_recovery_time_p50_ms,
  percentile_cont(0.95) within group (order by reconnect_recovery_time_ms) as reconnect_recovery_time_p95_ms,
  percentile_cont(0.99) within group (order by reconnect_recovery_time_ms) as reconnect_recovery_time_p99_ms
from bucketed
group by room_id, bucket_at;

create or replace function public.capture_room_participant_snapshot(
  p_participant_id uuid
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select to_jsonb(snapshot)
  from (
    select
      rp.id,
      rp.room_id,
      rp.user_id,
      rp.team_name,
      rp.budget_remaining,
      rp.squad_count,
      rp.joined_at,
      rp.accelerated_round_submitted_at,
      rp.match_finish_confirmed_at,
      rp.removed_at,
      rp.removed_by_user_id,
      rp.removal_reason,
      case
        when pr.id is null then null
        else jsonb_build_object('username', pr.username)
      end as profiles
    from public.room_participants rp
    left join public.profiles pr
      on pr.id = rp.user_id
    where rp.id = p_participant_id
  ) snapshot;
$$;

create or replace function public.capture_room_squad_snapshot(
  p_room_id uuid,
  p_participant_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', sp.id,
        'room_id', sp.room_id,
        'participant_id', sp.participant_id,
        'player_id', sp.player_id,
        'price_paid', sp.price_paid,
        'acquired_at', sp.acquired_at
      )
      order by sp.acquired_at desc
    ),
    '[]'::jsonb
  )
  from public.squad_players sp
  where sp.room_id = p_room_id
    and (p_participant_id is null or sp.participant_id = p_participant_id);
$$;

create or replace function public.capture_auction_state_payload(
  p_auction_session_id uuid
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select to_jsonb(snapshot)
  from (
    select
      als.auction_session_id,
      als.room_id,
      als.current_player_id,
      als.current_price,
      als.highest_bidder_id,
      als.ends_at,
      als.status,
      als.round_number,
      als.round_label,
      als.active_bidders,
      als.skipped_bidders,
      als.paused_remaining_ms,
      als.completed_count,
      als.queue_count,
      als.updated_at
    from public.auction_live_state als
    where als.auction_session_id = p_auction_session_id
  ) snapshot;
$$;

create or replace function public.capture_latest_bid_payload(
  p_auction_session_id uuid
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select to_jsonb(snapshot)
  from (
    select
      b.id,
      b.auction_session_id,
      b.player_id,
      b.bidder_id,
      b.amount,
      b.created_at
    from public.bids b
    where b.auction_session_id = p_auction_session_id
    order by b.created_at desc, b.id desc
    limit 1
  ) snapshot;
$$;

create or replace function public.log_failed_room_event(
  p_room_id uuid,
  p_event_id uuid,
  p_payload jsonb,
  p_failure_reason text,
  p_retry_count int default 0
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.failed_room_events (
    room_id,
    event_id,
    payload,
    failure_reason,
    retry_count
  )
  values (
    p_room_id,
    p_event_id,
    coalesce(p_payload, '{}'::jsonb),
    p_failure_reason,
    coalesce(p_retry_count, 0)
  );
$$;

create or replace function public.claim_processed_request_key(
  p_idempotency_key text,
  p_room_id uuid,
  p_action_type text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_count bigint := 0;
begin
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    return true;
  end if;

  insert into public.processed_request_keys (
    idempotency_key,
    room_id,
    action_type
  )
  values (
    trim(p_idempotency_key),
    p_room_id,
    p_action_type
  )
  on conflict do nothing;

  get diagnostics v_inserted_count = row_count;
  return v_inserted_count > 0;
end;
$$;

create or replace function public.prune_processed_request_keys()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.processed_request_keys
  where created_at < now() - interval '24 hours';
$$;

create or replace function public.sync_room_runtime_cache(
  p_room_id uuid,
  p_room_health_status public.room_health_status default null
)
returns public.room_runtime_cache
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_auction public.auction_sessions%rowtype;
  v_existing public.room_runtime_cache%rowtype;
  v_live_participant_count int := 0;
  v_cache public.room_runtime_cache%rowtype;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id;

  if not found then
    return null;
  end if;

  select * into v_auction
  from public.auction_sessions
  where room_id = p_room_id;

  select * into v_existing
  from public.room_runtime_cache
  where room_id = p_room_id;

  select count(distinct rpp.participant_id)::int
  into v_live_participant_count
  from public.room_participant_presence rpp
  where rpp.room_id = p_room_id
    and rpp.status = 'connected'
    and rpp.last_seen_at >= now() - interval '45 seconds';

  insert into public.room_runtime_cache (
    room_id,
    current_player_id,
    highest_bid,
    highest_bidder_id,
    timer_end,
    live_participant_count,
    current_room_status,
    state_version,
    room_health_status,
    abandoned_at,
    updated_at
  )
  values (
    p_room_id,
    v_auction.current_player_id,
    coalesce(v_auction.current_price, 0),
    v_auction.highest_bidder_id,
    v_auction.ends_at,
    coalesce(v_live_participant_count, 0),
    v_room.status,
    v_room.state_version,
    coalesce(p_room_health_status, v_existing.room_health_status, 'healthy'::public.room_health_status),
    case
      when coalesce(v_live_participant_count, 0) = 0 and v_room.status in ('auction', 'accelerated_selection')
        then coalesce(v_existing.abandoned_at, now())
      else null
    end,
    now()
  )
  on conflict (room_id) do update
  set
    current_player_id = excluded.current_player_id,
    highest_bid = excluded.highest_bid,
    highest_bidder_id = excluded.highest_bidder_id,
    timer_end = excluded.timer_end,
    live_participant_count = excluded.live_participant_count,
    current_room_status = excluded.current_room_status,
    state_version = excluded.state_version,
    room_health_status = coalesce(p_room_health_status, public.room_runtime_cache.room_health_status, excluded.room_health_status),
    abandoned_at = excluded.abandoned_at,
    updated_at = excluded.updated_at
  returning * into v_cache;

  return v_cache;
end;
$$;

create or replace function public.append_room_event(
  p_room_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_source text default 'rpc',
  p_auction_session_id uuid default null,
  p_room_health_status public.room_health_status default null
)
returns table (
  event_id uuid,
  version bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_payload_size int;
  v_version bigint;
  v_event_id uuid;
begin
  v_payload_size := octet_length(v_payload::text);

  if v_payload_size > 5120 then
    perform public.log_failed_room_event(
      p_room_id,
      null,
      v_payload,
      format('Payload exceeds 5 KB hard limit (%s bytes)', v_payload_size),
      0
    );
    raise exception 'Room event payload exceeds 5 KB hard limit';
  end if;

  update public.rooms
  set state_version = state_version + 1
  where id = p_room_id
  returning state_version into v_version;

  perform public.sync_room_runtime_cache(p_room_id, p_room_health_status);

  insert into public.room_event_log (
    room_id,
    version,
    auction_session_id,
    event_type,
    payload,
    source
  )
  values (
    p_room_id,
    v_version,
    p_auction_session_id,
    p_event_type,
    v_payload,
    coalesce(p_source, 'rpc')
  )
  returning room_event_log.event_id into v_event_id;

  return query
  select v_event_id, v_version;
end;
$$;

create or replace function public.broadcast_room_event()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
begin
  perform realtime.broadcast_changes(
    'room:' || new.room_id::text,
    'room_event',
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  return null;
exception
  when others then
    perform public.log_failed_room_event(
      new.room_id,
      new.event_id,
      new.payload,
      'Broadcast failed: ' || SQLERRM,
      1
    );
    return null;
end;
$$;

drop trigger if exists trg_broadcast_room_event on public.room_event_log;
create trigger trg_broadcast_room_event
after insert on public.room_event_log
for each row
execute function public.broadcast_room_event();

create or replace function public.get_room_runtime_snapshot(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_snapshot jsonb;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Room not found'
    );
  end if;

  if not (
    auth.uid() is null
    or v_room.admin_id = auth.uid()
    or exists (
      select 1
      from public.room_participants rp
      where rp.room_id = p_room_id
        and rp.user_id = auth.uid()
        and rp.removed_at is null
    )
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'Unauthorized'
    );
  end if;

  perform public.sync_room_runtime_cache(p_room_id);

  select jsonb_build_object(
    'success', true,
    'room', to_jsonb(room_row),
    'auction', (
      select to_jsonb(als)
      from public.auction_live_state als
      where als.room_id = p_room_id
    ),
    'participants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', rp.id,
          'room_id', rp.room_id,
          'user_id', rp.user_id,
          'team_name', rp.team_name,
          'budget_remaining', rp.budget_remaining,
          'squad_count', rp.squad_count,
          'joined_at', rp.joined_at,
          'accelerated_round_submitted_at', rp.accelerated_round_submitted_at,
          'match_finish_confirmed_at', rp.match_finish_confirmed_at,
          'removed_at', rp.removed_at,
          'removed_by_user_id', rp.removed_by_user_id,
          'removal_reason', rp.removal_reason,
          'profiles', case
            when pr.id is null then null
            else jsonb_build_object('username', pr.username)
          end
        )
        order by rp.joined_at
      )
      from public.room_participants rp
      left join public.profiles pr
        on pr.id = rp.user_id
      where rp.room_id = p_room_id
    ), '[]'::jsonb),
    'squads', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', sp.id,
          'room_id', sp.room_id,
          'participant_id', sp.participant_id,
          'player_id', sp.player_id,
          'price_paid', sp.price_paid,
          'acquired_at', sp.acquired_at
        )
        order by sp.acquired_at desc
      )
      from public.squad_players sp
      where sp.room_id = p_room_id
    ), '[]'::jsonb),
    'bid_history', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'auction_session_id', b.auction_session_id,
          'player_id', b.player_id,
          'bidder_id', b.bidder_id,
          'amount', b.amount,
          'created_at', b.created_at
        )
        order by b.created_at desc, b.id desc
      )
      from (
        select b.*
        from public.bids b
        join public.auction_sessions a
          on a.id = b.auction_session_id
        where a.room_id = p_room_id
        order by b.created_at desc, b.id desc
        limit 50
      ) b
    ), '[]'::jsonb),
    'runtime_cache', (
      select to_jsonb(rrc)
      from public.room_runtime_cache rrc
      where rrc.room_id = p_room_id
    ),
    'state_version', v_room.state_version,
    'room_health_status', (
      select room_health_status
      from public.room_runtime_cache
      where room_id = p_room_id
    ),
    'server_time', now()
  )
  into v_snapshot
  from (
    select
      v_room.id,
      v_room.code,
      v_room.name,
      v_room.admin_id,
      v_room.auction_mode,
      v_room.match_id,
      v_room.status,
      v_room.settings,
      v_room.results_reveal_at,
      v_room.created_at,
      v_room.state_version
  ) room_row;

  return v_snapshot;
end;
$$;

create or replace function public.get_room_events_since(
  p_room_id uuid,
  p_after_version bigint default 0
)
returns table (
  event_id uuid,
  version bigint,
  auction_session_id uuid,
  event_type text,
  payload jsonb,
  server_generated_at timestamptz,
  created_at timestamptz,
  total_gap_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_room public.rooms%rowtype;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id;

  if not found then
    return;
  end if;

  if not (
    auth.uid() is null
    or v_room.admin_id = auth.uid()
    or exists (
      select 1
      from public.room_participants rp
      where rp.room_id = p_room_id
        and rp.user_id = auth.uid()
        and rp.removed_at is null
    )
  ) then
    return;
  end if;

  return query
  with base as (
    select
      rel.event_id,
      rel.version,
      rel.auction_session_id,
      rel.event_type,
      rel.payload,
      rel.server_generated_at,
      rel.created_at,
      octet_length(rel.payload::text) as payload_bytes
    from public.room_event_log rel
    where rel.room_id = p_room_id
      and rel.version > coalesce(p_after_version, 0)
    order by rel.version asc
  ),
  ranked as (
    select
      base.*,
      row_number() over (order by version asc) as sequence_number,
      count(*) over () as total_gap_count,
      sum(payload_bytes) over (order by version asc rows between unbounded preceding and current row) as running_payload_bytes
    from base
  )
  select
    ranked.event_id,
    ranked.version,
    ranked.auction_session_id,
    ranked.event_type,
    ranked.payload,
    ranked.server_generated_at,
    ranked.created_at,
    ranked.total_gap_count
  from ranked
  where ranked.sequence_number <= 100
    and ranked.running_payload_bytes <= 100000
  order by ranked.version asc;
end;
$$;

create or replace function public.record_room_metric_sample(
  p_room_id uuid,
  p_reconnect_count int default 0,
  p_replay_gap_count int default 0,
  p_duplicate_event_count int default 0,
  p_average_delivery_lag_ms numeric default 0,
  p_stale_duration_ms bigint default 0,
  p_snapshot_hydrate_duration_ms bigint default 0,
  p_bid_acceptance_duration_ms bigint default 0,
  p_room_join_time_ms bigint default 0,
  p_room_hydrate_time_ms bigint default 0,
  p_replay_recovery_time_ms bigint default 0,
  p_next_player_transition_time_ms bigint default 0,
  p_event_delivery_lag_ms bigint default 0,
  p_reconnect_recovery_time_ms bigint default 0
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.room_metrics_samples (
    room_id,
    reconnect_count,
    replay_gap_count,
    duplicate_event_count,
    average_delivery_lag_ms,
    stale_duration_ms,
    snapshot_hydrate_duration_ms,
    bid_acceptance_duration_ms,
    room_join_time_ms,
    room_hydrate_time_ms,
    replay_recovery_time_ms,
    next_player_transition_time_ms,
    event_delivery_lag_ms,
    reconnect_recovery_time_ms
  )
  values (
    p_room_id,
    coalesce(p_reconnect_count, 0),
    coalesce(p_replay_gap_count, 0),
    coalesce(p_duplicate_event_count, 0),
    coalesce(p_average_delivery_lag_ms, 0),
    coalesce(p_stale_duration_ms, 0),
    coalesce(p_snapshot_hydrate_duration_ms, 0),
    coalesce(p_bid_acceptance_duration_ms, 0),
    coalesce(p_room_join_time_ms, 0),
    coalesce(p_room_hydrate_time_ms, 0),
    coalesce(p_replay_recovery_time_ms, 0),
    coalesce(p_next_player_transition_time_ms, 0),
    coalesce(p_event_delivery_lag_ms, 0),
    coalesce(p_reconnect_recovery_time_ms, 0)
  );
$$;

create or replace function public.upsert_room_participant_presence(
  p_room_id uuid,
  p_participant_id uuid,
  p_connection_id text,
  p_status text default 'connected',
  p_reconnect_count int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.room_participant_presence%rowtype;
begin
  if auth.uid() is not null and not exists (
    select 1
    from public.room_participants rp
    where rp.id = p_participant_id
      and rp.room_id = p_room_id
      and rp.user_id = auth.uid()
      and rp.removed_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select * into v_existing
  from public.room_participant_presence
  where room_id = p_room_id
    and participant_id = p_participant_id
    and connection_id = p_connection_id;

  insert into public.room_participant_presence (
    room_id,
    participant_id,
    connection_id,
    status,
    reconnect_count,
    last_seen_at,
    updated_at
  )
  values (
    p_room_id,
    p_participant_id,
    p_connection_id,
    coalesce(p_status, 'connected'),
    coalesce(p_reconnect_count, 0),
    now(),
    now()
  )
  on conflict (room_id, participant_id, connection_id) do update
  set
    status = excluded.status,
    reconnect_count = excluded.reconnect_count,
    last_seen_at = now(),
    updated_at = now();

  perform public.sync_room_runtime_cache(
    p_room_id,
    case
      when coalesce(p_reconnect_count, 0) >= 4 then 'recovering'::public.room_health_status
      else null
    end
  );

  if not found or v_existing.status is distinct from coalesce(p_status, 'connected') then
    perform public.append_room_event(
      p_room_id,
      'participant_presence_updated',
      jsonb_build_object(
        'participant_id', p_participant_id,
        'connection_id', p_connection_id,
        'status', coalesce(p_status, 'connected'),
        'reconnect_count', coalesce(p_reconnect_count, 0),
        'last_seen_at', now()
      ),
      'presence'
    );
  end if;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.cleanup_stale_room_runtime()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_presence record;
  v_auction record;
  v_remaining_ms int;
begin
  for v_presence in
    select *
    from public.room_participant_presence
    where last_seen_at < now() - interval '90 seconds'
  loop
    delete from public.room_participant_presence
    where room_id = v_presence.room_id
      and participant_id = v_presence.participant_id
      and connection_id = v_presence.connection_id;

    perform public.sync_room_runtime_cache(v_presence.room_id, 'degraded'::public.room_health_status);

    perform public.append_room_event(
      v_presence.room_id,
      'participant_connection_lost',
      jsonb_build_object(
        'participant_id', v_presence.participant_id,
        'connection_id', v_presence.connection_id,
        'last_seen_at', v_presence.last_seen_at
      ),
      'presence-cleanup',
      null,
      'degraded'::public.room_health_status
    );
  end loop;

  for v_auction in
    select
      a.id as auction_session_id,
      a.room_id,
      a.ends_at,
      a.status,
      r.status as room_status
    from public.auction_sessions a
    join public.rooms r
      on r.id = a.room_id
    left join public.room_runtime_cache rrc
      on rrc.room_id = a.room_id
    where r.status = 'auction'
      and a.status = 'live'
      and coalesce(rrc.live_participant_count, 0) = 0
      and coalesce(rrc.abandoned_at, now()) <= now() - interval '3 minutes'
  loop
    v_remaining_ms := greatest(
      0,
      floor(extract(epoch from coalesce(v_auction.ends_at, now()) - now()) * 1000)::int
    );

    update public.auction_sessions
    set
      status = 'paused',
      paused_remaining_ms = v_remaining_ms,
      ends_at = null
    where id = v_auction.auction_session_id;

    perform public.sync_room_runtime_cache(v_auction.room_id, 'degraded'::public.room_health_status);

    perform public.append_room_event(
      v_auction.room_id,
      'auction_paused',
      jsonb_build_object(
        'auction', public.capture_auction_state_payload(v_auction.auction_session_id),
        'reason', 'stale_room_cleanup'
      ),
      'cron',
      v_auction.auction_session_id,
      'degraded'::public.room_health_status
    );
  end loop;

  delete from public.processed_request_keys
  where created_at < now() - interval '24 hours';
end;
$$;

create or replace function public.build_room_player_queue(
  p_room_id uuid
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_player_queue uuid[];
begin
  select * into v_room
  from public.rooms
  where id = p_room_id;

  if not found then
    return '{}'::uuid[];
  end if;

  with eligible_players as (
    select
      p.id,
      case p.role
        when 'batter' then 1
        when 'bowler' then 2
        when 'allrounder' then 3
        when 'wicketkeeper' then 4
        else 5
      end as role_order
    from public.players p
    left join public.matches m
      on m.id = v_room.match_id
    where p.player_pool = case
      when v_room.auction_mode = 'legends_auction' then 'legends'
      else 'season'
    end
      and (
        v_room.auction_mode <> 'match_auction'
        or (m.id is not null and p.team_code in (m.team_a_code, m.team_b_code))
      )
  )
  select coalesce(
    array_agg(
      eligible_players.id
      order by
        case
          when coalesce(v_room.settings->>'player_order', 'category') = 'random' then 1
          else eligible_players.role_order
        end,
        random()
    ),
    '{}'::uuid[]
  )
  into v_player_queue
  from eligible_players;

  return coalesce(v_player_queue, '{}'::uuid[]);
end;
$$;

drop policy if exists "authenticated can receive room realtime" on realtime.messages;
create policy "authenticated can receive room realtime"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and (select realtime.topic()) ~ '^room:[0-9a-fA-F-]{36}$'
  and exists (
    select 1
    from public.room_participants rp
    where rp.room_id = split_part((select realtime.topic()), ':', 2)::uuid
      and rp.user_id = auth.uid()
      and rp.removed_at is null
  )
);

drop policy if exists "authenticated can send room realtime" on realtime.messages;
create policy "authenticated can send room realtime"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and (select realtime.topic()) ~ '^room:[0-9a-fA-F-]{36}$'
  and exists (
    select 1
    from public.room_participants rp
    where rp.room_id = split_part((select realtime.topic()), ':', 2)::uuid
      and rp.user_id = auth.uid()
      and rp.removed_at is null
  )
);

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

  insert into public.room_participants (
    room_id,
    user_id,
    team_name,
    budget_remaining,
    removed_at,
    removal_reason,
    removed_by_user_id
  )
  values (
    v_room.id,
    auth.uid(),
    trim(p_team_name),
    coalesce((v_room.settings->>'budget')::bigint, 1000000000),
    null,
    null,
    null
  )
  on conflict (room_id, user_id)
  do update set
    team_name = excluded.team_name,
    budget_remaining = coalesce((v_room.settings->>'budget')::bigint, public.room_participants.budget_remaining),
    removed_at = null,
    removal_reason = null,
    removed_by_user_id = null
  returning id into v_participant_id;

  perform public.sync_room_runtime_cache(v_room.id);

  perform public.append_room_event(
    v_room.id,
    'participant_joined',
    jsonb_build_object(
      'participant', public.capture_room_participant_snapshot(v_participant_id)
    ),
    'rpc'
  );

  return jsonb_build_object(
    'success', true,
    'room_id', v_room.id,
    'participant_id', v_participant_id
  );
end;
$$;

create or replace function public.leave_room(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant public.room_participants%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select * into v_participant
  from public.room_participants
  where room_id = p_room_id
    and user_id = auth.uid()
  for update;

  if not found then
    return jsonb_build_object('success', true, 'result', 'noop');
  end if;

  delete from public.room_participants
  where id = v_participant.id;

  perform public.sync_room_runtime_cache(p_room_id);

  perform public.append_room_event(
    p_room_id,
    'participant_removed',
    jsonb_build_object(
      'participant_id', v_participant.id,
      'user_id', v_participant.user_id
    ),
    'rpc'
  );

  return jsonb_build_object('success', true, 'participant_id', v_participant.id);
end;
$$;

create or replace function public.update_room_settings(
  p_room_id uuid,
  p_settings jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  if v_room.admin_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Not admin');
  end if;

  if not public.claim_processed_request_key(p_idempotency_key, p_room_id, 'update_room_settings') then
    return jsonb_build_object('success', true, 'result', 'noop', 'idempotent', true);
  end if;

  update public.rooms
  set settings = coalesce(p_settings, settings)
  where id = p_room_id
  returning * into v_room;

  perform public.sync_room_runtime_cache(p_room_id);

  perform public.append_room_event(
    p_room_id,
    'room_settings_updated',
    jsonb_build_object(
      'room', jsonb_build_object(
        'id', v_room.id,
        'settings', v_room.settings,
        'status', v_room.status
      )
    ),
    'rpc'
  );

  return jsonb_build_object('success', true, 'room_id', p_room_id);
end;
$$;

create or replace function public.start_auction_session(
  p_room_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_session public.auction_sessions%rowtype;
  v_queue uuid[];
  v_result jsonb;
  v_advance_idempotency_key text;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  if v_room.admin_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Not admin');
  end if;

  if not public.claim_processed_request_key(p_idempotency_key, p_room_id, 'start_auction_session') then
    return jsonb_build_object('success', true, 'result', 'noop', 'idempotent', true);
  end if;

  v_queue := public.build_room_player_queue(p_room_id);

  if coalesce(array_length(v_queue, 1), 0) = 0 then
    return jsonb_build_object('success', false, 'error', 'Player queue is empty');
  end if;

  update public.room_participants
  set match_finish_confirmed_at = null
  where room_id = p_room_id
    and removed_at is null;

  select * into v_session
  from public.auction_sessions
  where room_id = p_room_id
  for update;

  if found then
    update public.auction_sessions
    set
      player_queue = v_queue,
      status = 'waiting',
      completed_players = '{}',
      current_player_id = null,
      current_price = 0,
      highest_bidder_id = null,
      ends_at = null,
      paused_remaining_ms = null,
      selection_ends_at = null,
      accelerated_source_players = '{}',
      active_bidders = '{}',
      skipped_bidders = '{}',
      round_number = 1,
      round_label = 'Round 1'
    where id = v_session.id
    returning * into v_session;
  else
    insert into public.auction_sessions (
      room_id,
      player_queue,
      status,
      round_number,
      round_label
    )
    values (
      p_room_id,
      v_queue,
      'waiting',
      1,
      'Round 1'
    )
    returning * into v_session;
  end if;

  update public.rooms
  set
    status = 'auction',
    results_reveal_at = null
  where id = p_room_id;

  perform public.sync_room_runtime_cache(p_room_id);

  perform public.append_room_event(
    p_room_id,
    'auction_started',
    jsonb_build_object(
      'auction_session_id', v_session.id,
      'room_status', 'auction'
    ),
    'rpc',
    v_session.id
  );

  v_advance_idempotency_key := coalesce(p_idempotency_key, gen_random_uuid()::text) || ':advance';

  execute 'select public.advance_to_next_player($1, $2, $3)'
    into v_result
    using v_session.id, auth.uid(), v_advance_idempotency_key;

  return coalesce(v_result, jsonb_build_object('success', true, 'room_id', p_room_id));
end;
$$;

create or replace function public.reset_auction_session(
  p_room_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.start_auction_session(p_room_id, p_idempotency_key);
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
  v_result jsonb;
begin
  execute 'select public.pause_auction($1, null::text)'
    into v_result
    using p_auction_session_id;

  return v_result;
end;
$$;

create or replace function public.pause_auction(
  p_auction_session_id uuid,
  p_idempotency_key text
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

  if not public.claim_processed_request_key(p_idempotency_key, v_room.id, 'pause_auction') then
    return jsonb_build_object('success', true, 'result', 'noop', 'idempotent', true);
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

  perform public.sync_room_runtime_cache(v_room.id);

  perform public.append_room_event(
    v_room.id,
    'auction_paused',
    jsonb_build_object(
      'auction', public.capture_auction_state_payload(p_auction_session_id),
      'remaining_ms', v_remaining_ms
    ),
    'rpc',
    p_auction_session_id
  );

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
  v_result jsonb;
begin
  execute 'select public.resume_auction($1, null::text)'
    into v_result
    using p_auction_session_id;

  return v_result;
end;
$$;

create or replace function public.resume_auction(
  p_auction_session_id uuid,
  p_idempotency_key text
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

  if not public.claim_processed_request_key(p_idempotency_key, v_room.id, 'resume_auction') then
    return jsonb_build_object('success', true, 'result', 'noop', 'idempotent', true);
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

  perform public.sync_room_runtime_cache(v_room.id);

  perform public.append_room_event(
    v_room.id,
    'auction_resumed',
    jsonb_build_object(
      'auction', public.capture_auction_state_payload(p_auction_session_id)
    ),
    'rpc',
    p_auction_session_id
  );

  return jsonb_build_object('success', true, 'result', 'live');
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
  v_result jsonb;
begin
  execute 'select public.place_bid($1, $2, $3, null::text)'
    into v_result
    using p_auction_session_id, p_bidder_participant_id, p_bid_amount;

  return v_result;
end;
$$;

create or replace function public.place_bid(
  p_auction_session_id uuid,
  p_bidder_participant_id uuid,
  p_bid_amount bigint,
  p_idempotency_key text
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
  v_reconcile_result jsonb;
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

  if not public.claim_processed_request_key(p_idempotency_key, v_room.id, 'place_bid') then
    return jsonb_build_object('success', true, 'result', 'noop', 'idempotent', true);
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

  select public.reconcile_current_auction_skips(p_auction_session_id) into v_reconcile_result;

  if coalesce(v_reconcile_result->>'result', '') in ('sold', 'unsold') then
    perform public.sync_room_runtime_cache(v_room.id);
    perform public.append_room_event(
      v_room.id,
      'player_resolved',
      jsonb_build_object(
        'auction', public.capture_auction_state_payload(p_auction_session_id),
        'result', v_reconcile_result
      ),
      'rpc',
      p_auction_session_id
    );
    return v_reconcile_result;
  end if;

  select * into v_auction
  from public.auction_sessions
  where id = p_auction_session_id
  for update;

  if v_auction.highest_bidder_id = p_bidder_participant_id then
    return jsonb_build_object('success', false, 'error', 'Already highest bidder');
  end if;

  if not (v_auction.active_bidders @> array[p_bidder_participant_id]) then
    return jsonb_build_object('success', false, 'error', 'You are not an active bidder for this player');
  end if;

  if coalesce(v_auction.skipped_bidders, '{}'::uuid[]) @> array[p_bidder_participant_id] then
    return jsonb_build_object('success', false, 'error', 'You are skipped for this player');
  end if;

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
    ends_at = now() + (v_timer_seconds || ' seconds')::interval
  where id = p_auction_session_id;

  insert into public.bids (auction_session_id, player_id, bidder_id, amount)
  values (p_auction_session_id, v_auction.current_player_id, p_bidder_participant_id, p_bid_amount);

  select public.reconcile_current_auction_skips(p_auction_session_id) into v_reconcile_result;

  perform public.sync_room_runtime_cache(v_room.id);

  if coalesce(v_reconcile_result->>'result', '') in ('sold', 'unsold') then
    perform public.append_room_event(
      v_room.id,
      'player_resolved',
      jsonb_build_object(
        'auction', public.capture_auction_state_payload(p_auction_session_id),
        'bid', public.capture_latest_bid_payload(p_auction_session_id),
        'result', v_reconcile_result
      ),
      'rpc',
      p_auction_session_id
    );
    return v_reconcile_result;
  end if;

  perform public.append_room_event(
    v_room.id,
    'bid_accepted',
    jsonb_build_object(
      'auction', public.capture_auction_state_payload(p_auction_session_id),
      'bid', public.capture_latest_bid_payload(p_auction_session_id)
    ),
    'rpc',
    p_auction_session_id
  );

  return jsonb_build_object(
    'success', true,
    'new_price', p_bid_amount,
    'ends_at', now() + (v_timer_seconds || ' seconds')::interval
  );
end;
$$;

create or replace function public.finalize_player(
  p_auction_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  execute 'select public.finalize_player($1, null::text)'
    into v_result
    using p_auction_session_id;

  return v_result;
end;
$$;

create or replace function public.finalize_player(
  p_auction_session_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auction_sessions%rowtype;
  v_reconcile_result jsonb;
  v_result jsonb;
begin
  select * into v_auction
  from public.auction_sessions
  where id = p_auction_session_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  if auth.uid() is not null and not exists (
    select 1
    from public.room_participants
    where room_id = v_auction.room_id
      and user_id = auth.uid()
      and removed_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if not public.claim_processed_request_key(p_idempotency_key, v_auction.room_id, 'finalize_player') then
    return jsonb_build_object('success', true, 'result', 'noop', 'idempotent', true);
  end if;

  if v_auction.status in ('sold', 'unsold', 'completed', 'paused') then
    return jsonb_build_object('success', true, 'result', v_auction.status, 'note', 'Already finalized');
  end if;

  if v_auction.status != 'live' then
    return jsonb_build_object('success', false, 'error', 'Cannot finalize — status is ' || v_auction.status);
  end if;

  if v_auction.ends_at is not null and v_auction.ends_at > now() then
    return jsonb_build_object('success', false, 'error', 'Timer not expired');
  end if;

  select public.reconcile_current_auction_skips(p_auction_session_id) into v_reconcile_result;

  if coalesce(v_reconcile_result->>'result', '') in ('sold', 'unsold') then
    v_result := v_reconcile_result;
  elsif v_auction.highest_bidder_id is not null then
    select public.resolve_current_auction_player(
      p_auction_session_id,
      v_auction.highest_bidder_id,
      v_auction.current_price,
      false
    ) into v_result;
  else
    select public.resolve_current_auction_player(
      p_auction_session_id,
      null,
      v_auction.current_price,
      false
    ) into v_result;
  end if;

  perform public.sync_room_runtime_cache(v_auction.room_id);

  perform public.append_room_event(
    v_auction.room_id,
    'player_resolved',
    jsonb_build_object(
      'auction', public.capture_auction_state_payload(p_auction_session_id),
      'result', v_result,
      'participant', case
        when v_auction.highest_bidder_id is null then null
        else public.capture_room_participant_snapshot(v_auction.highest_bidder_id)
      end,
      'squad', public.capture_room_squad_snapshot(v_auction.room_id, v_auction.highest_bidder_id)
    ),
    'rpc',
    p_auction_session_id
  );

  return v_result;
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
  v_result jsonb;
begin
  execute 'select public.advance_to_next_player($1, $2, null::text)'
    into v_result
    using p_auction_session_id, p_admin_user_id;

  return v_result;
end;
$$;

create or replace function public.advance_to_next_player(
  p_auction_session_id uuid,
  p_admin_user_id uuid,
  p_idempotency_key text
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
  v_total_participants int;
  v_full_participants int;
  v_zero_budget_participants int;
  v_advance_result jsonb;
  v_event_type text := 'next_player_loaded';
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

  if auth.uid() is not null and not exists (
    select 1
    from public.room_participants
    where room_id = v_auction.room_id
      and user_id = auth.uid()
      and removed_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if not public.claim_processed_request_key(p_idempotency_key, v_room.id, 'advance_to_next_player') then
    return jsonb_build_object('success', true, 'result', 'noop', 'idempotent', true);
  end if;

  if v_auction.status = 'paused' then
    return jsonb_build_object('success', false, 'error', 'Auction is paused');
  end if;

  if v_auction.status not in ('sold', 'unsold', 'waiting') then
    return jsonb_build_object('success', true, 'result', 'noop', 'status', v_auction.status);
  end if;

  if v_room.auction_mode = 'match_auction' and coalesce(v_auction.round_number, 1) = 1 then
    select
      count(*),
      count(*) filter (where squad_count >= (v_room.settings->>'squad_size')::int),
      count(*) filter (where budget_remaining <= 0)
    into v_total_participants, v_full_participants, v_zero_budget_participants
    from public.room_participants
    where room_id = v_auction.room_id
      and removed_at is null;

    if coalesce(v_total_participants, 0) > 0
       and (
         v_full_participants = v_total_participants
         or v_zero_budget_participants = v_total_participants
       ) then
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

      update public.rooms
      set
        status = 'completed',
        results_reveal_at = null
      where id = v_auction.room_id;

      perform public.refresh_match_auction_provisional_results(v_auction.room_id);

      perform public.sync_room_runtime_cache(v_auction.room_id);
      perform public.append_room_event(
        v_auction.room_id,
        'room_completed',
        jsonb_build_object(
          'auction', public.capture_auction_state_payload(p_auction_session_id),
          'room_status', 'completed'
        ),
        'rpc',
        p_auction_session_id
      );

      return jsonb_build_object('success', true, 'result', 'completed');
    end if;
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
      perform public.sync_room_runtime_cache(v_auction.room_id);
      perform public.append_room_event(
        v_auction.room_id,
        'room_completed',
        jsonb_build_object(
          'auction', public.capture_auction_state_payload(p_auction_session_id),
          'room_status', 'completed'
        ),
        'rpc',
        p_auction_session_id
      );
      return jsonb_build_object('success', true, 'result', 'completed');
    end if;

    if coalesce(v_auction.round_number, 1) = 1 then
      v_round_two_pool := public.compute_accelerated_round_pool(v_auction.room_id, v_auction.player_queue);
      if coalesce(array_length(v_round_two_pool, 1), 0) > 0 then
        select public.begin_accelerated_selection(v_auction.room_id) into v_selection_result;
        perform public.sync_room_runtime_cache(v_auction.room_id);
        perform public.append_room_event(
          v_auction.room_id,
          'accelerated_selection_started',
          jsonb_build_object(
            'result', v_selection_result
          ),
          'rpc',
          p_auction_session_id
        );
        return coalesce(v_selection_result, jsonb_build_object('success', true, 'result', 'accelerated_selection'));
      end if;
    end if;

    perform public.complete_room_results_reveal(v_auction.room_id, coalesce(v_auction.round_number, 1) >= 2);
    perform public.sync_room_runtime_cache(v_auction.room_id);
    perform public.append_room_event(
      v_auction.room_id,
      'room_completed',
      jsonb_build_object(
        'auction', public.capture_auction_state_payload(p_auction_session_id),
        'room_status', 'completed'
      ),
      'rpc',
      p_auction_session_id
    );
    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  v_timer_seconds := (v_room.settings->>'timer_seconds')::int;

  select array_agg(id order by joined_at) into v_active_participants
  from public.room_participants rp
  where rp.room_id = v_auction.room_id
    and rp.removed_at is null;

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

    v_event_type := 'player_resolved';
  else
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
  end if;

  select public.reconcile_current_auction_skips(p_auction_session_id) into v_advance_result;

  perform public.sync_room_runtime_cache(v_auction.room_id);

  if coalesce(v_advance_result->>'result', '') in ('sold', 'unsold') then
    perform public.append_room_event(
      v_auction.room_id,
      'player_resolved',
      jsonb_build_object(
        'auction', public.capture_auction_state_payload(p_auction_session_id),
        'result', v_advance_result
      ),
      'rpc',
      p_auction_session_id
    );
    return v_advance_result;
  end if;

  perform public.append_room_event(
    v_auction.room_id,
    v_event_type,
    jsonb_build_object(
      'auction', public.capture_auction_state_payload(p_auction_session_id),
      'next_player_id', v_next_player_id
    ),
    'rpc',
    p_auction_session_id
  );

  return jsonb_build_object('success', true, 'result', 'advanced', 'next_player', v_next_player_id);
end;
$$;

create or replace function public.stop_auction(
  p_auction_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  execute 'select public.stop_auction($1, null::text)'
    into v_result
    using p_auction_session_id;

  return v_result;
end;
$$;

create or replace function public.stop_auction(
  p_auction_session_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auction_sessions%rowtype;
  v_room public.rooms%rowtype;
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

  if not public.claim_processed_request_key(p_idempotency_key, v_room.id, 'stop_auction') then
    return jsonb_build_object('success', true, 'result', 'noop', 'idempotent', true);
  end if;

  update public.auction_sessions
  set status = 'completed'
  where id = p_auction_session_id;

  perform public.complete_room_results_reveal(v_auction.room_id, false);
  perform public.sync_room_runtime_cache(v_auction.room_id);
  perform public.append_room_event(
    v_auction.room_id,
    'room_completed',
    jsonb_build_object(
      'auction', public.capture_auction_state_payload(p_auction_session_id),
      'room_status', 'completed'
    ),
    'rpc',
    p_auction_session_id
  );

  return jsonb_build_object('success', true, 'result', 'completed');
end;
$$;

create or replace function public.process_expired_auctions_batch(
  p_limit int default 100
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction record;
  v_result jsonb;
  v_processed int := 0;
begin
  for v_auction in
    select a.id, a.room_id
    from public.auction_sessions a
    where a.status = 'live'
      and a.ends_at is not null
      and a.ends_at <= now()
    order by a.ends_at asc
    limit greatest(coalesce(p_limit, 100), 1)
    for update skip locked
  loop
    select public.finalize_player(
      v_auction.id,
      gen_random_uuid()::text
    ) into v_result;

    if coalesce(v_result->>'result', '') in ('sold', 'unsold') then
      perform public.advance_to_next_player(
        v_auction.id,
        null,
        gen_random_uuid()::text
      );
    end if;

    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

create or replace function public.process_pending_auction_advances_batch(
  p_limit int default 100
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction record;
  v_processed int := 0;
begin
  for v_auction in
    select a.id
    from public.auction_sessions a
    join public.rooms r
      on r.id = a.room_id
    where r.status = 'auction'
      and a.status in ('sold', 'unsold', 'waiting')
      and coalesce(a.updated_at, now() - interval '10 seconds') <= now() - interval '2 seconds'
    order by coalesce(a.updated_at, a.created_at) asc
    limit greatest(coalesce(p_limit, 100), 1)
    for update skip locked
  loop
    perform public.advance_to_next_player(
      v_auction.id,
      null,
      gen_random_uuid()::text
    );
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

create or replace function public.retry_failed_room_events_batch(
  p_limit int default 50
)
returns int
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_failed record;
  v_event public.room_event_log%rowtype;
  v_processed int := 0;
begin
  for v_failed in
    select fre.id, fre.room_id, fre.event_id
    from public.failed_room_events fre
    where fre.event_id is not null
      and fre.retry_count < 5
      and fre.failure_reason like 'Broadcast%'
    order by fre.created_at asc
    limit greatest(coalesce(p_limit, 50), 1)
    for update skip locked
  loop
    begin
      select * into v_event
      from public.room_event_log
      where event_id = v_failed.event_id;

      if not found then
        delete from public.failed_room_events
        where id = v_failed.id;
        continue;
      end if;

      perform realtime.broadcast_changes(
        'room:' || v_event.room_id::text,
        'room_event',
        'INSERT',
        'room_event_log',
        'public',
        v_event,
        null
      );

      delete from public.failed_room_events
      where id = v_failed.id;

      v_processed := v_processed + 1;
    exception
      when others then
        update public.failed_room_events
        set
          retry_count = retry_count + 1,
          failure_reason = 'Broadcast retry failed: ' || SQLERRM
        where id = v_failed.id;
    end;
  end loop;

  return v_processed;
end;
$$;

do $$
declare
  v_room record;
begin
  for v_room in
    select id
    from public.rooms
  loop
    perform public.sync_room_runtime_cache(v_room.id);
  end loop;
end
$$;

create extension if not exists pg_cron with schema extensions;

do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    select jobid
    into v_job_id
    from cron.job
    where jobname = 'ipl-process-expired-auctions'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    perform cron.schedule(
      'ipl-process-expired-auctions',
      '1 second',
      $cron$select public.process_expired_auctions_batch(100);$cron$
    );

    select jobid
    into v_job_id
    from cron.job
    where jobname = 'ipl-process-pending-auction-advances'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    perform cron.schedule(
      'ipl-process-pending-auction-advances',
      '1 second',
      $cron$select public.process_pending_auction_advances_batch(100);$cron$
    );

    select jobid
    into v_job_id
    from cron.job
    where jobname = 'ipl-room-runtime-cleanup'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    perform cron.schedule(
      'ipl-room-runtime-cleanup',
      '30 seconds',
      $cron$select public.cleanup_stale_room_runtime();$cron$
    );

    select jobid
    into v_job_id
    from cron.job
    where jobname = 'ipl-retry-failed-room-events'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    perform cron.schedule(
      'ipl-retry-failed-room-events',
      '15 seconds',
      $cron$select public.retry_failed_room_events_batch(50);$cron$
    );
  end if;
exception
  when others then
    null;
end
$$;
