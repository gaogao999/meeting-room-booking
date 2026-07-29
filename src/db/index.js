'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');

const appDir = path.resolve(__dirname, '..', '..');

function ensureWritableDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
}

// Resolve where the database lives.
//
// The default sits outside the app directory so that redeploying (which replaces
// that directory) can't delete the bookings. On some hosts the parent directory
// isn't writable, though, so fall back to a directory inside the app rather than
// failing to boot — a running app with a warning beats a crash loop.
//
// An explicitly configured DB_PATH is never relocated: silently writing the data
// somewhere other than where it was asked to go would be worse than stopping.
function resolveDbPath() {
  const configured = path.resolve(process.cwd(), config.dbPath);
  try {
    ensureWritableDir(path.dirname(configured));
    return configured;
  } catch (err) {
    if (process.env.DB_PATH) {
      throw new Error(
        `Cannot use DB_PATH (${configured}): ${err.message}. ` +
          'Point it at a directory the app can write to.'
      );
    }
    const fallback = path.join(appDir, 'data', 'booking.db');
    ensureWritableDir(path.dirname(fallback));
    console.warn(
      `\nWARNING: could not use ${path.dirname(configured)} (${err.code || err.message}).\n` +
        `Falling back to ${path.dirname(fallback)}, inside the app directory.\n` +
        'A deploy that replaces the app directory will delete the bookings stored there.\n' +
        'Set DB_PATH to a writable location outside the app directory to avoid that.\n'
    );
    return fallback;
  }
}

const dbPath = resolveDbPath();

// Warn if the database ended up inside the app directory by explicit
// configuration, for the same reason as above.
if (process.env.DB_PATH && dbPath.startsWith(appDir + path.sep)) {
  console.warn(
    `\nWARNING: the database is inside the application directory:\n   ${dbPath}\n` +
      '   A deploy that replaces this directory will delete the bookings.\n'
  );
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Bring the schema up to date on every boot. Migrations are incremental and
// only ever add to the existing database, so updating the app preserves the
// bookings already stored in it.
const { migrate } = require('./migrations');
const result = migrate(db);
if (result.applied.length) {
  console.log(`Database migrated ${result.from} -> ${result.to}: ${result.applied.join(', ')}`);
}

// Rooms are configured in code (src/db/roomCatalog.js), not managed from the
// running app, so bring the table in line with that list on every boot. This is
// what makes "edit the catalog, deploy, restart" the way to add or change rooms.
const { syncRooms } = require('./roomCatalog');
const rooms = syncRooms(db);
for (const [action, names] of Object.entries(rooms)) {
  if (names.length) console.log(`Rooms ${action}: ${names.join(', ')}`);
}

module.exports = db;
