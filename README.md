# Meeting Room Booking

Web app for booking company meeting rooms. Pick a date and time and only the rooms
free for that slot show up; the whole company's schedule is visible on a timeline.

Current version: v2.6.0. UI is in English.

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
- Scheduling around people — add the people who should attend and their Outlook
  free/busy times appear as rows on the same grid as the rooms, with an
  `Everyone free` strip underneath. Click a stretch of it to take that time.
  See [Reading Outlook calendars](#reading-outlook-calendars) — until IT grants
  access this runs on sample data, clearly labelled as such on the page.
- A booking can carry the people invited and a meeting link, and
  `Add to Outlook` downloads it as a calendar appointment (`.ics`) so it does not
  have to be typed in twice.
- Booking with people invited opens a mail to them, filled in with the room,
  time, join link and a link to the calendar file. It opens the mail client the
  user is already signed in to rather than sending from the server: sending
  server-side needs the company mail server and so needs IT, while this needs
  nothing, goes out from the person's own address, and leaves a copy in their
  Sent items. A `mailto:` cannot carry an attachment, hence the link.
- `Free right now` — the top of the schedule lists the rooms free from this
  minute and for how long, for 30 minutes / 1 hour / 2 hours. One click fills the
  form in with that room and time. This is the walk-up case: somebody in the
  corridor who needs a room now, which is the thing Outlook handles worst.
- A line across the grid marks the current minute, and both it and the free-now
  list refresh every minute so a screen left open all morning stays honest.
- `My bookings` lists everything this browser has booked that has not happened
  yet — the only way to find one without knowing its date, since bookings are
  identified by device rather than by login. Each can be changed, cancelled, or
  added to a calendar from there.
- A meeting that is under way can be ended early — `Finished — free the room`
  hands the rest of the slot back to everyone else — or extended by 10 or 30
  minutes if the room is still free after it. Borrowed from the room displays
  the paid products sell, and the reason the "no bookings in the past" rule now
  makes an exception: it refuses a booking that *starts* in the past, but a
  meeting already running is a fact, and holding the room until the hour because
  nobody may touch it is the opposite of the point.
- A booking can be changed rather than cancelled and re-made, which used to lose
  the room in the gap. The same device rule covers changing and cancelling: only
  the browser that made a booking can do either.
- Room capacity and description are shown wherever a room is named, and a
  "for N people" filter appears once at least one room has a capacity set. Both
  are empty in the catalog for now; filling them in is all that is needed.
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

Then open http://localhost:3011 — the meeting rooms are registered automatically
on first start. `npm run dev` restarts on file changes.

Either `npm run db:deploy` or `npm run db:push` leaves the database complete —
both finish by applying `prisma/guards.sql`, which carries the constraints and
the trigger Prisma's schema cannot express. Use whichever your process prefers.

They differ in how the tables get there. `db:deploy` is `prisma migrate deploy`:
it applies migrations the database has not seen and does nothing when there are
none, so it is safe on every deployment and only ever adds. `db:push` builds the
tables from `schema.prisma` directly, which is Prisma's shortcut for a scratch
database. Prefer `db:deploy` anywhere that holds real bookings.

One thing to watch: `npx prisma db push` **run on its own** creates the tables
and nothing else — no constraints, no trigger. The app still enforces every rule
itself and works fine, but the database stops being a second line of defence.
It says so at startup when it notices, and `npm run db:guards` fixes it.

## Rooms

Rooms are configured in code, in `src/db/roomCatalog.js`, and are not editable
from the running app. The Rooms page lists what's configured but is read-only,
and there is no write API, so nobody can rename or remove a room by accident and
the app needs no permission model to protect it.

Currently:

| Location | Rooms |
| --- | --- |
| Bang Na | Training Room / Meeting Room 1 / Conference Room / Meeting Room 2 / Meeting Room 3 / Meeting Room 4 |
| Amata F1 | Conference Room 1st / Guest Room 2nd / Small meeting |
| Amata F2 | Conference Room / Meeting Room 1 / Meeting Room 2 / Meeting Room 3 |
| Amata F3 | Meeting Room 1 / Meeting Room 2 |

To change them, edit the catalog and deploy. On startup the database is
reconciled against the list: new entries are added, capacity/description changes
are applied, and a room dropped from the catalog is disabled rather than deleted,
so it disappears from booking and the schedule while its past bookings stay in
the analytics. Restarting with no catalog change does nothing. The startup log
says what changed (`Rooms added: …`, `Rooms disabled: …`).

Rooms are identified by name + location, so renaming one is treated as removing
the old and adding a new one — the old room's bookings stay under the old name.
Names only need to be unique within a location, which is why "Conference Room"
can exist at both Bang Na and Amata F2.

The order in the catalog is the order on screen — sites down the page, rooms
within a site — and `/api/config` hands that order to the browser so the
schedule and the analytics group the same way. It is deliberately not
alphabetical: that would put Amata F1 above the head office.

## Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | Listen port | 3011 |
| `NODE_ENV` | Read by Express itself, not by this app's config | development |
| `DATABASE_URL` | SQL Server connection string — required | — |
| `AUTH_MODE` | `mock` (no login) or `checklogin` | mock |
| `TRUST_PROXY` | Set when a reverse proxy is in front, so the recorded IP is the client's | off |
| `SLOT_MINUTES` | Booking increment | 10 |
| `BUSINESS_START_HOUR` / `BUSINESS_END_HOUR` | Bookable hours | 8 / 20 |
| `BOOKING_WINDOW_DEFAULT_DAYS` / `BOOKING_WINDOW_HR_DAYS` | Booking window, days ahead | 90 / 180 |
| `HR_DEPARTMENTS` | Departments counted as HR, comma-separated, case-insensitive substring match against `src/departments.js` | GA.HR,HR |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | Azure AD app, for reading Outlook free/busy | unset — sample data |
| `GRAPH_ORGANIZER` | Mailbox the free/busy lookup is made through | unset |
| `GRAPH_TIMEZONE` | Windows time zone id the times are read in | SE Asia Standard Time |

## Reading Outlook calendars

Showing when someone is free means asking Microsoft Graph, and Graph will not
answer without an app registered in Azure AD and an administrator's consent.
That is IT's to grant; there is no way around it, and no partial version of it.

What IT needs to do, once:

1. Register an application in Azure AD.
2. Grant it the **application** permission `Calendars.ReadBasic`, and consent as
   administrator — falling back to `Calendars.Read` if that does not work.
   (Microsoft's own pages disagree on which is the minimum: the getSchedule API
   reference says ReadBasic, the free/busy article says Read. Ask for the
   weaker one first.) Either way this returns free/busy times only, not what
   the meetings are.
3. Scope it to a set of mailboxes rather than the whole company, using
   [RBAC for Applications](https://learn.microsoft.com/exchange/permissions-exo/application-rbac)
   (`New-ManagementScope` + `New-ManagementRoleAssignment -CustomResourceScope`).
   Microsoft's own example for this feature is a room booking system, which is
   worth quoting when asking. Do not use `New-ApplicationAccessPolicy`: it does
   the same job but is legacy and slated for deprecation.
4. Optionally also `User.Read.All`, which is what lets the search box find people
   by name. Without it the feature still works; an address has to be typed out.
5. Hand over the tenant id, client id and client secret, plus any one mailbox for
   `GRAPH_ORGANIZER` — application calls have no "me", so the lookup is made
   through a named mailbox.

`npm run check:graph` verifies all of it — sign-in, whether a calendar can
actually be read, whether the server's clock is in the right time zone — and says
in plain Japanese what to fix. [docs/weekend-test.md](docs/weekend-test.md) walks
through doing the whole thing on a personal Microsoft 365 tenant first, which
needs nothing from IT and rehearses exactly what they will later be asked for.

Until all four values are in `.env`, the app answers with sample times instead of
leaving the screen empty, and says so both in the API response (`mode: "sample"`)
and on the page itself. Nothing else changes when the real values arrive: no
migration, no code change, restart and it is reading real calendars.

Two limits worth knowing before promising anything:

- Someone with no Outlook mailbox has no free/busy to read. They can still be
  invited and still appear on the booking; their row is simply blank.
- This reads calendars. It does not send meeting invitations and does not create
  Teams links — both need more than free/busy access, and Outlook already does
  them. `Add to Outlook` covers the common case without needing anything from IT.
- getSchedule takes at most 20 mailboxes per call and a window of less than 62
  days, which is why the participant list is capped at 20 and one day is fetched
  at a time.

Writing bookings into Outlook — so that a booking made here shows up in Outlook
and one made in Outlook shows up here — is a further step, not done. The shape it
would take is the one Exchange already provides: the rooms become room mailboxes,
and a booking invites the room as an attendee, which Exchange accepts or declines
against the room's own calendar. That means Exchange does the double-booking
check rather than this app. It needs `Calendars.ReadWrite`, scoped to the room
mailboxes. Note that Outlook-side changes could not be pushed here: Graph's
change notifications require a notification URL reachable from the public
internet, which an internal server is not, so it would have to poll.

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
| GET | `/api/bookings/:id/ics` | The booking as a calendar appointment, for `Add to Outlook` |
| GET | `/api/people/mode` | Whether calendars are live or sample |
| GET | `/api/people?q=` | Find someone to invite. Answers with no matches, not an error, when directory search is not permitted |
| POST | `/api/people/freebusy` | `{ date, emails[] }` → when each of them is busy that day, in minutes from midnight |
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
  guards.sql                 constraints + trigger; applied by either db: script
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
    people.js               directory search + Outlook free/busy
  services/
    bookingRules.js         slot/hours/window/length validation
    graph.js                Microsoft Graph; sample data until IT grants access
    calendarFile.js         the .ics behind "Add to Outlook"
scripts/
  apply-guards.js           runs guards.sql, idempotently
  check-graph.js            diagnoses the Outlook connection
public/
  common.js                 helpers shared by all three pages
  index.html / app.js       booking + schedule + availability
  rooms.html / rooms.js     room list (read-only)
  stats.html / stats.js     analytics
  timeline.css               all the styling
  favicon.svg
  vendor/                    Bootstrap 5
```
