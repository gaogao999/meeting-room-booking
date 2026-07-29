'use strict';

// Bring the database schema up to date (creates it if missing).
// Run: npm run init-db
//
// Requiring ./index already applies any pending migrations, so this script just
// reports the resulting version. It is safe to run against a database that
// already contains bookings: migrations only add to it.
const db = require('./index');
const { latestVersion } = require('./migrations');

const version = db.pragma('user_version', { simple: true });
console.log(`Database schema is at version ${version} (latest: ${latestVersion()}).`);
