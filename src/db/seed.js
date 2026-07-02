'use strict';

// Seed the default rooms explicitly.
// Run: npm run seed
// (Note: the app also auto-seeds these on startup when the rooms table is empty.)
const fs = require('fs');
const path = require('path');
const db = require('./index');
const { insertDefaultRooms } = require('./defaultRooms');

// Ensure tables exist (db/index.js already does this, but keep it explicit)
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const inserted = insertDefaultRooms(db);
console.log(`Seeded default rooms (${inserted} inserted).`);
