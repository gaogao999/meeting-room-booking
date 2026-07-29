# Meeting Room Booking

Web app for booking company meeting rooms. Pick a date and time and only the rooms
free for that slot show up; the whole company's schedule is visible on a timeline.

Current version: v1.2.0. UI is in English.

The version shown in the app header comes from `package.json`, so bump it there
when releasing — it's how you confirm which build is actually deployed.

## Features

- Booking flow (`Booking` page) — choose a date and start/end time, pick from the
  rooms actually available for that slot, department and name are pre-filled from
  the logged-in user. Bookings are in 10-minute increments and record department
  and name.
- Schedule — rooms as rows, time axis 07:00–21:00, bookings drawn as a Gantt-style
  chart. Click a bar for details, click empty space to start a booking there.
- Booking window differs by department: HR departments can book up to 6 months out
  (180 days), everyone else up to 3 months (90 days).
- No double-booking — overlap check and insert happen in one transaction, so two
  people can't grab the same slot at once.
- Analytics page — room utilization, usage by department, a day×hour heatmap,
  average duration, cancellation rate.
- Bookings and the schedule are limited to business hours (07:00–21:00 by
  default), enforced server-side too, not just in the form.

## Tech stack

- Node.js 22 LTS (pinned in `.node-version`, supported until April 2027) / Express
- HTML + Bootstrap 5, vendored under `public/vendor/` — no CDN dependency
- SQLite via better-sqlite3
- Auth reuses the existing `/checklogin`; mock auth for local dev
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
from the running app. There is no admin screen and no write API for them, so
nobody can rename or remove a room by accident, and the app needs no permission
model to protect it.

Currently:

| Location | Rooms |
| --- | --- |
| Factory 1 | Conference room 1 / Conference room 2 / Meeting space 1 / Meeting space 2 / Meeting space 3 |
| Factory 2 | Conference room 1 / Meeting room 1 / Meeting room 2 / Meeting room 3 |

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
| `NODE_ENV` | Environment | development |
| `DB_PATH` | SQLite file path — normally leave unset, see Operations below | auto |
| `BACKUP_DIR` | Where `npm run backup` writes to | ./backups |
| `BACKUP_KEEP` | How many backups to keep | 14 |
| `AUTH_MODE` | `mock` or `checklogin` | mock |
| `CHECKLOGIN_URL` | `/checklogin` endpoint in production | (empty) |
| `MOCK_USER_NAME` | Name used by mock auth | Taro Yamada |
| `MOCK_USER_DEPARTMENT` | Department used by mock auth | General Affairs |
| `SLOT_MINUTES` | Booking increment | 10 |
| `BUSINESS_START_HOUR` / `BUSINESS_END_HOUR` | Bookable hours | 7 / 21 |
| `BOOKING_WINDOW_DEFAULT_DAYS` / `BOOKING_WINDOW_HR_DAYS` | Booking window, days ahead | 90 / 180 |
| `HR_DEPARTMENTS` | Department names counted as HR, comma-separated, partial match | HR,Human Resources,Recruiting,People,Talent |

## Authentication

`AUTH_MODE=mock` during development — `MOCK_USER_NAME` / `MOCK_USER_DEPARTMENT`
from `.env` stand in for a logged-in user. In production, switch to
`AUTH_MODE=checklogin` and wire the existing `/checklogin` mechanism through
`src/middleware/auth.js`.

Cancellation currently has no permission check — anyone can cancel any booking.
It's a soft delete (status becomes `cancelled`, the row stays for analytics) so
the slot frees up and it drops off the schedule but the history is kept. A rule
like "HR can cancel anything, others only their own" isn't in yet; it belongs
together with the real `/checklogin` auth, once who's logged in is actually known.

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/config` | Booking rules, business hours, version |
| GET | `/api/auth/me` | Logged-in user |
| GET | `/api/rooms` | List rooms (`?all=1` includes disabled). Read-only — rooms come from the catalog |
| GET | `/api/availability?start_at=&end_at=` | Free/busy rooms for a slot |
| GET | `/api/bookings` | List bookings (`room_id` / `from` / `to` / `status`; confirmed only unless `status=all`) |
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

No manual database step. Schema changes ship as migrations tracked by SQLite's
`user_version` — each one runs once, in a transaction, and only adds to what's
there, so an update never means recreating the database. The log line on boot
(`Database migrated 1 -> 2`) tells you it ran. Adding a schema change later means
appending a new entry to `src/db/migrations.js`; existing entries shouldn't be
edited or renumbered, since a database that already applied one would just skip it.

Backups (`npm run backup`) use SQLite's online backup API, so they're consistent
even while the app is live — fine to put on a cron job. Old ones beyond
`BACKUP_KEEP` get pruned automatically. To restore, stop the app, copy a backup
over `DB_PATH`, start it back up.

## Project structure

```
src/
  server.js               entry point
  config.js                .env loading / config
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
    bookingRules.js         slot/hours/window validation
public/
  index.html / app.js       booking + schedule + availability
  stats.html / stats.js     analytics
  vendor/                    Bootstrap 5
```
