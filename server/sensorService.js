const { unwrap } = require('./supabase');

const HARDWARE_STALE_MS = 20000;
const SAFE_MIN_C = 2;
const SAFE_MAX_C = 8;
const CRITICAL_LOW_C = 0;
const CRITICAL_HIGH_C = 10;
const HARDWARE_STATUSES = new Set(['SAFE', 'WARNING', 'CRITICAL', 'SENSOR ERROR']);
const STANDALONE_DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{3,80}$/;
const STANDALONE_SENSOR_STATUSES = new Set(['CRITICAL LOW', 'SAFE', 'WARNING', 'CRITICAL HIGH']);
const SHIPMENT_DEVICE_STATUSES = ['Dispatched', 'In Transit', 'Arrived'];

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

function normalizeStandaloneSensorStatus(value) {
  if (value == null || value === '') return null;
  const status = String(value).trim().toUpperCase();
  if (!STANDALONE_SENSOR_STATUSES.has(status)) throw httpError('Device temperature status is invalid', 400);
  return status;
}

function normalizeDeviceId(value) {
  const deviceId = String(value ?? '').trim();
  if (!deviceId) throw httpError('Device ID is required', 400);
  if (!STANDALONE_DEVICE_ID_PATTERN.test(deviceId)) {
    throw httpError('Device ID must be 3-80 characters and contain only letters, numbers, dot, underscore, colon, or dash', 400);
  }
  return deviceId;
}

function temperatureStatus(temperature, hardwareStatus = null) {
  const normalizedStatus = normalizeHardwareStatus(hardwareStatus);
  if (normalizedStatus) return normalizedStatus;
  const numericTemperature = Number(temperature);
  if (!Number.isFinite(numericTemperature)) return 'SENSOR ERROR';
  if (numericTemperature < CRITICAL_LOW_C || numericTemperature > CRITICAL_HIGH_C) return 'CRITICAL';
  return numericTemperature < SAFE_MIN_C || numericTemperature > SAFE_MAX_C ? 'WARNING' : 'SAFE';
}

function standaloneTemperatureStatus(temperature) {
  const numericTemperature = Number(temperature);
  if (!Number.isFinite(numericTemperature)) throw httpError('Temperature must be a number', 400);
  if (numericTemperature < 2) return 'CRITICAL LOW';
  if (numericTemperature < 8) return 'SAFE';
  if (numericTemperature < 11) return 'WARNING';
  return 'CRITICAL HIGH';
}

function shipmentTemperatureStatusFromDevice(status) {
  if (status === 'CRITICAL LOW' || status === 'CRITICAL HIGH') return 'CRITICAL';
  return status;
}

function hardwareConnection(recordedAt) {
  if (!recordedAt) return { device_connection: 'No readings', reading_stale: true };
  const ageMs = Date.now() - new Date(recordedAt).getTime();
  return {
    device_connection: Number.isFinite(ageMs) && ageMs <= HARDWARE_STALE_MS ? 'Reporting' : 'Stale',
    reading_stale: !Number.isFinite(ageMs) || ageMs > HARDWARE_STALE_MS
  };
}

function isMissingDeviceAssignmentColumn(error) {
  return error && (
    error.code === '42703'
    || error.code === 'PGRST204'
    || /esp32_device_id|schema cache|column/i.test(error.message || '')
  );
}

async function activeShipmentForDevice(client, deviceId) {
  const result = await client.from('shipments')
    .select('id, tracking_code, status, esp32_device_id')
    .eq('esp32_device_id', deviceId)
    .in('status', SHIPMENT_DEVICE_STATUSES)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (isMissingDeviceAssignmentColumn(result.error)) return null;
  if (result.error) unwrap(result);
  return result.data || null;
}

async function recordStandaloneSensorReading(client, payload = {}) {
  const deviceId = normalizeDeviceId(payload.device_id);
  const numericTemperature = Number(payload.temperature);
  if (!Number.isFinite(numericTemperature)) throw httpError('Temperature must be a number', 400);
  const reportedStatus = normalizeStandaloneSensorStatus(payload.status);
  const computedStatus = standaloneTemperatureStatus(numericTemperature);
  const reading = unwrap(await client.from('sensor_readings').insert({
    device_id: deviceId,
    temperature: numericTemperature,
    status: computedStatus
  }).select('id, device_id, temperature, status, created_at').single());
  const activeShipment = await activeShipmentForDevice(client, deviceId);
  let shipmentReading = null;
  if (activeShipment) {
    shipmentReading = await recordTemperature(
      client,
      activeShipment.id,
      numericTemperature,
      reading.created_at,
      'esp32',
      shipmentTemperatureStatusFromDevice(computedStatus)
    );
  }
  return {
    ...reading,
    reported_status: reportedStatus,
    status_mismatch: Boolean(reportedStatus && reportedStatus !== computedStatus),
    assigned_shipment_id: activeShipment?.id || null,
    assigned_tracking_code: activeShipment?.tracking_code || null,
    shipment_temperature_reading_id: shipmentReading?.id || null
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

module.exports = {
  findShipment,
  allowedRange,
  recordTemperature,
  recordGps,
  recordStandaloneSensorReading,
  normalizeDeviceId,
  temperatureStatus,
  standaloneTemperatureStatus,
  shipmentTemperatureStatusFromDevice,
  hardwareConnection
};
