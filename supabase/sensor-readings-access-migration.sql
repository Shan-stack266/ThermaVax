-- Enables authenticated dashboard access and Realtime for ESP32 standalone readings.
-- Safe to run more than once after public.sensor_readings already exists.

begin;

alter table public.sensor_readings enable row level security;

grant select on public.sensor_readings to authenticated;
grant select, insert on public.sensor_readings to service_role;

drop policy if exists sensor_readings_select_active on public.sensor_readings;
create policy sensor_readings_select_active on public.sensor_readings
for select to authenticated
using ((select private.is_active_user()));

do $$ begin
  alter publication supabase_realtime add table public.sensor_readings;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

commit;
