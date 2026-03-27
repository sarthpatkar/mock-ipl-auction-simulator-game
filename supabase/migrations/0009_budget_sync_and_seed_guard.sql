alter table rooms alter column settings set default '{
  "budget": 1000000000,
  "squad_size": 20,
  "timer_seconds": 15,
  "player_order": "category"
}'::jsonb;

alter table room_participants alter column budget_remaining set default 1000000000;

update rooms
set settings = jsonb_set(settings, '{budget}', to_jsonb(1000000000::bigint))
where coalesce((settings->>'budget')::bigint, 0) = 10000000000;

update room_participants rp
set budget_remaining = (r.settings->>'budget')::bigint
from rooms r
where r.id = rp.room_id
  and r.status = 'lobby'
  and rp.squad_count = 0;

create or replace function sync_lobby_participant_budgets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'lobby'
     and coalesce((new.settings->>'budget')::bigint, 0) <> coalesce((old.settings->>'budget')::bigint, 0) then
    update room_participants
    set budget_remaining = (new.settings->>'budget')::bigint
    where room_id = new.id
      and squad_count = 0;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_lobby_budget on rooms;
create trigger trg_sync_lobby_budget
after update of settings on rooms
for each row
execute function sync_lobby_participant_budgets();
