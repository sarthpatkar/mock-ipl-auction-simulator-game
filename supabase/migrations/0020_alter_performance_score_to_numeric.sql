alter table public.players
  alter column performance_score type numeric
  using performance_score::numeric;
