'use strict';

const fs = require('fs');
const path = require('path');

// Schema migrations.
//
// Each migration runs exactly once per database, in order, inside a transaction.
// The applied version is tracked with SQLite's built-in `user_version` pragma,
// so upgrading an existing installation never requires recreating the database
// (i.e. existing bookings are preserved across app updates).
//
// To add a schema change in a future release, append a new entry with the next
// version number. Never edit or renumber an existing entry: databases that
// already applied it would silently skip the change.
const migrations = [
  {
    version: 1,
    name: 'baseline schema',
    up(db) {
      const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      db.exec(sql);
    },
  },
  {
    version: 2,
    name: 'record which device made a booking',
    up(db) {
      // Without a login, the browser that made a booking is the only thing that
      // ties it to a person. Used to tell someone their own booking apart from
      // everyone else's before they cancel it. The IP is recorded alongside but
      // never sent back to the browser — it is there for looking into a problem
      // after the fact, not for the screen.
      db.exec(`
        ALTER TABLE bookings ADD COLUMN device_id TEXT;
        ALTER TABLE bookings ADD COLUMN created_ip TEXT;
      `);
    },
  },
  {
    version: 3,
    name: 'index bookings by status and start time',
    up(db) {
      // The schedule and the analytics both ask for "confirmed bookings in this
      // date range, in time order", which was a full table scan and a sort —
      // the existing index leads with room_id and cannot answer it. This one
      // covers the filter, the range and the ordering.
      db.exec('CREATE INDEX IF NOT EXISTS idx_bookings_status_start ON bookings (status, start_at)');
    },
  },
];

// Apply any migrations newer than the database's current version.
// Returns the list of applied migration names (empty when already up to date).
function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  const applied = [];

  for (const m of pending) {
    // Each migration is atomic: a failure rolls back and leaves user_version
    // untouched, so a partially-applied schema is never persisted.
    const run = db.transaction(() => {
      m.up(db);
      // pragma cannot be parameterised; version is an integer literal we control.
      db.pragma(`user_version = ${m.version}`);
    });
    run();
    applied.push(`${m.version}: ${m.name}`);
  }

  return { from: current, to: latestVersion(), applied };
}

function latestVersion() {
  return migrations.reduce((max, m) => Math.max(max, m.version), 0);
}

module.exports = { migrate, latestVersion, migrations };
