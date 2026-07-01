'use strict';

// Seed sample data.
// Run: npm run seed
const fs = require('fs');
const path = require('path');
const db = require('./index');

// Create tables if they do not exist yet
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const rooms = [
  { name: 'Conference Room A', location: 'HQ 3F', capacity: 20, description: 'Projector and whiteboard' },
  { name: 'Meeting Room B', location: 'HQ 3F', capacity: 10, description: 'Video conferencing system' },
  { name: 'Small Room C', location: 'HQ 4F', capacity: 4, description: 'For small groups' },
  { name: 'Reception Room', location: 'HQ 1F', capacity: 6, description: 'For visitors' },
];

const insert = db.prepare(
  'INSERT OR IGNORE INTO rooms (name, location, capacity, description) VALUES (@name, @location, @capacity, @description)'
);

const tx = db.transaction((list) => {
  for (const r of list) insert.run(r);
});
tx(rooms);

console.log(`Seeded sample rooms (${rooms.length}).`);
