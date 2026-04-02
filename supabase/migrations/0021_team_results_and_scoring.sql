create table if not exists public.team_results (
  room_id uuid references public.rooms(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  team_score numeric not null,
  rank int not null,
  breakdown_json jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (room_id, user_id)
);

create index if not exists idx_team_results_room_rank on public.team_results(room_id, rank);

alter table public.team_results enable row level security;

drop policy if exists "Room members can read team results" on public.team_results;
create policy "Room members can read team results"
on public.team_results
for select
using (
  is_room_member(room_id)
  or exists (
    select 1
    from public.rooms r
    where r.id = team_results.room_id
      and r.admin_id = auth.uid()
  )
);

create or replace function public.compute_team_result_base_scores(
  p_room_id uuid
)
returns table (
  participant_id uuid,
  user_id uuid,
  team_name text,
  budget_remaining bigint,
  joined_at timestamptz,
  team_score numeric,
  score_data jsonb
)
language sql
security definer
set search_path = public
stable
as $$
with participants as (
  select
    rp.id as participant_id,
    rp.user_id,
    rp.team_name,
    rp.budget_remaining,
    rp.joined_at
  from public.room_participants rp
  where rp.room_id = p_room_id
),
squad_rows as (
  select
    p.participant_id,
    p.user_id,
    p.team_name,
    p.budget_remaining,
    p.joined_at,
    sp.player_id,
    pl.role,
    pl.impact_type,
    pl.experience_level,
    coalesce(pl.performance_score, 0)::numeric as performance_score,
    coalesce(pl.consistency_score, 0)::numeric as consistency_score,
    coalesce(pl.recent_form_score, 0)::numeric as recent_form_score,
    coalesce(pl.base_price, 0)::numeric as base_price,
    (
      coalesce(pl.performance_score, 0)::numeric * 0.50
      + coalesce(pl.consistency_score, 0)::numeric * 2.50
      + coalesce(pl.recent_form_score, 0)::numeric * 2.50
    ) as player_composite
  from participants p
  left join public.squad_players sp
    on sp.room_id = p_room_id
   and sp.participant_id = p.participant_id
  left join public.players pl
    on pl.id = sp.player_id
  where sp.player_id is not null
),
ranked_squad as (
  select
    sr.*,
    row_number() over (
      partition by sr.participant_id
      order by
        sr.player_composite desc,
        sr.performance_score desc,
        sr.recent_form_score desc,
        sr.consistency_score desc,
        sr.base_price desc,
        sr.player_id asc
    ) as rn
  from squad_rows sr
),
best_xi as (
  select *
  from ranked_squad
  where rn <= 11
),
full_agg as (
  select
    sr.participant_id,
    count(*)::int as squad_count,
    coalesce(array_agg(sr.player_id order by sr.player_composite desc, sr.player_id asc), '{}'::uuid[]) as squad_player_ids,
    count(*) filter (where sr.performance_score >= 85)::int as star_count,
    coalesce(array_agg(sr.player_id order by sr.performance_score desc, sr.player_id asc) filter (where sr.performance_score >= 85), '{}'::uuid[]) as star_player_ids,
    bool_or(sr.impact_type = 'anchor') as has_anchor,
    bool_or(sr.impact_type = 'finisher') as has_finisher,
    bool_or(sr.impact_type = 'death_bowler') as has_death_bowler,
    bool_or(sr.impact_type = 'spinner') as has_spinner,
    bool_or(sr.impact_type = 'powerplay_bowler') as has_powerplay_bowler,
    bool_or(sr.impact_type = 'all_rounder') as has_all_rounder_role,
    count(*) filter (where sr.experience_level = 'rookie')::int as rookie_count,
    count(*) filter (where sr.experience_level = 'mid')::int as mid_count,
    count(*) filter (where sr.experience_level = 'veteran')::int as veteran_count
  from squad_rows sr
  group by sr.participant_id
),
best_agg as (
  select
    bx.participant_id,
    count(*)::int as best_xi_count,
    coalesce(array_agg(bx.player_id order by bx.rn), '{}'::uuid[]) as best_xi_player_ids,
    coalesce(avg(bx.player_composite), 0)::numeric as best_xi_avg,
    count(*) filter (where bx.role = 'batter')::int as batter_count,
    count(*) filter (where bx.role = 'bowler')::int as bowler_count,
    count(*) filter (where bx.role = 'allrounder')::int as allrounder_count,
    count(*) filter (where bx.role = 'wicketkeeper')::int as wicketkeeper_count,
    count(*) filter (where bx.role in ('batter', 'wicketkeeper', 'allrounder'))::int as batting_contributors,
    count(*) filter (where bx.role in ('bowler', 'allrounder'))::int as bowling_contributors,
    count(*) filter (where bx.role = 'bowler')::int as specialist_bowlers
  from best_xi bx
  group by bx.participant_id
),
base_counts as (
  select
    p.participant_id,
    p.user_id,
    p.team_name,
    p.budget_remaining,
    p.joined_at,
    coalesce(f.squad_count, 0) as squad_count,
    coalesce(f.squad_player_ids, '{}'::uuid[]) as squad_player_ids,
    coalesce(b.best_xi_player_ids, '{}'::uuid[]) as best_xi_player_ids,
    coalesce(b.best_xi_count, 0) as best_xi_count,
    coalesce(b.best_xi_avg, 0)::numeric as best_xi_avg,
    coalesce(b.batter_count, 0) as batter_count,
    coalesce(b.bowler_count, 0) as bowler_count,
    coalesce(b.allrounder_count, 0) as allrounder_count,
    coalesce(b.wicketkeeper_count, 0) as wicketkeeper_count,
    coalesce(b.batting_contributors, 0) as batting_contributors,
    coalesce(b.bowling_contributors, 0) as bowling_contributors,
    coalesce(b.specialist_bowlers, 0) as specialist_bowlers,
    coalesce(f.star_count, 0) as star_count,
    coalesce(f.star_player_ids, '{}'::uuid[]) as star_player_ids,
    coalesce(f.has_anchor, false) as has_anchor,
    coalesce(f.has_finisher, false) as has_finisher,
    coalesce(f.has_death_bowler, false) as has_death_bowler,
    coalesce(f.has_spinner, false) as has_spinner,
    coalesce(f.has_powerplay_bowler, false) as has_powerplay_bowler,
    coalesce(f.has_all_rounder_role, false) as has_all_rounder_role,
    coalesce(f.rookie_count, 0) as rookie_count,
    coalesce(f.mid_count, 0) as mid_count,
    coalesce(f.veteran_count, 0) as veteran_count
  from participants p
  left join full_agg f on f.participant_id = p.participant_id
  left join best_agg b on b.participant_id = p.participant_id
),
coverage_roles as (
  select
    bc.*,
    array_remove(array[
      case when bc.has_anchor then 'anchor' end,
      case when bc.has_finisher then 'finisher' end,
      case when bc.has_death_bowler then 'death_bowler' end,
      case when bc.has_spinner then 'spinner' end,
      case when bc.has_powerplay_bowler then 'powerplay_bowler' end,
      case when bc.has_all_rounder_role then 'all_rounder' end
    ], null) as present_roles,
    array_remove(array[
      case when not bc.has_anchor then 'anchor' end,
      case when not bc.has_finisher then 'finisher' end,
      case when not bc.has_death_bowler then 'death_bowler' end,
      case when not bc.has_spinner then 'spinner' end,
      case when not bc.has_powerplay_bowler then 'powerplay_bowler' end,
      case when not bc.has_all_rounder_role then 'all_rounder' end
    ], null) as missing_roles
  from base_counts bc
),
scored as (
  select
    cr.*,
    (greatest(4 - cr.batter_count, 0) + greatest(cr.batter_count - 5, 0))::numeric as batter_deviation,
    (greatest(3 - cr.bowler_count, 0) + greatest(cr.bowler_count - 4, 0))::numeric as bowler_deviation,
    (greatest(2 - cr.allrounder_count, 0) + greatest(cr.allrounder_count - 3, 0))::numeric as allrounder_deviation,
    (greatest(1 - cr.wicketkeeper_count, 0) + greatest(cr.wicketkeeper_count - 1, 0))::numeric as wicketkeeper_deviation,
    round(
      case
        when cr.best_xi_count = 0 then 0
        else ((cr.best_xi_avg * (cr.best_xi_count::numeric / 11.0)) / 100.0) * 40.0
      end,
      2
    ) as player_strength,
    round(
      greatest(
        0,
        25
        - (
          ((greatest(4 - cr.batter_count, 0) + greatest(cr.batter_count - 5, 0))::numeric * 3.5)
          + ((greatest(3 - cr.bowler_count, 0) + greatest(cr.bowler_count - 4, 0))::numeric * 3.5)
          + ((greatest(2 - cr.allrounder_count, 0) + greatest(cr.allrounder_count - 3, 0))::numeric * 3.0)
          + ((greatest(1 - cr.wicketkeeper_count, 0) + greatest(cr.wicketkeeper_count - 1, 0))::numeric * 6.0)
        )
      ),
      2
    ) as team_balance,
    round((coalesce(array_length(cr.present_roles, 1), 0)::numeric * (15.0 / 6.0)), 2) as role_coverage,
    round(
      case
        when cr.batting_contributors >= 6 then 2.5
        when cr.batting_contributors = 5 then 1.5
        when cr.batting_contributors = 4 then 0.75
        else 0
      end,
      2
    ) as batting_depth_sub,
    round(
      case
        when cr.bowling_contributors >= 5 and cr.specialist_bowlers >= 3 then 2.5
        when cr.bowling_contributors >= 4 then 1.5
        when cr.bowling_contributors = 3 then 0.75
        else 0
      end,
      2
    ) as bowling_network_sub,
    round(
      case
        when cr.allrounder_count between 2 and 3 then 2.5
        when cr.allrounder_count in (1, 4) then 1.25
        else 0
      end,
      2
    ) as allrounder_support_sub,
    round(
      case
        when cr.squad_count = 0 then 0
        when cr.veteran_count > 0 and cr.mid_count > 0 and (cr.rookie_count::numeric / greatest(cr.squad_count, 1)) <= 0.4 then 2.5
        when cr.veteran_count > 0 and cr.mid_count > 0 then 1.5
        when cr.rookie_count = cr.squad_count or cr.mid_count = cr.squad_count or cr.veteran_count = cr.squad_count then 0.5
        else 0
      end,
      2
    ) as experience_blend_sub,
    round(
      case
        when cr.star_count >= 5 then 10
        when cr.star_count = 4 then 9
        when cr.star_count = 3 then 7.5
        when cr.star_count = 2 then 5.5
        when cr.star_count = 1 then 3
        else 0
      end,
      2
    ) as star_raw,
    round(
      greatest(
        0.0,
        least(
          1.0,
          0.70
          + (0.15 * (
            greatest(
              0,
              25
              - (
                ((greatest(4 - cr.batter_count, 0) + greatest(cr.batter_count - 5, 0))::numeric * 3.5)
                + ((greatest(3 - cr.bowler_count, 0) + greatest(cr.bowler_count - 4, 0))::numeric * 3.5)
                + ((greatest(2 - cr.allrounder_count, 0) + greatest(cr.allrounder_count - 3, 0))::numeric * 3.0)
                + ((greatest(1 - cr.wicketkeeper_count, 0) + greatest(cr.wicketkeeper_count - 1, 0))::numeric * 6.0)
              )
            ) / 25.0
          ))
          + (0.15 * (
            (
              case
                when cr.batting_contributors >= 6 then 2.5
                when cr.batting_contributors = 5 then 1.5
                when cr.batting_contributors = 4 then 0.75
                else 0
              end
              +
              case
                when cr.bowling_contributors >= 5 and cr.specialist_bowlers >= 3 then 2.5
                when cr.bowling_contributors >= 4 then 1.5
                when cr.bowling_contributors = 3 then 0.75
                else 0
              end
              +
              case
                when cr.allrounder_count between 2 and 3 then 2.5
                when cr.allrounder_count in (1, 4) then 1.25
                else 0
              end
              +
              case
                when cr.squad_count = 0 then 0
                when cr.veteran_count > 0 and cr.mid_count > 0 and (cr.rookie_count::numeric / greatest(cr.squad_count, 1)) <= 0.4 then 2.5
                when cr.veteran_count > 0 and cr.mid_count > 0 then 1.5
                when cr.rookie_count = cr.squad_count or cr.mid_count = cr.squad_count or cr.veteran_count = cr.squad_count then 0.5
                else 0
              end
            ) / 10.0
          ))
        )
      ),
      4
    ) as star_normalization_multiplier,
    round(
      (
        case
          when cr.star_count >= 5 then 10
          when cr.star_count = 4 then 9
          when cr.star_count = 3 then 7.5
          when cr.star_count = 2 then 5.5
          when cr.star_count = 1 then 3
          else 0
        end
      ),
      2
    ) as penalty_seed,
    round(case when cr.wicketkeeper_count = 0 then 12 else 0 end, 2) as penalty_no_wicketkeeper,
    round(greatest(cr.batter_count - 5, 0)::numeric * 2.0, 2) as penalty_batter_overload,
    round(greatest(cr.bowler_count - 4, 0)::numeric * 2.0, 2) as penalty_bowler_overload,
    round(case when cr.has_death_bowler then 0 else 6 end, 2) as penalty_missing_death_bowler
  from coverage_roles cr
),
assembled as (
  select
    s.*,
    round(s.batting_depth_sub + s.bowling_network_sub + s.allrounder_support_sub + s.experience_blend_sub, 2) as synergy,
    round(
      least(
        10,
        s.star_raw * s.star_normalization_multiplier
      ),
      2
    ) as star_power,
    round(
      s.penalty_no_wicketkeeper
      + s.penalty_batter_overload
      + s.penalty_bowler_overload
      + s.penalty_missing_death_bowler,
      2
    ) as penalties_total
  from scored s
),
finalized as (
  select
    a.*,
    round(
      least(
        100,
        greatest(
          0,
          a.player_strength + a.team_balance + a.role_coverage + a.star_power + a.synergy - a.penalties_total
        )
      ),
      2
    ) as final_team_score
  from assembled a
)
select
  f.participant_id,
  f.user_id,
  f.team_name,
  f.budget_remaining,
  f.joined_at,
  f.final_team_score as team_score,
  jsonb_build_object(
    'components', jsonb_build_object(
      'player_strength', jsonb_build_object('score', f.player_strength, 'max', 40),
      'team_balance', jsonb_build_object('score', f.team_balance, 'max', 25),
      'role_coverage', jsonb_build_object('score', f.role_coverage, 'max', 15),
      'star_power', jsonb_build_object('score', f.star_power, 'max', 10),
      'synergy', jsonb_build_object('score', f.synergy, 'max', 10)
    ),
    'penalties', jsonb_build_object(
      'total', f.penalties_total,
      'items', coalesce((
        select jsonb_agg(item)
        from (
          select jsonb_build_object(
            'code', 'no_wicketkeeper',
            'factor', 'penalty_no_wicketkeeper',
            'points', f.penalty_no_wicketkeeper,
            'message', 'No wicketkeeper in the best XI'
          ) as item
          where f.penalty_no_wicketkeeper > 0

          union all

          select jsonb_build_object(
            'code', 'batter_overload',
            'factor', 'penalty_batter_overload',
            'points', f.penalty_batter_overload,
            'message', 'Too many batters in the best XI'
          )
          where f.penalty_batter_overload > 0

          union all

          select jsonb_build_object(
            'code', 'bowler_overload',
            'factor', 'penalty_bowler_overload',
            'points', f.penalty_bowler_overload,
            'message', 'Too many bowlers in the best XI'
          )
          where f.penalty_bowler_overload > 0

          union all

          select jsonb_build_object(
            'code', 'missing_death_bowler',
            'factor', 'penalty_missing_death_bowler',
            'points', f.penalty_missing_death_bowler,
            'message', 'No death bowler in the squad'
          )
          where f.penalty_missing_death_bowler > 0
        ) penalty_items
      ), '[]'::jsonb)
    ),
    'best_xi_player_ids', to_jsonb(f.best_xi_player_ids),
    'balance_detail', jsonb_build_object(
      'role_counts', jsonb_build_object(
        'batter', f.batter_count,
        'bowler', f.bowler_count,
        'allrounder', f.allrounder_count,
        'wicketkeeper', f.wicketkeeper_count
      ),
      'deviations', jsonb_build_object(
        'batter', f.batter_deviation,
        'bowler', f.bowler_deviation,
        'allrounder', f.allrounder_deviation,
        'wicketkeeper', f.wicketkeeper_deviation
      ),
      'ideal_ranges', jsonb_build_object(
        'batter', jsonb_build_object('min', 4, 'max', 5),
        'bowler', jsonb_build_object('min', 3, 'max', 4),
        'allrounder', jsonb_build_object('min', 2, 'max', 3),
        'wicketkeeper', jsonb_build_object('min', 1, 'max', 1)
      ),
      'total_deviation_cost', round(
        (f.batter_deviation * 3.5)
        + (f.bowler_deviation * 3.5)
        + (f.allrounder_deviation * 3.0)
        + (f.wicketkeeper_deviation * 6.0),
        2
      )
    ),
    'coverage_detail', jsonb_build_object(
      'present_roles', to_jsonb(f.present_roles),
      'missing_roles', to_jsonb(f.missing_roles),
      'present_count', coalesce(array_length(f.present_roles, 1), 0),
      'max_roles', 6,
      'per_role_points', 2.5,
      'score', f.role_coverage
    ),
    'star_detail', jsonb_build_object(
      'star_count', f.star_count,
      'star_player_ids', to_jsonb(f.star_player_ids),
      'raw_score', f.star_raw,
      'normalization_multiplier', f.star_normalization_multiplier,
      'threshold', 85,
      'score', f.star_power,
      'max', 10
    ),
    'synergy_detail', jsonb_build_object(
      'score', f.synergy,
      'max', 10,
      'batting_depth', jsonb_build_object(
        'score', f.batting_depth_sub,
        'contributors', f.batting_contributors
      ),
      'bowling_network', jsonb_build_object(
        'score', f.bowling_network_sub,
        'contributors', f.bowling_contributors,
        'specialist_bowlers', f.specialist_bowlers
      ),
      'allrounder_support', jsonb_build_object(
        'score', f.allrounder_support_sub,
        'count', f.allrounder_count
      ),
      'experience_blend', jsonb_build_object(
        'score', f.experience_blend_sub,
        'rookie_count', f.rookie_count,
        'mid_count', f.mid_count,
        'veteran_count', f.veteran_count,
        'rookie_share', round(case when f.squad_count = 0 then 0 else f.rookie_count::numeric / f.squad_count::numeric end, 4)
      )
    ),
    'raw_metrics', jsonb_build_object(
      'squad_count', f.squad_count,
      'squad_player_ids', to_jsonb(f.squad_player_ids),
      'best_xi_count', f.best_xi_count,
      'best_xi_avg', round(f.best_xi_avg, 2),
      'star_count', f.star_count,
      'present_role_count', coalesce(array_length(f.present_roles, 1), 0),
      'has_anchor', f.has_anchor,
      'has_finisher', f.has_finisher,
      'has_death_bowler', f.has_death_bowler,
      'has_spinner', f.has_spinner,
      'has_powerplay_bowler', f.has_powerplay_bowler,
      'has_all_rounder_role', f.has_all_rounder_role,
      'batter_count', f.batter_count,
      'bowler_count', f.bowler_count,
      'allrounder_count', f.allrounder_count,
      'wicketkeeper_count', f.wicketkeeper_count,
      'batting_contributors', f.batting_contributors,
      'bowling_contributors', f.bowling_contributors,
      'specialist_bowlers', f.specialist_bowlers,
      'rookie_count', f.rookie_count,
      'mid_count', f.mid_count,
      'veteran_count', f.veteran_count,
      'batting_depth_sub', f.batting_depth_sub,
      'bowling_network_sub', f.bowling_network_sub,
      'allrounder_support_sub', f.allrounder_support_sub,
      'experience_blend_sub', f.experience_blend_sub,
      'penalty_no_wicketkeeper', f.penalty_no_wicketkeeper,
      'penalty_batter_overload', f.penalty_batter_overload,
      'penalty_bowler_overload', f.penalty_bowler_overload,
      'penalty_missing_death_bowler', f.penalty_missing_death_bowler
    )
  ) as score_data
from finalized f;
$$;

create or replace function public.compute_team_result_rankings(
  p_room_id uuid
)
returns table (
  participant_id uuid,
  user_id uuid,
  team_name text,
  budget_remaining bigint,
  joined_at timestamptz,
  team_score numeric,
  rank int,
  score_data jsonb,
  ranking_detail jsonb
)
language sql
security definer
set search_path = public
stable
as $$
select
  base.participant_id,
  base.user_id,
  base.team_name,
  base.budget_remaining,
  base.joined_at,
  base.team_score,
  row_number() over (
    order by
      base.team_score desc,
      ((base.score_data->'components'->'player_strength'->>'score')::numeric) desc,
      ((base.score_data->'components'->'synergy'->>'score')::numeric) desc,
      base.budget_remaining asc,
      base.joined_at asc,
      base.user_id asc
  )::int as rank,
  base.score_data,
  jsonb_build_object(
    'player_strength', ((base.score_data->'components'->'player_strength'->>'score')::numeric),
    'synergy', ((base.score_data->'components'->'synergy'->>'score')::numeric),
    'budget_remaining', base.budget_remaining,
    'joined_at', base.joined_at,
    'user_id', base.user_id
  ) as ranking_detail
from public.compute_team_result_base_scores(p_room_id) base;
$$;

create or replace function public.compute_team_result_comparisons(
  p_room_id uuid
)
returns table (
  participant_id uuid,
  user_id uuid,
  team_name text,
  budget_remaining bigint,
  joined_at timestamptz,
  team_score numeric,
  rank int,
  score_data jsonb,
  ranking_detail jsonb,
  comparison jsonb,
  loss_reasons jsonb
)
language sql
security definer
set search_path = public
stable
as $$
with ranked as (
  select *
  from public.compute_team_result_rankings(p_room_id)
),
winner as (
  select *
  from ranked
  where rank = 1
)
select
  ranked.participant_id,
  ranked.user_id,
  ranked.team_name,
  ranked.budget_remaining,
  ranked.joined_at,
  ranked.team_score,
  ranked.rank,
  ranked.score_data,
  ranked.ranking_detail,
  case
    when ranked.rank = 1 then null
    else jsonb_build_object(
      'winner_user_id', winner.user_id,
      'winner_team_name', winner.team_name,
      'winner_team_score', winner.team_score,
      'score_gap', round(winner.team_score - ranked.team_score, 2),
      'component_deltas', jsonb_build_object(
        'player_strength', round(((winner.score_data->'components'->'player_strength'->>'score')::numeric) - ((ranked.score_data->'components'->'player_strength'->>'score')::numeric), 2),
        'team_balance', round(((winner.score_data->'components'->'team_balance'->>'score')::numeric) - ((ranked.score_data->'components'->'team_balance'->>'score')::numeric), 2),
        'role_coverage', round(((winner.score_data->'components'->'role_coverage'->>'score')::numeric) - ((ranked.score_data->'components'->'role_coverage'->>'score')::numeric), 2),
        'star_power', round(((winner.score_data->'components'->'star_power'->>'score')::numeric) - ((ranked.score_data->'components'->'star_power'->>'score')::numeric), 2),
        'synergy', round(((winner.score_data->'components'->'synergy'->>'score')::numeric) - ((ranked.score_data->'components'->'synergy'->>'score')::numeric), 2)
      ),
      'penalty_delta', round(((ranked.score_data->'penalties'->>'total')::numeric) - ((winner.score_data->'penalties'->>'total')::numeric), 2),
      'missing_roles_relative_to_winner', coalesce((
        select jsonb_agg(missing_roles.winner_role)
        from (
          select winner_role.value as winner_role
          from jsonb_array_elements_text(winner.score_data->'coverage_detail'->'present_roles') as winner_role(value)
          where not exists (
            select 1
            from jsonb_array_elements_text(ranked.score_data->'coverage_detail'->'present_roles') as my_role(value)
            where my_role.value = winner_role.value
          )
        ) missing_roles
      ), '[]'::jsonb),
      'star_count_delta', ((winner.score_data->'star_detail'->>'star_count')::numeric) - ((ranked.score_data->'star_detail'->>'star_count')::numeric),
      'best_xi_avg_delta', round(((winner.score_data->'raw_metrics'->>'best_xi_avg')::numeric) - ((ranked.score_data->'raw_metrics'->>'best_xi_avg')::numeric), 2)
    )
  end as comparison,
  case
    when ranked.rank = 1 then '[]'::jsonb
    else coalesce(reason_data.loss_reasons, '[]'::jsonb)
  end as loss_reasons
from ranked
cross join winner
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'factor', candidates.factor,
      'your_value', candidates.your_value,
      'winner_value', candidates.winner_value,
      'impact', candidates.impact,
      'message', candidates.message
    )
    order by candidates.impact desc, candidates.factor asc
  ) as loss_reasons
  from (
    select *
    from (
      select
        'player_strength'::text as factor,
        round((ranked.score_data->'components'->'player_strength'->>'score')::numeric, 2) as your_value,
        round((winner.score_data->'components'->'player_strength'->>'score')::numeric, 2) as winner_value,
        round(((winner.score_data->'components'->'player_strength'->>'score')::numeric) - ((ranked.score_data->'components'->'player_strength'->>'score')::numeric), 2) as impact,
        format(
          'Player strength trailed the winner by %s points (%s vs %s).',
          round(((winner.score_data->'components'->'player_strength'->>'score')::numeric) - ((ranked.score_data->'components'->'player_strength'->>'score')::numeric), 2),
          round((ranked.score_data->'components'->'player_strength'->>'score')::numeric, 2),
          round((winner.score_data->'components'->'player_strength'->>'score')::numeric, 2)
        ) as message
      where ((winner.score_data->'components'->'player_strength'->>'score')::numeric) - ((ranked.score_data->'components'->'player_strength'->>'score')::numeric) >= 2

      union all

      select
        'team_balance',
        round((ranked.score_data->'components'->'team_balance'->>'score')::numeric, 2),
        round((winner.score_data->'components'->'team_balance'->>'score')::numeric, 2),
        round(((winner.score_data->'components'->'team_balance'->>'score')::numeric) - ((ranked.score_data->'components'->'team_balance'->>'score')::numeric), 2),
        format(
          'Balance trailed the winner by %s points (%s vs %s).',
          round(((winner.score_data->'components'->'team_balance'->>'score')::numeric) - ((ranked.score_data->'components'->'team_balance'->>'score')::numeric), 2),
          round((ranked.score_data->'components'->'team_balance'->>'score')::numeric, 2),
          round((winner.score_data->'components'->'team_balance'->>'score')::numeric, 2)
        )
      where ((winner.score_data->'components'->'team_balance'->>'score')::numeric) - ((ranked.score_data->'components'->'team_balance'->>'score')::numeric) >= 2

      union all

      select
        'role_coverage',
        round((ranked.score_data->'components'->'role_coverage'->>'score')::numeric, 2),
        round((winner.score_data->'components'->'role_coverage'->>'score')::numeric, 2),
        round(((winner.score_data->'components'->'role_coverage'->>'score')::numeric) - ((ranked.score_data->'components'->'role_coverage'->>'score')::numeric), 2),
        format(
          'Role coverage lagged the winner by %s points (%s vs %s).',
          round(((winner.score_data->'components'->'role_coverage'->>'score')::numeric) - ((ranked.score_data->'components'->'role_coverage'->>'score')::numeric), 2),
          round((ranked.score_data->'components'->'role_coverage'->>'score')::numeric, 2),
          round((winner.score_data->'components'->'role_coverage'->>'score')::numeric, 2)
        )
      where ((winner.score_data->'components'->'role_coverage'->>'score')::numeric) - ((ranked.score_data->'components'->'role_coverage'->>'score')::numeric) >= 2

      union all

      select
        'star_power',
        round((ranked.score_data->'components'->'star_power'->>'score')::numeric, 2),
        round((winner.score_data->'components'->'star_power'->>'score')::numeric, 2),
        round(((winner.score_data->'components'->'star_power'->>'score')::numeric) - ((ranked.score_data->'components'->'star_power'->>'score')::numeric), 2),
        format(
          'Star power trailed the winner by %s points (%s vs %s).',
          round(((winner.score_data->'components'->'star_power'->>'score')::numeric) - ((ranked.score_data->'components'->'star_power'->>'score')::numeric), 2),
          round((ranked.score_data->'components'->'star_power'->>'score')::numeric, 2),
          round((winner.score_data->'components'->'star_power'->>'score')::numeric, 2)
        )
      where ((winner.score_data->'components'->'star_power'->>'score')::numeric) - ((ranked.score_data->'components'->'star_power'->>'score')::numeric) >= 2

      union all

      select
        'synergy',
        round((ranked.score_data->'components'->'synergy'->>'score')::numeric, 2),
        round((winner.score_data->'components'->'synergy'->>'score')::numeric, 2),
        round(((winner.score_data->'components'->'synergy'->>'score')::numeric) - ((ranked.score_data->'components'->'synergy'->>'score')::numeric), 2),
        format(
          'Synergy trailed the winner by %s points (%s vs %s).',
          round(((winner.score_data->'components'->'synergy'->>'score')::numeric) - ((ranked.score_data->'components'->'synergy'->>'score')::numeric), 2),
          round((ranked.score_data->'components'->'synergy'->>'score')::numeric, 2),
          round((winner.score_data->'components'->'synergy'->>'score')::numeric, 2)
        )
      where ((winner.score_data->'components'->'synergy'->>'score')::numeric) - ((ranked.score_data->'components'->'synergy'->>'score')::numeric) >= 2

      union all

      select
        'penalty_no_wicketkeeper',
        round((ranked.score_data->'raw_metrics'->>'penalty_no_wicketkeeper')::numeric, 2),
        round((winner.score_data->'raw_metrics'->>'penalty_no_wicketkeeper')::numeric, 2),
        round(((ranked.score_data->'raw_metrics'->>'penalty_no_wicketkeeper')::numeric) - ((winner.score_data->'raw_metrics'->>'penalty_no_wicketkeeper')::numeric), 2),
        format(
          'Wicketkeeper penalty cost %s extra points (%s vs %s).',
          round(((ranked.score_data->'raw_metrics'->>'penalty_no_wicketkeeper')::numeric) - ((winner.score_data->'raw_metrics'->>'penalty_no_wicketkeeper')::numeric), 2),
          round((ranked.score_data->'raw_metrics'->>'penalty_no_wicketkeeper')::numeric, 2),
          round((winner.score_data->'raw_metrics'->>'penalty_no_wicketkeeper')::numeric, 2)
        )
      where ((ranked.score_data->'raw_metrics'->>'penalty_no_wicketkeeper')::numeric) - ((winner.score_data->'raw_metrics'->>'penalty_no_wicketkeeper')::numeric) >= 3

      union all

      select
        'penalty_batter_overload',
        round((ranked.score_data->'raw_metrics'->>'penalty_batter_overload')::numeric, 2),
        round((winner.score_data->'raw_metrics'->>'penalty_batter_overload')::numeric, 2),
        round(((ranked.score_data->'raw_metrics'->>'penalty_batter_overload')::numeric) - ((winner.score_data->'raw_metrics'->>'penalty_batter_overload')::numeric), 2),
        format(
          'Batter overload cost %s extra points (%s vs %s).',
          round(((ranked.score_data->'raw_metrics'->>'penalty_batter_overload')::numeric) - ((winner.score_data->'raw_metrics'->>'penalty_batter_overload')::numeric), 2),
          round((ranked.score_data->'raw_metrics'->>'penalty_batter_overload')::numeric, 2),
          round((winner.score_data->'raw_metrics'->>'penalty_batter_overload')::numeric, 2)
        )
      where ((ranked.score_data->'raw_metrics'->>'penalty_batter_overload')::numeric) - ((winner.score_data->'raw_metrics'->>'penalty_batter_overload')::numeric) >= 3

      union all

      select
        'penalty_bowler_overload',
        round((ranked.score_data->'raw_metrics'->>'penalty_bowler_overload')::numeric, 2),
        round((winner.score_data->'raw_metrics'->>'penalty_bowler_overload')::numeric, 2),
        round(((ranked.score_data->'raw_metrics'->>'penalty_bowler_overload')::numeric) - ((winner.score_data->'raw_metrics'->>'penalty_bowler_overload')::numeric), 2),
        format(
          'Bowler overload cost %s extra points (%s vs %s).',
          round(((ranked.score_data->'raw_metrics'->>'penalty_bowler_overload')::numeric) - ((winner.score_data->'raw_metrics'->>'penalty_bowler_overload')::numeric), 2),
          round((ranked.score_data->'raw_metrics'->>'penalty_bowler_overload')::numeric, 2),
          round((winner.score_data->'raw_metrics'->>'penalty_bowler_overload')::numeric, 2)
        )
      where ((ranked.score_data->'raw_metrics'->>'penalty_bowler_overload')::numeric) - ((winner.score_data->'raw_metrics'->>'penalty_bowler_overload')::numeric) >= 3

      union all

      select
        'penalty_missing_death_bowler',
        round((ranked.score_data->'raw_metrics'->>'penalty_missing_death_bowler')::numeric, 2),
        round((winner.score_data->'raw_metrics'->>'penalty_missing_death_bowler')::numeric, 2),
        round(((ranked.score_data->'raw_metrics'->>'penalty_missing_death_bowler')::numeric) - ((winner.score_data->'raw_metrics'->>'penalty_missing_death_bowler')::numeric), 2),
        format(
          'Death-bowler penalty cost %s extra points (%s vs %s).',
          round(((ranked.score_data->'raw_metrics'->>'penalty_missing_death_bowler')::numeric) - ((winner.score_data->'raw_metrics'->>'penalty_missing_death_bowler')::numeric), 2),
          round((ranked.score_data->'raw_metrics'->>'penalty_missing_death_bowler')::numeric, 2),
          round((winner.score_data->'raw_metrics'->>'penalty_missing_death_bowler')::numeric, 2)
        )
      where ((ranked.score_data->'raw_metrics'->>'penalty_missing_death_bowler')::numeric) - ((winner.score_data->'raw_metrics'->>'penalty_missing_death_bowler')::numeric) >= 3
    ) candidate_reasons
    order by impact desc, factor asc
    limit 2
  ) candidates
) reason_data on ranked.rank > 1
$$;

create or replace function public.compute_team_result_metadata(
  p_room_id uuid
)
returns table (
  participant_id uuid,
  user_id uuid,
  team_name text,
  team_score numeric,
  rank int,
  breakdown_json jsonb
)
language sql
security definer
set search_path = public
stable
as $$
with comparisons as (
  select *
  from public.compute_team_result_comparisons(p_room_id)
)
select
  c.participant_id,
  c.user_id,
  c.team_name,
  c.team_score,
  c.rank,
  c.score_data
    || jsonb_build_object(
      'team_score', c.team_score,
      'rank', c.rank,
      'comparison', c.comparison,
      'loss_reasons', c.loss_reasons,
      'strength_highlights', coalesce(highlights.strength_highlights, '[]'::jsonb),
      'insights', coalesce(insights.insights, '[]'::jsonb),
      'team_archetype',
        case
          when ((c.score_data->'components'->'team_balance'->>'score')::numeric) < 12
            or ((c.score_data->'penalties'->>'total')::numeric) >= 8 then 'High-Risk Build'
          when ((c.score_data->'components'->'star_power'->>'score')::numeric) >= 7
            and (
              ((c.score_data->'components'->'team_balance'->>'score')::numeric) < 18
              or ((c.score_data->'components'->'synergy'->>'score')::numeric) < 6
            ) then 'Star-Driven'
          when ((c.score_data->'components'->'team_balance'->>'score')::numeric) >= 20
            and ((c.score_data->'components'->'synergy'->>'score')::numeric) >= 7 then 'Balanced Contender'
          when ((c.score_data->'raw_metrics'->>'allrounder_support_sub')::numeric) >= 2.5
            and ((c.score_data->'raw_metrics'->>'present_role_count')::numeric) >= 5 then 'All-Round Engine'
          when ((c.score_data->'raw_metrics'->>'bowling_network_sub')::numeric) >= 2
            and coalesce((c.score_data->'raw_metrics'->>'has_death_bowler')::boolean, false)
            and coalesce((c.score_data->'raw_metrics'->>'has_spinner')::boolean, false) then 'Bowling Core'
          else 'Batting Heavy'
        end,
      'near_miss',
        case
          when c.rank > 1 and c.comparison is not null and (c.comparison->>'score_gap')::numeric <= 5
            then jsonb_build_object(
              'is_near_miss', true,
              'score_gap', round((c.comparison->>'score_gap')::numeric, 2),
              'closest_factor', coalesce(c.loss_reasons->0->>'factor', null),
              'closest_impact', case when jsonb_array_length(c.loss_reasons) > 0 then round((c.loss_reasons->0->>'impact')::numeric, 2) else null end,
              'message', case
                when jsonb_array_length(c.loss_reasons) > 0
                  then format(
                    'A %s-point swing in %s would have closed the gap.',
                    round((c.loss_reasons->0->>'impact')::numeric, 2),
                    replace(coalesce(c.loss_reasons->0->>'factor', 'team_score'), '_', ' ')
                  )
                else format('Finished within %s points of the winner.', round((c.comparison->>'score_gap')::numeric, 2))
              end
            )
          else jsonb_build_object(
            'is_near_miss', false,
            'score_gap', null,
            'closest_factor', null,
            'closest_impact', null,
            'message', null
          )
        end,
      'ranking_tiebreak', c.ranking_detail
    ) as breakdown_json
from comparisons c
left join lateral (
  select jsonb_agg(highlight) as strength_highlights
  from (
    select *
    from (
      select 1 as priority, format('Best XI quality delivered %s points.', round((c.score_data->'components'->'player_strength'->>'score')::numeric, 2)) as highlight
      where ((c.score_data->'components'->'player_strength'->>'score')::numeric) >= 32

      union all

      select 2, format('Role balance held up at %s / 25.', round((c.score_data->'components'->'team_balance'->>'score')::numeric, 2))
      where ((c.score_data->'components'->'team_balance'->>'score')::numeric) >= 20

      union all

      select 3, format('Covered %s of 6 impact roles.', (c.score_data->'coverage_detail'->>'present_count')::int)
      where (c.score_data->'coverage_detail'->>'present_count')::int >= 5

      union all

      select 4, format('%s star players lifted the squad ceiling.', (c.score_data->'star_detail'->>'star_count')::int)
      where (c.score_data->'star_detail'->>'star_count')::int >= 3

      union all

      select 5, format('Synergy reached %s / 10 with strong structural links.', round((c.score_data->'components'->'synergy'->>'score')::numeric, 2))
      where ((c.score_data->'components'->'synergy'->>'score')::numeric) >= 7.5

      union all

      select 6, 'Bowling phase coverage includes both spin and death control.'
      where coalesce((c.score_data->'raw_metrics'->>'has_spinner')::boolean, false)
        and coalesce((c.score_data->'raw_metrics'->>'has_death_bowler')::boolean, false)
    ) highlight_candidates
    order by priority
    limit 3
  ) chosen
) highlights on true
left join lateral (
  select jsonb_agg(insight) as insights
  from (
    select *
    from (
      select 1 as priority, format('Player strength settled at %s / 40.', round((c.score_data->'components'->'player_strength'->>'score')::numeric, 2)) as insight
      where ((c.score_data->'components'->'player_strength'->>'score')::numeric) >= 30

      union all

      select 2, format('Balance deviation cost %s points.', round((c.score_data->'balance_detail'->>'total_deviation_cost')::numeric, 2))
      where round((c.score_data->'balance_detail'->>'total_deviation_cost')::numeric, 2) > 0

      union all

      select 3, 'Missing a death bowler triggered a direct penalty.'
      where ((c.score_data->'raw_metrics'->>'penalty_missing_death_bowler')::numeric) > 0

      union all

      select 4, 'No wicketkeeper in the best XI forced a heavy deduction.'
      where ((c.score_data->'raw_metrics'->>'penalty_no_wicketkeeper')::numeric) > 0

      union all

      select 5, format('Role coverage reached only %s / 15.', round((c.score_data->'components'->'role_coverage'->>'score')::numeric, 2))
      where ((c.score_data->'components'->'role_coverage'->>'score')::numeric) < 7.5

      union all

      select 6, format('Synergy sat at %s / 10, leaving structural upside.', round((c.score_data->'components'->'synergy'->>'score')::numeric, 2))
      where ((c.score_data->'components'->'synergy'->>'score')::numeric) < 6

      union all

      select 7, format('Star count reached %s, giving the side a higher ceiling.', (c.score_data->'star_detail'->>'star_count')::int)
      where (c.score_data->'star_detail'->>'star_count')::int >= 3
    ) insight_candidates
    order by priority
    limit 4
  ) chosen
) insights on true;
$$;

create or replace function public.compute_room_results(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_count int;
  v_winner record;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  delete from public.team_results
  where room_id = p_room_id
    and user_id not in (
      select rp.user_id
      from public.room_participants rp
      where rp.room_id = p_room_id
    );

  insert into public.team_results (
    room_id,
    user_id,
    team_score,
    rank,
    breakdown_json,
    updated_at
  )
  select
    p_room_id,
    result_rows.user_id,
    result_rows.team_score,
    result_rows.rank,
    result_rows.breakdown_json,
    now()
  from public.compute_team_result_metadata(p_room_id) result_rows
  on conflict (room_id, user_id) do update
  set
    team_score = excluded.team_score,
    rank = excluded.rank,
    breakdown_json = excluded.breakdown_json,
    updated_at = now();

  select count(*)
  into v_count
  from public.team_results
  where room_id = p_room_id;

  select
    tr.user_id,
    tr.team_score,
    tr.rank
  into v_winner
  from public.team_results tr
  where tr.room_id = p_room_id
  order by tr.rank asc
  limit 1;

  return jsonb_build_object(
    'success', true,
    'room_id', p_room_id,
    'result_count', coalesce(v_count, 0),
    'winner_user_id', v_winner.user_id,
    'winner_score', v_winner.team_score,
    'winner_rank', v_winner.rank
  );
end;
$$;

create or replace function public.ensure_room_results(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_existing_count int;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  if not (
    v_room.admin_id = auth.uid()
    or exists (
      select 1
      from public.room_participants rp
      where rp.room_id = p_room_id
        and rp.user_id = auth.uid()
    )
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_room.status <> 'completed' then
    return jsonb_build_object('success', false, 'error', 'Room is not completed');
  end if;

  select count(*)
  into v_existing_count
  from public.team_results
  where room_id = p_room_id;

  if coalesce(v_existing_count, 0) > 0 then
    return jsonb_build_object('success', true, 'computed', false, 'result_count', v_existing_count);
  end if;

  return public.compute_room_results(p_room_id);
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

      perform public.compute_room_results(v_auction.room_id);

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

  perform public.compute_room_results(v_auction.room_id);

  return jsonb_build_object('success', true, 'result', 'completed');
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
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_room.status <> 'accelerated_selection' then
    return jsonb_build_object('success', true, 'result', 'noop', 'status', v_room.status);
  end if;

  select count(*), count(accelerated_round_submitted_at)
  into v_total_participants, v_submitted_participants
  from public.room_participants
  where room_id = p_room_id;

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

    update public.rooms
    set status = 'completed'
    where id = p_room_id;

    perform public.compute_room_results(p_room_id);

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

  update public.rooms
  set status = 'auction'
  where id = p_room_id;

  select public.advance_to_next_player(v_auction.id, auth.uid()) into v_result;
  return coalesce(v_result, jsonb_build_object('success', true, 'result', 'accelerated_started'));
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

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  if v_room.admin_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Not admin');
  end if;

  update public.auction_sessions
  set status = 'completed'
  where id = p_auction_session_id;

  update public.rooms
  set status = 'completed'
  where id = v_auction.room_id;

  perform public.compute_room_results(v_auction.room_id);

  return jsonb_build_object('success', true, 'result', 'completed');
end;
$$;