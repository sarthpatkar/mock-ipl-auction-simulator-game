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

  if v_auction.highest_bidder_id is null then
    if p_bid_amount != v_auction.current_price then
      return jsonb_build_object('success', false, 'error', 'Opening bid must match the base price');
    end if;
  elsif p_bid_amount <= v_auction.current_price then
    return jsonb_build_object('success', false, 'error', 'Bid too low');
  end if;

  if not (v_auction.active_bidders @> array[p_bidder_participant_id]) then
    return jsonb_build_object('success', false, 'error', 'You are not an active bidder for this player');
  end if;

  select * into v_participant
  from public.room_participants
  where id = p_bidder_participant_id
  for update;

  if not found or v_participant.user_id != auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized bidder');
  end if;

  if v_participant.budget_remaining < p_bid_amount then
    return jsonb_build_object('success', false, 'error', 'Insufficient budget');
  end if;

  select * into v_room
  from public.rooms
  where id = v_auction.room_id;

  v_timer_seconds := (v_room.settings->>'timer_seconds')::int;

  if v_participant.squad_count >= (v_room.settings->>'squad_size')::int then
    return jsonb_build_object('success', false, 'error', 'Squad full');
  end if;

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
