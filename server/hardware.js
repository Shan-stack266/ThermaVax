const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const { createServiceClient } = require('./supabase');
const { recordTemperature, recordGps } = require('./sensorService');
const { hardwareLimiter } = require('./security');

const router = express.Router();
router.use(hardwareLimiter);

function validDeviceKey(provided) {
  const expected = process.env.THERMAVAX_DEVICE_KEY;
  if (!expected) return false;
  const candidate = String(provided || '');
  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
}

router.use((req, res, next) => {
  if (!validDeviceKey(req.get('x-device-key'))) return res.status(401).json({ error: 'Invalid device key' });
  req.supabase = createServiceClient();
  if (!req.supabase) {
    return res.status(503).json({ error: 'Hardware ingestion requires SUPABASE_SECRET_KEY on the server' });
  }
  next();
});

router.post('/temperature', async (req, res, next) => {
  try {
    const reading = await recordTemperature(req.supabase, req.body.shipment_id || req.body.tracking_code,
      req.body.temperature, req.body.recorded_at, 'esp32', req.body.temperature_status);
    res.status(201).json(reading);
  } catch (error) { next(error); }
});

router.post('/gps', async (req, res, next) => {
  try {
    const reading = await recordGps(req.supabase, req.body.shipment_id || req.body.tracking_code,
      req.body.latitude, req.body.longitude, req.body.recorded_at, 'esp32');
    res.status(201).json(reading);
  } catch (error) { next(error); }
});

module.exports = router;
