# Meeting Room Booking

Web app for booking company meeting rooms. Pick a date and time and only the rooms
free for that slot show up; the whole company's schedule is visible on a timeline.

Current version: v1.7.1. UI is in English.

The version shown in the app header comes from `package.json`, so bump it there
when releasing — it's how you confirm which build is actually deployed.

## Features

- Booking flow (`Booking` page) — choose a date and start/end time, then pick from
  the rooms actually available for that slot. Bookings are in 10-minute increments
  and record department and name. Department is a fixed list (`src/departments.js`
  — PE, EC, CD, PD, WH, QA, SALES, PUR, ACCT, BOI, GA.HR, IT) rather than free
  text, so the analytics don't fragment across spellings of the same team.
- Schedule — rooms as rows, time axis 8:00–20:00, bookings drawn as a Gantt-style
  chart. Click a bar for details, click empty space to start a booking there.
- Booking window differs by department: HR (`GA.HR`) can book up to 6 months out
  (180 days), everyone else up to 3 months (90 days).
- No double-booking — overlap check and insert happen in one transaction, so two
  people can't grab the same slot at once.
- Analytics page — room utilization, usage by department, a day×hour heatmap,
  average duration, cancellation rate. `Export CSV` downloads the figures for
  the selected range (summary, per room, per department, and the heatmap as a
  weekday×hour grid). Written with a BOM and CRLF line endings so Excel opens it
  correctly, including non-ASCII department names.
- Bookings and the schedule are limited to business hours (8:00–20:00 by
  default), enforced server-side too, not just in the form.

## Tech stack

- Node.js 22 or newer / Express. Tested on 22 LTS and on 26; `.node-version` pins
  22.22.2 for the Render deploy, which is the only place that file is read.
- HTML + Bootstrap 5.3.3, vendored under `public/vendor/` — no CDN dependency, no build step
- SQLite via better-sqlite3
- No login for now: department picked from a list, name typed once and remembered
  by the browser. Ready to switch to the existing `/checklogin`
- Config/secrets in `.env`

Runtime dependencies are just `express`, `dotenv`, `better-sqlite3` — nothing else,
no outbound network calls.

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Then open http://localhost:3000 — rooms are created automatically on first run.
`npm run dev` restarts on file changes.

## Rooms

Rooms are configured in code, in `src/db/roomCatalog.js`, and are not editable
from the running app. The Rooms page lists what's configured but is read-only,
and there is no write API, so nobody can rename or remove a room by accident and
the app needs no permission model to protect it.

Currently:

| Location | Rooms |
| --- | --- |
| Bangna Office | Meeting room 1 / Meeting room 2 / Meeting room 3 |
| Factory 1 | Conference room 1 / Conference room 2 / Meeting space 1 / Meeting space 2 / Meeting space 3 |
| Factory 2 | Conference room 1 / Meeting room 1 / Meeting room 2 / Meeting room 3 |
| Factory 3 | Conference room 1 |

To change them, edit the catalog and deploy. On startup the database is
reconciled against the list: new entries are added, capacity/description changes
are applied, and a room dropped from the catalog is disabled rather than deleted,
so it disappears from booking and the schedule while its past bookings stay in
the analytics. Restarting with no catalog change does nothing. The startup log
says what changed (`Rooms added: …`, `Rooms disabled: …`).

Rooms are identified by name + location, so renaming one is treated as removing
the old and adding a new one — the old room's bookings stay under the old name.
Names only need to be unique within a location, which is why "Conference room 1"
can exist in both factories.

## Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | Listen port | 3000 |
| `NODE_ENV` | Read by Express itself, not by this app's config | development |
| `DB_PATH` | SQLite file path — normally leave unset, see Operations below | auto |
| `BACKUP_DIR` | Where `npm run backup` writes to | ./backups |
| `BACKUP_KEEP` | How many backups to keep | 14 |
| `AUTH_MODE` | `mock` (no login) or `checklogin` | mock |
| `TRUST_PROXY` | Set when a reverse proxy is in front, so the recorded IP is the client's | off |
| `SLOT_MINUTES` | Booking increment | 10 |
| `BUSINESS_START_HOUR` / `BUSINESS_END_HOUR` | Bookable hours | 8 / 20 |
| `BOOKING_WINDOW_DEFAULT_DAYS` / `BOOKING_WINDOW_HR_DAYS` | Booking window, days ahead | 90 / 180 |
| `HR_DEPARTMENTS` | Departments counted as HR, comma-separated, case-insensitive substring match against `src/departments.js` | GA.HR,HR |

## Authentication

`AUTH_MODE=mock` is the no-login mode it currently runs in: whoever is booking
picks their department and types their name, and the browser keeps both in
`localStorage` so they only do it once per device. Nothing is filed under a
placeholder — an empty department or name is rejected rather than defaulted.

`AUTH_MODE=checklogin` takes the user from `X-User-Name` / `X-User-Department`
request headers, on the assumption a reverse proxy sets them, and the form
switches to read-only so the booking is filed under the logged-in user. Calling
the existing `/checklogin` directly is still to be written, in
`src/middleware/auth.js`. The frontend already handles both, keyed off the `mode`
returned by `/api/auth/me`, so turning login on is a server-side change only.

Until then anyone on the network can book as anyone, and the department-based
booking window is effectively self-declared. That is a deliberate trade: it
replaces a whiteboard, which had no identity check either.

One thing to know before wiring that up: cookies are not scoped by port, so two
Express apps on the same host share a cookie namespace even on different ports.
If this app ever adds `express-session`, it must set a distinct cookie name
(`mrb.sid`, say) — leaving the default `connect.sid` would overwrite the session
cookie of any other Express app on the same host and silently log its users out.
As it stands the app sets no cookies at all, so there is nothing to collide.

### Whose booking is whose, without a login

The browser generates an id for itself on first use and sends it with every
request. The server stores it against the booking and tells each browser which
bookings are its own — it never sends anyone else's id back, so the id is not
something one user can learn about another.

The schedule rings your own bookings, the detail panel says whether the booking
came from this device or names who made it, and the cancel button reads `Cancel
my booking` or `Cancel Somchai's booking` accordingly. Cancelling your own asks
once; cancelling someone else's names them and asks twice.

This stops accidents, not impersonation — clearing browser storage is enough to
become a new device, and cancellation is still unrestricted server-side. That is
the trade for having no login: with roughly one PC per person the id behaves like
an identity, and the failure it actually prevents is the misclick. Real
enforcement waits for `/checklogin`.

Cancellation is a soft delete (status becomes `cancelled`, the row stays for
analytics) so the slot frees up and it drops off the schedule but the history is
kept.

The requester's IP is recorded on each booking as well. It is never returned to
any browser and appears on no screen; it exists so a problem can be looked into
after the fact. Behind a reverse proxy set `TRUST_PROXY` or every booking records
the proxy's address.

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/config` | Booking rules, business hours, the department list, version |
| GET | `/api/auth/me` | Logged-in user |
| GET | `/api/rooms` | List rooms (`?all=1` includes disabled). Read-only — rooms come from the catalog |
| GET | `/api/availability?start_at=&end_at=` | Which rooms are free for a slot. Taken rooms come back with a conflict count, not the bookings themselves |
| GET | `/api/bookings` | List bookings (`room_id` / `from` / `to` / `status`; confirmed only unless `status=all`). With no `from` and no `to` it returns the last 30 days through the end of the booking window rather than everything ever booked |
| POST | `/api/bookings` | Create booking |
| PUT | `/api/bookings/:id` | Update booking |
| DELETE | `/api/bookings/:id` | Cancel booking |
| GET | `/api/stats?from=&to=` | Utilization stats for a date range |

## Deploying to Render (free plan)

Needs a backend (Express + SQLite), so static hosting won't work. Use the included
`render.yaml`:

1. dashboard.render.com → New → Blueprint
2. pick this repo
3. it's live at `https://<service-name>.onrender.com` a few minutes later

Node version is pinned via `.node-version` so better-sqlite3 gets a prebuilt
binary instead of compiling. The free plan sleeps when idle and its disk is
ephemeral — bookings reset on redeploy/wake and default rooms get reseeded. For
persistence, add a paid Render Disk and point `DB_PATH` at the mounted path.

## Security

No dependency does this — it is a middleware and a few validation rules.

Every response carries a Content-Security-Policy of `self`, plus `nosniff`,
`X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. The policy is
possible because nothing loads from anywhere else: no CDN, no fonts, no
analytics. Inline styles are allowed (the timeline positions its bars with style
attributes); inline scripts are not, which is the half that keeps injected
markup from running. `X-Powered-By` is off.

Everything a user types is escaped on the way into the page, and every query is
parameterised — the payloads worth trying (`'; DROP TABLE bookings;--` and
friends) are stored and displayed as the text they are. Request bodies are
capped at 32kb and department, name and purpose have length limits, so a booking
cannot be used to park a large blob in the database. Unexpected 500s log their
detail and return a generic message.

What is deliberately open: there is no login, so anyone who can reach the port
can book and can cancel. See Authentication above.

## Performance

At around 9,000 bookings — a year of real use — a day of the schedule comes back
in about 3ms, the availability check in about 2ms, and a month of analytics in
about 4ms.

What that rests on: `idx_bookings_status_start` covers the "confirmed bookings
in this range, in time order" question that the schedule and the analytics both
ask, so neither scans the table. The analytics compare `start_at` as a range
rather than wrapping it in `substr()`, which would have made the index unusable.
Availability asks one grouped question instead of one query per room. Bootstrap
is served with a long cache lifetime while the app's own files stay on
revalidation, so a deploy takes effect on the next page load.

## Operations: updating without losing bookings

The database defaults to a sibling directory next to the app folder —
`meeting-room-booking-data/booking.db` sitting alongside `meeting-room-booking/` —
computed from where the app itself is installed. No config needed, and it means a
routine "swap in the new version" deploy, which replaces the app directory
wholesale, never touches the data. Only set `DB_PATH` if you actually want the
file somewhere specific; if it ever resolves back inside the app directory the
app prints a warning on startup so that doesn't happen silently.

Update procedure:

```bash
npm run backup      # snapshot, safe to run while serving traffic
# swap in the new app files
npm ci
# restart however you normally do (systemd / pm2 / container)
```

Use `npm ci`, not `npm install`. better-sqlite3 ships a native binary built for
a specific Node major version, and `npm install` will happily leave an existing
`node_modules` in place — so after a Node upgrade the app starts and then dies
with `NODE_MODULE_VERSION 115 ... requires 127`. `npm ci` wipes `node_modules`
first, so the binary always matches the Node actually running it.

That binary is also the one thing tied to the Node version, so it decides which
Node the app runs on. better-sqlite3 13 publishes prebuilt binaries for Node 22
through 26 — installs take seconds and need no compiler. Going back to an older
better-sqlite3, or forward to a Node it has no prebuild for, means falling back
to building from source, which needs a toolchain on the server and fails outright
on a Node whose V8 API the older release predates.

No manual database step. Schema changes ship as migrations tracked by SQLite's
`user_version` — each one runs once, in a transaction, and only adds to what's
there, so an update never means recreating the database. The log line on boot
(`Database migrated 1 -> 2`) tells you it ran. Adding a schema change later means
appending a new entry to `src/db/migrations.js`; existing entries shouldn't be
edited or renumbered, since a database that already applied one would just skip it.

`npm run init-db` prints the schema version the database is at and the version
the code expects — a quick way to confirm an update actually applied. It creates
the database if it isn't there yet, and is safe to run against one that already
holds bookings.

Backups (`npm run backup`) use SQLite's online backup API, so they're consistent
even while the app is live — fine to put on a cron job. Old ones beyond
`BACKUP_KEEP` get pruned automatically. To restore, stop the app, copy a backup
over `DB_PATH`, start it back up.

## Project structure

```
src/
  server.js               entry point, security headers, static files
  config.js                .env loading / config
  departments.js           the department list for the booking form
  db/
    index.js              connection, migrations, room sync on boot
    migrations.js         schema migrations (user_version)
    schema.sql             baseline schema
    roomCatalog.js        the room list + sync (edit this to change rooms)
    init.js                 report/apply schema version
    backup.js               timestamped backup + retention
  middleware/auth.js       mock / checklogin
  routes/
    auth.js, rooms.js (read-only), bookings.js, availability.js, stats.js
  services/
    bookingRules.js         slot/hours/window/length validation
public/
  common.js                 helpers shared by all three pages
  index.html / app.js       booking + schedule + availability
  rooms.html / rooms.js     room list (read-only)
  stats.html / stats.js     analytics
  timeline.css               all the styling
  favicon.svg
  vendor/                    Bootstrap 5
scripts/
  ensure-native-module.js   postinstall check that better-sqlite3 loads
```
