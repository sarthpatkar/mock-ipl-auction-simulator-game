-- Enforce max 10 participants per room
create or replace function enforce_participant_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count from room_participants where room_id = new.room_id;
  if v_count >= 10 then
    raise exception 'Participant limit reached for this room';
  end if;
  return new;
end;
$$;

create or replace function set_participant_budget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget bigint;
begin
  select (settings->>'budget')::bigint into v_budget from rooms where id = new.room_id;
  if v_budget is not null then
    new.budget_remaining := v_budget;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_room_participant_limit on room_participants;
create trigger trg_room_participant_limit
before insert on room_participants
for each row
execute function enforce_participant_limit();

drop trigger if exists trg_room_participant_budget on room_participants;
create trigger trg_room_participant_budget
before insert on room_participants
for each row
execute function set_participant_budget();
