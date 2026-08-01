'use strict';

// better-sqlite3 ships a native binary tied to one Node major version. Hosts
// that cache node_modules between builds (Render does) can hand a tree built
// for an older Node to a newer runtime, and the app then dies on boot with
// "NODE_MODULE_VERSION 115 ... requires 127".
//
// npm ci avoids that by wiping node_modules, but the build command isn't always
// ours to control, so verify the binary actually loads here and rebuild it for
// the current Node if it doesn't. Runs as postinstall; a no-op on a clean install.
const { execSync } = require('child_process');

try {
  // The binary is dlopen'd when a Database is constructed, not on require,
  // so actually open one (in memory) to check it loads.
  new (require('better-sqlite3'))(':memory:').close();
} catch (err) {
  // Not installed at all (npm install --package-lock-only, for one) — nothing
  // to check, and failing here would fail the whole install.
  if (err.code === 'MODULE_NOT_FOUND') return;
  if (err.code !== 'ERR_DLOPEN_FAILED') throw err;

  console.log(
    `better-sqlite3 was built for a different Node version (running ${process.version}). Rebuilding...`
  );
  execSync('npm rebuild better-sqlite3', { stdio: 'inherit' });
  console.log('Rebuilt better-sqlite3.');
}
