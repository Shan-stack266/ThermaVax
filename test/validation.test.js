const test = require('node:test');
const assert = require('node:assert/strict');
const { validateShipmentTransition, validateDeliveryConfirmation } = require('../server/validation');
const { recordStandaloneSensorReading, standaloneTemperatureStatus } = require('../server/sensorService');

test('rider shipment transitions move forward one step', () => {
  assert.doesNotThrow(() => validateShipmentTransition('Preparing', 'Dispatched', 'rider'));
  assert.doesNotThrow(() => validateShipmentTransition('Dispatched', 'In Transit', 'rider'));
  assert.doesNotThrow(() => validateShipmentTransition('In Transit', 'Arrived', 'rider'));
});

test('staff cannot change shipment states', () => {
  assert.throws(() => validateShipmentTransition('Preparing', 'Dispatched', 'staff'), /monitor shipments only/);
});

test('rider cannot skip or reverse shipment states', () => {
  assert.throws(() => validateShipmentTransition('Preparing', 'Arrived', 'rider'), /must progress/);
  assert.throws(() => validateShipmentTransition('Arrived', 'In Transit', 'rider'), /must progress/);
});

test('delivery status is only set through confirmation', () => {
  assert.throws(() => validateShipmentTransition('Arrived', 'Delivered', 'admin'), /Confirm delivery/);
});

test('delivery confirmation requires an arrived shipment and valid quantity', () => {
  const shipment = { status: 'Arrived', total_quantity: 20, delivery: null };
  assert.doesNotThrow(() => validateDeliveryConfirmation(shipment, 20));
  assert.throws(() => validateDeliveryConfirmation({ ...shipment, status: 'In Transit' }, 20), /must be Arrived/);
  assert.throws(() => validateDeliveryConfirmation(shipment, 21), /cannot exceed/);
  assert.throws(() => validateDeliveryConfirmation({ ...shipment, delivery: {} }, 20), /already been confirmed/);
});

test('standalone ESP32 readings use device monitoring thresholds', () => {
  assert.equal(standaloneTemperatureStatus(1.9), 'CRITICAL LOW');
  assert.equal(standaloneTemperatureStatus(2), 'SAFE');
  assert.equal(standaloneTemperatureStatus(7.99), 'SAFE');
  assert.equal(standaloneTemperatureStatus(8), 'WARNING');
  assert.equal(standaloneTemperatureStatus(10.99), 'WARNING');
  assert.equal(standaloneTemperatureStatus(11), 'CRITICAL HIGH');
  assert.throws(() => standaloneTemperatureStatus('not-a-number'), /Temperature must be a number/);
});

test('standalone ESP32 readings attach to accepted assigned shipments', async () => {
  const inserted = [];
  let shipmentLookup = 0;
  const client = {
    from(table) {
      if (table === 'sensor_readings') {
        return {
          insert(payload) { inserted.push({ table, payload }); return this; },
          select() { return this; },
          async single() {
            return {
              data: { id: 'sensor-reading-id', device_id: 'esp32Dev1', temperature: 11.5, status: 'CRITICAL HIGH', created_at: '2026-10-11T05:00:00.000Z' },
              error: null
            };
          }
        };
      }
      if (table === 'shipments') {
        shipmentLookup += 1;
        return {
          select() { return this; },
          eq() { return this; },
          in() { return this; },
          order() { return this; },
          limit() { return this; },
          async maybeSingle() {
            return { data: { id: 'shipment-id', tracking_code: 'TVX-1', status: 'In Transit', esp32_device_id: 'esp32Dev1' }, error: null };
          }
        };
      }
      if (table === 'shipment_batches') {
        return {
          select() { return this; },
          eq() { return this; },
          then(resolve) { resolve({ data: [{ batches: { min_temperature: 2, max_temperature: 8 } }], error: null }); }
        };
      }
      if (table === 'temperature_readings') {
        return {
          insert(payload) { inserted.push({ table, payload }); return this; },
          select() { return this; },
          async single() {
            return { data: { id: 'temperature-reading-id', temperature: 11.5, temperature_status: 'CRITICAL' }, error: null };
          }
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };

  const reading = await recordStandaloneSensorReading(client, { device_id: 'esp32Dev1', temperature: 11.5, status: 'CRITICAL HIGH' });
  assert.equal(shipmentLookup, 2);
  assert.equal(reading.assigned_shipment_id, 'shipment-id');
  assert.equal(reading.shipment_temperature_reading_id, 'temperature-reading-id');
  assert.deepEqual(inserted[1], {
    table: 'temperature_readings',
    payload: {
      shipment_id: 'shipment-id',
      temperature: 11.5,
      recorded_at: '2026-10-11T05:00:00.000Z',
      source: 'esp32',
      temperature_status: 'CRITICAL'
    }
  });
});
