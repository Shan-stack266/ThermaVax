-- Apply this once to an existing ThermaVax Supabase project.
-- Adds workflow integrity and narrows anonymous tracking information.

begin;

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
            select reading.temperature from public.temperature_readings reading
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
