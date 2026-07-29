'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');

const dbPath = path.resolve(process.cwd(), config.dbPath);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Safety net: warn loudly if the database ended up inside the app directory
// (e.g. DB_PATH was overridden to a relative path). A deploy that replaces the
// app directory wholesale would delete it from there. This should not happen
// with the default configuration, which resolves outside the app directory.
const appDir = path.resolve(__dirname, '..', '..');
if (dbPath.startsWith(appDir + path.sep)) {
  console.warn(
    '\n⚠️  WARNING: the database file is inside the application directory:\n' +
      `   ${dbPath}\n` +
      '   A deployment that replaces this directory will delete your booking data.\n' +
      '   Set DB_PATH to a location outside the app directory (see .env.example).\n'
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

// Seed the default rooms on a brand new database (empty rooms table) so the app
// is usable immediately without a separate seed step.
const { count } = db.prepare('SELECT COUNT(*) AS count FROM rooms').get();
if (count === 0) {
  const { insertDefaultRooms } = require('./defaultRooms');
  const inserted = insertDefaultRooms(db);
  console.log(`Seeded ${inserted} default room(s).`);
}

module.exports = db;
