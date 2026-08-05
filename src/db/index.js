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
async function init() {
  await prisma.$connect();
  const { syncRooms } = require('./roomCatalog');
  const summary = await syncRooms(prisma);
  for (const [action, names] of Object.entries(summary)) {
    if (names.length) console.log(`Rooms ${action}: ${names.join(', ')}`);
  }
}

module.exports = { prisma, init };
