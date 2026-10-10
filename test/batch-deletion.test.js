const test = require('node:test');
const assert = require('node:assert/strict');

// Route tests use an in-memory query stub and never connect to Supabase.
const savedUrl = process.env.SUPABASE_URL;
const savedKey = process.env.SUPABASE_ANON_KEY;
process.env.SUPABASE_URL = savedUrl || 'https://layout-test.supabase.co';
process.env.SUPABASE_ANON_KEY = savedKey || 'test-key';
const router = require('../server/api');
if (savedUrl === undefined) delete process.env.SUPABASE_URL;
else process.env.SUPABASE_URL = savedUrl;
if (savedKey === undefined) delete process.env.SUPABASE_ANON_KEY;
else process.env.SUPABASE_ANON_KEY = savedKey;

const deletion = router.stack.find(layer => layer.route?.path === '/batches/:id' && layer.route.methods.delete).route;

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; }
  };
}

async function runDelete(result) {
  const calls = [];
  const query = {
    delete() { calls.push('delete'); return this; },
    eq(key, value) { calls.push([key, value]); return this; },
    select(columns) { calls.push(['select', columns]); return this; },
    async single() { return result; }
  };
  const req = { params: { id: 'batch-id' }, supabase: { from(table) { calls.push(table); return query; } } };
  const res = response();
  let error;
  await deletion.stack.at(-1).handle(req, res, value => { error = value; });
  return { res, error, calls };
}

test('batch deletion rejects staff permissions', () => {
  const res = response();
  let proceeded = false;
  deletion.stack[1].handle({ user: { role: 'staff' } }, res, () => { proceeded = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(proceeded, false);
});

test('batch deletion returns 204 after deleting the requested record', async () => {
  const { res, error, calls } = await runDelete({ data: { id: 'batch-id' }, error: null });
  assert.equal(error, undefined);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.deepEqual(calls, ['batches', 'delete', ['id', 'batch-id'], ['select', 'id']]);
});

test('batch deletion preserves shipment-linked records and returns a clear conflict', async () => {
  const { res, error } = await runDelete({ data: null, error: { code: '23503', message: 'Foreign key violation' } });
  assert.equal(error.status, 409);
  assert.match(error.message, /assigned to a shipment/);
  assert.equal(res.ended, undefined);
});

test('batch deletion returns not found for a missing record', async () => {
  const { error } = await runDelete({ data: null, error: { code: 'PGRST116', message: 'No rows' } });
  assert.equal(error.status, 404);
});

const shipmentDeletion = router.stack.find(layer => layer.route?.path === '/shipments/:id' && layer.route.methods.delete).route;

async function runShipmentDelete(status) {
  let deleted = false;
  const query = {
    select() { return this; },
    eq() { return this; },
    delete() { deleted = true; return this; },
    async single() { return { data: { id: 'shipment-id', status }, error: null }; }
  };
  const res = response();
  let error;
  await shipmentDeletion.stack.at(-1).handle({ params: { id: 'shipment-id' }, supabase: { from() { return query; } } }, res, value => { error = value; });
  return { res, error, deleted };
}

test('shipment deletion rejects staff permissions', () => {
  const res = response();
  let proceeded = false;
  shipmentDeletion.stack[1].handle({ user: { role: 'staff' } }, res, () => { proceeded = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(proceeded, false);
});

test('shipment deletion preserves delivered vaccine records', async () => {
  const { res, error, deleted } = await runShipmentDelete('Delivered');
  assert.equal(error.status, 409);
  assert.match(error.message, /retained for delivery records/);
  assert.equal(deleted, false);
  assert.equal(res.ended, undefined);
});

test('shipment deletion permits unfinished shipments', async () => {
  const { res, error, deleted } = await runShipmentDelete('Preparing');
  assert.equal(error, undefined);
  assert.equal(deleted, true);
  assert.equal(res.statusCode, 204);
});

test('delivery archive contains batch allocations and actual received quantity separately', async () => {
  const deliveryRoute = router.stack.find(layer => layer.route?.path === '/deliveries' && layer.route.methods.get).route;
  const deliveries = [{ id: 'delivery-id', shipment_id: 'shipment-id', quantity_received: 8, shipments: { tracking_code: 'TVX-1', destination: 'Health center', shipment_batches: [{ quantity: 10, batches: { id: 'batch-id', vaccine_name: 'Vaccine', batch_number: 'B-1' } }] } }];
  const client = { from(table) { return { select() { return this; }, async order() { return { data: table === 'deliveries' ? deliveries : [{ id: 'shipment-id', status: 'Delivered' }], error: null }; } }; } };
  const res = response();
  let error;
  await deliveryRoute.stack.at(-1).handle({ supabase: client }, res, value => { error = value; });
  assert.equal(error, undefined);
  assert.equal(res.body.ready.length, 0);
  assert.equal(res.body.completed[0].quantity_received, 8);
  assert.deepEqual(res.body.completed[0].batches, [{ id: 'batch-id', vaccine_name: 'Vaccine', batch_number: 'B-1', assigned_quantity: 10 }]);
  assert.equal(res.body.completed[0].shipment_batches, undefined);
});
