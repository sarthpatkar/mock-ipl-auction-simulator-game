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
  v_active_bidder_count int := 0;
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

  select coalesce(array_length(coalesce(v_auction.active_bidders, '{}'::uuid[]), 1), 0)
  into v_active_bidder_count;

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
      -- In a two-participant room, one manual skip before any bid should not
      -- auto-award the player to the other participant. Wait for a bid, a skip,
      -- or timer expiry.
      if p_manual_skip_participant_id is not null
         and v_active_bidder_count = 2 then
        return jsonb_build_object(
          'success', true,
          'result', 'skipped',
          'skipped_bidders', coalesce(v_auction.skipped_bidders, '{}'::uuid[])
        );
      end if;

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
