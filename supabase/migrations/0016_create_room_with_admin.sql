create or replace function public.create_room_with_admin(
  p_name text,
  p_team_name text,
  p_settings jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_participant_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if nullif(trim(coalesce(p_name, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Room name is required');
  end if;

  if nullif(trim(coalesce(p_team_name, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Team name is required');
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
  ) then
    return jsonb_build_object('success', false, 'error', 'Profile not found');
  end if;

  insert into public.rooms (
    name,
    admin_id,
    settings
  )
  values (
    trim(p_name),
    auth.uid(),
    coalesce(
      p_settings,
      '{
        "budget": 1000000000,
        "squad_size": 20,
        "timer_seconds": 15,
        "player_order": "category"
      }'::jsonb
    )
  )
  returning * into v_room;

  insert into public.room_participants (
    room_id,
    user_id,
    team_name
  )
  values (
    v_room.id,
    auth.uid(),
    trim(p_team_name)
  )
  returning id into v_participant_id;

  return jsonb_build_object(
    'success', true,
    'room_id', v_room.id,
    'participant_id', v_participant_id,
    'code', v_room.code
  );
end;
$$;
