const express = require('express');
const QRCode = require('qrcode');
const { authenticate, requireRole } = require('./auth');
const { createAnonymousClient, createServiceClient, createUserClient, unwrap } = require('./supabase');
const { recordTemperature, recordGps, allowedRange, temperatureStatus, hardwareConnection, normalizeDeviceId } = require('./sensorService');
const { SHIPMENT_STATUSES, validateShipmentTransition, validateDeliveryConfirmation } = require('./validation');
const { loginLimiter, confirmationLimiter, passwordResetLimiter, publicTrackingLimiter, qrLimiter } = require('./security');

const router = express.Router();
const BATCH_STATUSES = ['Available', 'Quarantined', 'Depleted'];

function normalizeBatchNumber(value) {
  if (Array.isArray(value)) return value.map(normalizeBatchNumber);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key === 'lot_number' ? 'batch_number' : key,
    normalizeBatchNumber(item)
  ]));
}

// Keep responses compatible while an existing Supabase project applies the rename migration.
router.use((req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = payload => sendJson(normalizeBatchNumber(payload));
  next();
});

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function text(value, label, required = true, maxLength = 255) {
  const result = String(value ?? '').trim();
  if (required && !result) throw httpError(`${label} is required`, 400);
  if (result.length > maxLength) throw httpError(`${label} must contain no more than ${maxLength} characters`, 400);
  return result;
}

function trackingToken(value) {
  const token = String(value || '');
  if (!/^[a-f0-9]{36}$/i.test(token)) throw httpError('Invalid tracking token', 400);
  return token;
}

function publicAppUrl() {
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
  const configured = String(process.env.PUBLIC_APP_URL || vercelUrl).trim().replace(/\/$/, '');
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      return parsed.origin + parsed.pathname.replace(/\/$/, '');
    } catch {
      throw httpError('PUBLIC_APP_URL is invalid', 500);
    }
  }
  return `http://localhost:${Number(process.env.PORT) || 3000}`;
}

function positiveInteger(value, label, allowZero = false) {
  const number = Number(value);
  const valid = Number.isInteger(number) && (allowZero ? number >= 0 : number > 0);
  if (!valid) throw httpError(`${label} must be ${allowZero ? 'zero or greater' : 'a positive whole number'}`, 400);
  return number;
}

function numberValue(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw httpError(`${label} must be a number`, 400);
  return number;
}

function dateValue(value, label, optional = false) {
  if (optional && !value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw httpError(`${label} is invalid`, 400);
  return date.toISOString();
}

function dateOnly(value, label) {
  const result = text(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(new Date(`${result}T00:00:00`).getTime())) {
    throw httpError(`${label} is invalid`, 400);
  }
  return result;
}

function flattenShipment(record) {
  if (!record) return record;
  const { shipments, ...rest } = record;
  return { ...rest, ...(shipments || {}) };
}

function addTemperatureState(shipment, range = shipment.temperature_range) {
  const latestTemperature = shipment.current_temperature;
  const latestRecordedAt = shipment.temperature_recorded_at;
  shipment.temperature_status = latestTemperature == null
    ? 'No reading'
    : temperatureStatus(latestTemperature, shipment.current_temperature_status);
  Object.assign(shipment, hardwareConnection(latestRecordedAt));
  if (Array.isArray(shipment.temperature_history)) {
    shipment.temperature_history = shipment.temperature_history.map(reading => ({
      ...reading,
      temperature_status: temperatureStatus(reading.temperature, reading.temperature_status)
    }));
    const latestReading = shipment.temperature_history.at(-1);
    if (latestReading?.temperature_status) shipment.temperature_status = latestReading.temperature_status;
  }
  return shipment;
}

function serviceOrRequestClient(client) {
  return client?.auth ? createServiceClient() || client : client;
}

async function addRiderAssignmentState(client, shipments) {
  if (!shipments.length) return shipments;
  const assignmentClient = serviceOrRequestClient(client);
  let assignmentResult = await assignmentClient.from('rider_assignments')
    .select('shipment_id, rider_id, status, responded_at, rejection_reason');
  if (assignmentResult.error && assignmentClient !== client) {
    assignmentResult = await client.from('rider_assignments')
      .select('shipment_id, rider_id, status, responded_at, rejection_reason');
  }
  if (assignmentResult.error?.code === 'PGRST205') {
    return shipments.map(shipment => ({ ...shipment, rider_assignment_status: 'Assigned' }));
  }
  const assignments = unwrap(assignmentResult) || [];
  const assignmentByShipment = new Map(assignments.map(item => [item.shipment_id, item]));
  return shipments.map(shipment => {
    const assignment = assignmentByShipment.get(shipment.id);
    const inferredAccepted = !assignment && ['Dispatched', 'In Transit', 'Arrived'].includes(shipment.status);
    return {
      ...shipment,
      rider_assignment_status: assignment?.status || (inferredAccepted ? 'Accepted' : 'Assigned'),
      rider_assignment_responded_at: assignment?.responded_at || null,
      rider_assignment_rejection_reason: assignment?.rejection_reason || null
    };
  });
}

async function alertViewsForUser(client, userId, alertIds = null) {
  let query = client.from('alert_views').select('alert_id, viewed_at').eq('user_id', userId);
  if (Array.isArray(alertIds)) {
    if (!alertIds.length) return new Map();
    query = query.in('alert_id', alertIds);
  }
  const result = await query;
  if (result.error?.code === 'PGRST205') return new Map();
  return new Map(unwrap(result).map(item => [item.alert_id, item.viewed_at]));
}

async function listShipments(client, activeOnly = false) {
  let query = client.from('shipment_overview').select('*').order('created_at', { ascending: false });
  if (activeOnly) query = query.neq('status', 'Delivered');
  return addRiderAssignmentState(client, unwrap(await query).map(addTemperatureState));
}

function isActiveDelivery(shipment) {
  return shipment.status !== 'Delivered'
    && (
      shipment.rider_assignment_status === 'Accepted'
      || ['Dispatched', 'In Transit', 'Arrived'].includes(shipment.status)
    );
}

function isShipmentQueueItem(shipment) {
  return shipment.status !== 'Delivered' && !isActiveDelivery(shipment);
}

function isMissingDeviceAssignmentColumn(error) {
  return error && (
    error.code === '42703'
    || error.code === 'PGRST204'
    || /esp32_device_id|schema cache|column/i.test(error.message || '')
  );
}

async function activeDeviceAssignments(client) {
  const result = await client.from('shipments')
    .select('id, tracking_code, status, esp32_device_id')
    .not('esp32_device_id', 'is', null)
    .neq('status', 'Delivered');
  if (isMissingDeviceAssignmentColumn(result.error)) {
    throw httpError('Apply supabase/esp32-device-assignment-migration.sql before assigning ESP32 devices to shipments.', 409);
  }
  return unwrap(result);
}

async function assertDeviceAvailable(client, deviceId) {
  if (!deviceId) return;
  const assignments = await activeDeviceAssignments(client);
  const assigned = assignments.find(item => item.esp32_device_id === deviceId);
  if (assigned) {
    throw httpError(`ESP32 device ${deviceId} is already assigned to shipment ${assigned.tracking_code}.`, 409);
  }
}

async function shipmentDetail(client, id) {
  const { data: shipment, error } = await client.from('shipment_overview').select('*').eq('id', id).maybeSingle();
  if (error) unwrap({ data: shipment, error });
  if (!shipment) return null;

  const assignmentClient = serviceOrRequestClient(client);
  const [allocations, temperatureHistory, locationHistory, alerts, delivery, temperatureRange, riderAssignment] = await Promise.all([
    client.from('shipment_batches').select('quantity, batches(*)').eq('shipment_id', id),
    client.from('temperature_readings').select('*').eq('shipment_id', id).order('recorded_at'),
    client.from('gps_readings').select('*').eq('shipment_id', id).order('recorded_at'),
    client.from('alerts').select('*').eq('shipment_id', id).order('recorded_at', { ascending: false }),
    client.from('deliveries').select('*').eq('shipment_id', id).maybeSingle(),
    allowedRange(client, id),
    assignmentClient.from('rider_assignments').select('*').eq('shipment_id', id).maybeSingle()
  ]);

  shipment.batches = unwrap(allocations).map(item => ({ ...item.batches, assigned_quantity: item.quantity }));
  shipment.temperature_history = unwrap(temperatureHistory);
  shipment.location_history = unwrap(locationHistory);
  shipment.alerts = unwrap(alerts);
  shipment.delivery = unwrap(delivery);
  shipment.temperature_range = temperatureRange;
  const assignment = riderAssignment.error?.code === 'PGRST205' ? null : unwrap(riderAssignment);
  shipment.rider_assignment_status = assignment?.status || (['Dispatched', 'In Transit', 'Arrived'].includes(shipment.status) ? 'Accepted' : 'Assigned');
  shipment.rider_assignment_responded_at = assignment?.responded_at || null;
  shipment.rider_assignment_rejection_reason = assignment?.rejection_reason || null;
  addTemperatureState(shipment, temperatureRange);
  return shipment;
}

async function moveAcceptedShipmentToTransit(client, shipment) {
  if (shipment.status === 'Preparing') {
    unwrap(await client.from('shipments').update({ status: 'Dispatched' }).eq('id', shipment.id).select('id').single());
    unwrap(await client.from('shipments').update({ status: 'In Transit' }).eq('id', shipment.id).select('id').single());
    return;
  }
  if (shipment.status === 'Dispatched') {
    unwrap(await client.from('shipments').update({ status: 'In Transit' }).eq('id', shipment.id).select('id').single());
  }
}

async function moveShipmentToArrived(client, shipment) {
  if (shipment.status === 'Preparing') {
    unwrap(await client.from('shipments').update({ status: 'Dispatched' }).eq('id', shipment.id).select('id').single());
    unwrap(await client.from('shipments').update({ status: 'In Transit' }).eq('id', shipment.id).select('id').single());
    unwrap(await client.from('shipments').update({ status: 'Arrived' }).eq('id', shipment.id).select('id').single());
    return;
  }
  if (shipment.status === 'Dispatched') {
    unwrap(await client.from('shipments').update({ status: 'In Transit' }).eq('id', shipment.id).select('id').single());
    unwrap(await client.from('shipments').update({ status: 'Arrived' }).eq('id', shipment.id).select('id').single());
    return;
  }
  if (shipment.status === 'In Transit') {
    unwrap(await client.from('shipments').update({ status: 'Arrived' }).eq('id', shipment.id).select('id').single());
  }
}

router.post('/auth/login', loginLimiter, route(async (req, res) => {
  const email = text(req.body.email, 'Email').toLowerCase();
  const password = text(req.body.password, 'Password', true, 128);
  const client = createAnonymousClient();
  const service = createServiceClient();
  const profileRequest = service
    ? service.from('profiles').select('id, email, role, active, created_at').eq('email', email).maybeSingle()
    : null;
  const [authResult, serviceProfileResult] = await Promise.all([
    client.auth.signInWithPassword({ email, password }),
    profileRequest || Promise.resolve(null)
  ]);
  const { data, error } = authResult;
  if (error || !data.session) {
    if (error?.code === 'email_not_confirmed' || /email not confirmed/i.test(error?.message || '')) {
      return res.status(403).json({ error: 'Email confirmation is required before this account can sign in.' });
    }
    console.warn(`Supabase login rejected: ${error?.code || 'no_session'}`);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  let profile;
  if (serviceProfileResult && !serviceProfileResult.error && serviceProfileResult.data?.id === data.user.id) {
    profile = serviceProfileResult.data;
  } else {
    const userClient = require('./supabase').createUserClient(data.session.access_token);
    profile = unwrap(await userClient.from('profiles')
      .select('id, email, role, active, created_at')
      .eq('id', data.user.id)
      .single());
  }
  if (!profile.active) return res.status(403).json({ error: 'This account is disabled' });

  res.json({
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: new Date(data.session.expires_at * 1000).toISOString(),
    user: profile
  });
}));

router.post('/auth/resend-confirmation', confirmationLimiter, route(async (req, res) => {
  const email = text(req.body.email, 'Email').toLowerCase();
  const { error } = await createAnonymousClient().auth.resend({ type: 'signup', email });
  if (error && error.status === 429) throw httpError('Please wait before requesting another confirmation email', 429);
  if (error) console.warn(`Confirmation resend rejected: ${error.code || 'unknown'}`);
  res.status(204).end();
}));

router.post('/auth/forgot-password', passwordResetLimiter, route(async (req, res) => {
  const email = text(req.body.email, 'Email').toLowerCase();
  const { error } = await createAnonymousClient().auth.resetPasswordForEmail(email, {
    redirectTo: `${publicAppUrl()}/?reset=password`
  });
  if (error) console.warn(`Password reset request rejected: ${error.code || error.message || 'unknown'}`);
  res.status(204).end();
}));

router.post('/auth/reset-password', passwordResetLimiter, route(async (req, res) => {
  const password = text(req.body.password, 'Password', true, 128);
  if (password.length < 8) throw httpError('Password must contain at least 8 characters', 400);

  const code = text(req.body.code, 'Reset code', false, 2048);
  const accessToken = text(req.body.access_token, 'Reset token', false, 4096);
  let userClient;

  if (code) {
    const { data, error } = await createAnonymousClient().auth.exchangeCodeForSession(code);
    if (error || !data.session?.access_token) throw httpError('Password reset link is invalid or expired', 400);
    userClient = createUserClient(data.session.access_token);
  } else if (accessToken) {
    userClient = createUserClient(accessToken);
  } else {
    throw httpError('Password reset link is invalid or expired', 400);
  }

  const { error } = await userClient.auth.updateUser({ password });
  if (error) throw httpError(error.message || 'Unable to update password', error.status || 400);
  res.status(204).end();
}));

router.post('/auth/refresh', route(async (req, res) => {
  const refreshToken = text(req.body.refresh_token, 'Refresh token');
  const { data, error } = await createAnonymousClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) return res.status(401).json({ error: 'Session expired or invalid' });
  res.json({
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: new Date(data.session.expires_at * 1000).toISOString()
  });
}));

router.post('/auth/logout', authenticate, route(async (req, res) => {
  const refreshToken = text(req.body.refresh_token, 'Refresh token', false);
  if (refreshToken) {
    const client = createAnonymousClient();
    const session = await client.auth.setSession({ access_token: req.accessToken, refresh_token: refreshToken });
    if (!session.error) await client.auth.signOut({ scope: 'global' });
  }
  res.status(204).end();
}));
router.get('/auth/me', authenticate, (req, res) => res.json(req.user));

router.get('/users', authenticate, requireRole('admin'), route(async (req, res) => {
  const users = unwrap(await req.supabase.from('profiles')
    .select('id, email, role, active, created_at')
    .order('created_at'));
  const service = createServiceClient();
  let authById = new Map();
  if (service) {
    const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw httpError('Unable to read Supabase Auth users', error.status || 500);
    authById = new Map(data.users.map(user => [user.id, user]));
  }
  const results = users.map(user => ({
    ...user,
    auth_confirmed: service ? Boolean(authById.get(user.id)?.email_confirmed_at) : null
  }));
  results.sort((a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1));
  res.json(results);
}));

router.get('/riders', authenticate, requireRole('admin'), route(async (req, res) => {
  const service = createServiceClient();
  if (!service) throw httpError('Verified rider lookup requires SUPABASE_SECRET_KEY on the server', 503);
  let profiles;
  try {
    profiles = unwrap(await service.from('profiles')
      .select('id, email, active, role')
      .eq('active', true)
      .order('email'));
  } catch (error) {
    throw httpError(`Rider lookup failed at profiles: ${error.message}`, 422);
  }
  let authData;
  try {
    const result = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (result.error) throw result.error;
    authData = result.data;
  } catch (error) {
    throw httpError(`Rider lookup failed at Auth verification: ${error.message}`, 422);
  }
  const confirmedUsers = (authData?.users || []).filter(user => user.email_confirmed_at);
  const confirmed = new Map(confirmedUsers.map(user => [user.id, user.email]));
  let shipments;
  try {
    shipments = unwrap(await service.from('shipment_overview').select('assigned_personnel, status'));
  } catch (error) {
    throw httpError(`Rider lookup failed at shipment overview: ${error.message}`, 422);
  }
  const verified = profiles.filter(profile => profile.role === 'rider' && confirmed.has(profile.id)).map(profile => {
    const email = confirmed.get(profile.id) || profile.email || '';
    const name = email.split('@')[0].replace(/[._-]+/g, ' ') || 'Verified rider';
    const normalizedName = name.toLowerCase();
    const activeDeliveries = shipments.filter(shipment => shipment.status !== 'Delivered'
      && String(shipment.assigned_personnel || '').toLowerCase().includes(normalizedName)).length;
    return { id: profile.id, email: profile.email, name, active_deliveries: activeDeliveries };
  });
  res.json(verified);
}));

router.post('/users', authenticate, requireRole('admin'), route(async (req, res) => {
  const email = text(req.body.email, 'Email').toLowerCase();
  const password = text(req.body.password, 'Password');
  const role = ['admin', 'staff', 'rider'].includes(req.body.role) ? req.body.role : 'staff';
  if (password.length < 8) throw httpError('Password must contain at least 8 characters', 400);

  const service = createServiceClient();
  if (!service) throw httpError('Staff automation requires SUPABASE_SECRET_KEY on the server', 503);
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (error) {
    const duplicate = error.code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message || '');
    throw httpError(duplicate ? 'A user with this email already exists' : error.message, duplicate ? 409 : error.status || 400);
  }
  if (!data.user) throw httpError('Supabase did not create the staff account', 500);

  const user = unwrap(await req.supabase.from('profiles')
    .update({ role })
    .eq('id', data.user.id)
    .select('id, email, role, active, created_at')
    .single());
  res.status(201).json({ ...user, auth_confirmed: true, confirmation_required: false });
}));

router.post('/users/:id/confirm', authenticate, requireRole('admin'), route(async (req, res) => {
  const service = createServiceClient();
  if (!service) throw httpError('Staff automation requires SUPABASE_SECRET_KEY on the server', 503);
  const { data, error } = await service.auth.admin.updateUserById(req.params.id, { email_confirm: true });
  if (error) throw httpError(error.message, error.status || 400);
  const profile = unwrap(await req.supabase.from('profiles')
    .select('id, email, role, active, created_at')
    .eq('id', req.params.id)
    .single());
  res.json({ ...profile, auth_confirmed: Boolean(data.user?.email_confirmed_at) });
}));

router.patch('/users/:id/status', authenticate, requireRole('admin'), route(async (req, res) => {
  const active = req.body.active === true || req.body.active === 1;
  if (req.params.id === req.user.id && !active) throw httpError('You cannot disable your own account', 409);
  const user = unwrap(await req.supabase.from('profiles')
    .update({ active })
    .eq('id', req.params.id)
    .select('id, email, role, active, created_at')
    .single());
  res.json(user);
}));

router.delete('/users/:id', authenticate, requireRole('admin'), route(async (req, res) => {
  if (req.params.id === req.user.id) throw httpError('You cannot delete your own account', 409);
  const service = createServiceClient();
  if (!service) throw httpError('User deletion requires SUPABASE_SECRET_KEY on the server', 503);
  unwrap(await service.from('profiles')
    .select('id')
    .eq('id', req.params.id)
    .single());
  const { error } = await service.auth.admin.deleteUser(req.params.id);
  if (error) {
    const linked = /foreign key|referenced|violates|constraint/i.test(error.message || '');
    throw httpError(
      linked
        ? 'This user is linked to operational records and cannot be deleted. Disable the account instead.'
        : error.message,
      linked ? 409 : error.status || 400
    );
  }
  res.status(204).end();
}));

router.get('/dashboard', authenticate, route(async (req, res) => {
  const [batchResult, shipmentResult, alertResult] = await Promise.all([
    req.supabase.from('batch_inventory').select('*').order('expiration_date'),
    req.supabase.from('shipment_overview').select('*').order('created_at', { ascending: false }),
    req.supabase.from('alerts').select('*, shipments!inner(tracking_code, origin, destination, assigned_personnel)')
      .eq('status', 'Active').order('recorded_at', { ascending: false })
  ]);
  const batches = unwrap(batchResult);
  const shipments = unwrap(shipmentResult).map(addTemperatureState);
  const riderName = req.user?.role === 'rider' ? req.user.email.split('@')[0].replace(/[._-]+/g, ' ').toLowerCase() : '';
  const assignedToRider = item => !riderName || String(item.assigned_personnel || '').toLowerCase().includes(riderName);
  const alerts = unwrap(alertResult).map(flattenShipment).filter(assignedToRider);
  const viewedAlerts = await alertViewsForUser(req.supabase, req.user.id, alerts.map(alert => alert.id));
  const newAlerts = alerts.filter(alert => !viewedAlerts.has(alert.id));
  const newAlertCountByShipment = newAlerts.reduce((counts, alert) => {
    counts.set(alert.shipment_id, (counts.get(alert.shipment_id) || 0) + 1);
    return counts;
  }, new Map());
  const activeShipments = (await addRiderAssignmentState(req.supabase, shipments.filter(item => item.status !== 'Delivered' && assignedToRider(item))))
    .map(shipment => ({ ...shipment, active_alerts: newAlertCountByShipment.get(shipment.id) || 0 }));
  const inventoryByVaccine = batches.reduce((totals, batch) => {
    const vaccine = batch.vaccine_name || 'Unnamed vaccine';
    totals.set(vaccine, (totals.get(vaccine) || 0) + Number(batch.available_quantity || 0));
    return totals;
  }, new Map());
  const inventoryChart = [...inventoryByVaccine.entries()]
    .map(([label, value]) => ({ label, value, tone: 'primary' }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, 6);
  const shipmentTones = {
    Preparing: 'muted', Dispatched: 'accent', 'In Transit': 'primary', Arrived: 'success', Delivered: 'complete'
  };
  const expirationTones = { Safe: 'success', 'Expiring Soon': 'warning', Expired: 'danger' };
  const shipmentsWithAlerts = activeShipments.filter(item => Number(item.active_alerts || 0) > 0).length;
  res.json({
    counts: {
      batches: batches.length,
      available_doses: batches.reduce((sum, batch) => sum + Number(batch.available_quantity), 0),
      active_shipments: activeShipments.length,
      active_alerts: newAlerts.length,
      expiring: batches.filter(item => item.expiration_status !== 'Safe').length
    },
    charts: {
      inventory: inventoryChart.length ? inventoryChart : [{ label: 'No inventory', value: 0, tone: 'muted' }],
      shipments: ['Preparing', 'Dispatched', 'In Transit', 'Arrived', 'Delivered'].map(label => ({
        label, value: shipments.filter(item => item.status === label).length, tone: shipmentTones[label]
      })),
      expiration: ['Safe', 'Expiring Soon', 'Expired'].map(label => ({
        label, value: batches.filter(item => item.expiration_status === label).length, tone: expirationTones[label]
      })),
      temperature: [
        { label: 'Stable', value: Math.max(0, activeShipments.length - shipmentsWithAlerts), tone: 'success' },
        { label: 'With active alerts', value: shipmentsWithAlerts, tone: 'danger' }
      ]
    },
    warnings: batches.filter(item => item.expiration_status !== 'Safe').slice(0, 8),
    alerts: newAlerts.slice(0, 8),
    active_shipments: activeShipments,
    recent_shipments: shipments.slice(0, 5)
  });
}));

router.get('/sensor-readings/latest', authenticate, route(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const client = createServiceClient() || req.supabase;
  res.json(unwrap(await client.from('sensor_readings')
    .select('id, device_id, temperature, status, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)));
}));

router.get('/sensor-devices', authenticate, requireRole('admin'), route(async (req, res) => {
  const client = createServiceClient() || req.supabase;
  const readings = unwrap(await client.from('sensor_readings')
    .select('device_id, temperature, status, created_at')
    .order('created_at', { ascending: false })
    .limit(200));
  const latestByDevice = new Map();
  readings.forEach(reading => {
    if (!latestByDevice.has(reading.device_id)) latestByDevice.set(reading.device_id, reading);
  });
  const assignments = await activeDeviceAssignments(client);
  const assignmentByDevice = new Map(assignments.map(item => [item.esp32_device_id, item]));
  res.json([...latestByDevice.values()].map(reading => {
    const assignment = assignmentByDevice.get(reading.device_id);
    return {
      device_id: reading.device_id,
      latest_temperature: reading.temperature,
      status: reading.status,
      last_seen: reading.created_at,
      available: !assignment,
      assigned_shipment_id: assignment?.id || null,
      assigned_tracking_code: assignment?.tracking_code || null,
      assigned_status: assignment?.status || null
    };
  }));
}));

router.get('/batches', authenticate, route(async (req, res) => {
  res.json(unwrap(await req.supabase.from('batch_inventory').select('*').order('expiration_date')));
}));

router.get('/batches/:id', authenticate, route(async (req, res) => {
  const { data: batch, error } = await req.supabase.from('batch_inventory').select('*').eq('id', req.params.id).maybeSingle();
  if (error) unwrap({ data: batch, error });
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  const allocations = unwrap(await req.supabase.from('shipment_batches')
    .select('quantity, shipments(id, tracking_code, status, origin, destination, created_at)')
    .eq('batch_id', batch.id));
  batch.shipments = allocations.map(item => ({ ...item.shipments, quantity: item.quantity }))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json(batch);
}));

router.post('/batches', authenticate, requireRole('admin'), route(async (req, res) => {
  const quantity = positiveInteger(req.body.quantity, 'Quantity');
  const minTemperature = numberValue(req.body.min_temperature, 'Minimum temperature');
  const maxTemperature = numberValue(req.body.max_temperature, 'Maximum temperature');
  if (minTemperature >= maxTemperature) throw httpError('Minimum temperature must be lower than maximum temperature', 400);
  const manufacturingDate = dateOnly(req.body.manufacturing_date, 'Manufacturing date');
  const expirationDate = dateOnly(req.body.expiration_date, 'Expiration date');
  if (expirationDate <= manufacturingDate) throw httpError('Expiration date must be after manufacturing date', 400);
  const batchNumber = text(req.body.batch_number, 'Batch number');
  const payload = {
    batch_number: batchNumber,
    vaccine_name: text(req.body.vaccine_name, 'Vaccine name'),
    quantity,
    available_quantity: quantity,
    manufacturing_date: manufacturingDate,
    expiration_date: expirationDate,
    min_temperature: minTemperature,
    max_temperature: maxTemperature,
    created_by: req.user.id
  };
  let result = await req.supabase.from('batches').insert(payload).select().single();
  if (result.error?.code === 'PGRST204' && /batch_number/i.test(result.error.message)) {
    const { batch_number, ...legacyPayload } = payload;
    result = await req.supabase.from('batches').insert({ ...legacyPayload, lot_number: batch_number }).select().single();
  }
  const batch = unwrap(result);
  res.status(201).json(batch);
}));

router.delete('/batches/:id', authenticate, requireRole('admin'), route(async (req, res) => {
  const result = await req.supabase.from('batches').delete().eq('id', req.params.id).select('id').single();
  if (result.error?.code === '23503') {
    throw httpError('This batch is assigned to a shipment and cannot be deleted.', 409);
  }
  unwrap(result);
  res.status(204).end();
}));

router.patch('/batches/:id/status', authenticate, requireRole('admin'), route(async (req, res) => {
  if (!BATCH_STATUSES.includes(req.body.status)) throw httpError('Invalid batch status', 400);
  const batch = unwrap(await req.supabase.from('batches').update({ status: req.body.status })
    .eq('id', req.params.id).select().single());
  res.json(batch);
}));

router.get('/shipments', authenticate, route(async (req, res) => {
  const shipments = await listShipments(req.supabase);
  const shipmentQueue = shipments.filter(isShipmentQueueItem);
  if (req.user.role !== 'rider') return res.json(shipmentQueue);
  const riderName = req.user.email.split('@')[0].replace(/[._-]+/g, ' ').toLowerCase();
  res.json(shipmentQueue.filter(item => String(item.assigned_personnel || '').toLowerCase().includes(riderName)
    && (item.rider_assignment_status || 'Assigned') === 'Assigned'
    && item.status === 'Preparing'));
}));

router.get('/deliveries', authenticate, route(async (req, res) => {
  const [shipments, deliveries] = await Promise.all([
    listShipments(req.supabase),
    req.supabase.from('deliveries')
      .select('*, shipments!inner(tracking_code, origin, destination, shipment_batches(quantity, batches(id, vaccine_name, batch_number)))')
      .order('delivered_at', { ascending: false })
  ]);
  const riderName = req.user?.role === 'rider' ? req.user.email.split('@')[0].replace(/[._-]+/g, ' ').toLowerCase() : '';
  const visibleShipments = riderName
    ? shipments.filter(item => String(item.assigned_personnel || '').toLowerCase().includes(riderName))
    : shipments;
  const activeAccepted = visibleShipments.filter(isActiveDelivery);
  res.json({
    active: activeAccepted,
    ready: activeAccepted.filter(shipment => shipment.status === 'Arrived'),
    in_transit: activeAccepted.filter(shipment => ['Dispatched', 'In Transit'].includes(shipment.status)),
    completed: unwrap(deliveries).map(record => {
      const delivery = flattenShipment(record);
      const { shipment_batches, ...details } = delivery;
      return {
        ...details,
        batches: (shipment_batches || []).map(allocation => ({
          ...allocation.batches,
          assigned_quantity: allocation.quantity
        }))
      };
    })
  });
}));

router.get('/shipments/:id', authenticate, route(async (req, res) => {
  const shipment = await shipmentDetail(req.supabase, req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
  res.json(shipment);
}));

router.post('/shipments', authenticate, requireRole('admin'), route(async (req, res) => {
  if (!Array.isArray(req.body.batches) || !req.body.batches.length) throw httpError('At least one batch is required', 400);
  const batches = req.body.batches.map(item => ({
    batch_id: text(item.batch_id, 'Batch'),
    quantity: positiveInteger(item.quantity, 'Assigned quantity')
  }));
  const esp32DeviceId = req.body.esp32_device_id ? normalizeDeviceId(req.body.esp32_device_id) : null;
  const expectedDelivery = dateValue(req.body.expected_delivery_date, 'Expected delivery date');
  const dispatchDate = dateValue(req.body.dispatch_date, 'Dispatch date', true);
  if (dispatchDate && expectedDelivery <= dispatchDate) throw httpError('Expected delivery must be after dispatch', 400);
  await assertDeviceAvailable(createServiceClient() || req.supabase, esp32DeviceId);
  const shipment = unwrap(await req.supabase.rpc('create_shipment', {
    p_origin: text(req.body.origin, 'Origin'),
    p_destination: text(req.body.destination, 'Destination'),
    p_dispatch_date: dispatchDate,
    p_expected_delivery_date: expectedDelivery,
    p_assigned_personnel: text(req.body.assigned_personnel, 'Assigned personnel'),
    p_batches: batches,
    p_status: SHIPMENT_STATUSES.includes(req.body.status) ? req.body.status : 'Preparing'
  }));
  if (esp32DeviceId) {
    const assignmentResult = await (createServiceClient() || req.supabase).from('shipments')
      .update({ esp32_device_id: esp32DeviceId })
      .eq('id', shipment.id)
      .select('id')
      .single();
    if (isMissingDeviceAssignmentColumn(assignmentResult.error)) {
      throw httpError('Apply supabase/esp32-device-assignment-migration.sql before assigning ESP32 devices to shipments.', 409);
    }
    unwrap(assignmentResult);
  }
  res.status(201).json(await shipmentDetail(req.supabase, shipment.id));
}));

router.patch('/shipments/:id/status', authenticate, requireRole('admin', 'rider'), route(async (req, res) => {
  const shipment = await shipmentDetail(req.supabase, req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
  validateShipmentTransition(shipment.status, req.body.status, req.user.role);
  unwrap(await req.supabase.from('shipments').update({ status: req.body.status }).eq('id', req.params.id).select().single());
  res.json(await shipmentDetail(req.supabase, req.params.id));
}));

router.post('/shipments/:id/accept', authenticate, requireRole('rider'), route(async (req, res) => {
  const shipment = await shipmentDetail(req.supabase, req.params.id);
  if (!shipment) throw httpError('Shipment not found', 404);
  const riderName = req.user.email.split('@')[0].replace(/[._-]+/g, ' ').toLowerCase();
  if (!String(shipment.assigned_personnel || '').toLowerCase().includes(riderName)) throw httpError('This shipment is not assigned to you', 403);
  const writeClient = createServiceClient() || req.supabase;
  const assignment = unwrap(await writeClient.from('rider_assignments').upsert({ shipment_id: shipment.id, rider_id: req.user.id, status: 'Accepted', responded_at: new Date().toISOString(), rejection_reason: null }, { onConflict: 'shipment_id' }).select().single());
  await moveAcceptedShipmentToTransit(writeClient, shipment);
  const acceptedShipment = await shipmentDetail(writeClient, shipment.id);
  acceptedShipment.rider_assignment_status = 'Accepted';
  acceptedShipment.rider_assignment_responded_at = assignment.responded_at;
  acceptedShipment.rider_assignment_rejection_reason = null;
  res.json(acceptedShipment);
}));

router.post('/shipments/:id/reject', authenticate, requireRole('rider'), route(async (req, res) => {
  const reason = text(req.body.reason, 'Rejection reason', true, 500);
  const shipment = await shipmentDetail(req.supabase, req.params.id);
  if (!shipment) throw httpError('Shipment not found', 404);
  const riderName = req.user.email.split('@')[0].replace(/[._-]+/g, ' ').toLowerCase();
  if (!String(shipment.assigned_personnel || '').toLowerCase().includes(riderName)) throw httpError('This shipment is not assigned to you', 403);
  const writeClient = createServiceClient() || req.supabase;
  const assignment = unwrap(await writeClient.from('rider_assignments').upsert({ shipment_id: shipment.id, rider_id: req.user.id, status: 'Rejected', responded_at: new Date().toISOString(), rejection_reason: reason }, { onConflict: 'shipment_id' }).select().single());
  res.json(assignment);
}));

router.delete('/shipments/:id', authenticate, requireRole('admin'), route(async (req, res) => {
  const shipment = unwrap(await req.supabase.from('shipments').select('id, status').eq('id', req.params.id).single());
  if (shipment.status === 'Delivered') throw httpError('Delivered shipments are retained for delivery records and cannot be deleted.', 409);
  unwrap(await req.supabase.from('shipments').delete().eq('id', req.params.id).select('id').single());
  res.status(204).end();
}));

router.post('/shipments/:id/temperature', authenticate, requireRole('admin', 'staff'), route(async (req, res) => {
  res.status(201).json(await recordTemperature(req.supabase, req.params.id, req.body.temperature, req.body.recorded_at, 'manual'));
}));

router.post('/shipments/:id/gps', authenticate, requireRole('admin', 'staff'), route(async (req, res) => {
  res.status(201).json(await recordGps(req.supabase, req.params.id, req.body.latitude, req.body.longitude, req.body.recorded_at, 'manual'));
}));

router.post('/shipments/:id/delivery', authenticate, requireRole('rider'), route(async (req, res) => {
  const shipment = await shipmentDetail(req.supabase, req.params.id);
  const quantityReceived = positiveInteger(req.body.quantity_received, 'Quantity received', true);
  validateDeliveryConfirmation(shipment, quantityReceived);
  const statuses = ['Within range', 'Excursion detected', 'Not verified'];
  unwrap(await req.supabase.from('deliveries').insert({
    shipment_id: shipment.id,
    receiver: text(req.body.receiver, 'Receiver'),
    delivered_at: dateValue(req.body.delivered_at || new Date().toISOString(), 'Delivery date'),
    quantity_received: quantityReceived,
    condition: text(req.body.condition, 'Shipment condition'),
    temperature_status: statuses.includes(req.body.temperature_status) ? req.body.temperature_status : 'Not verified',
    confirmed_by: req.user.id
  }).select().single());
  res.status(201).json(await shipmentDetail(req.supabase, shipment.id));
}));

router.post('/shipments/:id/complete-delivery', authenticate, requireRole('rider'), route(async (req, res) => {
  const writeClient = createServiceClient() || req.supabase;
  let shipment = await shipmentDetail(writeClient, req.params.id);
  if (!shipment) throw httpError('Shipment not found', 404);
  if (req.user.role === 'rider') {
    const riderName = req.user.email.split('@')[0].replace(/[._-]+/g, ' ').toLowerCase();
    if (!String(shipment.assigned_personnel || '').toLowerCase().includes(riderName)) throw httpError('This shipment is not assigned to you', 403);
  }
  if (shipment.status === 'Delivered') throw httpError('Delivery has already been confirmed', 409);
  await moveShipmentToArrived(writeClient, shipment);
  shipment = await shipmentDetail(writeClient, req.params.id);
  const quantityReceived = positiveInteger(req.body.quantity_received, 'Quantity received', true);
  validateDeliveryConfirmation(shipment, quantityReceived);
  const statuses = ['Within range', 'Excursion detected', 'Not verified'];
  unwrap(await writeClient.from('deliveries').insert({
    shipment_id: shipment.id,
    receiver: text(req.body.receiver, 'Receiver'),
    delivered_at: dateValue(req.body.delivered_at || new Date().toISOString(), 'Delivery date'),
    quantity_received: quantityReceived,
    condition: text(req.body.condition, 'Shipment condition'),
    temperature_status: statuses.includes(req.body.temperature_status) ? req.body.temperature_status : 'Not verified',
    confirmed_by: req.user.id
  }).select().single());
  res.status(201).json(await shipmentDetail(writeClient, shipment.id));
}));

router.get('/alerts', authenticate, route(async (req, res) => {
  const alerts = unwrap(await req.supabase.from('alerts')
    .select('*, shipments!inner(tracking_code, origin, destination)')
    .order('status').order('recorded_at', { ascending: false }));
  const viewsByAlert = await alertViewsForUser(req.supabase, req.user.id, alerts.map(alert => alert.id));
  res.json(alerts.map(alert => ({ ...flattenShipment(alert), viewed_at: viewsByAlert.get(alert.id) || null })));
}));

router.post('/alerts/viewed', authenticate, route(async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.alert_ids) ? req.body.alert_ids : [])
    .map(id => String(id || '').trim())
    .filter(id => /^[a-f0-9-]{36}$/i.test(id)))]
    .slice(0, 100);
  if (!ids.length) return res.json({ viewed: 0 });
  const activeAlerts = unwrap(await req.supabase.from('alerts')
    .select('id')
    .eq('status', 'Active')
    .in('id', ids));
  const rows = activeAlerts.map(alert => ({
    alert_id: alert.id,
    user_id: req.user.id,
    viewed_at: new Date().toISOString()
  }));
  if (!rows.length) return res.json({ viewed: 0 });
  const result = await req.supabase.from('alert_views')
    .upsert(rows, { onConflict: 'alert_id,user_id' })
    .select('alert_id');
  if (result.error?.code === 'PGRST205') {
    throw httpError('Alert viewed tracking is not configured. Run supabase/alert-views-migration.sql first.', 503);
  }
  res.status(201).json({ viewed: unwrap(result).length });
}));

router.get('/map', authenticate, route(async (req, res) => {
  const shipments = await listShipments(req.supabase, true);
  res.json(shipments.filter(item => item.latitude !== null));
}));

router.get('/reports/:type', authenticate, requireRole('admin'), route(async (req, res) => {
  const views = {
    inventory: ['report_inventory', 'vaccine_name'],
    expiration: ['report_expiration', 'expiration_date'],
    shipments: ['report_shipments', 'created_at'],
    temperatures: ['report_temperatures', 'recorded_at'],
    deliveries: ['report_deliveries', 'delivered_at']
  };
  const report = views[req.params.type];
  if (!report) return res.status(404).json({ error: 'Report not found' });
  res.json(unwrap(await req.supabase.from(report[0]).select('*').order(report[1], { ascending: req.params.type === 'inventory' })));
}));

router.get('/tracking/:token', publicTrackingLimiter, route(async (req, res) => {
  const token = trackingToken(req.params.token);
  const data = unwrap(await createAnonymousClient().rpc('get_tracking_by_token', { p_token: token }));
  if (data.type === 'shipment') {
    data.shipment.batches = (data.shipment.batches || []).map(batch => ({ ...batch, assigned_quantity: batch.quantity }));
    data.shipment.total_quantity = data.shipment.batches.reduce((sum, batch) => sum + Number(batch.quantity), 0);
    data.shipment.active_alerts = 0;
    const range = data.shipment.batches.length
      ? {
        min_temperature: Math.max(...data.shipment.batches.map(batch => Number(batch.min_temperature))),
        max_temperature: Math.min(...data.shipment.batches.map(batch => Number(batch.max_temperature)))
      }
      : {};
    addTemperatureState(data.shipment, range);
  }
  res.json(data);
}));

router.get('/qr/:token', qrLimiter, route(async (req, res) => {
  const token = trackingToken(req.params.token);
  unwrap(await createAnonymousClient().rpc('get_tracking_by_token', { p_token: token }));
  const url = `${publicAppUrl()}/?track=${encodeURIComponent(token)}`;
  const png = await QRCode.toBuffer(url, { width: 420, margin: 2, color: { dark: '#062d55', light: '#ffffff' } });
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('png').send(png);
}));

module.exports = router;
