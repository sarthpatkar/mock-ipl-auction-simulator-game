alter table public.room_participants
  add column if not exists removed_at timestamptz;

alter table public.room_participants
  add column if not exists removed_by_user_id uuid references public.profiles(id);

alter table public.room_participants
  add column if not exists removal_reason text;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.room_participants
    where room_id = p_room_id
      and user_id = auth.uid()
      and removed_at is null
  );
$$;

create or replace function public.can_read_bid(p_auction_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.auction_sessions a
    join public.room_participants rp
      on rp.room_id = a.room_id
    where a.id = p_auction_session_id
      and rp.user_id = auth.uid()
      and rp.removed_at is null
  );
$$;

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
    and rp.removed_at is null
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
              and me.removed_at is null
          )
        )
    )
  group by rp.room_id;
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
      and removed_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
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
      and removed_at is null
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

    perform public.complete_room_results_reveal(v_auction.room_id, coalesce(v_auction.round_number, 1) >= 2);

    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  v_timer_seconds := (v_room.settings->>'timer_seconds')::int;

  select array_agg(id order by joined_at) into v_active_participants
  from public.room_participants rp
  where rp.room_id = v_auction.room_id
    and rp.removed_at is null
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
  v_auction public.auction_sessions%rowtype;
  v_participant public.room_participants%rowtype;
begin
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

create or replace function public.list_inactive_participants_for_removal(
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
  v_completed_count int;
  v_recent_player_ids uuid[];
  v_candidates jsonb := '[]'::jsonb;
begin
  select * into v_auction
  from public.auction_sessions
  where id = p_auction_session_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  select * into v_room
  from public.rooms
  where id = v_auction.room_id;

  if not found or v_room.admin_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  v_completed_count := coalesce(array_length(v_auction.completed_players, 1), 0);

  if v_completed_count >= 25 then
    v_recent_player_ids := v_auction.completed_players[greatest(v_completed_count - 24, 1):v_completed_count];

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'participant_id', rp.id,
          'user_id', rp.user_id,
          'team_name', rp.team_name,
          'username', pr.username,
          'joined_at', rp.joined_at
        )
        order by rp.joined_at
      ),
      '[]'::jsonb
    )
    into v_candidates
    from public.room_participants rp
    left join public.profiles pr
      on pr.id = rp.user_id
    where rp.room_id = v_auction.room_id
      and rp.removed_at is null
      and rp.user_id <> v_room.admin_id
      and not exists (
        select 1
        from public.bids b
        where b.auction_session_id = p_auction_session_id
          and b.bidder_id = rp.id
          and b.player_id = any(coalesce(v_recent_player_ids, '{}'::uuid[]))
      );
  end if;

  return jsonb_build_object(
    'success', true,
    'completed_count', v_completed_count,
    'required_count', 25,
    'eligible_participants', coalesce(v_candidates, '[]'::jsonb)
  );
end;
$$;

create or replace function public.remove_inactive_participant(
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
  v_room public.rooms%rowtype;
  v_participant public.room_participants%rowtype;
  v_completed_count int;
  v_recent_player_ids uuid[];
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

  if not found or v_room.admin_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_auction.status not in ('waiting', 'sold', 'unsold') then
    return jsonb_build_object('success', false, 'error', 'Inactive participant removal is only allowed between players');
  end if;

  select * into v_participant
  from public.room_participants
  where id = p_participant_id
    and room_id = v_auction.room_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Participant not found');
  end if;

  if v_participant.removed_at is not null then
    return jsonb_build_object('success', false, 'error', 'Participant already removed');
  end if;

  if v_participant.user_id = v_room.admin_id or v_participant.user_id = auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Cannot remove the admin participant');
  end if;

  v_completed_count := coalesce(array_length(v_auction.completed_players, 1), 0);
  if v_completed_count < 25 then
    return jsonb_build_object('success', false, 'error', 'Removal becomes available after 25 completed players');
  end if;

  v_recent_player_ids := v_auction.completed_players[greatest(v_completed_count - 24, 1):v_completed_count];

  if exists (
    select 1
    from public.bids b
    where b.auction_session_id = p_auction_session_id
      and b.bidder_id = p_participant_id
      and b.player_id = any(coalesce(v_recent_player_ids, '{}'::uuid[]))
  ) then
    return jsonb_build_object('success', false, 'error', 'Participant is not inactive for the last 25 players');
  end if;

  update public.room_participants
  set
    removed_at = now(),
    removed_by_user_id = auth.uid(),
    removal_reason = 'inactive_last_25_players'
  where id = p_participant_id;

  update public.auction_sessions
  set
    active_bidders = coalesce(array_remove(coalesce(active_bidders, '{}'::uuid[]), p_participant_id), '{}'::uuid[]),
    skipped_bidders = coalesce(array_remove(coalesce(skipped_bidders, '{}'::uuid[]), p_participant_id), '{}'::uuid[])
  where id = p_auction_session_id;

  return jsonb_build_object(
    'success', true,
    'removed_participant_id', p_participant_id
  );
end;
$$;
