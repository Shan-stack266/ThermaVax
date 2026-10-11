-- Assigns standalone ESP32 temperature devices to shipments.
-- Safe to run after the base schema and sensor_readings table exist.

begin;

alter table public.shipments
add column if not exists esp32_device_id text;

alter table public.shipments
drop constraint if exists shipments_esp32_device_id_format;

alter table public.shipments
add constraint shipments_esp32_device_id_format
check (
  esp32_device_id is null
  or esp32_device_id ~ '^[A-Za-z0-9._:-]{3,80}$'
);

create unique index if not exists idx_shipments_active_esp32_device
on public.shipments(esp32_device_id)
where esp32_device_id is not null and status <> 'Delivered';

create or replace view public.shipment_overview
with (security_invoker = true)
as
select
  shipment.id,
  shipment.public_token,
  shipment.tracking_code,
  shipment.origin,
  shipment.destination,
  shipment.dispatch_date,
  shipment.expected_delivery_date,
  shipment.assigned_personnel,
  shipment.status,
  shipment.created_by,
  shipment.created_at,
  shipment.updated_at,
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
  latest_temperature.temperature_status as current_temperature_status,
  shipment.esp32_device_id
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

create or replace view public.report_shipments
with (security_invoker = true)
as select * from public.shipment_overview;

commit;
