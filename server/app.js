const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const api = require('./api');
const hardware = require('./hardware');
const { apiLimiter } = require('./security');

function createApp() {
  const app = express();
  const root = path.join(__dirname, '..');
  const dist = path.join(root, 'dist');
  const production = process.env.NODE_ENV === 'production';
  const configuredOrigins = new Set((process.env.APP_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean));

  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

  app.disable('x-powered-by');
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: production ? undefined : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        upgradeInsecureRequests: production ? [] : null
      }
    }
  }));
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    const origin = req.get('origin');
    const localOrigin = !production && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
    const allowedOrigin = configuredOrigins.has(origin) || localOrigin;
    if (allowedOrigin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Device-Key');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.status(allowedOrigin ? 204 : 403).end();
    next();
  });

  app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'ThermaVax API' }));
  const noStore = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };
  app.use('/api/hardware', noStore, hardware);
  app.use('/api', apiLimiter, noStore, api);
  app.use('/assets', express.static(path.join(root, 'assets')));
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api(?:\/|$)).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const duplicate = error.code === '23505';
    const status = error.status || (duplicate ? 409 : 500);
    const message = duplicate
      ? 'A record with that unique value already exists'
      : status >= 500 && production ? 'Unexpected server error' : error.message || 'Request failed';
    if (status >= 500) console.error(error);
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = createApp;
