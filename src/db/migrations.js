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
