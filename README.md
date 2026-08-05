# Meeting Room Booking

Web app for booking company meeting rooms. Pick a date and time and only the rooms
free for that slot show up; the whole company's schedule is visible on a timeline.

Current version: v2.0.1. UI is in English.

The version shown in the app header comes from `package.json`, so bump it there
when releasing — it's how you confirm which build is actually deployed.

## Features

- Booking flow (`Booking` page) — choose a date and start/end time, then pick from
  the rooms actually available for that slot. Bookings are in 10-minute increments
  and record department and name. Department is a fixed list (`src/departments.js`
  — PE, EC, CD, PD, WH, QA, SALES, PUR, ACCT, BOI, GA.HR, IT) rather than free
  text, so the analytics don't fragment across spellings of the same team.
- Schedule — rooms as rows, time axis 8:00–20:00, bookings drawn as a Gantt-style
  chart. Click a bar for details, click empty space to start a booking there. A
  bar shows as much as it has room for: the full range, or the start time, or —
  for a half-hour booking, which is only 30px wide — the department code, since
  the grid already says when it is but not who has it.
- Booking window differs by department: HR (`GA.HR`) can book up to 6 months out
  (180 days), everyone else up to 3 months (90 days).
- No double-booking — the overlap check and the insert happen in one transaction
  under a per-room lock, so two people cannot take the same slot at once, and a
  trigger applies the same rule to anything written around the application.
- Analytics page — room utilization, usage by department, a day×hour heatmap,
  average duration, cancellation rate. `Export CSV` downloads the figures for
  the selected range (summary, per room, per department, and the heatmap as a
  weekday×hour grid). Written with a BOM and CRLF line endings so Excel opens it
  correctly, including non-ASCII department names.
- Bookings and the schedule are limited to business hours (8:00–20:00 by
  default), enforced server-side too, not just in the form.

## Tech stack

- Node.js 22 or newer / Express. Tested on 22 LTS and on 26; `.node-version`
  pins 22.22.2 for anything that reads it (nvm, fnm, asdf).
- HTML + Bootstrap 5.3.3, vendored under `public/vendor/` — no CDN dependency, no build step.
  The JS is the plain build, not the bundle: the app uses the modal and the
  dismissible alert, neither of which needs Popper. Adding a tooltip, dropdown or
  popover later means switching to `bootstrap.bundle.min.js`.
- SQL Server, accessed through Prisma — the company standard, on the KAGA server
- No login for now: department picked from a list, name typed once and remembered
  by the browser. Ready to switch to the existing `/checklogin`
- Config/secrets in `.env`

Runtime dependencies are `express`, `dotenv` and `@prisma/client`. The only
outbound connection the app makes is to the database.

## Setup

```bash
npm ci
cp .env.example .env      # then put the real DATABASE_URL in it
npm run db:deploy         # create/upgrade the tables
npm start
```

Then open http://localhost:3000 — the meeting rooms are registered automatically
on first start. `npm run dev` restarts on file changes.

`npm run db:deploy` is `prisma migrate deploy`: it applies any migration the
database has not seen and does nothing when there is nothing to apply, so it is
safe to run on every deployment. It only ever adds — no existing booking is
touched. `npm run db:push` is the shortcut Prisma offers for a scratch database;
prefer `db:deploy` anywhere that holds real bookings.

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
| `DATABASE_URL` | SQL Server connection string — required | — |
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

The schedule rings your own bookings and the detail panel says whether the
booking came from this computer or names who made it.

**A booking can only be cancelled from the computer that made it.** The server
refuses anything else with a 403 naming the person to ask, and the cancel button
is not shown at all for someone else's booking — a hidden button is not a rule,
so the rule lives on the server and the hiding is only there to save the click.

Two exceptions, both deliberate. A booking with no device recorded — made before
this rule existed, or from a script — can be cancelled by anyone, because
otherwise nothing could ever clear it. And once a real login exists the server
will know who is asking, so the rule will belong to the user rather than the
browser; today it applies to the no-login mode only.

What this does not do is stop impersonation: clearing browser storage makes a
new device, and someone who does that can book as anyone. It stops the misclick,
which with roughly one PC per person is the failure that actually happens.

The practical cost is that a booking cannot be cancelled on someone's behalf
while they are away. Whoever administers the database can clear it; there is no
in-app override, because without a login there is nobody to grant it to.

Cancellation is a soft delete (status becomes `cancelled`, the row stays for
analytics) so the slot frees up and it drops off the schedule but the history is
kept. `cancelled_at` and `cancelled_device` record when it happened and from
which browser — "who cancelled my meeting?" is the first thing anyone asks, and
overwriting the status alone could not answer it. `updated_at` moves on any
change.

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
| DELETE | `/api/bookings/:id` | Cancel booking. 403 unless `X-Device-Id` matches the one that created it |
| GET | `/api/stats?from=&to=` | Utilization stats for a date range |

## Deploying

The app runs on the KAGA server against the SQL Server there. It needs Node 22
or newer, network access to the database, and nothing else — no build tooling
beyond `prisma generate`, which `npm ci` runs for you.

```bash
npm ci              # installs and generates the Prisma client
npm run db:deploy   # applies any pending migration
npm start           # or however the server keeps it running
```

`/healthz` answers `{"ok":true}` once it is up, and `503` with
`{"ok":false}` whenever the database cannot be reached — it runs a query rather
than just confirming the process is alive, so a monitor watching it notices an
outage the app could not serve a single booking through. If the database goes
away and comes back, the app recovers on its own; it does not need restarting.

There is no longer a public demo. It ran on Render against a file database,
which this version no longer has; SQL Server is not something Render offers.
The KAGA deployment is the place to show it now.

## Operations: updating without losing bookings

The bookings live in SQL Server, not in the application folder, so replacing the
app wholesale cannot touch them. Backups are the database server's, which means
they are the DBA's existing routine rather than a second thing to remember.

Update procedure:

```bash
# swap in the new app files
npm ci
npm run db:deploy
# restart however you normally do (systemd / pm2 / Windows service)
```

Use `npm ci`, not `npm install`: it installs exactly what the lockfile says and
regenerates the Prisma client for the schema in this checkout, so the code and
the client can never be a version apart.

Schema changes ship as Prisma migrations under `prisma/migrations/`. Each runs
once, in a transaction, and only adds to what is there, so an update never means
recreating anything. `npm run db:deploy` applies whatever is pending and prints
`No pending migrations to apply.` when there is nothing to do. A migration that
has already been applied must not be edited — write a new one, or the database
that already ran it will silently disagree with the schema.

Backups are the database server's. `npm run backup` is gone with SQLite — the
bookings are in SQL Server now and whatever protects the rest of that instance
protects them too. Worth confirming with IT that this database is in their
backup set rather than assuming it.

## Project structure

```
prisma/
  schema.prisma              the tables, as Prisma sees them
  migrations/                versioned SQL, applied by `npm run db:deploy`
src/
  server.js               entry point, security headers, static files
  config.js                .env loading / config
  departments.js           the department list for the booking form
  db/
    index.js              Prisma client + room sync on boot
    roomCatalog.js        the room list + sync (edit this to change rooms)
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
```
