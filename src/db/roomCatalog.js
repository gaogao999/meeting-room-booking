'use strict';

// The meeting rooms, as configured for this deployment.
//
// This list is the source of truth: rooms are not managed from the running app,
// they are changed here and picked up on the next deploy. On startup the
// database is reconciled against this list (see syncRooms below).
//
// To add, rename or adjust a room: edit this list, then deploy and restart.
// Rooms are identified by name + location, so renaming one is treated as
// removing the old room and adding a new one.
// The order here is the order everything shows in - the sites down the page and
// the rooms within a site. Neither is alphabetical, because neither is how
// anyone thinks about the building.
const ROOMS = [
  // Bang Na
  { name: 'Training Room', location: 'Bang Na', capacity: null, description: null },
  { name: 'Meeting Room 1', location: 'Bang Na', capacity: null, description: null },
  { name: 'Conference Room', location: 'Bang Na', capacity: null, description: null },
  { name: 'Meeting Room 2', location: 'Bang Na', capacity: null, description: null },
  { name: 'Meeting Room 3', location: 'Bang Na', capacity: null, description: null },
  { name: 'Meeting Room 4', location: 'Bang Na', capacity: null, description: null },
  // Amata F1
  { name: 'Conference Room 1st', location: 'Amata F1', capacity: null, description: null },
  { name: 'Guest Room 2nd', location: 'Amata F1', capacity: null, description: null },
  { name: 'Small meeting', location: 'Amata F1', capacity: null, description: null },
  // Amata F2
  { name: 'Conference Room', location: 'Amata F2', capacity: null, description: null },
  { name: 'Meeting Room 1', location: 'Amata F2', capacity: null, description: null },
  { name: 'Meeting Room 2', location: 'Amata F2', capacity: null, description: null },
  { name: 'Meeting Room 3', location: 'Amata F2', capacity: null, description: null },
  // Amata F3
  { name: 'Meeting Room 1', location: 'Amata F3', capacity: null, description: null },
  { name: 'Meeting Room 2', location: 'Amata F3', capacity: null, description: null },
];

const key = (r) => `${r.name} ${r.location || ''}`;

// Where a site and a room sit in the catalog, so the order written above is the
// order on screen. Anything no longer in the catalog - a room that was removed
// but still carries old bookings - sorts to the end rather than into the middle.
const LOCATION_RANK = new Map();
const ROOM_RANK = new Map();
for (const room of ROOMS) {
  const loc = room.location || '';
  if (!LOCATION_RANK.has(loc)) LOCATION_RANK.set(loc, LOCATION_RANK.size);
  ROOM_RANK.set(key(room), ROOM_RANK.size);
}

// The order the sites appear in, handed to the frontend through /api/config so
// there is one list - this one - rather than a copy in the browser that has to
// be remembered whenever a site is added or renamed.
const LOCATION_ORDER = [...LOCATION_RANK.keys()];

// Reconcile the rooms table with the catalog above.
//
// - in the catalog, missing from the database -> inserted
// - in both -> capacity/description updated, re-enabled if it had been disabled
// - in the database but no longer in the catalog -> disabled, never deleted,
//   since deleting cascades to its bookings and would destroy the history the
//   analytics are based on
//
// Returns a summary of what changed.
async function syncRooms(prisma) {
  const existing = await prisma.rooms.findMany();
  const byKey = new Map(existing.map((r) => [key(r), r]));
  const summary = { added: [], updated: [], disabled: [] };
  const catalogKeys = new Set();

  for (const room of ROOMS) {
    catalogKeys.add(key(room));
    const current = byKey.get(key(room));
    if (!current) {
      await prisma.rooms.create({ data: room });
      summary.added.push(room.name);
      continue;
    }
    const differs =
      current.capacity !== room.capacity ||
      current.description !== room.description ||
      current.is_active !== true;
    if (differs) {
      await prisma.rooms.update({
        where: { id: current.id },
        data: { capacity: room.capacity, description: room.description, is_active: true },
      });
      summary.updated.push(room.name);
    }
  }

  for (const room of existing) {
    if (!catalogKeys.has(key(room)) && room.is_active) {
      await prisma.rooms.update({ where: { id: room.id }, data: { is_active: false } });
      summary.disabled.push(room.name);
    }
  }

  return summary;
}

// Catalog order, for both the site and the room within it. Sorted in JavaScript
// rather than in the query: the order is a property of the catalog, not
// something the database knows, and fifteen rows is not worth expressing in SQL.
//
// It was alphabetical until the sites were named Bang Na and Amata F1-F3, which
// sorts the head office after the factories and "Meeting Room 2" before
// "Meeting Room1". Neither is how anyone reads the list.
const LAST = Number.MAX_SAFE_INTEGER;

function byLocationThenName(a, b) {
  const la = LOCATION_RANK.has(a.location || '') ? LOCATION_RANK.get(a.location || '') : LAST;
  const lb = LOCATION_RANK.has(b.location || '') ? LOCATION_RANK.get(b.location || '') : LAST;
  if (la !== lb) return la - lb;
  const ra = ROOM_RANK.has(key(a)) ? ROOM_RANK.get(key(a)) : LAST;
  const rb = ROOM_RANK.has(key(b)) ? ROOM_RANK.get(key(b)) : LAST;
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name);
}

module.exports = { ROOMS, LOCATION_ORDER, syncRooms, byLocationThenName };
