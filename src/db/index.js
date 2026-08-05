'use strict';

const { PrismaClient } = require('@prisma/client');

// One client for the process. Prisma pools connections internally, so a second
// client would just open a second pool against the same server.
const prisma = new PrismaClient();

// Rooms are configured in code (src/db/roomCatalog.js), not managed from the
// running app, so bring the table in line with that list on every boot. This is
// what makes "edit the catalog, deploy, restart" the way to add or change rooms.
//
// The schema itself is deliberately not touched here — that is
// `npx prisma migrate deploy`, run as a step of the deployment. An app quietly
// altering the shape of a shared database on startup is what a DBA does not
// want, and on SQL Server the database is not ours alone.
// The constraints and the trigger come from prisma/guards.sql, applied by
// `npm run db:deploy` or `npm run db:push`. Someone running `npx prisma db push`
// on its own gets the tables without them, and nothing would say so — the app
// keeps working, because it checks these rules itself, and only something
// writing to the database directly would notice. So say so, once, at startup.
//
// A warning rather than a refusal to start: the missing rules are a second line
// of defence, and a booking screen that will not open is worse than one whose
// database is merely less strict than it should be.
async function checkGuards() {
  try {
    const [{ n: checks }] = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS n FROM sys.check_constraints WHERE name LIKE 'bookings[_]%'"
    );
    const [{ n: triggers }] = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS n FROM sys.triggers WHERE name = 'bookings_no_overlap'"
    );
    if (checks >= 4 && triggers >= 1) return;
    console.warn(
      `\nWARNING: the database is missing its integrity rules ` +
        `(${checks}/4 constraints, ${triggers}/1 trigger).\n` +
        'Anything writing to it directly could create an overlapping or malformed\n' +
        'booking. Run: npm run db:guards\n'
    );
  } catch (err) {
    // Not being able to read the catalogue views is not a reason to stay down.
    console.warn(`Could not verify the database integrity rules: ${err.message}`);
  }
}

async function init() {
  await prisma.$connect();
  await checkGuards();
  const { syncRooms } = require('./roomCatalog');
  const summary = await syncRooms(prisma);
  for (const [action, names] of Object.entries(summary)) {
    if (names.length) console.log(`Rooms ${action}: ${names.join(', ')}`);
  }
}

module.exports = { prisma, init };
