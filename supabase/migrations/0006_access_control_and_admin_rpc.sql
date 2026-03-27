do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Users can insert own profile'
  ) then
    create policy "Users can insert own profile" on profiles for insert
      with check (auth.uid() = id);
  end if;
end
$$;

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

  if v_auction.highest_bidder_id = p_bidder_participant_id then
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

  if v_participant.user_id != auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized bidder');
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
end;
$$;

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
  v_participant room_participants%rowtype;
  v_skip_count int;
  v_active_count int;
  v_all_skipped boolean;
  v_inserted int;
begin
  select * into v_auction
  from auction_sessions
  where id = p_auction_session_id
  for update;

  if v_auction.status != 'live' then
    return jsonb_build_object('success', false, 'error', 'Auction not live');
  end if;

  select * into v_participant
  from room_participants
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

  if v_auction.skipped_bidders @> array[p_participant_id] then
    return jsonb_build_object('success', true, 'result', 'skipped');
  end if;

  update auction_sessions
  set skipped_bidders = array_append(skipped_bidders, p_participant_id)
  where id = p_auction_session_id;

  if not (v_auction.skipped_bidders @> array[p_participant_id]) then
    select * into v_auction
    from auction_sessions
    where id = p_auction_session_id;
  end if;

  v_active_count := coalesce(array_length(v_auction.active_bidders, 1), 0);
  v_skip_count := coalesce(array_length(v_auction.skipped_bidders, 1), 0);
  if v_auction.highest_bidder_id is not null then
    v_all_skipped := v_active_count > 1 and v_skip_count >= (v_active_count - 1);
  else
    v_all_skipped := v_active_count > 0 and v_skip_count >= v_active_count;
  end if;

  if v_all_skipped and v_auction.highest_bidder_id is null then
    update auction_sessions
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
        null;
    end;

    update auction_sessions
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

  if not exists (
    select 1 from room_participants
    where room_id = v_auction.room_id and user_id = auth.uid()
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_auction.status in ('sold','unsold','completed','paused') then
    return jsonb_build_object('success', true, 'result', v_auction.status, 'note', 'Already finalized');
  end if;

  if v_auction.status != 'live' then
    return jsonb_build_object('success', false, 'error', 'Cannot finalize — status is ' || v_auction.status);
  end if;

  if v_auction.ends_at is not null and v_auction.ends_at > now() then
    return jsonb_build_object('success', false, 'error', 'Timer not expired');
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
        null;
    end;

    update auction_sessions
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

  update auction_sessions
  set
    status = 'unsold',
    ends_at = null,
    completed_players = case
      when completed_players @> array[current_player_id] then completed_players
      else array_append(completed_players, current_player_id)
    end
  where id = p_auction_session_id;

  return jsonb_build_object('success', true, 'result', 'unsold', 'player_id', v_auction.current_player_id);
end;
$$;

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

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  select * into v_room from rooms where id = v_auction.room_id;

  if not exists (
    select 1
    from room_participants
    where room_id = v_auction.room_id
      and user_id = auth.uid()
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_auction.status not in ('sold', 'unsold') then
    return jsonb_build_object('success', true, 'result', 'noop', 'status', v_auction.status);
  end if;

  select queued.player_id into v_next_player_id
  from unnest(v_auction.player_queue) with ordinality as queued(player_id, position)
  where not (queued.player_id = any(coalesce(v_auction.completed_players, '{}')))
  order by queued.position
  limit 1;

  if v_next_player_id is null then
    update auction_sessions set status = 'completed' where id = p_auction_session_id;
    update rooms set status = 'completed' where id = v_auction.room_id;
    return jsonb_build_object('success', true, 'result', 'completed');
  end if;

  v_timer_seconds := (v_room.settings->>'timer_seconds')::int;

  select array_agg(id order by joined_at) into v_active_participants
  from room_participants rp
  where rp.room_id = v_auction.room_id
    and rp.budget_remaining >= (select base_price from players where id = v_next_player_id)
    and rp.squad_count < (v_room.settings->>'squad_size')::int;

  if v_active_participants is null or array_length(v_active_participants, 1) is null then
    update auction_sessions set
      current_player_id = v_next_player_id,
      current_price = (select base_price from players where id = v_next_player_id),
      highest_bidder_id = null,
      ends_at = null,
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

create or replace function pause_auction(
  p_auction_session_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_auction auction_sessions%rowtype;
  v_room rooms%rowtype;
begin
  select * into v_auction from auction_sessions where id = p_auction_session_id for update;
  select * into v_room from rooms where id = v_auction.room_id;

  if v_room.admin_id != auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Not admin');
  end if;

  update auction_sessions
  set status = 'paused'
  where id = p_auction_session_id;

  return jsonb_build_object('success', true, 'result', 'paused');
end;
$$;

create or replace function resume_auction(
  p_auction_session_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_auction auction_sessions%rowtype;
  v_room rooms%rowtype;
  v_timer_seconds int;
begin
  select * into v_auction from auction_sessions where id = p_auction_session_id for update;
  select * into v_room from rooms where id = v_auction.room_id;

  if v_room.admin_id != auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Not admin');
  end if;

  v_timer_seconds := (v_room.settings->>'timer_seconds')::int;

  update auction_sessions
  set
    status = 'live',
    ends_at = now() + (v_timer_seconds || ' seconds')::interval
  where id = p_auction_session_id;

  return jsonb_build_object('success', true, 'result', 'live');
end;
$$;

create or replace function stop_auction(
  p_auction_session_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_auction auction_sessions%rowtype;
  v_room rooms%rowtype;
begin
  select * into v_auction from auction_sessions where id = p_auction_session_id for update;
  select * into v_room from rooms where id = v_auction.room_id;

  if v_room.admin_id != auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Not admin');
  end if;

  update auction_sessions set status = 'completed' where id = p_auction_session_id;
  update rooms set status = 'completed' where id = v_auction.room_id;

  return jsonb_build_object('success', true, 'result', 'completed');
end;
$$;
