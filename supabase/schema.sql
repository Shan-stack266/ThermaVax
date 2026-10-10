-- ThermaVax Supabase/PostgreSQL schema
-- Run this file in the Supabase SQL Editor on a new project.
-- Authentication is handled by Supabase Auth; do not recreate password/session tables.

begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

do $$ begin
  create type public.app_role as enum ('admin', 'staff', 'rider');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.batch_status as enum ('Available', 'Quarantined', 'Depleted');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.shipment_status as enum ('Preparing', 'Dispatched', 'In Transit', 'Arrived', 'Delivered');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.reading_source as enum ('manual', 'esp32');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.alert_status as enum ('Active', 'Resolved');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.delivery_temperature_status as enum ('Within range', 'Excursion detected', 'Not verified');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role public.app_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  public_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  batch_number text not null unique,
  vaccine_name text not null,
  quantity integer not null check (quantity >= 0),
  available_quantity integer not null check (available_quantity >= 0),
  manufacturing_date date not null,
  expiration_date date not null,
  min_temperature numeric(6,2) not null,
  max_temperature numeric(6,2) not null,
  status public.batch_status not null default 'Available',
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint batches_available_lte_quantity check (available_quantity <= quantity),
  constraint batches_temperature_range check (min_temperature < max_temperature),
  constraint batches_valid_dates check (expiration_date > manufacturing_date)
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  public_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  tracking_code text not null unique default (
    'TVX-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
  ),
  origin text not null,
  destination text not null,
  dispatch_date timestamptz,
  expected_delivery_date timestamptz not null,
  assigned_personnel text not null,
  status public.shipment_status not null default 'Preparing',
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipments_distinct_route check (origin <> destination),
  constraint shipments_valid_dates check (dispatch_date is null or expected_delivery_date > dispatch_date)
);

create table if not exists public.shipment_batches (
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  batch_id uuid not null references public.batches(id),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  primary key (shipment_id, batch_id)
);

create table if not exists public.temperature_readings (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  temperature numeric(6,2) not null,
  recorded_at timestamptz not null default now(),
  source public.reading_source not null default 'manual',
  temperature_status text check (temperature_status in ('SAFE', 'WARNING', 'CRITICAL', 'SENSOR ERROR')),
  created_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  temperature numeric(6,2) not null,
  min_temperature numeric(6,2) not null,
  max_temperature numeric(6,2) not null,
  recorded_at timestamptz not null,
  status public.alert_status not null default 'Active',
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint alerts_resolution_state check (
    (status = 'Active' and resolved_at is null and resolved_by is null)
    or (status = 'Resolved' and resolved_at is not null and resolved_by is not null)
  )
);

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

create table if not exists public.gps_readings (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  recorded_at timestamptz not null default now(),
  source public.reading_source not null default 'manual',
  created_at timestamptz not null default now()
);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null unique references public.shipments(id) on delete cascade,
  receiver text not null,
  delivered_at timestamptz not null default now(),
  quantity_received integer not null check (quantity_received >= 0),
  condition text not null,
  temperature_status public.delivery_temperature_status not null default 'Not verified',
  confirmed_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_batches_expiration on public.batches(expiration_date);
create index if not exists idx_batches_status on public.batches(status);
create index if not exists idx_shipments_status on public.shipments(status);
create index if not exists idx_shipments_expected_delivery on public.shipments(expected_delivery_date);
create index if not exists idx_temperature_shipment_time on public.temperature_readings(shipment_id, recorded_at desc);
create index if not exists idx_gps_shipment_time on public.gps_readings(shipment_id, recorded_at desc);
create index if not exists idx_alerts_status_time on public.alerts(status, recorded_at desc);
create index if not exists idx_alert_acknowledgements_user on public.alert_acknowledgements(acknowledged_by, acknowledged_at desc);
create index if not exists idx_rider_assignments_rider on public.rider_assignments(rider_id, status);

-- Keep public user profiles synchronized with Supabase Auth.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role, active)
  values (new.id, new.email, 'staff'::public.app_role, true)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute function private.handle_new_auth_user();

insert into public.profiles (id, email, role, active)
select id, email, 'staff'::public.app_role, true
from auth.users
where email is not null
on conflict (id) do update set email = excluded.email;

-- Shared audit timestamp trigger.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();

drop trigger if exists batches_set_updated_at on public.batches;
create trigger batches_set_updated_at before update on public.batches
for each row execute function private.set_updated_at();

drop trigger if exists shipments_set_updated_at on public.shipments;
create trigger shipments_set_updated_at before update on public.shipments
for each row execute function private.set_updated_at();

-- Role helpers are kept outside the exposed public schema.
create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and active = true
  );
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and active = true and role = 'admin'::public.app_role
  );
$$;

revoke all on function private.is_active_user() from public;
revoke all on function private.is_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_active_user() to authenticated;
grant execute on function private.is_admin() to authenticated;

-- Prevent an administrator from accidentally locking their own account.
create or replace function private.prevent_self_disable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.id = (select auth.uid()) and old.active = true and new.active = false then
    raise exception 'You cannot disable your own account';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_self_disable on public.profiles;
create trigger profiles_prevent_self_disable before update of active on public.profiles
for each row execute function private.prevent_self_disable();

-- Reserve stock atomically whenever a batch is assigned to a shipment.
create or replace function private.reserve_batch_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_record public.batches%rowtype;
begin
  select * into batch_record
  from public.batches
  where id = new.batch_id
  for update;

  if not found then
    raise exception 'Batch not found';
  end if;
  if batch_record.status <> 'Available'::public.batch_status then
    raise exception 'Batch % is not available', batch_record.batch_number;
  end if;
  if batch_record.expiration_date < current_date then
    raise exception 'Batch % is expired', batch_record.batch_number;
  end if;
  if batch_record.available_quantity < new.quantity then
    raise exception 'Insufficient available quantity for batch %', batch_record.batch_number;
  end if;

  update public.batches
  set available_quantity = available_quantity - new.quantity,
      status = case
        when available_quantity - new.quantity = 0 then 'Depleted'::public.batch_status
        else status
      end
  where id = new.batch_id;

  return new;
end;
$$;

drop trigger if exists shipment_batches_reserve_stock on public.shipment_batches;
create trigger shipment_batches_reserve_stock
before insert on public.shipment_batches
for each row execute function private.reserve_batch_stock();

-- Return stock before an undelivered shipment is deleted.
create or replace function private.restore_shipment_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allocation record;
begin
  if old.status = 'Delivered'::public.shipment_status then
    raise exception 'Delivered shipments cannot be deleted';
  end if;

  for allocation in
    select batch_id, quantity
    from public.shipment_batches
    where shipment_id = old.id
  loop
    update public.batches
    set available_quantity = available_quantity + allocation.quantity,
        status = case
          when status = 'Depleted'::public.batch_status then 'Available'::public.batch_status
          else status
        end
    where id = allocation.batch_id;
  end loop;
  return old;
end;
$$;

drop trigger if exists shipments_restore_stock on public.shipments;
create trigger shipments_restore_stock
before delete on public.shipments
for each row execute function private.restore_shipment_stock();

-- Create alerts automatically using the strictest range among assigned batches.
create or replace function private.check_temperature_reading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_min numeric(6,2);
  allowed_max numeric(6,2);
begin
  select max(batch.min_temperature), min(batch.max_temperature)
  into allowed_min, allowed_max
  from public.shipment_batches allocation
  join public.batches batch on batch.id = allocation.batch_id
  where allocation.shipment_id = new.shipment_id;

  if allowed_min is null or allowed_max is null then
    raise exception 'Shipment has no assigned batch temperature range';
  end if;
  if allowed_min > allowed_max then
    raise exception 'Assigned batches have incompatible temperature ranges';
  end if;

  if new.temperature < allowed_min or new.temperature > allowed_max then
    insert into public.alerts (
      shipment_id, temperature, min_temperature, max_temperature, recorded_at
    ) values (
      new.shipment_id, new.temperature, allowed_min, allowed_max, new.recorded_at
    );
  end if;
  return new;
end;
$$;

drop trigger if exists temperature_readings_create_alert on public.temperature_readings;
create trigger temperature_readings_create_alert
after insert on public.temperature_readings
for each row execute function private.check_temperature_reading();

-- Delivery confirmation always completes the shipment.
create or replace function private.complete_delivered_shipment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.shipments
  set status = 'Delivered'::public.shipment_status
  where id = new.shipment_id;
  return new;
end;
$$;

drop trigger if exists deliveries_complete_shipment on public.deliveries;
create trigger deliveries_complete_shipment
after insert on public.deliveries
for each row execute function private.complete_delivered_shipment();

-- Enforce operational status progression even when PostgREST is called directly.
create or replace function private.validate_shipment_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = old.status then return new; end if;
  if new.status = 'Delivered'::public.shipment_status then
    if not exists (select 1 from public.deliveries where shipment_id = old.id) then
      raise exception 'Confirm delivery to complete a shipment';
    end if;
    return new;
  end if;
  if (select auth.uid()) is null or private.is_admin() then return new; end if;
  if not (
    (old.status = 'Preparing' and new.status = 'Dispatched')
    or (old.status = 'Dispatched' and new.status = 'In Transit')
    or (old.status = 'In Transit' and new.status = 'Arrived')
  ) then
    raise exception 'Invalid shipment status transition';
  end if;
  return new;
end;
$$;

drop trigger if exists shipments_validate_status_transition on public.shipments;
create trigger shipments_validate_status_transition
before update of status on public.shipments
for each row execute function private.validate_shipment_status_transition();

-- Rider acceptance immediately promotes the shipment into the delivery workflow.
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

create or replace function private.validate_delivery_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shipment_status public.shipment_status;
  assigned_quantity integer;
begin
  select shipment.status, coalesce(sum(allocation.quantity), 0)::integer
  into shipment_status, assigned_quantity
  from public.shipments shipment
  left join public.shipment_batches allocation on allocation.shipment_id = shipment.id
  where shipment.id = new.shipment_id
  group by shipment.status;
  if shipment_status is null then raise exception 'Shipment not found'; end if;
  if shipment_status <> 'Arrived' then raise exception 'Shipment must be Arrived before delivery can be confirmed'; end if;
  if new.quantity_received > assigned_quantity then
    raise exception 'Quantity received cannot exceed assigned shipment quantity';
  end if;
  return new;
end;
$$;

drop trigger if exists deliveries_validate_confirmation on public.deliveries;
create trigger deliveries_validate_confirmation
before insert on public.deliveries
for each row execute function private.validate_delivery_confirmation();

-- Atomic RPC for shipment creation and one or more batch allocations.
create or replace function public.create_shipment(
  p_origin text,
  p_destination text,
  p_dispatch_date timestamptz,
  p_expected_delivery_date timestamptz,
  p_assigned_personnel text,
  p_batches jsonb,
  p_status public.shipment_status default 'Preparing'
)
returns public.shipments
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_shipment public.shipments%rowtype;
  allocation record;
  allowed_min numeric(6,2);
  allowed_max numeric(6,2);
begin
  if not private.is_admin() then
    raise exception 'Administrator access is required';
  end if;
  if trim(coalesce(p_origin, '')) = '' or trim(coalesce(p_destination, '')) = '' then
    raise exception 'Origin and destination are required';
  end if;
  if p_origin = p_destination then
    raise exception 'Origin and destination must be different';
  end if;
  if p_expected_delivery_date is null
     or (p_dispatch_date is not null and p_expected_delivery_date <= p_dispatch_date) then
    raise exception 'Expected delivery must be after dispatch';
  end if;
  if trim(coalesce(p_assigned_personnel, '')) = '' then
    raise exception 'Assigned personnel is required';
  end if;
  if jsonb_typeof(p_batches) <> 'array' or jsonb_array_length(p_batches) = 0 then
    raise exception 'At least one batch allocation is required';
  end if;

  insert into public.shipments (
    origin, destination, dispatch_date, expected_delivery_date,
    assigned_personnel, status, created_by
  ) values (
    trim(p_origin), trim(p_destination), p_dispatch_date, p_expected_delivery_date,
    trim(p_assigned_personnel), p_status, (select auth.uid())
  ) returning * into new_shipment;

  for allocation in
    select * from jsonb_to_recordset(p_batches) as item(batch_id uuid, quantity integer)
  loop
    if allocation.batch_id is null or allocation.quantity is null or allocation.quantity <= 0 then
      raise exception 'Every batch allocation requires a batch_id and positive quantity';
    end if;
    insert into public.shipment_batches (shipment_id, batch_id, quantity)
    values (new_shipment.id, allocation.batch_id, allocation.quantity);
  end loop;

  select max(batch.min_temperature), min(batch.max_temperature)
  into allowed_min, allowed_max
  from public.shipment_batches shipment_batch
  join public.batches batch on batch.id = shipment_batch.batch_id
  where shipment_batch.shipment_id = new_shipment.id;

  if allowed_min > allowed_max then
    raise exception 'Assigned batches have incompatible temperature ranges';
  end if;

  return new_shipment;
end;
$$;

revoke all on function public.create_shipment(text, text, timestamptz, timestamptz, text, jsonb, public.shipment_status) from public;
grant execute on function public.create_shipment(text, text, timestamptz, timestamptz, text, jsonb, public.shipment_status) to authenticated;

-- Resolve alerts with an authenticated user and a complete audit trail.
create or replace function public.resolve_alert(p_alert_id uuid)
returns public.alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_alert public.alerts%rowtype;
begin
  if not private.is_active_user() then
    raise exception 'Active staff or administrator access is required';
  end if;

  update public.alerts
  set status = 'Resolved'::public.alert_status,
      resolved_at = now(),
      resolved_by = (select auth.uid())
  where id = p_alert_id and status = 'Active'::public.alert_status
  returning * into resolved_alert;

  if not found then
    raise exception 'Active alert not found' using errcode = 'P0002';
  end if;
  return resolved_alert;
end;
$$;

revoke all on function public.resolve_alert(uuid) from public;
grant execute on function public.resolve_alert(uuid) to authenticated;

-- RLS-safe views used by the dashboard and reports.
create or replace view public.batch_inventory
with (security_invoker = true)
as
select
  batch.*,
  case
    when batch.expiration_date < current_date then 'Expired'
    when batch.expiration_date <= current_date + 30 then 'Expiring Soon'
    else 'Safe'
  end as expiration_status
from public.batches batch;

create or replace view public.shipment_overview
with (security_invoker = true)
as
select
  shipment.*,
  coalesce((
    select sum(allocation.quantity)
    from public.shipment_batches allocation
    where allocation.shipment_id = shipment.id
  ), 0) as total_quantity,
  latest_temperature.temperature as current_temperature,
  latest_temperature.recorded_at as temperature_recorded_at,
  latest_location.latitude,
  latest_location.longitude,
  latest_location.recorded_at as location_recorded_at,
  (
    select count(*)
    from public.alerts alert
    where alert.shipment_id = shipment.id and alert.status = 'Active'
  ) as active_alerts,
  latest_temperature.temperature_status as current_temperature_status
from public.shipments shipment
left join lateral (
  select reading.temperature, reading.temperature_status, reading.recorded_at
  from public.temperature_readings reading
  where reading.shipment_id = shipment.id
  order by reading.recorded_at desc
  limit 1
) latest_temperature on true
left join lateral (
  select reading.latitude, reading.longitude, reading.recorded_at
  from public.gps_readings reading
  where reading.shipment_id = shipment.id
  order by reading.recorded_at desc
  limit 1
) latest_location on true;

create or replace view public.report_inventory
with (security_invoker = true)
as select * from public.batch_inventory;

create or replace view public.report_expiration
with (security_invoker = true)
as select * from public.batch_inventory where expiration_status <> 'Safe';

create or replace view public.report_shipments
with (security_invoker = true)
as select * from public.shipment_overview;

create or replace view public.report_temperatures
with (security_invoker = true)
as
select
  reading.id,
  reading.shipment_id,
  reading.temperature,
  reading.recorded_at,
  reading.source,
  reading.created_at,
  shipment.tracking_code,
  shipment.origin,
  shipment.destination,
  case when exists (
    select 1 from public.alerts alert
    where alert.shipment_id = reading.shipment_id
      and alert.recorded_at = reading.recorded_at
  ) then 'Violation' else 'Within range' end as result,
  reading.temperature_status
from public.temperature_readings reading
join public.shipments shipment on shipment.id = reading.shipment_id;

create or replace view public.report_deliveries
with (security_invoker = true)
as
select delivery.*, shipment.tracking_code, shipment.origin, shipment.destination
from public.deliveries delivery
join public.shipments shipment on shipment.id = delivery.shipment_id;

-- Narrow public RPC used by QR links. It returns only tracking-safe fields.
create or replace function public.get_tracking_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  batch_record public.batches%rowtype;
  shipment_record public.shipments%rowtype;
begin
  select * into batch_record from public.batches where public_token = p_token;
  if found then
    return jsonb_build_object(
      'type', 'batch',
      'batch', jsonb_build_object(
        'id', batch_record.id,
        'batch_number', batch_record.batch_number,
        'vaccine_name', batch_record.vaccine_name,
        'quantity', batch_record.quantity,
        'available_quantity', batch_record.available_quantity,
        'manufacturing_date', batch_record.manufacturing_date,
        'expiration_date', batch_record.expiration_date,
        'min_temperature', batch_record.min_temperature,
        'max_temperature', batch_record.max_temperature,
        'status', batch_record.status,
        'expiration_status', case
          when batch_record.expiration_date < current_date then 'Expired'
          when batch_record.expiration_date <= current_date + 30 then 'Expiring Soon'
          else 'Safe'
        end
      ),
      'shipments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'tracking_code', shipment.tracking_code,
          'origin', shipment.origin,
          'destination', shipment.destination,
          'status', shipment.status,
          'quantity', allocation.quantity,
          'current_temperature', (
            select reading.temperature
            from public.temperature_readings reading
            where reading.shipment_id = shipment.id
            order by reading.recorded_at desc limit 1
          ),
          'current_temperature_status', (
            select reading.temperature_status
            from public.temperature_readings reading
            where reading.shipment_id = shipment.id
            order by reading.recorded_at desc limit 1
          )
        ) order by shipment.created_at desc)
        from public.shipment_batches allocation
        join public.shipments shipment on shipment.id = allocation.shipment_id
        where allocation.batch_id = batch_record.id
      ), '[]'::jsonb)
    );
  end if;

  select * into shipment_record from public.shipments where public_token = p_token;
  if found then
    return jsonb_build_object(
      'type', 'shipment',
      'shipment', jsonb_build_object(
        'tracking_code', shipment_record.tracking_code,
        'origin', shipment_record.origin,
        'destination', shipment_record.destination,
        'dispatch_date', shipment_record.dispatch_date,
        'expected_delivery_date', shipment_record.expected_delivery_date,
        'status', shipment_record.status,
        'current_temperature', (
          select reading.temperature from public.temperature_readings reading
          where reading.shipment_id = shipment_record.id
          order by reading.recorded_at desc limit 1
        ),
        'current_temperature_status', (
          select reading.temperature_status from public.temperature_readings reading
          where reading.shipment_id = shipment_record.id
          order by reading.recorded_at desc limit 1
        ),
        'temperature_recorded_at', (
          select reading.recorded_at from public.temperature_readings reading
          where reading.shipment_id = shipment_record.id
          order by reading.recorded_at desc limit 1
        ),
        'batches', coalesce((
          select jsonb_agg(jsonb_build_object(
            'batch_number', batch.batch_number,
            'vaccine_name', batch.vaccine_name,
            'quantity', allocation.quantity,
            'min_temperature', batch.min_temperature,
            'max_temperature', batch.max_temperature
          ))
          from public.shipment_batches allocation
          join public.batches batch on batch.id = allocation.batch_id
          where allocation.shipment_id = shipment_record.id
        ), '[]'::jsonb),
        'delivery', (
          select jsonb_build_object(
            'delivered_at', delivery.delivered_at,
            'quantity_received', delivery.quantity_received,
            'condition', delivery.condition,
            'temperature_status', delivery.temperature_status
          ) from public.deliveries delivery
          where delivery.shipment_id = shipment_record.id
        )
      )
    );
  end if;

  raise exception 'Tracking record not found' using errcode = 'P0002';
end;
$$;

revoke all on function public.get_tracking_by_token(text) from public;
grant execute on function public.get_tracking_by_token(text) to anon, authenticated;

-- Enable RLS for every exposed table.
alter table public.profiles enable row level security;
alter table public.batches enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_batches enable row level security;
alter table public.temperature_readings enable row level security;
alter table public.alerts enable row level security;
alter table public.gps_readings enable row level security;
alter table public.deliveries enable row level security;

-- Explicit grants: anonymous users get only the public tracking RPC.
revoke all on table
  public.profiles, public.batches, public.shipments, public.shipment_batches,
  public.temperature_readings, public.alerts, public.gps_readings, public.deliveries,
  public.batch_inventory, public.shipment_overview, public.report_inventory,
  public.report_expiration, public.report_shipments, public.report_temperatures,
  public.report_deliveries
from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, delete on public.batches to authenticated;
grant update(status) on public.batches to authenticated;
grant select, delete on public.shipments to authenticated;
grant update(status) on public.shipments to authenticated;
grant select on public.shipment_batches to authenticated;
grant select, insert on public.temperature_readings to authenticated;
grant select on public.alerts to authenticated;
grant select, insert on public.alert_acknowledgements to authenticated;
grant select, insert, update on public.rider_assignments to authenticated;
grant select, insert on public.gps_readings to authenticated;
grant select, insert on public.deliveries to authenticated;
grant select on public.batch_inventory, public.shipment_overview, public.report_inventory,
  public.report_expiration, public.report_shipments, public.report_temperatures,
  public.report_deliveries to authenticated;

grant all on table
  public.profiles, public.batches, public.shipments, public.shipment_batches,
  public.temperature_readings, public.alerts, public.alert_acknowledgements,
  public.rider_assignments, public.gps_readings, public.deliveries
to service_role;

-- Profiles: users see themselves; administrators manage all profiles.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

-- Operational records are readable by active administrators and staff.
drop policy if exists batches_select on public.batches;
create policy batches_select on public.batches for select to authenticated
using ((select private.is_active_user()));

drop policy if exists batches_insert on public.batches;
create policy batches_insert on public.batches for insert to authenticated
with check ((select private.is_admin()) and created_by = (select auth.uid()));

drop policy if exists batches_update on public.batches;
create policy batches_update on public.batches for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists batches_delete on public.batches;
create policy batches_delete on public.batches for delete to authenticated
using ((select private.is_admin()));

drop policy if exists shipments_select on public.shipments;
create policy shipments_select on public.shipments for select to authenticated
using ((select private.is_active_user()));

drop policy if exists shipments_update on public.shipments;
create policy shipments_update on public.shipments for update to authenticated
using ((select private.is_active_user()))
with check ((select private.is_active_user()));

drop policy if exists shipments_delete on public.shipments;
create policy shipments_delete on public.shipments for delete to authenticated
using ((select private.is_admin()));

drop policy if exists shipment_batches_select on public.shipment_batches;
create policy shipment_batches_select on public.shipment_batches for select to authenticated
using ((select private.is_active_user()));

drop policy if exists temperature_readings_select on public.temperature_readings;
create policy temperature_readings_select on public.temperature_readings for select to authenticated
using ((select private.is_active_user()));

drop policy if exists temperature_readings_insert on public.temperature_readings;
create policy temperature_readings_insert on public.temperature_readings for insert to authenticated
with check ((select private.is_active_user()));

drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated
using ((select private.is_active_user()));

drop policy if exists alerts_update on public.alerts;
create policy alerts_update on public.alerts for update to authenticated
using ((select private.is_active_user()))
with check ((select private.is_active_user()));

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

drop policy if exists gps_readings_select on public.gps_readings;
create policy gps_readings_select on public.gps_readings for select to authenticated
using ((select private.is_active_user()));

drop policy if exists gps_readings_insert on public.gps_readings;
create policy gps_readings_insert on public.gps_readings for insert to authenticated
with check ((select private.is_active_user()));

drop policy if exists deliveries_select on public.deliveries;
create policy deliveries_select on public.deliveries for select to authenticated
using ((select private.is_active_user()));

drop policy if exists deliveries_insert on public.deliveries;
create policy deliveries_insert on public.deliveries for insert to authenticated
with check ((select private.is_active_user()) and confirmed_by = (select auth.uid()));

commit;

-- AFTER RUNNING THIS FILE:
-- 1. Create the first user in Authentication > Users in the Supabase dashboard.
-- 2. Promote that user once by running:
--    update public.profiles set role = 'admin' where email = 'admin@example.com';
-- 3. ESP32/GSM writes should go through a Supabase Edge Function that validates a
--    device key and writes with the service-role key. Never place that key on hardware
--    or in browser JavaScript.
