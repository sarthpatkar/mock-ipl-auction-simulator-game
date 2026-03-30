drop policy if exists "Admin can delete room" on public.rooms;

create policy "Admin can delete room" on public.rooms for delete
  using (auth.uid() = admin_id);
