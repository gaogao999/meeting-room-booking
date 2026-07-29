# Meeting Room Booking

A web app for registering and booking company meeting rooms. Pick a date and time
and only the rooms free for that slot are offered; the whole company's schedule is
visible on a timeline.

- Current version: **v1.1.0**
- The UI is in English.

## Features

- **Room management** (`Rooms` page): register rooms with name, location, capacity and
  description; disable/enable them.
- **Booking flow** (`Booking` page): choose a date and start/end time (hour and minute
  as separate selects). Only the rooms **available for that slot** are shown. Pick a room,
  then enter department and name (auto-filled from the logged-in user) and an optional
  purpose. Bookings are in **10-minute increments** and **record the department and name**.
- **Schedule (timeline)**: rooms (rows) × time axis (07:00–21:00) showing the day's
  bookings as a Gantt-style chart. Switch days, click a bar for details (with cancel), or
  click an empty area to start a booking for that room and time.
- **Per-department booking window**:
  - **HR departments**: up to 6 months ahead (default 180 days)
  - **Other departments**: up to 3 months ahead (default 90 days)
- **Overlap prevention**: no double-booking of the same room; a transaction also prevents
  races from concurrent requests.
- **Analytics** (`Analytics` page): room utilization, usage by department, a day×hour
  busy-times heatmap, average duration and cancellation rate for a date range.
  Cancellations are soft-deleted (kept in the database) so this history is preserved.
- **Business hours**: bookings and the schedule are limited to business hours
  (default 07:00–21:00), enforced on the server as well.

## Tech stack

- Node.js 22 LTS (pinned via `.node-version`; supported until April 2027) / Express
- Frontend: HTML + Bootstrap 5 (vendored under `public/vendor/`, no CDN dependency)
- Database: SQLite (better-sqlite3)
- Auth: reuses the existing `/checklogin`; mock auth during development
- Secrets: all managed via `.env`

## Setup

```bash
# Install dependencies
npm install

# Create the env file
cp .env.example .env

# Start (on first run, the default rooms are auto-seeded if the table is empty)
npm start

# Development (auto-restart on file changes)
npm run dev
```

Open http://localhost:3000 in your browser.

> Rooms are **auto-seeded on startup**, so `npm run seed` is usually not needed.
> Use `npm run seed` to seed explicitly, or `npm run init-db` to create the schema only.

## Default rooms

On first start (when the `rooms` table is empty) the following are inserted.
The list is ordered by **location (Factory 1 → 2 …) then room name**.

| Location | Rooms |
| --- | --- |
| Factory 1 | Conference room 1 / Conference room 2 / Meeting space 1 / Meeting space 2 / Meeting space 3 |
| Factory 2 | Conference room 1 / Meeting room 1 / Meeting room 2 / Meeting room 3 |

Room names are **unique per location** (`UNIQUE(name, location)`), so the same name can
exist in both factories.

## Environment variables (.env)

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | Listen port | 3000 |
| `NODE_ENV` | Environment | development |
| `DB_PATH` | SQLite file path. Optional — defaults to a sibling directory outside the app folder (see Operations below); override only for a specific location | *(auto)* |
| `BACKUP_DIR` | Output directory for `npm run backup` | ./backups |
| `BACKUP_KEEP` | Number of backups to retain | 14 |
| `AUTH_MODE` | `mock` or `checklogin` | mock |
| `CHECKLOGIN_URL` | `/checklogin` endpoint for production | (empty) |
| `MOCK_USER_NAME` | Name for mock auth | Taro Yamada |
| `MOCK_USER_DEPARTMENT` | Department for mock auth | General Affairs |
| `SLOT_MINUTES` | Booking increment (minutes) | 10 |
| `BUSINESS_START_HOUR` | Start of selectable business hours | 7 |
| `BUSINESS_END_HOUR` | End of selectable business hours | 21 |
| `BOOKING_WINDOW_DEFAULT_DAYS` | Booking window for general departments | 90 |
| `BOOKING_WINDOW_HR_DAYS` | Booking window for HR departments | 180 |
| `HR_DEPARTMENTS` | Department names treated as HR (partial match, comma-separated) | HR,Human Resources,Recruiting,People,Talent |

## Authentication

- During development, `AUTH_MODE=mock`: `MOCK_USER_NAME` / `MOCK_USER_DEPARTMENT` from `.env`
  are treated as the logged-in user.
- In production, set `AUTH_MODE=checklogin` and use the existing `/checklogin` mechanism
  (reverse proxy / session) for the verified user. The integration point is
  `src/middleware/auth.js`.

### Cancellation permissions (current behavior)

- There is currently **no permission check**: anyone can cancel any booking.
- Cancellation is a **soft delete**: the booking's `status` becomes `cancelled` (the row is
  kept for analytics). Cancelled bookings free the slot and are hidden from the schedule.
- The rule "HR departments can cancel any booking / others can cancel only their own" is
  **not yet implemented**. It should be added together with `/checklogin` auth, once the
  logged-in user is reliably known.

## API overview

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/config` | Booking rules, business hours, version |
| GET | `/api/auth/me` | Logged-in user info |
| GET | `/api/rooms` | List rooms (`?all=1` includes disabled) |
| POST | `/api/rooms` | Create a room |
| PUT | `/api/rooms/:id` | Update a room |
| DELETE | `/api/rooms/:id` | Disable a room (soft delete) |
| GET | `/api/availability?start_at=&end_at=` | Available / busy rooms for a time slot |
| GET | `/api/bookings` | List bookings (filter by `room_id` / `from` / `to` / `status`; confirmed only by default) |
| POST | `/api/bookings` | Create a booking |
| PUT | `/api/bookings/:id` | Update a booking |
| DELETE | `/api/bookings/:id` | Cancel a booking (soft delete) |
| GET | `/api/stats?from=&to=` | Utilization / usage statistics for a date range |

## Deployment (Render / free plan)

Because it includes a backend (Express + SQLite), static hosting won't work. Use the
included `render.yaml` (Blueprint) to deploy to Render.

1. https://dashboard.render.com/ → **New** → **Blueprint**
2. Select this repository (`render.yaml` is picked up)
3. After a few minutes it is served at `https://<service-name>.onrender.com`

Notes:
- Node is pinned via `.node-version` (22.22.2, the current LTS) so better-sqlite3 installs
  a prebuilt binary instead of compiling from source.
- The free plan sleeps when idle and its disk is ephemeral. On redeploy/wake the booking
  data resets and the default rooms are auto-seeded on startup. To persist bookings, use a
  Render Disk (paid): enable the disk section in `render.yaml` and set `DB_PATH` to
  `/data/booking.db`.

## Operations: updating without losing bookings

Booking data lives in a single SQLite file, kept outside the application code by
default. Updates replace the app directory only — they never touch that file — so
bookings survive as long as the two stay apart, which requires no setup.

### Where the database lives (no setup needed)

With `DB_PATH` unset, the app automatically stores the database in a sibling
directory next to the app folder, e.g.:

```
.../meeting-room-booking/        ← app code (replaced wholesale on updates)
.../meeting-room-booking-data/   ← booking.db (untouched by updates)
```

This is computed from the app's own install location, so it works out of the box
on any server without IT needing to configure a path. Only set `DB_PATH` explicitly
if you want the file somewhere specific (a different disk, shared storage, etc.):

```bash
# .env — optional override; must be an absolute path outside the app directory
DB_PATH=/var/lib/meeting-room/booking.db
BACKUP_DIR=/var/backups/meeting-room
```

If `DB_PATH` is ever set to a path that resolves inside the app directory, the app
prints a startup warning so the misconfiguration doesn't go unnoticed.

### Update procedure

```bash
npm run backup            # 1. snapshot first (safe while the app is running)
# 2. replace the application files with the new version
npm ci                    # 3. install dependencies for the new version
# 4. restart the service (systemd / pm2 / container)
```

On startup the app reports the schema version it moved to, for example
`Database migrated 1 -> 2`. No manual database step is ever required.

### Schema migrations

Schema changes ship as incremental migrations tracked by SQLite's `user_version`.
Each migration runs **once per database**, in order, inside a transaction, and only
ever adds to what is already there — so upgrading never means recreating the
database. A failed migration rolls back and leaves the version unchanged.

To add a schema change in a future release, append a new entry to
`src/db/migrations.js` with the next version number. Never edit or renumber an
existing entry: databases that already applied it would skip the change.

### Backups

```bash
npm run backup            # writes BACKUP_DIR/booking-YYYYMMDD-HHMMSS.db
```

Uses SQLite's online backup API, so it produces a consistent copy without stopping
the app and can be scheduled with cron. The newest `BACKUP_KEEP` files are kept
(default 14) and older ones are removed automatically.

To restore, stop the app, copy a backup file over `DB_PATH`, and start it again.

## Project structure

```
src/
  server.js               Entry point
  config.js               .env loading / configuration
  db/
    index.js              SQLite connection, migrations on boot, startup auto-seed
    migrations.js         Incremental schema migrations (tracked by user_version)
    schema.sql            Baseline schema (migration 1)
    defaultRooms.js       Default room definitions (shared by auto-seed and seed)
    init.js               Report/apply schema version (npm run init-db)
    seed.js               Insert default rooms (npm run seed)
    backup.js             Timestamped online backup + retention (npm run backup)
  middleware/auth.js      Auth (mock / checklogin)
  routes/
    auth.js               /api/auth
    rooms.js              /api/rooms
    bookings.js           /api/bookings (overlap-prevention transaction)
    availability.js       /api/availability (availability search)
    stats.js              /api/stats (utilization / usage analytics)
  services/
    bookingRules.js       Booking rules (slot, business hours, dept windows, validation)
public/
  index.html / app.js     Booking page (form + schedule + availability filtering)
  rooms.html / rooms.js   Rooms page (room management)
  stats.html / stats.js   Analytics page (utilization, department usage, heatmap)
  timeline.css            Schedule styles
  vendor/                 Bootstrap 5 (vendored)
```

## Notes

- Minimal footprint for easy IT review: runtime dependencies are only `express`,
  `dotenv` and `better-sqlite3`. No external services or outbound network calls are
  required at runtime, and all frontend assets (Bootstrap) are vendored locally
  (Bootstrap is a devDependency used only to refresh those vendored files).
