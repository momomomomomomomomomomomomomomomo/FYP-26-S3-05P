'use strict';
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('./config');
const db = require('./db');
const { attachUser, attachScope } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(cookieParser());

// A small set of hardening headers. Everything the page needs is served from
// this origin, so the content security policy can stay strict.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; "
    + "script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  next();
});

// Every request knows who is asking and what they may see.
app.use(attachUser);
app.use(attachScope);

// --- API ---------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', database: 'unreachable', error: err.message });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/content', require('./routes/content'));
app.use('/api/me', require('./routes/me'));
app.use('/api/children', require('./routes/children'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/admin', require('./routes/admin'));

// --- Front end ---------------------------------------------------------------
// `extensions: ['html']` lets /library serve public/library.html.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
  maxAge: config.env === 'production' ? '1h' : 0,
}));

app.use(notFound);

// Anything that is not an API call falls back to the home page.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(errorHandler);

// --- Boot --------------------------------------------------------------------
async function start() {
  try {
    await db.query('SELECT 1');
    console.log(`[db] connected to mysql://${config.db.host}:${config.db.port}/${config.db.database}`);
  } catch (err) {
    console.error('\n[db] Could not connect to MySQL.');
    console.error(`     ${err.message}`);
    console.error('     Check that MySQL is running and that .env matches your setup,');
    console.error('     then run `npm run db:setup` if you have not created the database yet.\n');
    process.exitCode = 1;
    return;
  }

  const server = app.listen(config.port, () => {
    console.log(`[web] StoryNest is running at http://localhost:${config.port}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[web] ${signal} received, shutting down.`);
    server.close(async () => {
      await db.pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) start();

module.exports = app;
