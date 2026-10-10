const { unwrap } = require('./supabase');

const HARDWARE_STALE_MS = 20000;
const SAFE_MIN_C = 2;
const SAFE_MAX_C = 8;
const CRITICAL_LOW_C = 0;
const CRITICAL_HIGH_C = 10;
const HARDWARE_STATUSES = new Set(['SAFE', 'WARNING', 'CRITICAL', 'SENSOR ERROR']);

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function findShipment(client, identifier) {
  let query = client.from('shipments').select('*');
  query = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(identifier))
    ? query.eq('id', identifier)
    : query.eq('tracking_code', identifier);
  const { data, error } = await query.maybeSingle();
  if (error) unwrap({ data, error });
  return data;
}

async function allowedRange(client, shipmentId) {
  const allocations = unwrap(await client.from('shipment_batches')
    .select('batches(min_temperature, max_temperature)')
    .eq('shipment_id', shipmentId));
  if (!allocations.length) return { min_temperature: null, max_temperature: null };
  return {
    min_temperature: Math.max(...allocations.map(item => Number(item.batches.min_temperature))),
    max_temperature: Math.min(...allocations.map(item => Number(item.batches.max_temperature)))
  };
}

function timestampValue(value, label) {
  const timestamp = value ? new Date(value) : new Date();
  if (Number.isNaN(timestamp.getTime())) throw httpError(`Invalid ${label} timestamp`, 400);
  return timestamp.toISOString();
}

function normalizeHardwareStatus(value) {
  if (value == null || value === '') return null;
  const status = String(value).trim().toUpperCase();
  if (!HARDWARE_STATUSES.has(status)) throw httpError('Temperature status is invalid', 400);
  return status;
}

function temperatureStatus(temperature, hardwareStatus = null) {
  const normalizedStatus = normalizeHardwareStatus(hardwareStatus);
  if (normalizedStatus) return normalizedStatus;
  const numericTemperature = Number(temperature);
  if (!Number.isFinite(numericTemperature)) return 'SENSOR ERROR';
  if (numericTemperature < CRITICAL_LOW_C || numericTemperature > CRITICAL_HIGH_C) return 'CRITICAL';
  return numericTemperature < SAFE_MIN_C || numericTemperature > SAFE_MAX_C ? 'WARNING' : 'SAFE';
}

function hardwareConnection(recordedAt) {
  if (!recordedAt) return { device_connection: 'No readings', reading_stale: true };
  const ageMs = Date.now() - new Date(recordedAt).getTime();
  return {
    device_connection: Number.isFinite(ageMs) && ageMs <= HARDWARE_STALE_MS ? 'Reporting' : 'Stale',
    reading_stale: !Number.isFinite(ageMs) || ageMs > HARDWARE_STALE_MS
  };
}

async function recordTemperature(client, identifier, temperature, recordedAt, source, status) {
  const shipment = await findShipment(client, identifier);
  if (!shipment) throw httpError('Shipment not found', 404);
  if (shipment.status === 'Delivered') throw httpError('Delivered shipments cannot receive readings', 409);
  const numericTemperature = Number(temperature);
  if (!Number.isFinite(numericTemperature)) throw httpError('Temperature must be a number', 400);
  const normalizedStatus = normalizeHardwareStatus(status);
  const range = await allowedRange(client, shipment.id);
  if (range.min_temperature === null || range.max_temperature === null) {
    throw httpError('Shipment has no assigned batch temperature range', 409);
  }
  const payload = {
    shipment_id: shipment.id,
    temperature: numericTemperature,
    recorded_at: timestampValue(recordedAt, 'reading'),
    source
  };
  if (normalizedStatus) payload.temperature_status = normalizedStatus;
  let readingResult = await client.from('temperature_readings').insert(payload).select().single();
  if (readingResult.error && normalizedStatus && /temperature_status|schema cache/i.test(readingResult.error.message || '')) {
    delete payload.temperature_status;
    readingResult = await client.from('temperature_readings').insert(payload).select().single();
  }
  const reading = unwrap(readingResult);
  return {
    ...reading,
    temperature_status: temperatureStatus(numericTemperature, reading.temperature_status || normalizedStatus),
    safe: numericTemperature >= range.min_temperature && numericTemperature <= range.max_temperature,
    ...range
  };
}

async function recordGps(client, identifier, latitude, longitude, recordedAt, source) {
  const shipment = await findShipment(client, identifier);
  if (!shipment) throw httpError('Shipment not found', 404);
  if (shipment.status === 'Delivered') throw httpError('Delivered shipments cannot receive GPS readings', 409);
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw httpError('Latitude must be between -90 and 90', 400);
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw httpError('Longitude must be between -180 and 180', 400);
  return unwrap(await client.from('gps_readings').insert({
    shipment_id: shipment.id,
    latitude: lat,
    longitude: lng,
    recorded_at: timestampValue(recordedAt, 'GPS'),
    source
  }).select().single());
}

module.exports = { findShipment, allowedRange, recordTemperature, recordGps, temperatureStatus, hardwareConnection };
