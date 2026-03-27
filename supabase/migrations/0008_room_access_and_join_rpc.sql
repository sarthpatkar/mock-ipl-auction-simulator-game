drop policy if exists "Room members can read room" on rooms;
create policy "Room members can read room" on rooms for select
  using (is_room_member(id) or auth.uid() = admin_id);

create or replace function join_room_by_code(
  p_code text,
  p_team_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms%rowtype;
  v_count int;
  v_participant_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select * into v_room
  from rooms
  where code = p_code;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  select count(*) into v_count
  from room_participants
  where room_id = v_room.id;

  if v_count >= 10 then
    return jsonb_build_object('success', false, 'error', 'Room is full');
  end if;

  insert into room_participants (room_id, user_id, team_name)
  values (v_room.id, auth.uid(), p_team_name)
  on conflict (room_id, user_id)
  do update set team_name = excluded.team_name
  returning id into v_participant_id;

  return jsonb_build_object(
    'success', true,
    'room_id', v_room.id,
    'participant_id', v_participant_id
  );
end;
$$;
