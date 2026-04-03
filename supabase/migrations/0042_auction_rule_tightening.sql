create or replace function public.get_minimum_player_base_price(
  p_player_ids uuid[]
)
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(min(base_price), 0)
  from public.players
  where id = any(coalesce(p_player_ids, '{}'::uuid[]));
$$;

create or replace function public.get_room_remaining_player_ids(
  p_room_id uuid
)
returns uuid[]
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_room public.rooms%rowtype;
  v_auction public.auction_sessions%rowtype;
  v_player_ids uuid[];
begin
  select * into v_room
  from public.rooms
  where id = p_room_id;

  if not found then
    return '{}'::uuid[];
  end if;

  select * into v_auction
  from public.auction_sessions
  where room_id = p_room_id;

  if not found then
    return '{}'::uuid[];
  end if;

  if v_room.status = 'accelerated_selection' then
    return coalesce(v_auction.accelerated_source_players, '{}'::uuid[]);
  end if;

  select coalesce(array_agg(queued.player_id order by queued.position), '{}'::uuid[])
  into v_player_ids
  from unnest(coalesce(v_auction.player_queue, '{}'::uuid[])) with ordinality as queued(player_id, position)
  where not (queued.player_id = any(coalesce(v_auction.completed_players, '{}'::uuid[])));

  return coalesce(v_player_ids, '{}'::uuid[]);
end;
$$;

create or replace function public.get_globally_eligible_participant_ids(
  p_room_id uuid,
  p_candidate_player_ids uuid[] default null
)
returns uuid[]
language sql
security definer
set search_path = public
stable
as $$
  with candidate_players as (
    select coalesce(p_candidate_player_ids, public.get_room_remaining_player_ids(p_room_id)) as player_ids
  ),
  room_settings as (
    select
      coalesce(
        (settings->>'squad_size')::int,
        case when auction_mode = 'match_auction' then 7 else 20 end
      ) as squad_size
    from public.rooms
    where id = p_room_id
  ),
  min_bid as (
    select public.get_minimum_player_base_price(candidate_players.player_ids) as amount
    from candidate_players
  )
  select coalesce(array_agg(rp.id order by rp.joined_at), '{}'::uuid[])
  from public.room_participants rp
  cross join room_settings rs
  cross join min_bid mb
  where rp.room_id = p_room_id
    and rp.removed_at is null
    and mb.amount > 0
    and rp.squad_count < rs.squad_size
    and rp.budget_remaining >= mb.amount;
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
  v_eligible_participants uuid[];
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
    perform public.sync_room_runtime_cache(p_room_id);
    perform public.append_room_event(
      p_room_id,
      'room_completed',
      jsonb_build_object(
        'auction', public.capture_auction_state_payload(v_auction.id),
        'room_status', 'completed'
      ),
      'rpc',
      v_auction.id
    );

    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  v_round_two_pool := public.compute_accelerated_round_pool(p_room_id, v_auction.player_queue);

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
      accelerated_source_players = '{}',
      active_bidders = '{}',
      skipped_bidders = '{}'
    where id = v_auction.id;

    perform public.complete_room_results_reveal(p_room_id, true);
    perform public.sync_room_runtime_cache(p_room_id);
    perform public.append_room_event(
      p_room_id,
      'room_completed',
      jsonb_build_object(
        'auction', public.capture_auction_state_payload(v_auction.id),
        'room_status', 'completed'
      ),
      'rpc',
      v_auction.id
    );

    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  v_eligible_participants := public.get_globally_eligible_participant_ids(
    p_room_id,
    v_round_two_pool
  );

  if coalesce(array_length(v_eligible_participants, 1), 0) = 0 then
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

    perform public.complete_room_results_reveal(p_room_id, true);
    perform public.sync_room_runtime_cache(p_room_id);
    perform public.append_room_event(
      p_room_id,
      'room_completed',
      jsonb_build_object(
        'auction', public.capture_auction_state_payload(v_auction.id),
        'room_status', 'completed'
      ),
      'rpc',
      v_auction.id
    );

    return jsonb_build_object('success', true, 'result', 'completed');
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

  perform public.sync_room_runtime_cache(p_room_id);
  perform public.append_room_event(
    p_room_id,
    'accelerated_selection_started',
    jsonb_build_object(
      'player_count', coalesce(array_length(v_round_two_pool, 1), 0)
    ),
    'rpc',
    v_auction.id
  );

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
  v_eligible_participants uuid[];
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

  v_eligible_participants := public.get_globally_eligible_participant_ids(
    p_room_id,
    v_auction.accelerated_source_players
  );

  if not (p_participant_id = any(coalesce(v_eligible_participants, '{}'::uuid[]))) then
    return jsonb_build_object('success', false, 'error', 'Viewer-only participants cannot submit accelerated selections');
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
  v_eligible_participants uuid[];
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
    perform public.sync_room_runtime_cache(p_room_id);
    perform public.append_room_event(
      p_room_id,
      'room_completed',
      jsonb_build_object(
        'auction', public.capture_auction_state_payload(v_auction.id),
        'room_status', 'completed'
      ),
      'rpc',
      v_auction.id
    );

    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  if v_room.status <> 'accelerated_selection' then
    return jsonb_build_object('success', true, 'result', 'noop', 'status', v_room.status);
  end if;

  v_eligible_participants := public.get_globally_eligible_participant_ids(
    p_room_id,
    v_auction.accelerated_source_players
  );

  if coalesce(array_length(v_eligible_participants, 1), 0) = 0 then
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
      skipped_bidders = '{}',
      round_number = 2,
      round_label = 'Accelerated Round'
    where id = v_auction.id;

    delete from public.accelerated_round_selections
    where room_id = p_room_id;

    update public.room_participants
    set accelerated_round_submitted_at = null
    where room_id = p_room_id
      and removed_at is null;

    perform public.complete_room_results_reveal(p_room_id, true);
    perform public.sync_room_runtime_cache(p_room_id);
    perform public.append_room_event(
      p_room_id,
      'room_completed',
      jsonb_build_object(
        'auction', public.capture_auction_state_payload(v_auction.id),
        'room_status', 'completed'
      ),
      'rpc',
      v_auction.id
    );

    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  select count(*), count(accelerated_round_submitted_at)
  into v_total_participants, v_submitted_participants
  from public.room_participants
  where room_id = p_room_id
    and removed_at is null
    and id = any(coalesce(v_eligible_participants, '{}'::uuid[]));

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

    delete from public.accelerated_round_selections
    where room_id = p_room_id;

    update public.room_participants
    set accelerated_round_submitted_at = null
    where room_id = p_room_id
      and removed_at is null;

    perform public.complete_room_results_reveal(p_room_id, true);
    perform public.sync_room_runtime_cache(p_room_id);
    perform public.append_room_event(
      p_room_id,
      'room_completed',
      jsonb_build_object(
        'auction', public.capture_auction_state_payload(v_auction.id),
        'room_status', 'completed'
      ),
      'rpc',
      v_auction.id
    );

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
  v_result jsonb;
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

  if v_room.auction_mode = 'match_auction' or coalesce(v_auction.round_number, 1) >= 2 then
    return public.stop_auction(p_auction_session_id, gen_random_uuid()::text);
  end if;

  if v_auction.current_player_id is not null
     and not (v_auction.current_player_id = any(coalesce(v_auction.completed_players, '{}'::uuid[])))
     and v_auction.status in ('live', 'paused') then
    if v_auction.highest_bidder_id is not null then
      perform public.resolve_current_auction_player(
        p_auction_session_id,
        v_auction.highest_bidder_id,
        v_auction.current_price,
        false
      );
    else
      perform public.resolve_current_auction_player(
        p_auction_session_id,
        null,
        v_auction.current_price,
        false
      );
    end if;
  end if;

  select public.begin_accelerated_selection(v_room.id) into v_result;
  return coalesce(v_result, jsonb_build_object('success', true, 'result', 'accelerated_selection'));
end;
$$;

create or replace function public.reconcile_current_auction_skips(
  p_auction_session_id uuid,
  p_manual_skip_participant_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auction_sessions%rowtype;
  v_auto_skipped uuid[];
  v_effective_skipped uuid[];
  v_eligible_bidders uuid[];
begin
  select * into v_auction
  from public.auction_sessions
  where id = p_auction_session_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  if v_auction.status <> 'live' or v_auction.current_player_id is null then
    return jsonb_build_object('success', true, 'result', 'noop', 'status', v_auction.status);
  end if;

  v_auto_skipped := public.get_auction_auto_skipped_bidders(
    v_auction.room_id,
    v_auction.active_bidders,
    v_auction.current_price,
    v_auction.highest_bidder_id
  );

  with active as (
    select bidder_id, position
    from unnest(coalesce(v_auction.active_bidders, '{}'::uuid[])) with ordinality as bidder(bidder_id, position)
  ),
  raw_skipped as (
    select unnest(
      coalesce(v_auction.skipped_bidders, '{}'::uuid[])
      || case
        when p_manual_skip_participant_id is null then '{}'::uuid[]
        else array[p_manual_skip_participant_id]
      end
      || coalesce(v_auto_skipped, '{}'::uuid[])
    ) as bidder_id
  )
  select coalesce(array_agg(active.bidder_id order by active.position), '{}'::uuid[])
  into v_effective_skipped
  from active
  where (v_auction.highest_bidder_id is null or active.bidder_id <> v_auction.highest_bidder_id)
    and exists (
      select 1
      from raw_skipped
      where raw_skipped.bidder_id = active.bidder_id
    );

  if v_effective_skipped is distinct from coalesce(v_auction.skipped_bidders, '{}'::uuid[]) then
    update public.auction_sessions
    set skipped_bidders = coalesce(v_effective_skipped, '{}'::uuid[])
    where id = p_auction_session_id
    returning * into v_auction;
  else
    v_auction.skipped_bidders := coalesce(v_effective_skipped, '{}'::uuid[]);
  end if;

  with active as (
    select bidder_id, position
    from unnest(coalesce(v_auction.active_bidders, '{}'::uuid[])) with ordinality as bidder(bidder_id, position)
  )
  select coalesce(array_agg(active.bidder_id order by active.position), '{}'::uuid[])
  into v_eligible_bidders
  from active
  where (v_auction.highest_bidder_id is null or active.bidder_id <> v_auction.highest_bidder_id)
    and not (active.bidder_id = any(coalesce(v_auction.skipped_bidders, '{}'::uuid[])));

  if v_auction.highest_bidder_id is not null
     and coalesce(array_length(v_eligible_bidders, 1), 0) = 0 then
    return public.resolve_current_auction_player(
      p_auction_session_id,
      v_auction.highest_bidder_id,
      v_auction.current_price,
      false
    );
  end if;

  if v_auction.highest_bidder_id is null
     and coalesce(array_length(v_eligible_bidders, 1), 0) = 0 then
    return public.resolve_current_auction_player(
      p_auction_session_id,
      null,
      v_auction.current_price,
      false
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'result', case when p_manual_skip_participant_id is null then 'live' else 'skipped' end,
    'skipped_bidders', coalesce(v_auction.skipped_bidders, '{}'::uuid[])
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
  v_auto_skipped uuid[];
begin
  select * into v_auction
  from public.auction_sessions
  where id = p_auction_session_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  if v_auction.status <> 'live' then
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

  v_auto_skipped := public.get_auction_auto_skipped_bidders(
    v_auction.room_id,
    v_auction.active_bidders,
    v_auction.current_price,
    v_auction.highest_bidder_id
  );

  if p_participant_id = any(coalesce(v_auto_skipped, '{}'::uuid[])) then
    return jsonb_build_object('success', false, 'error', 'Viewer-only participants cannot skip this player');
  end if;

  if p_participant_id = any(coalesce(v_auction.skipped_bidders, '{}'::uuid[])) then
    return jsonb_build_object('success', true, 'result', 'skipped', 'idempotent', true);
  end if;

  return public.reconcile_current_auction_skips(
    p_auction_session_id,
    p_participant_id
  );
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

  if v_auction.highest_bidder_id is not null then
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
  end if;

  if not (v_auction.active_bidders @> array[p_bidder_participant_id]) then
    return jsonb_build_object('success', false, 'error', 'You are not an active bidder for this player');
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
  v_advance_result jsonb;
  v_event_type text := 'next_player_loaded';
  v_remaining_player_ids uuid[];
  v_globally_eligible_participants uuid[];
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

  v_remaining_player_ids := public.get_room_remaining_player_ids(v_auction.room_id);
  v_globally_eligible_participants := public.get_globally_eligible_participant_ids(
    v_auction.room_id,
    v_remaining_player_ids
  );

  if coalesce(array_length(v_remaining_player_ids, 1), 0) > 0
     and coalesce(array_length(v_globally_eligible_participants, 1), 0) = 0 then
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

    if v_room.auction_mode = 'match_auction' then
      update public.rooms
      set
        status = 'completed',
        results_reveal_at = null
      where id = v_auction.room_id;

      perform public.refresh_match_auction_provisional_results(v_auction.room_id);
    else
      perform public.complete_room_results_reveal(v_auction.room_id, true);
    end if;

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
      current_price = 0,
      highest_bidder_id = null,
      ends_at = null,
      paused_remaining_ms = null,
      selection_ends_at = null,
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

        return coalesce(v_selection_result, jsonb_build_object('success', true, 'result', 'accelerated_selection'));
      end if;
    end if;

    perform public.complete_room_results_reveal(v_auction.room_id, true);
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

  if v_room.auction_mode = 'match_auction' then
    update public.rooms
    set
      status = 'completed',
      results_reveal_at = null
    where id = v_auction.room_id;

    perform public.refresh_match_auction_provisional_results(v_auction.room_id);
  else
    perform public.complete_room_results_reveal(v_auction.room_id, true);
  end if;

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
