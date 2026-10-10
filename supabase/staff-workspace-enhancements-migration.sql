-- Adds staff acknowledgement records for existing ThermaVax projects.
alter type public.app_role add value if not exists 'rider';

begin;

create table if not exists public.alert_acknowledgements (
  alert_id uuid primary key references public.alerts(id) on delete cascade,
  acknowledged_by uuid not null references public.profiles(id),
  acknowledged_at timestamptz not null default now(),
  note text not null check (char_length(note) between 1 and 1000)
);

create table if not exists public.rider_assignments (
  shipment_id uuid primary key references public.shipments(id) on delete cascade,
  rider_id uuid not null references public.profiles(id),
  status text not null default 'Assigned' check (status in ('Assigned', 'Accepted', 'Rejected')),
  assigned_at timestamptz not null default now(),
  responded_at timestamptz,
  rejection_reason text,
  constraint rider_assignment_response_state check (
    (status = 'Rejected' and rejection_reason is not null and responded_at is not null)
    or (status in ('Assigned', 'Accepted') and rejection_reason is null)
  )
);

create index if not exists idx_alert_acknowledgements_user
  on public.alert_acknowledgements(acknowledged_by, acknowledged_at desc);

alter table public.alert_acknowledgements enable row level security;
grant select, insert on public.alert_acknowledgements to authenticated;
grant select, insert, update on public.rider_assignments to authenticated;
grant all on public.alert_acknowledgements, public.rider_assignments to service_role;

drop policy if exists alert_acknowledgements_select on public.alert_acknowledgements;
create policy alert_acknowledgements_select on public.alert_acknowledgements for select to authenticated
using ((select private.is_active_user()));

drop policy if exists alert_acknowledgements_insert on public.alert_acknowledgements;
create policy alert_acknowledgements_insert on public.alert_acknowledgements for insert to authenticated
with check ((select private.is_active_user()) and acknowledged_by = (select auth.uid()));

alter table public.rider_assignments enable row level security;
drop policy if exists rider_assignments_select on public.rider_assignments;
create policy rider_assignments_select on public.rider_assignments for select to authenticated
using ((select private.is_active_user()));

drop policy if exists rider_assignments_insert on public.rider_assignments;
create policy rider_assignments_insert on public.rider_assignments for insert to authenticated
with check ((select private.is_admin()) or rider_id = (select auth.uid()));

drop policy if exists rider_assignments_update on public.rider_assignments;
create policy rider_assignments_update on public.rider_assignments for update to authenticated
using ((select private.is_admin()) or rider_id = (select auth.uid()))
with check ((select private.is_admin()) or rider_id = (select auth.uid()));

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
