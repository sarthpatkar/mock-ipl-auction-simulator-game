alter table public.auction_live_state
  add column if not exists current_player_id uuid references public.players(id) on delete set null,
  add column if not exists round_number int not null default 1,
  add column if not exists round_label text,
  add column if not exists active_bidders uuid[] not null default '{}',
  add column if not exists skipped_bidders uuid[] not null default '{}',
  add column if not exists paused_remaining_ms int,
  add column if not exists completed_count int not null default 0,
  add column if not exists queue_count int not null default 0;

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
    current_player_id,
    current_price,
    highest_bidder_id,
    ends_at,
    status,
    round_number,
    round_label,
    active_bidders,
    skipped_bidders,
    paused_remaining_ms,
    completed_count,
    queue_count,
    updated_at
  )
  values (
    new.id,
    new.room_id,
    new.current_player_id,
    coalesce(new.current_price, 0),
    new.highest_bidder_id,
    new.ends_at,
    new.status,
    coalesce(new.round_number, 1),
    new.round_label,
    coalesce(new.active_bidders, '{}'::uuid[]),
    coalesce(new.skipped_bidders, '{}'::uuid[]),
    new.paused_remaining_ms,
    coalesce(array_length(coalesce(new.completed_players, '{}'::uuid[]), 1), 0),
    coalesce(array_length(coalesce(new.player_queue, '{}'::uuid[]), 1), 0),
    coalesce(new.updated_at, now())
  )
  on conflict (auction_session_id) do update
  set
    room_id = excluded.room_id,
    current_player_id = excluded.current_player_id,
    current_price = excluded.current_price,
    highest_bidder_id = excluded.highest_bidder_id,
    ends_at = excluded.ends_at,
    status = excluded.status,
    round_number = excluded.round_number,
    round_label = excluded.round_label,
    active_bidders = excluded.active_bidders,
    skipped_bidders = excluded.skipped_bidders,
    paused_remaining_ms = excluded.paused_remaining_ms,
    completed_count = excluded.completed_count,
    queue_count = excluded.queue_count,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

insert into public.auction_live_state (
  auction_session_id,
  room_id,
  current_player_id,
  current_price,
  highest_bidder_id,
  ends_at,
  status,
  round_number,
  round_label,
  active_bidders,
  skipped_bidders,
  paused_remaining_ms,
  completed_count,
  queue_count,
  updated_at
)
select
  a.id,
  a.room_id,
  a.current_player_id,
  coalesce(a.current_price, 0),
  a.highest_bidder_id,
  a.ends_at,
  a.status,
  coalesce(a.round_number, 1),
  a.round_label,
  coalesce(a.active_bidders, '{}'::uuid[]),
  coalesce(a.skipped_bidders, '{}'::uuid[]),
  a.paused_remaining_ms,
  coalesce(array_length(coalesce(a.completed_players, '{}'::uuid[]), 1), 0),
  coalesce(array_length(coalesce(a.player_queue, '{}'::uuid[]), 1), 0),
  coalesce(a.updated_at, now())
from public.auction_sessions a
on conflict (auction_session_id) do update
set
  room_id = excluded.room_id,
  current_player_id = excluded.current_player_id,
  current_price = excluded.current_price,
  highest_bidder_id = excluded.highest_bidder_id,
  ends_at = excluded.ends_at,
  status = excluded.status,
  round_number = excluded.round_number,
  round_label = excluded.round_label,
  active_bidders = excluded.active_bidders,
  skipped_bidders = excluded.skipped_bidders,
  paused_remaining_ms = excluded.paused_remaining_ms,
  completed_count = excluded.completed_count,
  queue_count = excluded.queue_count,
  updated_at = excluded.updated_at;

create index if not exists idx_bids_auction_session_created_at on public.bids(auction_session_id, created_at desc);
create index if not exists idx_room_participants_room_joined_at on public.room_participants(room_id, joined_at);
create index if not exists idx_room_participants_user_id on public.room_participants(user_id);
create index if not exists idx_rooms_admin_created_at on public.rooms(admin_id, created_at desc);
create index if not exists idx_squad_players_room_id on public.squad_players(room_id);
create index if not exists idx_squad_players_room_participant on public.squad_players(room_id, participant_id);

create or replace function public.get_room_participant_counts(
  p_room_ids uuid[]
)
returns table (
  room_id uuid,
  participant_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    rp.room_id,
    count(*)::bigint as participant_count
  from public.room_participants rp
  where rp.room_id = any(coalesce(p_room_ids, '{}'::uuid[]))
    and exists (
      select 1
      from public.rooms r
      where r.id = rp.room_id
        and (
          r.admin_id = auth.uid()
          or exists (
            select 1
            from public.room_participants me
            where me.room_id = r.id
              and me.user_id = auth.uid()
          )
        )
    )
  group by rp.room_id;
$$;
