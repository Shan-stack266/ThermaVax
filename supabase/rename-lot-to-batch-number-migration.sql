-- Rename the vaccine lot identifier to "batch number" without losing data.
-- Run once in the Supabase SQL Editor for an existing ThermaVax project.

begin;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'batches'
      and column_name = 'lot_number'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'batches'
      and column_name = 'batch_number'
  ) then
    alter table public.batches rename column lot_number to batch_number;
  end if;
end;
$$;

-- Views keep their original output-column names when a source column is renamed.
do $$
declare
  view_name text;
begin
  foreach view_name in array array[
    'batch_inventory',
    'report_inventory',
    'report_expiration'
  ]
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = view_name
        and column_name = 'lot_number'
    ) then
      execute format(
        'alter view public.%I rename column lot_number to batch_number',
        view_name
      );
    end if;
  end loop;
end;
$$;

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

commit;
