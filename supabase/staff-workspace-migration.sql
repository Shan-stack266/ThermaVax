-- Apply this once to an existing ThermaVax Supabase project.
-- It separates administrative setup from staff operational work.

begin;

drop policy if exists batches_insert on public.batches;
create policy batches_insert on public.batches for insert to authenticated
with check ((select private.is_admin()) and created_by = (select auth.uid()));

drop policy if exists batches_update on public.batches;
create policy batches_update on public.batches for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

-- create_shipment is security-definer, so this trigger also protects existing
-- deployments where that RPC was created before the admin-only rule.
create or replace function private.require_admin_shipment_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not private.is_admin() then
    raise exception 'Administrator access is required';
  end if;
  return new;
end;
$$;

drop trigger if exists shipments_require_admin_creation on public.shipments;
create trigger shipments_require_admin_creation
before insert on public.shipments
for each row execute function private.require_admin_shipment_creation();

commit;
