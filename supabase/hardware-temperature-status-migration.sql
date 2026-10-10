-- Stores the ESP32-reported status beside each temperature reading and exposes
-- the latest status through shipment and public tracking views.

begin;

alter table public.temperature_readings
add column if not exists temperature_status text;

alter table public.temperature_readings
drop constraint if exists temperature_readings_temperature_status_check;

alter table public.temperature_readings
add constraint temperature_readings_temperature_status_check
check (temperature_status in ('SAFE', 'WARNING', 'CRITICAL', 'SENSOR ERROR'));

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

commit;
