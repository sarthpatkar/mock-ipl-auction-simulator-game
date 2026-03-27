alter table public.players
  add column if not exists matches int,
  add column if not exists batting_avg numeric,
  add column if not exists strike_rate numeric,
  add column if not exists wickets int,
  add column if not exists economy numeric,
  add column if not exists performance_score numeric,
  add column if not exists consistency_score numeric,
  add column if not exists recent_form_score numeric,
  add column if not exists experience_level text,
  add column if not exists impact_type text;
