
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');

const api = require('./server/api');
const hardware = require('./server/hardware');
const { apiLimiter } = require('./server/security');

// ============================================
// THERMAVAX SERVER CONFIGURATION
// ============================================

const app = express();

const port = Number(process.env.PORT) || 3000;
const root = __dirname;
const dist = path.join(root, 'dist');

const production = process.env.NODE_ENV === 'production';

const configuredOrigins = new Set(
  (process.env.APP_ORIGIN || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);

// ============================================
// PROXY CONFIGURATION
// ============================================

if (process.env.TRUST_PROXY) {
  app.set(
    'trust proxy',
    Number(process.env.TRUST_PROXY) ||
      process.env.TRUST_PROXY
  );
}

// ============================================
// SECURITY CONFIGURATION
// ============================================

app.disable('x-powered-by');

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,

    strictTransportSecurity: production
      ? undefined
      : false,

    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        baseUri: ["'self'"],

        connectSrc: ["'self'"],

        fontSrc: [
          "'self'",
          'https://fonts.gstatic.com',
          'data:'
        ],

        formAction: ["'self'"],

        frameAncestors: ["'none'"],

        imgSrc: [
          "'self'",
          'data:',
          'https://*.tile.openstreetmap.org'
        ],

        objectSrc: ["'none'"],

        scriptSrc: ["'self'"],

        scriptSrcAttr: ["'none'"],

        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com'
        ],

        upgradeInsecureRequests: production
          ? []
          : null
      }
    }
  })
);

// ============================================
// JSON BODY PARSER
// ============================================

app.use(
  express.json({
    limit: '256kb'
  })
);

// ============================================
// CORS CONFIGURATION
// ============================================

app.use((req, res, next) => {
  const origin = req.get('origin');

  const localOrigin =
    !production &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
      origin || ''
    );

  const allowedOrigin =
    configuredOrigins.has(origin) || localOrigin;

  if (allowedOrigin) {
    res.set(
      'Access-Control-Allow-Origin',
      origin
    );

    res.set('Vary', 'Origin');

    res.set(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Device-Key'
    );

    res.set(
      'Access-Control-Allow-Methods',
      'GET, POST, PATCH, DELETE, OPTIONS'
    );
  }

  if (req.method === 'OPTIONS') {
    return res
      .status(allowedOrigin ? 204 : 403)
      .end();
  }

  next();
});

// ============================================
// API HEALTH CHECK
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ThermaVax API'
  });
});

// ============================================
// DISABLE API RESPONSE CACHING
// ============================================

const noStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

// ============================================
// ESP32 HARDWARE ROUTES
// ============================================

app.use(
  '/api/hardware',
  noStore,
  hardware
);

// ============================================
// MAIN API ROUTES
// ============================================

app.use(
  '/api',
  apiLimiter,
  noStore,
  api
);

// ============================================
// STATIC ASSETS
// ============================================

app.use(
  '/assets',
  express.static(
    path.join(root, 'assets')
  )
);

// ============================================
// REACT / VITE FRONTEND
// ============================================

if (fs.existsSync(dist)) {
  app.use(
    express.static(dist)
  );

  app.get(
    /^(?!\/api(?:\/|$)).*/,
    (req, res) => {
      res.sendFile(
        path.join(dist, 'index.html')
      );
    }
  );
}

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const duplicate = error.code === '23505';

  const status =
    error.status ||
    (duplicate ? 409 : 500);

  const message = duplicate
    ? 'A record with that unique value already exists'
    : status >= 500 && production
      ? 'Unexpected server error'
      : error.message || 'Request failed';

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({
    error: message
  });
});

// ============================================
// EXPORT EXPRESS APP FOR VERCEL
// ============================================

module.exports = app;

// ============================================
// LOCAL SERVER STARTUP
// ============================================

if (require.main === module) {
  app.listen(port, () => {
    console.log('================================');
    console.log('THERMAVAX SERVER RUNNING');
    console.log(`URL: http://localhost:${port}`);
    console.log('Database: Supabase');
    console.log('================================');
  });
}
