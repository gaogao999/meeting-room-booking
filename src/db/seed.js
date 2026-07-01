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
  // Factory 1
  { name: 'Conference room 1', location: 'Factory 1', capacity: null, description: null },
  { name: 'Conference room 2', location: 'Factory 1', capacity: null, description: null },
  { name: 'Meeting space 1', location: 'Factory 1', capacity: null, description: null },
  { name: 'Meeting space 2', location: 'Factory 1', capacity: null, description: null },
  { name: 'Meeting space 3', location: 'Factory 1', capacity: null, description: null },
  // Factory 2
  { name: 'Conference room 1', location: 'Factory 2', capacity: null, description: null },
  { name: 'Meeting room 1', location: 'Factory 2', capacity: null, description: null },
  { name: 'Meeting room 2', location: 'Factory 2', capacity: null, description: null },
  { name: 'Meeting room 3', location: 'Factory 2', capacity: null, description: null },
];

const insert = db.prepare(
  'INSERT OR IGNORE INTO rooms (name, location, capacity, description) VALUES (@name, @location, @capacity, @description)'
);

const tx = db.transaction((list) => {
  for (const r of list) insert.run(r);
});
tx(rooms);

console.log(`Seeded sample rooms (${rooms.length}).`);
