create or replace function is_room_member(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from room_participants
    where room_id = p_room_id
      and user_id = auth.uid()
  );
$$;

create or replace function can_read_bid(p_auction_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from auction_sessions a
    join room_participants rp on rp.room_id = a.room_id
    where a.id = p_auction_session_id
      and rp.user_id = auth.uid()
  );
$$;

drop policy if exists "Room members can read participants" on room_participants;
create policy "Room members can read participants" on room_participants for select
  using (is_room_member(room_id));

drop policy if exists "Room members can read room" on rooms;
create policy "Room members can read room" on rooms for select
  using (is_room_member(id));

drop policy if exists "Room members can read auction" on auction_sessions;
create policy "Room members can read auction" on auction_sessions for select
  using (is_room_member(room_id));

drop policy if exists "Room members can read bids" on bids;
create policy "Room members can read bids" on bids for select
  using (can_read_bid(auction_session_id));

drop policy if exists "Room members can read squads" on squad_players;
create policy "Room members can read squads" on squad_players for select
  using (is_room_member(room_id));
