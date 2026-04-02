create or replace function public.refresh_match_auction_provisional_results(
  p_room_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_match public.matches%rowtype;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id;

  if not found or v_room.auction_mode <> 'match_auction' or v_room.match_id is null then
    return;
  end if;

  select * into v_match
  from public.matches
  where id = v_room.match_id;

  if not found then
    return;
  end if;

  delete from public.match_auction_results
  where room_id = p_room_id;

  insert into public.match_auction_results (
    room_id,
    user_id,
    projected_score,
    actual_score,
    result_status,
    rank,
    winner_user_id,
    last_updated_at,
    last_result_updated_at,
    published_stats_version
  )
  with participant_scores as (
    select
      rp.room_id,
      rp.user_id,
      rp.joined_at,
      coalesce(
        sum(
          round(
            coalesce(p.performance_score, 0) * 0.55
            + coalesce(p.recent_form_score, 0) * 0.25
            + coalesce(p.consistency_score, 0) * 0.20
          )
        ),
        0
      )::int as projected_score
    from public.room_participants rp
    left join public.squad_players sp
      on sp.participant_id = rp.id
     and sp.room_id = rp.room_id
    left join public.players p
      on p.id = sp.player_id
    where rp.room_id = p_room_id
      and rp.removed_at is null
    group by rp.room_id, rp.user_id, rp.joined_at
  ),
  ranked as (
    select
      ps.*,
      dense_rank() over (order by ps.projected_score desc) as score_rank,
      row_number() over (order by ps.projected_score desc, ps.joined_at asc) as placement
    from participant_scores ps
  ),
  winner as (
    select user_id
    from ranked
    where placement = 1
    limit 1
  )
  select
    p_room_id,
    ranked.user_id,
    ranked.projected_score,
    null,
    case
      when v_match.status = 'live' then 'match_live'
      when v_match.status in ('abandoned', 'cancelled') then 'match_abandoned'
      else 'waiting_for_match'
    end,
    ranked.score_rank,
    case
      when v_match.status in ('abandoned', 'cancelled') then null
      else (select user_id from winner)
    end,
    now(),
    now(),
    null
  from ranked;
end;
$$;
