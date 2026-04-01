do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'players'
      and column_name = 'ipl_team'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'players'
      and column_name = 'team_code'
  ) then
    alter table public.players rename column ipl_team to team_code;
  end if;
end $$;
