-- Keeps rider-accepted deliveries visible to every workspace from backend/database state.
-- Safe to run more than once in Supabase SQL Editor.

begin;

grant all on public.rider_assignments to service_role;
grant all on public.alert_acknowledgements to service_role;

create or replace function private.sync_accepted_rider_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'Accepted' then
    update public.shipments
    set status = 'In Transit'::public.shipment_status
    where id = new.shipment_id
      and status in ('Preparing'::public.shipment_status, 'Dispatched'::public.shipment_status);
  end if;
  return new;
end;
$$;

drop trigger if exists rider_assignments_sync_accepted_delivery on public.rider_assignments;
create trigger rider_assignments_sync_accepted_delivery
after insert or update of status on public.rider_assignments
for each row execute function private.sync_accepted_rider_delivery();

update public.shipments shipment
set status = 'In Transit'::public.shipment_status
from public.rider_assignments assignment
where assignment.shipment_id = shipment.id
  and assignment.status = 'Accepted'
  and shipment.status in ('Preparing'::public.shipment_status, 'Dispatched'::public.shipment_status);

commit;
