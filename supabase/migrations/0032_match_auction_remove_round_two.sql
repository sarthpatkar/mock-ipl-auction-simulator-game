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
      and removed_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_room.auction_mode = 'match_auction' then
    update public.auction_sessions
    set
      status = 'completed',
      current_player_id = null,
      current_price = 0,
      highest_bidder_id = null,
      ends_at = null,
      paused_remaining_ms = null,
      selection_ends_at = null,
      accelerated_source_players = '{}',
      active_bidders = '{}',
      skipped_bidders = '{}'
    where id = v_auction.id;

    delete from public.accelerated_round_selections
    where room_id = p_room_id;

    update public.room_participants
    set accelerated_round_submitted_at = null
    where room_id = p_room_id
      and removed_at is null;

    update public.rooms
    set
      status = 'completed',
      results_reveal_at = null
    where id = p_room_id;

    perform public.refresh_match_auction_provisional_results(p_room_id);
    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  v_round_two_pool := public.compute_accelerated_round_pool(p_room_id, v_auction.player_queue);

  if coalesce(array_length(v_round_two_pool, 1), 0) = 0 then
    return jsonb_build_object('success', true, 'result', 'no_unsold_players');
  end if;

  delete from public.accelerated_round_selections
  where room_id = p_room_id;

  update public.room_participants
  set accelerated_round_submitted_at = null
  where room_id = p_room_id
    and removed_at is null;

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
  set
    status = 'accelerated_selection',
    results_reveal_at = null
  where id = p_room_id;

  return jsonb_build_object(
    'success', true,
    'result', 'accelerated_selection',
    'player_count', coalesce(array_length(v_round_two_pool, 1), 0)
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
  v_room public.rooms%rowtype;
  v_auction public.auction_sessions%rowtype;
  v_participant public.room_participants%rowtype;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  if v_room.auction_mode = 'match_auction' then
    return public.finalize_accelerated_selection(p_room_id);
  end if;

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
    and room_id = p_room_id
    and removed_at is null;

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
      and removed_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_room.auction_mode = 'match_auction' then
    update public.auction_sessions
    set
      status = 'completed',
      current_player_id = null,
      highest_bidder_id = null,
      current_price = 0,
      ends_at = null,
      paused_remaining_ms = null,
      selection_ends_at = null,
      accelerated_source_players = '{}',
      active_bidders = '{}',
      skipped_bidders = '{}'
    where id = v_auction.id;

    delete from public.accelerated_round_selections
    where room_id = p_room_id;

    update public.room_participants
    set accelerated_round_submitted_at = null
    where room_id = p_room_id
      and removed_at is null;

    update public.rooms
    set
      status = 'completed',
      results_reveal_at = null
    where id = p_room_id;

    perform public.refresh_match_auction_provisional_results(p_room_id);
    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  if v_room.status <> 'accelerated_selection' then
    return jsonb_build_object('success', true, 'result', 'noop', 'status', v_room.status);
  end if;

  select count(*), count(accelerated_round_submitted_at)
  into v_total_participants, v_submitted_participants
  from public.room_participants
  where room_id = p_room_id
    and removed_at is null;

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

    perform public.complete_room_results_reveal(p_room_id, true);
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

  delete from public.accelerated_round_selections
  where room_id = p_room_id;

  update public.room_participants
  set accelerated_round_submitted_at = null
  where room_id = p_room_id
    and removed_at is null;

  update public.rooms
  set
    status = 'auction',
    results_reveal_at = null
  where id = p_room_id;

  select public.advance_to_next_player(v_auction.id, auth.uid()) into v_result;
  return coalesce(v_result, jsonb_build_object('success', true, 'result', 'accelerated_started'));
end;
$$;
