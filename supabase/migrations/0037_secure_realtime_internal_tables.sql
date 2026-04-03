alter table public.room_event_log enable row level security;
alter table public.processed_request_keys enable row level security;
alter table public.room_runtime_cache enable row level security;
alter table public.room_participant_presence enable row level security;
alter table public.failed_room_events enable row level security;
alter table public.room_metrics_samples enable row level security;

alter view public.room_latency_rollups_5m set (security_invoker = true);

revoke all on public.room_event_log from anon, authenticated;
revoke all on public.processed_request_keys from anon, authenticated;
revoke all on public.room_runtime_cache from anon, authenticated;
revoke all on public.room_participant_presence from anon, authenticated;
revoke all on public.failed_room_events from anon, authenticated;
revoke all on public.room_metrics_samples from anon, authenticated;
revoke all on public.room_latency_rollups_5m from anon, authenticated;

grant select on public.room_event_log to service_role;
grant select on public.room_runtime_cache to service_role;
grant select on public.failed_room_events to service_role;
grant select on public.room_metrics_samples to service_role;
grant select on public.room_latency_rollups_5m to service_role;

grant insert, update, delete on public.room_event_log to service_role;
grant insert, update, delete on public.processed_request_keys to service_role;
grant insert, update, delete on public.room_runtime_cache to service_role;
grant insert, update, delete on public.room_participant_presence to service_role;
grant insert, update, delete on public.failed_room_events to service_role;
grant insert, update, delete on public.room_metrics_samples to service_role;
