create or replace function public.complete_room_results_reveal(
  p_room_id uuid,
  p_delay_reveal boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rooms
  set
    status = 'completed',
    results_reveal_at = now() + interval '90 seconds'
  where id = p_room_id;

  perform public.compute_room_results(p_room_id);
end;
$$;
