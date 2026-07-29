'use strict';

// Create a timestamped backup of the database.
// Run: npm run backup   (safe to run while the app is serving traffic)
//
// Uses SQLite's online backup API, which produces a consistent copy even while
// the database is being written to — so this can be scheduled with cron.
const fs = require('fs');
const path = require('path');
const db = require('./index');
const config = require('../config');

function pad(n) {
  return String(n).padStart(2, '0');
}

function stamp(d) {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function main() {
  const dir = path.resolve(process.cwd(), config.backup.dir);
  fs.mkdirSync(dir, { recursive: true });

  const dest = path.join(dir, `booking-${stamp(new Date())}.db`);
  await db.backup(dest);
  const { size } = fs.statSync(dest);
  console.log(`Backup written: ${dest} (${(size / 1024).toFixed(1)} KB)`);

  // Retention: keep only the newest N backups so the disk cannot fill up.
  const keep = config.backup.keep;
  if (keep > 0) {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^booking-\d{8}-\d{6}\.db$/.test(f))
      .sort()
      .reverse();
    for (const stale of files.slice(keep)) {
      fs.unlinkSync(path.join(dir, stale));
      console.log(`Removed old backup: ${stale}`);
    }
  }
}

main().catch((err) => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
