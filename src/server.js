'use strict';

const path = require('path');
const express = require('express');
const config = require('./config');
const { prisma } = require('./db');
const { authenticate } = require('./middleware/auth');

const app = express();

// Nothing gains from advertising the framework and version to whoever asks.
app.disable('x-powered-by');

// Behind a reverse proxy every request otherwise looks like it came from the
// proxy, which would make the recorded IP useless. Off by default because
// trusting the header when there is no proxy in front lets a client claim any
// address it likes. Set TRUST_PROXY=1 (or a hop count) when one is in front.
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

// A booking is a few hundred bytes; the default 100kb ceiling is far more than
// this app ever needs to accept.
app.use(express.json({ limit: '32kb' }));

// Everything the page needs is served from this origin — no CDN, no external
// fonts, no analytics — so the policy can simply be "self". Inline styles are
// allowed because the markup positions timeline bars with style attributes;
// inline *scripts* are not, which is the half that stops injected markup from
// executing. frame-ancestors keeps the app out of other sites' frames.
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; form-action 'self'; " +
      "base-uri 'self'; frame-ancestors 'none'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// 静的ファイル（フロントエンド）
// Bootstrap only changes when the app is redeployed with a new copy of it, so
// it is worth caching properly. The app's own files stay on revalidation, so a
// deploy takes effect on the next page load rather than whenever a cache
// happens to expire.
app.use(
  '/vendor',
  express.static(path.join(__dirname, '..', 'public', 'vendor'), { maxAge: '7d', immutable: true })
);
app.use(express.static(path.join(__dirname, '..', 'public')));

// ヘルスチェック
//
// Answers for the database, not just for the process. Without the query this
// returned ok while every booking screen was failing, so anything watching it
// would have reported the app healthy through an outage it could not serve a
// single request during.
app.get('/healthz', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'Database unreachable.' });
  }
});

// 認証（開発中はモック）。API 全体に適用する。
app.use('/api', authenticate);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/availability', require('./routes/availability'));
app.use('/api/people', require('./routes/people'));
app.use('/api/stats', require('./routes/stats'));

// Settings used by the frontend (booking rules, business hours, version)
app.get('/api/config', (req, res) => {
  res.json({
    version: config.version,
    slotMinutes: config.booking.slotMinutes,
    businessStartHour: config.booking.businessStartHour,
    businessEndHour: config.booking.businessEndHour,
    windowDefaultDays: config.booking.windowDefaultDays,
    windowHrDays: config.booking.windowHrDays,
    hrDepartments: config.booking.hrDepartments,
    departments: config.booking.departments,
  });
});

// 404
app.use('/api', (req, res) => res.status(404).json({ error: 'Not Found' }));

// The database being unreachable is not a bug in the app and it is not the
// user's fault, so it should not read as either. Prisma reports it with its own
// codes; anything in this set means the server could not be talked to rather
// than that the query was wrong.
const DB_UNREACHABLE = new Set(['P1000', 'P1001', 'P1002', 'P1008', 'P1010', 'P1017']);

function dbUnreachable(err) {
  return (
    err?.name === 'PrismaClientInitializationError' ||
    DB_UNREACHABLE.has(err?.errorCode) ||
    DB_UNREACHABLE.has(err?.code)
  );
}

// エラーハンドラ
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (dbUnreachable(err)) {
    return res.status(503).json({
      error: 'The booking system cannot reach its database. Please try again in a moment — if it keeps happening, tell IT.',
    });
  }
  const status = err.status || 500;
  // 4xx messages are ours and meant to be read. Anything else is an unexpected
  // failure whose message may describe the internals, so it stays in the log.
  const message = status < 500 ? err.message : 'Internal server error.';
  res.status(status).json({ error: message || 'Internal server error.' });
});

if (require.main === module) {
  // Connect and reconcile the room list before accepting traffic — a request
  // arriving before the rooms are in place would show an empty schedule.
  const { init } = require('./db');
  init()
    .then(() => {
      app.listen(config.port, () => {
        console.log(`Meeting Room Booking started: http://localhost:${config.port}`);
        console.log(`Auth mode: ${config.auth.mode}`);
      });
    })
    .catch((err) => {
      console.error('\nCould not start: the database is not reachable.');
      console.error(err.message);
      console.error('\nCheck DATABASE_URL in .env, and that this machine can reach the server.\n');
      process.exit(1);
    });
}

module.exports = app;
