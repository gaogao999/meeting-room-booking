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

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Ensure the schema exists on every boot (safe: CREATE TABLE IF NOT EXISTS),
// then seed the default rooms if the table is empty. This guarantees the
// default rooms appear in any environment (e.g. a fresh Render deploy) without
// relying on a separate build/seed step.
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const { count } = db.prepare('SELECT COUNT(*) AS count FROM rooms').get();
if (count === 0) {
  const { insertDefaultRooms } = require('./defaultRooms');
  const inserted = insertDefaultRooms(db);
  console.log(`Seeded ${inserted} default room(s).`);
}

module.exports = db;
