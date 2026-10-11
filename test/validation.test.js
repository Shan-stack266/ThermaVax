const test = require('node:test');
const assert = require('node:assert/strict');
const { validateShipmentTransition, validateDeliveryConfirmation } = require('../server/validation');
const { standaloneTemperatureStatus } = require('../server/sensorService');

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
