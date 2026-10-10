const SHIPMENT_STATUSES = ['Preparing', 'Dispatched', 'In Transit', 'Arrived', 'Delivered'];
const STAFF_TRANSITIONS = {
  Preparing: 'Dispatched',
  Dispatched: 'In Transit',
  'In Transit': 'Arrived'
};

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function validateShipmentTransition(currentStatus, nextStatus, role) {
  if (!SHIPMENT_STATUSES.includes(nextStatus)) throw httpError('Invalid shipment status', 400);
  if (nextStatus === 'Delivered') throw httpError('Confirm delivery to complete a shipment', 409);
  if (currentStatus === 'Delivered') throw httpError('Delivered shipments cannot be changed', 409);
  if (role === 'staff') throw httpError('Staff can monitor shipments only', 403);
  if (currentStatus === nextStatus || role === 'admin') return;
  if (STAFF_TRANSITIONS[currentStatus] !== nextStatus) {
    throw httpError(`Shipment must progress from ${currentStatus} to ${STAFF_TRANSITIONS[currentStatus] || 'delivery confirmation'}`, 409);
  }
}

function validateDeliveryConfirmation(shipment, quantityReceived) {
  if (!shipment) throw httpError('Shipment not found', 404);
  if (shipment.status !== 'Arrived') throw httpError('Shipment must be Arrived before delivery can be confirmed', 409);
  if (shipment.delivery) throw httpError('Delivery has already been confirmed', 409);
  if (quantityReceived > Number(shipment.total_quantity)) {
    throw httpError('Quantity received cannot exceed the assigned shipment quantity', 400);
  }
}

module.exports = { SHIPMENT_STATUSES, validateShipmentTransition, validateDeliveryConfirmation };
