-- RPC: place_bid (hardened)
create or replace function place_bid(
  p_auction_session_id uuid,
  p_bidder_participant_id uuid,
  p_bid_amount bigint
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_auction auction_sessions%rowtype;
  v_participant room_participants%rowtype;
  v_room rooms%rowtype;
  v_timer_seconds int;
  v_grace_ms int := 300;
begin
  -- Lock auction row
  select * into v_auction
  from auction_sessions
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

  if v_auction.ends_at < (now() - (v_grace_ms || ' milliseconds')::interval) then
    return jsonb_build_object('success', false, 'error', 'Timer expired');
  end if;

  if v_auction.highest_bidder_id = p_bidder_participant_id and v_auction.current_price = p_bid_amount then
    return jsonb_build_object('success', false, 'error', 'Already highest bidder');
  end if;

  if p_bid_amount <= v_auction.current_price then
    return jsonb_build_object('success', false, 'error', 'Bid too low');
  end if;

  if not (v_auction.active_bidders @> array[p_bidder_participant_id]) then
    return jsonb_build_object('success', false, 'error', 'You have skipped this player');
  end if;

  select * into v_participant
  from room_participants
  where id = p_bidder_participant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Participant not found');
  end if;

  if v_participant.budget_remaining < p_bid_amount then
    return jsonb_build_object('success', false, 'error', 'Insufficient budget');
  end if;

  select * into v_room from rooms where id = v_auction.room_id;
  v_timer_seconds := (v_room.settings->>'timer_seconds')::int;

  if v_participant.squad_count >= (v_room.settings->>'squad_size')::int then
    return jsonb_build_object('success', false, 'error', 'Squad full');
  end if;

  update auction_sessions set
    current_price = p_bid_amount,
    highest_bidder_id = p_bidder_participant_id,
    ends_at = now() + (v_timer_seconds || ' seconds')::interval,
    skipped_bidders = '{}'
  where id = p_auction_session_id;

  insert into bids (auction_session_id, player_id, bidder_id, amount)
  values (p_auction_session_id, v_auction.current_player_id, p_bidder_participant_id, p_bid_amount);

  return jsonb_build_object(
    'success', true,
    'new_price', p_bid_amount,
    'ends_at', now() + (v_timer_seconds || ' seconds')::interval
  );

exception
  when others then
    return jsonb_build_object('success', false, 'error', 'Internal error: ' || SQLERRM);
end;
$$;

-- RPC: skip_player
create or replace function skip_player(
  p_auction_session_id uuid,
  p_participant_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_auction auction_sessions%rowtype;
  v_all_skipped boolean;
begin
  select * into v_auction
  from auction_sessions
  where id = p_auction_session_id
  for update;

  if v_auction.status != 'live' then
    return jsonb_build_object('success', false, 'error', 'Auction not live');
  end if;

  if not (v_auction.skipped_bidders @> array[p_participant_id]) then
    update auction_sessions
    set skipped_bidders = array_append(skipped_bidders, p_participant_id)
    where id = p_auction_session_id;
  end if;

  select (
    array_length(v_auction.active_bidders, 1) =
    array_length(
      (select skipped_bidders from auction_sessions where id = p_auction_session_id),
      1
    )
  ) into v_all_skipped;

  if v_all_skipped or v_auction.highest_bidder_id is null then
    update auction_sessions
    set status = 'unsold'
    where id = p_auction_session_id;
    return jsonb_build_object('success', true, 'result', 'unsold');
  end if;

  return jsonb_build_object('success', true, 'result', 'skipped');
end;
$$;

-- RPC: finalize_player (idempotent)
create or replace function finalize_player(
  p_auction_session_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_auction auction_sessions%rowtype;
  v_inserted int;
begin
  select * into v_auction
  from auction_sessions
  where id = p_auction_session_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  if v_auction.status in ('sold','unsold','completed','paused') then
    return jsonb_build_object('success', true, 'result', v_auction.status, 'note', 'Already finalized');
  end if;

  if v_auction.status != 'live' then
    return jsonb_build_object('success', false, 'error', 'Cannot finalize — status is ' || v_auction.status);
  end if;

  if v_auction.highest_bidder_id is not null then
    begin
      insert into squad_players (room_id, participant_id, player_id, price_paid)
      values (
        v_auction.room_id,
        v_auction.highest_bidder_id,
        v_auction.current_player_id,
        v_auction.current_price
      );
      get diagnostics v_inserted = row_count;

      if v_inserted > 0 then
        update room_participants
        set
          budget_remaining = budget_remaining - v_auction.current_price,
          squad_count = squad_count + 1
        where id = v_auction.highest_bidder_id;
      end if;
    exception
      when unique_violation then
        null; -- already inserted, idempotent
    end;

    update auction_sessions
    set
      status = 'sold',
      completed_players = array_append(completed_players, current_player_id)
    where id = p_auction_session_id;

    return jsonb_build_object(
      'success', true,
      'result', 'sold',
      'winner', v_auction.highest_bidder_id,
      'player_id', v_auction.current_player_id,
      'price', v_auction.current_price
    );
  else
    update auction_sessions
    set
      status = 'unsold',
      completed_players = array_append(completed_players, current_player_id)
    where id = p_auction_session_id;

    return jsonb_build_object('success', true, 'result', 'unsold', 'player_id', v_auction.current_player_id);
  end if;

exception
  when others then
    return jsonb_build_object('success', false, 'error', 'Finalize failed: ' || SQLERRM);
end;
$$;

-- RPC: advance_to_next_player (handles empty active bidders)
create or replace function advance_to_next_player(
  p_auction_session_id uuid,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_auction auction_sessions%rowtype;
  v_room rooms%rowtype;
  v_next_player_id uuid;
  v_timer_seconds int;
  v_active_participants uuid[];
begin
  select * into v_auction
  from auction_sessions
  where id = p_auction_session_id
  for update;

  select * into v_room from rooms where id = v_auction.room_id;
  if v_room.admin_id != p_admin_user_id then
    return jsonb_build_object('success', false, 'error', 'Not admin');
  end if;

  if v_auction.status not in ('sold', 'unsold') then
    return jsonb_build_object('success', false, 'error', 'Cannot advance now');
  end if;

  select unnest into v_next_player_id
  from unnest(v_auction.player_queue) as unnest
  where unnest != all(v_auction.completed_players)
  limit 1;

  if v_next_player_id is null then
    update auction_sessions set status = 'completed' where id = p_auction_session_id;
    update rooms set status = 'completed' where id = v_auction.room_id;
    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  v_timer_seconds := (v_room.settings->>'timer_seconds')::int;

  select array_agg(id) into v_active_participants
  from room_participants rp
  where rp.room_id = v_auction.room_id
    and rp.budget_remaining >= (select base_price from players where id = v_next_player_id)
    and rp.squad_count < (v_room.settings->>'squad_size')::int;

  if v_active_participants is null or array_length(v_active_participants,1) is null then
    update auction_sessions set
      current_player_id = v_next_player_id,
      status = 'unsold',
      completed_players = array_append(completed_players, v_next_player_id)
    where id = p_auction_session_id;

    return jsonb_build_object('success', true, 'result', 'auto_unsold', 'player', v_next_player_id);
  end if;

  update auction_sessions set
    current_player_id = v_next_player_id,
    current_price = (select base_price from players where id = v_next_player_id),
    highest_bidder_id = null,
    ends_at = now() + (v_timer_seconds || ' seconds')::interval,
    status = 'live',
    active_bidders = coalesce(v_active_participants, '{}'),
    skipped_bidders = '{}'
  where id = p_auction_session_id;

  return jsonb_build_object('success', true, 'result', 'advanced', 'next_player', v_next_player_id);
end;
$$;
