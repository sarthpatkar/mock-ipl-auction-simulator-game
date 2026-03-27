create or replace function public.end_auction_round(
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
  v_inserted int;
  v_unsold_pool uuid[];
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
  where id = v_auction.room_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  if v_room.admin_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Not admin');
  end if;

  if v_room.status = 'accelerated_selection' then
    return jsonb_build_object('success', true, 'result', 'accelerated_selection');
  end if;

  if v_auction.status = 'completed' or v_room.status = 'completed' then
    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  if v_auction.current_player_id is not null
     and not (v_auction.current_player_id = any(coalesce(v_auction.completed_players, '{}')))
     and v_auction.status in ('live', 'paused') then
    if v_auction.highest_bidder_id is not null then
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
        paused_remaining_ms = null,
        completed_players = case
          when completed_players @> array[current_player_id] then completed_players
          else array_append(completed_players, current_player_id)
        end
      where id = p_auction_session_id;
    else
      update public.auction_sessions
      set
        status = 'unsold',
        ends_at = null,
        paused_remaining_ms = null,
        completed_players = case
          when completed_players @> array[current_player_id] then completed_players
          else array_append(completed_players, current_player_id)
        end
      where id = p_auction_session_id;
    end if;

    select * into v_auction
    from public.auction_sessions
    where id = p_auction_session_id;
  end if;

  if coalesce(v_auction.round_number, 1) = 1 then
    v_unsold_pool := public.compute_unsold_round_pool(v_auction.room_id, v_auction.completed_players);

    if coalesce(array_length(v_unsold_pool, 1), 0) = 0 then
      update public.auction_sessions
      set
        status = 'completed',
        current_player_id = null,
        current_price = 0,
        highest_bidder_id = null,
        ends_at = null,
        paused_remaining_ms = null,
        selection_ends_at = null,
        active_bidders = '{}',
        skipped_bidders = '{}',
        round_number = 2,
        round_label = 'Accelerated Round'
      where id = p_auction_session_id;

      update public.rooms
      set status = 'completed'
      where id = v_auction.room_id;

      return jsonb_build_object('success', true, 'result', 'completed');
    end if;

    delete from public.accelerated_round_selections
    where room_id = v_auction.room_id;

    update public.room_participants
    set accelerated_round_submitted_at = null
    where room_id = v_auction.room_id;

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
      round_number = 2,
      round_label = 'Accelerated Round'
    where id = p_auction_session_id;

    update public.rooms
    set status = 'accelerated_selection'
    where id = v_auction.room_id;

    return jsonb_build_object(
      'success', true,
      'result', 'accelerated_selection',
      'player_count', coalesce(array_length(v_unsold_pool, 1), 0)
    );
  end if;

  update public.auction_sessions
  set
    status = 'completed',
    current_player_id = null,
    current_price = 0,
    highest_bidder_id = null,
    ends_at = null,
    paused_remaining_ms = null,
    selection_ends_at = null,
    active_bidders = '{}',
    skipped_bidders = '{}'
  where id = p_auction_session_id;

  update public.rooms
  set status = 'completed'
  where id = v_auction.room_id;

  return jsonb_build_object('success', true, 'result', 'completed');
end;
$$;
