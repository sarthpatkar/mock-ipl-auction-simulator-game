create or replace function public.cleanup_stale_room_runtime()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_presence record;
begin
  for v_presence in
    select *
    from public.room_participant_presence
    where last_seen_at < now() - interval '90 seconds'
  loop
    delete from public.room_participant_presence
    where room_id = v_presence.room_id
      and participant_id = v_presence.participant_id
      and connection_id = v_presence.connection_id;

    perform public.sync_room_runtime_cache(v_presence.room_id, 'degraded'::public.room_health_status);

    perform public.append_room_event(
      v_presence.room_id,
      'participant_connection_lost',
      jsonb_build_object(
        'participant_id', v_presence.participant_id,
        'connection_id', v_presence.connection_id,
        'last_seen_at', v_presence.last_seen_at
      ),
      'presence-cleanup',
      null,
      'degraded'::public.room_health_status
    );
  end loop;

  delete from public.processed_request_keys
  where created_at < now() - interval '24 hours';
end;
$$;
