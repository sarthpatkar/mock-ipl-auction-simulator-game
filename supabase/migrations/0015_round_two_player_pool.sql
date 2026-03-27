create or replace function public.compute_accelerated_round_pool(
  p_room_id uuid,
  p_player_queue uuid[]
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
  from unnest(coalesce(p_player_queue, '{}')) with ordinality as source(player_id, position)
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
  v_round_two_pool uuid[];
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

  v_round_two_pool := public.compute_accelerated_round_pool(p_room_id, v_auction.player_queue);

  if coalesce(array_length(v_round_two_pool, 1), 0) = 0 then
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
    accelerated_source_players = v_round_two_pool,
    active_bidders = '{}',
    skipped_bidders = '{}',
    round_label = 'Accelerated Round',
    round_number = 2
  where id = v_auction.id;

  update public.rooms
  set status = 'accelerated_selection'
  where id = p_room_id;

  return jsonb_build_object(
    'success', true,
    'result', 'accelerated_selection',
    'player_count', coalesce(array_length(v_round_two_pool, 1), 0)
  );
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
  v_round_two_pool uuid[];
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
      v_round_two_pool := public.compute_accelerated_round_pool(v_auction.room_id, v_auction.player_queue);
      if coalesce(array_length(v_round_two_pool, 1), 0) > 0 then
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
  v_round_two_pool uuid[];
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
    v_round_two_pool := public.compute_accelerated_round_pool(v_auction.room_id, v_auction.player_queue);

    if coalesce(array_length(v_round_two_pool, 1), 0) = 0 then
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
      accelerated_source_players = v_round_two_pool,
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
      'player_count', coalesce(array_length(v_round_two_pool, 1), 0)
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
