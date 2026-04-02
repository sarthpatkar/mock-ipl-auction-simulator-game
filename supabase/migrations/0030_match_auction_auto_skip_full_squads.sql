create or replace function public.get_match_auction_auto_skipped_bidders(
  p_room_id uuid,
  p_active_bidders uuid[],
  p_highest_bidder_id uuid default null
)
returns uuid[]
language sql
security definer
set search_path = public
as $$
  with room_settings as (
    select
      auction_mode,
      coalesce((settings->>'squad_size')::int, 7) as squad_size
    from public.rooms
    where id = p_room_id
  )
  select case
    when exists (select 1 from room_settings where auction_mode = 'match_auction') then
      coalesce((
        select array_agg(rp.id)
        from public.room_participants rp
        cross join room_settings rs
        where rp.room_id = p_room_id
          and rp.id = any(coalesce(p_active_bidders, '{}'::uuid[]))
          and (p_highest_bidder_id is null or rp.id <> p_highest_bidder_id)
          and (rp.removed_at is not null or rp.squad_count >= rs.squad_size)
      ), '{}'::uuid[])
    else '{}'::uuid[]
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
  v_auto_skipped uuid[];
  v_effective_skipped uuid[];
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

  v_auto_skipped := public.get_match_auction_auto_skipped_bidders(
    v_room.id,
    v_auction.active_bidders,
    v_auction.highest_bidder_id
  );

  select coalesce(array_agg(distinct skipped_bidder_id), '{}'::uuid[])
  into v_effective_skipped
  from unnest(coalesce(v_auction.skipped_bidders, '{}'::uuid[]) || coalesce(v_auto_skipped, '{}'::uuid[])) as skipped_bidder_id;

  if v_effective_skipped is distinct from coalesce(v_auction.skipped_bidders, '{}'::uuid[]) then
    update public.auction_sessions
    set skipped_bidders = v_effective_skipped
    where id = p_auction_session_id
    returning * into v_auction;
  else
    v_auction.skipped_bidders := v_effective_skipped;
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

  v_auto_skipped := public.get_match_auction_auto_skipped_bidders(
    v_room.id,
    v_auction.active_bidders,
    p_bidder_participant_id
  );

  update public.auction_sessions
  set
    current_price = p_bid_amount,
    highest_bidder_id = p_bidder_participant_id,
    ends_at = now() + (v_timer_seconds || ' seconds')::interval,
    skipped_bidders = coalesce(v_auto_skipped, '{}'::uuid[])
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

create or replace function public.skip_player(
  p_auction_session_id uuid,
  p_participant_id uuid
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
  v_skip_count int;
  v_active_count int;
  v_all_skipped boolean;
  v_inserted int;
  v_auto_skipped uuid[];
  v_effective_skipped uuid[];
begin
  select * into v_auction
  from public.auction_sessions
  where id = p_auction_session_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  if v_auction.status != 'live' then
    return jsonb_build_object('success', false, 'error', 'Auction not live');
  end if;

  if v_auction.ends_at is null or v_auction.ends_at <= now() then
    return jsonb_build_object('success', false, 'error', 'Timer expired');
  end if;

  select * into v_participant
  from public.room_participants
  where id = p_participant_id;

  if not found or v_participant.user_id != auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized participant');
  end if;

  if not (v_auction.active_bidders @> array[p_participant_id]) then
    return jsonb_build_object('success', false, 'error', 'You are not an active bidder for this player');
  end if;

  if v_auction.highest_bidder_id = p_participant_id then
    return jsonb_build_object('success', false, 'error', 'Current highest bidder cannot skip');
  end if;

  select * into v_room
  from public.rooms
  where id = v_auction.room_id;

  v_auto_skipped := public.get_match_auction_auto_skipped_bidders(
    v_room.id,
    v_auction.active_bidders,
    v_auction.highest_bidder_id
  );

  select coalesce(array_agg(distinct skipped_bidder_id), '{}'::uuid[])
  into v_effective_skipped
  from unnest(coalesce(v_auction.skipped_bidders, '{}'::uuid[]) || coalesce(v_auto_skipped, '{}'::uuid[])) as skipped_bidder_id;

  if v_effective_skipped @> array[p_participant_id] then
    update public.auction_sessions
    set skipped_bidders = v_effective_skipped
    where id = p_auction_session_id;

    return jsonb_build_object('success', true, 'result', 'skipped');
  end if;

  update public.auction_sessions
  set skipped_bidders = array_append(v_effective_skipped, p_participant_id)
  where id = p_auction_session_id;

  select * into v_auction
  from public.auction_sessions
  where id = p_auction_session_id;

  v_active_count := coalesce(array_length(v_auction.active_bidders, 1), 0);
  v_skip_count := coalesce(array_length(v_auction.skipped_bidders, 1), 0);

  if v_auction.highest_bidder_id is not null then
    v_all_skipped := v_active_count > 1 and v_skip_count >= (v_active_count - 1);
  else
    v_all_skipped := v_active_count > 0 and v_skip_count >= v_active_count;
  end if;

  if v_all_skipped and v_auction.highest_bidder_id is null then
    update public.auction_sessions
    set
      status = 'unsold',
      ends_at = null,
      completed_players = case
        when completed_players @> array[current_player_id] then completed_players
        else array_append(completed_players, current_player_id)
      end
    where id = p_auction_session_id;

    return jsonb_build_object('success', true, 'result', 'unsold');
  end if;

  if v_all_skipped and v_auction.highest_bidder_id is not null then
    begin
      insert into public.squad_players (room_id, participant_id, player_id, price_paid)
      values (
        v_auction.room_id,
        v_auction.highest_bidder_id,
        v_auction.current_player_id,
        v_auction.current_price
      );
      get diagnostics v_inserted = row_count;

      if v_inserted > 0 then
        update public.room_participants
        set
          budget_remaining = budget_remaining - v_auction.current_price,
          squad_count = squad_count + 1
        where id = v_auction.highest_bidder_id;
      end if;
    exception
      when unique_violation then
        null;
    end;

    update public.auction_sessions
    set
      status = 'sold',
      ends_at = null,
      completed_players = case
        when completed_players @> array[current_player_id] then completed_players
        else array_append(completed_players, current_player_id)
      end
    where id = p_auction_session_id;

    return jsonb_build_object(
      'success', true,
      'result', 'sold',
      'winner', v_auction.highest_bidder_id,
      'player_id', v_auction.current_player_id,
      'price', v_auction.current_price
    );
  end if;

  return jsonb_build_object('success', true, 'result', 'skipped');
end;
$$;
