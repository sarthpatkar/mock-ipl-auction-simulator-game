do $$
declare
  v_table text;
  v_tables text[] := array[
    'rooms',
    'room_participants',
    'auction_sessions',
    'auction_live_state',
    'bids',
    'squad_players',
    'accelerated_round_selections'
  ];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array v_tables loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end
$$;
