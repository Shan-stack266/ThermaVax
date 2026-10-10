-- Removes development-only simulated readings from an existing ThermaVax project.
-- Run once in the Supabase SQL Editor after deploying the matching application code.

begin;

delete from public.temperature_readings
where source::text = 'simulated';

delete from public.gps_readings
where source::text = 'simulated';

alter table public.gps_readings
alter column source set default 'manual'::public.reading_source;

alter table public.temperature_readings
alter column source set default 'manual'::public.reading_source;

commit;
