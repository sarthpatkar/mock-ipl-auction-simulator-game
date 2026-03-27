-- Server-side 7-digit room code generator
create or replace function generate_room_code()
returns text
language plpgsql
as $$
declare
  v_code text;
  exists_code boolean;
begin
  loop
    v_code := lpad(floor(random() * 9000000 + 1000000)::text, 7, '0');
    select exists(select 1 from rooms where code = v_code) into exists_code;
    exit when not exists_code;
  end loop;
  return v_code;
end;
$$;

alter table rooms alter column code set default generate_room_code();
