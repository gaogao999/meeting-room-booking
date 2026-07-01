'use strict';

// Default rooms, used both by `npm run seed` and by the auto-seed on startup.
const DEFAULT_ROOMS = [
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

// Insert the default rooms (idempotent). Returns the number of rows inserted.
function insertDefaultRooms(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO rooms (name, location, capacity, description) VALUES (@name, @location, @capacity, @description)'
  );
  const tx = db.transaction((list) => {
    let n = 0;
    for (const r of list) n += insert.run(r).changes;
    return n;
  });
  return tx(DEFAULT_ROOMS);
}

module.exports = { DEFAULT_ROOMS, insertDefaultRooms };
