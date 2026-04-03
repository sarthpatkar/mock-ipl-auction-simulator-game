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
    ends_at = now() + (v_timer_seconds || ' seconds')::interval,
    skipped_bidders = '{}'::uuid[]
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
