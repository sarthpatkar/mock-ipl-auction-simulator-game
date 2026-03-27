-- Add updated_at for ordering realtime events
alter table auction_sessions
  add column if not exists updated_at timestamptz default now();

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_auction_sessions_updated_at on auction_sessions;
create trigger trg_auction_sessions_updated_at
before update on auction_sessions
for each row execute function set_updated_at();
