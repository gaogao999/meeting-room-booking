'use strict';

// Applies prisma/guards.sql — the constraints and the trigger that Prisma's
// schema language cannot express.
//
// Runs after both `npm run db:deploy` and `npm run db:push`, because a database
// can be built either way and both have to end up with the same rules. Every
// statement in the file checks before it acts, so running this again is a no-op.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const FILE = path.join(__dirname, '..', 'prisma', 'guards.sql');

// Split on blank-line-separated statements would be fragile with the trigger
// body in the middle, so the file is executed as one batch. SQL Server is happy
// with that as long as nothing needs its own batch — which is why the trigger
// goes through sp_executesql rather than needing a GO.
async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(fs.readFileSync(FILE, 'utf8'));
    const [{ n: checks }] = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS n FROM sys.check_constraints WHERE name LIKE 'bookings[_]%'"
    );
    const [{ n: triggers }] = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS n FROM sys.triggers WHERE name = 'bookings_no_overlap'"
    );
    console.log(`Integrity rules in place: ${checks} constraints, ${triggers} trigger.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\nCould not apply the integrity rules.');
  console.error(err.message);
  console.error(
    '\nThe application enforces these rules itself, so it will still run — but\n' +
      'anything writing to the database directly could then create a booking it\n' +
      'should not. The account in DATABASE_URL needs ALTER on dbo.bookings.\n'
  );
  process.exit(1);
});
