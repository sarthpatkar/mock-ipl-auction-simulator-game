create or replace function public.get_next_valid_bid_amount(
  p_room_id uuid,
  p_current_price bigint,
  p_highest_bidder_id uuid default null
)
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select case
    when p_highest_bidder_id is null then coalesce(p_current_price, 0)
    when r.auction_mode = 'match_auction' then coalesce(p_current_price, 0) + 5000000
    when coalesce(p_current_price, 0) < 500000000 then coalesce(p_current_price, 0) + 2500000
    when coalesce(p_current_price, 0) < 700000000 then coalesce(p_current_price, 0) + 5000000
    else coalesce(p_current_price, 0) + 10000000
  end
  from public.rooms r
  where r.id = p_room_id;
$$;

create or replace function public.get_auction_auto_skipped_bidders(
  p_room_id uuid,
  p_active_bidders uuid[],
  p_current_price bigint,
  p_highest_bidder_id uuid default null
)
returns uuid[]
language sql
security definer
set search_path = public
stable
as $$
  with room_settings as (
    select
      coalesce(
        (settings->>'squad_size')::int,
        case when auction_mode = 'match_auction' then 7 else 20 end
      ) as squad_size
    from public.rooms
    where id = p_room_id
  ),
  next_bid as (
    select public.get_next_valid_bid_amount(
      p_room_id,
      p_current_price,
      p_highest_bidder_id
    ) as amount
  ),
  active as (
    select bidder_id, position
    from unnest(coalesce(p_active_bidders, '{}'::uuid[])) with ordinality as bidder(bidder_id, position)
  )
  select coalesce(array_agg(active.bidder_id order by active.position), '{}'::uuid[])
  from active
  cross join room_settings rs
  cross join next_bid nb
  join public.room_participants rp
    on rp.id = active.bidder_id
   and rp.room_id = p_room_id
  where (p_highest_bidder_id is null or active.bidder_id <> p_highest_bidder_id)
    and (
      rp.removed_at is not null
      or rp.squad_count >= rs.squad_size
      or rp.budget_remaining < nb.amount
    );
$$;

create or replace function public.get_match_auction_auto_skipped_bidders(
  p_room_id uuid,
  p_active_bidders uuid[],
  p_current_price bigint,
  p_highest_bidder_id uuid default null
)
returns uuid[]
language sql
security definer
set search_path = public
stable
as $$
  select public.get_auction_auto_skipped_bidders(
    p_room_id,
    p_active_bidders,
    p_current_price,
    p_highest_bidder_id
  );
$$;

create or replace function public.resolve_current_auction_player(
  p_auction_session_id uuid,
  p_winner_participant_id uuid default null,
  p_price bigint default null,
  p_record_bid boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auction_sessions%rowtype;
  v_price bigint;
  v_inserted int := 0;
begin
  select * into v_auction
  from public.auction_sessions
  where id = p_auction_session_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  if v_auction.current_player_id is null then
    return jsonb_build_object('success', true, 'result', coalesce(v_auction.status, 'waiting'));
  end if;

  v_price := coalesce(p_price, v_auction.current_price, 0);

  if p_winner_participant_id is not null then
    if p_record_bid then
      insert into public.bids (auction_session_id, player_id, bidder_id, amount)
      values (p_auction_session_id, v_auction.current_player_id, p_winner_participant_id, v_price);
    end if;

    begin
      insert into public.squad_players (room_id, participant_id, player_id, price_paid)
      values (
        v_auction.room_id,
        p_winner_participant_id,
        v_auction.current_player_id,
        v_price
      );
      get diagnostics v_inserted = row_count;

      if v_inserted > 0 then
        update public.room_participants
        set
          budget_remaining = budget_remaining - v_price,
          squad_count = squad_count + 1
        where id = p_winner_participant_id;
      end if;
    exception
      when unique_violation then
        null;
    end;

    update public.auction_sessions
    set
      current_price = v_price,
      highest_bidder_id = p_winner_participant_id,
      status = 'sold',
      ends_at = null,
      paused_remaining_ms = null,
      skipped_bidders = coalesce(
        array_remove(coalesce(skipped_bidders, '{}'::uuid[]), p_winner_participant_id),
        '{}'::uuid[]
      ),
      completed_players = case
        when completed_players @> array[current_player_id] then completed_players
        else array_append(completed_players, current_player_id)
      end
    where id = p_auction_session_id;

    return jsonb_build_object(
      'success', true,
      'result', 'sold',
      'winner', p_winner_participant_id,
      'player_id', v_auction.current_player_id,
      'price', v_price
    );
  end if;

  update public.auction_sessions
  set
    highest_bidder_id = null,
    status = 'unsold',
    ends_at = null,
    paused_remaining_ms = null,
    completed_players = case
      when completed_players @> array[current_player_id] then completed_players
      else array_append(completed_players, current_player_id)
    end
  where id = p_auction_session_id;

  return jsonb_build_object('success', true, 'result', 'unsold', 'player_id', v_auction.current_player_id);
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

  if v_auction.highest_bidder_id is null then
    if coalesce(array_length(v_eligible_bidders, 1), 0) = 0 then
      return public.resolve_current_auction_player(
        p_auction_session_id,
        null,
        v_auction.current_price,
        false
      );
    end if;

    if coalesce(array_length(v_eligible_bidders, 1), 0) = 1 then
      return public.resolve_current_auction_player(
        p_auction_session_id,
        v_eligible_bidders[1],
        v_auction.current_price,
        true
      );
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'result', case when p_manual_skip_participant_id is null then 'live' else 'skipped' end,
    'skipped_bidders', coalesce(v_auction.skipped_bidders, '{}'::uuid[])
  );
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
  v_reconcile_result jsonb;
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

  select public.reconcile_current_auction_skips(p_auction_session_id) into v_reconcile_result;

  if coalesce(v_reconcile_result->>'result', '') in ('sold', 'unsold') then
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
    ends_at = now() + (v_timer_seconds || ' seconds')::interval
  where id = p_auction_session_id;

  insert into public.bids (auction_session_id, player_id, bidder_id, amount)
  values (p_auction_session_id, v_auction.current_player_id, p_bidder_participant_id, p_bid_amount);

  select public.reconcile_current_auction_skips(p_auction_session_id) into v_reconcile_result;

  if coalesce(v_reconcile_result->>'result', '') in ('sold', 'unsold') then
    return v_reconcile_result;
  end if;

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

  return public.reconcile_current_auction_skips(
    p_auction_session_id,
    p_participant_id
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
  v_total_participants int;
  v_full_participants int;
  v_zero_budget_participants int;
  v_advance_result jsonb;
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

  if v_room.auction_mode = 'match_auction' and coalesce(v_auction.round_number, 1) = 1 then
    select
      count(*),
      count(*) filter (where squad_count >= (v_room.settings->>'squad_size')::int),
      count(*) filter (where budget_remaining <= 0)
    into v_total_participants, v_full_participants, v_zero_budget_participants
    from public.room_participants
    where room_id = v_auction.room_id
      and removed_at is null;

    if coalesce(v_total_participants, 0) > 0
       and (
         v_full_participants = v_total_participants
         or v_zero_budget_participants = v_total_participants
       ) then
      update public.auction_sessions
      set
        status = 'completed',
        current_player_id = null,
        highest_bidder_id = null,
        ends_at = null,
        paused_remaining_ms = null,
        active_bidders = '{}',
        skipped_bidders = '{}'
      where id = p_auction_session_id;

      update public.rooms
      set
        status = 'completed',
        results_reveal_at = null
      where id = v_auction.room_id;

      perform public.refresh_match_auction_provisional_results(v_auction.room_id);
      return jsonb_build_object('success', true, 'result', 'completed');
    end if;
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
      highest_bidder_id = null,
      ends_at = null,
      paused_remaining_ms = null,
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
      return jsonb_build_object('success', true, 'result', 'completed');
    end if;

    if coalesce(v_auction.round_number, 1) = 1 then
      v_round_two_pool := public.compute_accelerated_round_pool(v_auction.room_id, v_auction.player_queue);
      if coalesce(array_length(v_round_two_pool, 1), 0) > 0 then
        select public.begin_accelerated_selection(v_auction.room_id) into v_selection_result;
        return coalesce(v_selection_result, jsonb_build_object('success', true, 'result', 'accelerated_selection'));
      end if;
    end if;

    perform public.complete_room_results_reveal(v_auction.room_id, coalesce(v_auction.round_number, 1) >= 2);
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

  select public.reconcile_current_auction_skips(p_auction_session_id) into v_advance_result;

  if coalesce(v_advance_result->>'result', '') in ('sold', 'unsold') then
    return v_advance_result;
  end if;

  return jsonb_build_object('success', true, 'result', 'advanced', 'next_player', v_next_player_id);
end;
$$;

create or replace function public.finalize_player(
  p_auction_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auction_sessions%rowtype;
  v_reconcile_result jsonb;
begin
  select * into v_auction
  from public.auction_sessions
  where id = p_auction_session_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Auction session not found');
  end if;

  if not exists (
    select 1
    from public.room_participants
    where room_id = v_auction.room_id
      and user_id = auth.uid()
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_auction.status in ('sold', 'unsold', 'completed', 'paused') then
    return jsonb_build_object('success', true, 'result', v_auction.status, 'note', 'Already finalized');
  end if;

  if v_auction.status != 'live' then
    return jsonb_build_object('success', false, 'error', 'Cannot finalize — status is ' || v_auction.status);
  end if;

  if v_auction.ends_at is not null and v_auction.ends_at > now() then
    return jsonb_build_object('success', false, 'error', 'Timer not expired');
  end if;

  select public.reconcile_current_auction_skips(p_auction_session_id) into v_reconcile_result;

  if coalesce(v_reconcile_result->>'result', '') in ('sold', 'unsold') then
    return v_reconcile_result;
  end if;

  if v_auction.highest_bidder_id is not null then
    return public.resolve_current_auction_player(
      p_auction_session_id,
      v_auction.highest_bidder_id,
      v_auction.current_price,
      false
    );
  end if;

  return public.resolve_current_auction_player(
    p_auction_session_id,
    null,
    v_auction.current_price,
    false
  );
end;
$$;
