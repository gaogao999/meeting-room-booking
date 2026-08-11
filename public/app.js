'use strict';

// Visible timeline window (minutes). Set from business hours in init();
// the deployment runs 08:00-20:00 (BUSINESS_START_HOUR / BUSINESS_END_HOUR).
let DAY_START = 8 * 60;
let DAY_END = 20 * 60;
let SPAN = DAY_END - DAY_START;

// One hour is always this wide, so bar labels never collapse. The grid scrolls
// horizontally on narrow screens rather than squeezing the day.
const PX_PER_HOUR = 60;
const ROOM_COL_PX = 196; // keep in step with --tl-room-w in timeline.css

// Bookings are coloured by department, and locations are ordered, by the shared
// helpers in common.js.

const state = {
  config: {
    slotMinutes: 10,
    businessStartHour: 8,
    businessEndHour: 20,
    windowDefaultDays: 90,
    windowHrDays: 180,
    hrDepartments: [],
  },
  authMode: 'mock',
  date: null,
  rooms: [],
  locFilter: 'All',
  selectedRoom: null,
  detailBooking: null,
  // Who the meeting is for, and when their Outlook calendars say they are busy.
  // freeBusy is keyed by email and only ever holds the day currently shown.
  participants: [],
  freeBusy: {},
  fbMode: 'sample',
  fbError: null,
  // Set while changing an existing booking rather than making a new one.
  editing: null,
  // How long the "free right now" strip is looking ahead for, in minutes.
  freeNowMins: 30,
};

// Recompute "now" this often, so the current-time line and the free-now strip
// do not go stale on a screen left open all morning.
const NOW_TICK_MS = 60 * 1000;

let detailModal = null;

function pad(n) {
  return String(n).padStart(2, '0');
}

// Times are shown without a leading zero on the hour (8:00, not 08:00). Minutes
// stay two digits. Note this is display only — timeStr() still pads, because
// that is what goes to the API.
function fmtMin(m) {
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

// Same, for an "HH:MM" string that came back from the API.
function fmtClock(hhmm) {
  return hhmm.replace(/^0/, '');
}

// "2026-07-30T08:00" -> "2026-07-30 8:00"
function fmtStamp(iso) {
  return `${iso.slice(0, 10)} ${fmtClock(iso.slice(11, 16))}`;
}

function durText(m) {
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} m` : `${h} h`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(iso) {
  const d = new Date(`${iso}T00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Read the split hour/minute selects
function timeStr(hourId, minId) {
  return `${pad(+document.getElementById(hourId).value)}:${pad(+document.getElementById(minId).value)}`;
}
function timeMin(hourId, minId) {
  return +document.getElementById(hourId).value * 60 + +document.getElementById(minId).value;
}

// Messages are escaped by default — most of them carry text from the server.
// `html: true` is for the handful this file writes itself, which need a link in
// them; never pass it anything that came back over the network.
function showAlert(message, type = 'danger', { html = false } = {}) {
  document.getElementById('formAlert').innerHTML =
    `<div class="alert alert-${type} alert-dismissible fade show" role="alert">${
      html ? message : escapeHtml(message)
    }<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
}

// Rooms carry a capacity and a description in the catalog, both of which start
// empty here. Everything below has to read well with nothing set, and get more
// useful the moment IT or the office fills them in — no code change either way.
function seatsOf(room) {
  return Number.isFinite(room && room.capacity) ? room.capacity : null;
}

function anyCapacityKnown() {
  return state.rooms.some((r) => seatsOf(r) != null);
}

// "8 seats · TV, VC" — whichever of the two is known.
function roomFacts(room) {
  const bits = [];
  const seats = seatsOf(room);
  if (seats != null) bits.push(`${seats} seats`);
  if (room.description) bits.push(room.description);
  return bits.join(' · ');
}

// A room fits when it is big enough, or when nobody has said how big it is:
// an unknown capacity is not evidence that it is too small, and excluding
// those would empty the list entirely until the catalog is filled in.
function fitsSeats(room, wanted) {
  if (!wanted) return true;
  const seats = seatsOf(room);
  return seats == null || seats >= wanted;
}

function visibleRooms() {
  return state.locFilter === 'All'
    ? state.rooms
    : state.rooms.filter((r) => (r.location || 'Other') === state.locFilter);
}

// ---- Time controls (hour + minute, limited to business hours) ----
function minuteOptions() {
  const out = [];
  for (let m = 0; m < 60; m += state.config.slotMinutes) out.push(m);
  return out;
}

// End minute is limited to :00 when the end hour is the closing hour
function syncEndMinutes() {
  const endMin = document.getElementById('endMin');
  const prev = +endMin.value;
  const atClose = +document.getElementById('endHour').value >= state.config.businessEndHour;
  const mins = atClose ? [0] : minuteOptions();
  endMin.innerHTML = mins.map((m) => `<option value="${m}">${pad(m)}</option>`).join('');
  endMin.value = mins.includes(prev) ? prev : mins[0];
}

function fillTimeControls() {
  const bs = state.config.businessStartHour;
  const be = state.config.businessEndHour;
  const startHour = document.getElementById('startHour');
  const endHour = document.getElementById('endHour');
  const startMin = document.getElementById('startMin');

  const startHours = [];
  for (let h = bs; h < be; h++) startHours.push(h); // start cannot be at closing hour
  const endHours = [];
  for (let h = bs; h <= be; h++) endHours.push(h);
  startHour.innerHTML = startHours.map((h) => `<option value="${h}">${h}</option>`).join('');
  endHour.innerHTML = endHours.map((h) => `<option value="${h}">${h}</option>`).join('');

  const minOpts = minuteOptions()
    .map((m) => `<option value="${m}">${pad(m)}</option>`)
    .join('');
  startMin.innerHTML = minOpts;

  // Defaults: 09:00-10:00 (clamped to business hours)
  startHour.value = Math.min(Math.max(9, bs), be - 1);
  startMin.value = 0;
  endHour.value = Math.min(Math.max(10, bs + 1), be);
  syncEndMinutes();
  document.getElementById('endMin').value = 0;
}

function updateRuleHint() {
  const dep = document.getElementById('department').value;
  if (!dep) {
    document.getElementById('ruleHint').innerHTML =
      `Bookings are made in ${state.config.slotMinutes}-minute steps. How far ahead you can book depends on your department.`;
    return;
  }
  const isHr = state.config.hrDepartments.some((k) =>
    dep.toLowerCase().includes(String(k).toLowerCase())
  );
  const days = isHr ? state.config.windowHrDays : state.config.windowDefaultDays;
  const kind = isHr ? 'HR department' : 'General department';
  document.getElementById('ruleHint').innerHTML =
    `${kind} — book up to <strong>${days} days</strong> ahead, in ${state.config.slotMinutes}-minute steps.`;
}

// Without a login there is nothing to fill the form from, so the browser
// remembers whoever used it last. Wrapped because storage throws outright in
// private browsing on some setups, and a booking screen that refuses to load
// there would be worse than one that just asks for the name again.
const ME_KEY = 'mrb.me';

function remembered() {
  try {
    return JSON.parse(localStorage.getItem(ME_KEY) || '{}');
  } catch (err) {
    return {};
  }
}

function remember(name, department, email) {
  try {
    localStorage.setItem(ME_KEY, JSON.stringify({ name, department, email }));
  } catch (err) {
    /* not fatal — the fields just start empty next time */
  }
}

// Called whenever either field changes, not only once a booking goes through:
// someone who fills the form in and then gets called away should not have to
// type their name again to find out a room was taken.
function rememberCurrent() {
  if (state.authMode !== 'mock') return;
  const name = document.getElementById('reserver').value.trim();
  const department = document.getElementById('department').value;
  remember(name, department, myEmail());
  updateUserChip(name, department);
}

// Your own address, if you have given one. Without a login the app has no way
// to know which mailbox is yours, and free/busy is looked up by address — so
// this is what puts your own calendar on the grid next to everyone else's.
function myEmail() {
  const value = document.getElementById('myEmail').value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : '';
}

// Everyone whose calendar belongs on the schedule: you first, then the people
// you invited. You are not one of the participants stored on the booking —
// being in the room is already implied by having booked it.
function attendees() {
  const mine = myEmail();
  const own = mine
    ? [{ name: document.getElementById('reserver').value.trim() || 'You', email: mine, self: true }]
    : [];
  return [...own, ...state.participants];
}

// Offered sizes are drawn from the catalog, so the choices are ones that can
// actually be met. With no capacities set the whole control stays hidden rather
// than presenting a filter that cannot filter.
function fillSeatOptions() {
  const wrap = document.getElementById('seatsWrap');
  if (!anyCapacityKnown()) {
    wrap.hidden = true;
    return;
  }
  const sizes = [...new Set(state.rooms.map(seatsOf).filter((n) => n != null))].sort((a, b) => a - b);
  document.getElementById('seats').innerHTML =
    '<option value="">any size</option>' +
    sizes.map((n) => `<option value="${n}">${n}+ people</option>`).join('');
  wrap.hidden = false;
}

function fillDepartments(list, selected) {
  const el = document.getElementById('department');
  el.innerHTML =
    '<option value="">Select your department</option>' +
    list.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  if (selected && list.includes(selected)) el.value = selected;
}

// The header chip shows who the booking will be filed under.
function updateUserChip(name, department) {
  const chip = document.getElementById('currentUser');
  if (!name) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  document.getElementById('userName').textContent = name;
  document.getElementById('userDept').textContent = department || '';
  document.getElementById('userInitials').textContent = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// ---- Participants -------------------------------------------------------
//
// The list is kept in the browser between visits: the same handful of people
// tend to be in the same meetings, and re-typing them every time is the kind of
// friction that stops a screen being used.
const PEOPLE_KEY = 'mrb.people';

function loadParticipants() {
  try {
    const list = JSON.parse(localStorage.getItem(PEOPLE_KEY) || '[]');
    return Array.isArray(list) ? list.slice(0, 20) : [];
  } catch (err) {
    return [];
  }
}

function saveParticipants() {
  try {
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(state.participants));
  } catch (err) {
    /* not fatal — the list just starts empty next time */
  }
}

function renderParticipants() {
  const el = document.getElementById('participantList');
  el.innerHTML = state.participants
    .map(
      (p, i) =>
        `<span class="person-chip" style="--pc:${colorForDept(p.email)}">` +
        `<span class="pc-name" title="${escapeHtml(p.email)}">${escapeHtml(p.name)}</span>` +
        `<button type="button" class="pc-x" data-remove="${i}" aria-label="Remove ${escapeHtml(
          p.name
        )}">&times;</button></span>`
    )
    .join('');

  const hint = document.getElementById('peopleHint');
  if (!state.participants.length) {
    hint.textContent = '';
    return;
  }
  hint.textContent =
    state.fbMode === 'live'
      ? 'Busy times come from Outlook.'
      : 'Showing sample times — Outlook is not connected yet.';
}

function addParticipant(person) {
  const email = String(person.email || '').trim();
  if (!email) return;
  if (state.participants.some((p) => p.email.toLowerCase() === email.toLowerCase())) return;
  if (state.participants.length >= 20) {
    showAlert('You can add up to 20 people.');
    return;
  }
  state.participants.push({ name: String(person.name || email).trim() || email, email });
  saveParticipants();
  renderParticipants();
  refreshFreeBusy();
}

function removeParticipant(index) {
  state.participants.splice(index, 1);
  saveParticipants();
  renderParticipants();
  refreshFreeBusy();
}

function hideSuggestions() {
  const box = document.getElementById('personSuggest');
  box.hidden = true;
  box.innerHTML = '';
}

let suggestTimer = null;

function onPersonSearch() {
  const q = document.getElementById('personSearch').value.trim();
  clearTimeout(suggestTimer);
  if (q.length < 2) {
    hideSuggestions();
    return;
  }
  // One request per pause in typing, not one per keystroke.
  suggestTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/people?q=${encodeURIComponent(q)}`);
      const box = document.getElementById('personSuggest');
      const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q);
      const rows = data.people.map(
        (p) =>
          `<button type="button" class="sugg" data-name="${escapeHtml(p.name)}" data-email="${escapeHtml(
            p.email
          )}"><span class="s-name">${escapeHtml(p.name)}</span>` +
          `<span class="s-mail">${escapeHtml(p.email)}</span></button>`
      );
      // A name that is not in the directory is still a person who can be
      // invited, as long as what was typed is an address.
      if (looksLikeEmail && !data.people.some((p) => p.email.toLowerCase() === q.toLowerCase())) {
        rows.push(
          `<button type="button" class="sugg" data-name="${escapeHtml(q)}" data-email="${escapeHtml(
            q
          )}"><span class="s-name">Add ${escapeHtml(q)}</span></button>`
        );
      }
      if (!rows.length) {
        box.innerHTML = '<div class="sugg-empty">No one found. Type a full email address.</div>';
      } else {
        box.innerHTML = rows.join('');
      }
      box.hidden = false;
    } catch (err) {
      hideSuggestions();
    }
  }, 200);
}

// Fetch busy times for everyone on the list, for the day the schedule is on.
async function refreshFreeBusy() {
  const note = document.getElementById('fbNote');
  const people = attendees();
  if (!people.length) {
    state.freeBusy = {};
    state.fbError = null;
    note.hidden = true;
    renderParticipants();
    loadTimeline();
    return;
  }
  // Read the picker rather than state.date: this runs before loadTimeline has
  // caught up with a day the user just moved to.
  const date = document.getElementById('tlDate').value || todayStr();
  try {
    const data = await api('/api/people/freebusy', {
      method: 'POST',
      body: JSON.stringify({ date, emails: people.map((p) => p.email) }),
    });
    state.fbMode = data.mode;
    state.fbError = null;
    state.freeBusy = {};
    for (const p of data.people) state.freeBusy[p.email.toLowerCase()] = p;
    note.hidden = data.mode === 'live';
    note.textContent =
      'Outlook is not connected yet, so the times shown for people are sample data.';
  } catch (err) {
    state.fbError = err.message;
    state.freeBusy = {};
    note.hidden = false;
    note.textContent = `Could not read calendars: ${err.message}`;
  }
  renderParticipants();
  loadTimeline();
}

// The stretches where nobody on the list is busy. Used for the strip that
// answers the actual question: when can we all meet?
function commonFreeBlocks() {
  const busy = [];
  for (const p of attendees()) {
    const entry = state.freeBusy[p.email.toLowerCase()];
    for (const b of (entry && entry.busy) || []) busy.push(b);
  }
  busy.sort((a, b) => a.start - b.start);
  const free = [];
  let cursor = DAY_START;
  for (const b of busy) {
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, DAY_END) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= DAY_END) break;
  }
  if (cursor < DAY_END) free.push({ start: cursor, end: DAY_END });
  return free.filter((f) => f.end - f.start >= state.config.slotMinutes);
}

function updateSlotSummary() {
  const date = document.getElementById('date').value;
  const s = timeMin('startHour', 'startMin');
  const e = timeMin('endHour', 'endMin');
  const el = document.getElementById('slotSummary');
  if (!date || e <= s) {
    el.textContent = '';
    return;
  }
  el.innerHTML = `${dayLabel(date)} · ${fmtMin(s)}–${fmtMin(e)} · <strong>${durText(e - s)}</strong>`;
}

function updateBookButton() {
  const sel = document.getElementById('roomId');
  const btn = document.getElementById('bookBtn');
  const room = state.rooms.find((r) => String(r.id) === sel.value);
  const department = document.getElementById('department').value;
  const reserver = document.getElementById('reserver').value.trim();

  // Say which field is still missing rather than sitting there greyed out.
  // Without a login the department and name are all that identify a booking,
  // so neither can be left to a default.
  btn.disabled = !room || !department || !reserver;
  const range = `${fmtMin(timeMin('startHour', 'startMin'))}–${fmtMin(timeMin('endHour', 'endMin'))}`;
  btn.textContent = !room
    ? 'Select a room first'
    : !department
      ? 'Select your department'
      : !reserver
        ? 'Enter your name'
        : state.editing
          ? `Save changes · ${room.name} · ${range}`
          : `Book ${room.name} · ${range}`;
}

// ---- Step 1+2: find available rooms for the chosen time slot ----
async function findRooms(preselectRoomId = null) {
  const date = document.getElementById('date').value;
  const startStr = timeStr('startHour', 'startMin');
  const endStr = timeStr('endHour', 'endMin');
  const sel = document.getElementById('roomId');
  const hint = document.getElementById('availHint');
  const count = document.getElementById('freeCount');

  updateSlotSummary();

  const reset = (msg) => {
    sel.innerHTML = `<option value="">${escapeHtml(msg)}</option>`;
    sel.disabled = true;
    count.textContent = '';
    updateBookButton();
  };

  if (!date) {
    hint.textContent = 'Please select a date.';
    reset('Select a time slot first');
    return;
  }
  if (timeMin('endHour', 'endMin') <= timeMin('startHour', 'startMin')) {
    hint.textContent = 'End time must be after start time.';
    reset('Invalid time range');
    return;
  }

  try {
    const data = await api(
      `/api/availability?start_at=${date}T${startStr}&end_at=${date}T${endStr}`
    );
    // The room this booking already holds is "taken" by this very booking, so
    // it would otherwise disappear from the list the moment you tried to edit
    // anything else about it.
    if (state.editing) {
      const held = state.rooms.find((r) => r.id === state.editing.room_id);
      if (held && !data.available.some((r) => r.id === held.id)) data.available.push(held);
    }
    // Respect the location filter so the dropdown matches the schedule below,
    // and the size filter if the catalog knows how big the rooms are.
    const wanted = +document.getElementById('seats').value || 0;
    const available = data.available
      .filter((r) => state.locFilter === 'All' || (r.location || 'Other') === state.locFilter)
      .filter((r) => fitsSeats(r, wanted));

    if (available.length === 0) {
      hint.textContent = wanted
        ? `No rooms for ${wanted} people free at ${fmtClock(startStr)}–${fmtClock(endStr)}.`
        : `No rooms available for ${fmtClock(startStr)}–${fmtClock(endStr)}.`;
      reset('No rooms available');
      return;
    }
    const groups = {};
    for (const r of available) {
      const loc = r.location || 'Other';
      (groups[loc] = groups[loc] || []).push(r);
    }
    sel.innerHTML =
      '<option value="">Select a room</option>' +
      sortedLocations(available)
        .map(
          (loc) =>
            `<optgroup label="${escapeHtml(loc)}">` +
            groups[loc]
              .map((r) => {
                const facts = roomFacts(r);
                return `<option value="${r.id}">${escapeHtml(
                  facts ? `${r.name} — ${facts}` : r.name
                )}</option>`;
              })
              .join('') +
            '</optgroup>'
        )
        .join('');
    sel.disabled = false;
    hint.textContent = '';
    count.textContent = `${available.length} free`;
    const want = preselectRoomId != null ? preselectRoomId : state.selectedRoom;
    if (want && [...sel.options].some((o) => o.value === String(want))) sel.value = String(want);
    state.selectedRoom = sel.value ? +sel.value : null;
    updateBookButton();
  } catch (err) {
    hint.textContent = err.message;
    reset('Error');
  }
}

// ---- Step 3: submit the booking ----
async function submitBooking(ev) {
  ev.preventDefault();
  const date = document.getElementById('date').value;
  const roomId = document.getElementById('roomId').value;
  if (!roomId) {
    showAlert('Please pick an available room first.');
    return;
  }
  const department = document.getElementById('department').value;
  const reserver = document.getElementById('reserver').value.trim();
  if (!department || !reserver) {
    showAlert('Please fill in your department and name.');
    return;
  }
  const payload = {
    room_id: roomId,
    department,
    reserver,
    purpose: document.getElementById('purpose').value,
    meeting_url: document.getElementById('meetingUrl').value,
    participants: state.participants,
    start_at: `${date}T${timeStr('startHour', 'startMin')}`,
    end_at: `${date}T${timeStr('endHour', 'endMin')}`,
  };
  try {
    const editing = state.editing;
    const saved = editing
      ? await api(`/api/bookings/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
    // The booking exists; the next thing anyone wants is it in their own
    // calendar, so offer that here rather than making them find the booking
    // again to get at it.
    const hasPeople = (saved.participants || []).length > 0;
    showAlert(
      `${editing ? 'Booking updated' : 'Reservation created'}. ` +
        `<a class="alert-link" href="/api/bookings/${saved.id}/ics">Add to Outlook</a>` +
        (hasPeople
          ? ` · <a class="alert-link" href="${escapeHtml(bookingMail(saved))}">Email the ${
              saved.participants.length
            } people invited</a>`
          : ''),
      'success',
      { html: true }
    );
    // Straight into the mail with everything filled in — but only when somebody
    // was invited, since opening an empty message after every booking would be
    // an interruption rather than a help. The link above re-opens it.
    openBookingMail(saved);
    setEditing(null);
    rememberCurrent();
    document.getElementById('purpose').value = '';
    document.getElementById('meetingUrl').value = '';
    document.getElementById('tlDate').value = date;
    state.selectedRoom = null;
    loadTimeline();
    findRooms(); // refresh availability (booked room now busy)
  } catch (err) {
    showAlert(err.message, 'danger');
  }
}

// ---- Right now -------------------------------------------------------------
//
// Someone standing in the corridor wanting a room for the next half hour should
// not have to fill in a form to find out which ones are free. This is the case
// Outlook handles worst and this screen handles best, so it gets the top of the
// page — but only while looking at today, because "now" means nothing on any
// other day.

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function isToday() {
  return state.date === todayStr();
}

// For each room the schedule is showing: is it free from now, and until when.
// `bookings` is the same per-room map the timeline draws from, so this costs
// nothing extra and can never disagree with the grid below it.
function freeNowRooms(bookingsByRoom) {
  const slot = state.config.slotMinutes;
  const from = Math.max(DAY_START, Math.ceil(nowMinutes() / slot) * slot);
  if (from >= DAY_END) return { from, rooms: [] };

  const rooms = [];
  for (const room of visibleRooms()) {
    let until = DAY_END;
    for (const b of bookingsByRoom[room.id] || []) {
      const s = minutesOfDay(b.start_at, state.date);
      const e = minutesOfDay(b.end_at, state.date);
      if (s == null || e == null) continue;
      if (e <= from) continue;
      // Busy at this very moment — not free, whatever comes later.
      if (s <= from) { until = from; break; }
      until = Math.min(until, s);
    }
    if (until - from >= state.freeNowMins) rooms.push({ room, until });
  }
  return { from, rooms };
}

function renderFreeNow(bookingsByRoom) {
  const box = document.getElementById('freeNow');
  if (!isToday() || nowMinutes() >= DAY_END) {
    box.hidden = true;
    return;
  }
  const { from, rooms } = freeNowRooms(bookingsByRoom);
  box.hidden = false;

  const choices = [30, 60, 120];
  document.getElementById('freeNowDurs').innerHTML = choices
    .map(
      (m) =>
        `<button type="button" class="fn-dur${state.freeNowMins === m ? ' active' : ''}"` +
        ` data-mins="${m}">${durText(m)}</button>`
    )
    .join('');

  const list = document.getElementById('freeNowList');
  if (!rooms.length) {
    list.innerHTML =
      `<span class="fn-none">Nothing free for ${durText(state.freeNowMins)} from ${fmtMin(from)}.</span>`;
    return;
  }
  list.innerHTML = rooms
    .map(({ room, until }) => {
      const facts = roomFacts(room);
      return (
        `<button type="button" class="fn-room" data-room="${room.id}" data-from="${from}"` +
        ` title="${escapeHtml(`Book ${room.name} from ${fmtMin(from)}`)}">` +
        `<span class="fn-name">${escapeHtml(room.name)}</span>` +
        `<span class="fn-meta">${escapeHtml(room.location || '')}${
          facts ? ' · ' + escapeHtml(facts) : ''
        }</span>` +
        `<span class="fn-free">free ${until >= DAY_END ? 'all day' : 'until ' + fmtMin(until)}</span>` +
        '</button>'
      );
    })
    .join('');
}

// Take one of those rooms: today, from the next slot boundary, for the length
// the strip is currently showing.
function bookFromNow(roomId, from) {
  const end = Math.min(DAY_END, from + state.freeNowMins);
  document.getElementById('date').value = state.date;
  document.getElementById('startHour').value = Math.floor(from / 60);
  document.getElementById('startMin').value = from % 60;
  document.getElementById('endHour').value = Math.floor(end / 60);
  syncEndMinutes();
  document.getElementById('endMin').value = end % 60;
  state.selectedRoom = +roomId;
  findRooms(roomId).then(loadTimeline);
  document.getElementById('bookingForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Timeline ----
function minutesOfDay(iso, baseDate) {
  if (!iso.startsWith(baseDate)) return null;
  return parseInt(iso.slice(11, 13), 10) * 60 + parseInt(iso.slice(14, 16), 10);
}

function hourLines() {
  // Gridline at the start of each hour column, but NOT at 100%: a 1px border at
  // the right edge would overflow and cause a scrollbar.
  const n = SPAN / 60;
  return Array.from({ length: n }, (_, i) => {
    const leftPct = ((i * 60) / SPAN) * 100;
    return `<div class="tl-hour" style="left:${leftPct}%"></div>`;
  }).join('');
}

// Label detail is chosen from real pixels, not a percentage of the day.
function innerPx(minutes) {
  return (minutes / 60) * PX_PER_HOUR - 18;
}

function renderFreeCells(room, busy) {
  // Free time is cut into clickable cells aligned to the hour grid, so one click
  // books exactly the hour it sits under.
  const cells = [];
  const emit = (from, to) => {
    if (to - from < 10) return;
    let a = from;
    while (a < to) {
      const b = Math.min(to, (Math.floor(a / 60) + 1) * 60);
      if (b - a >= 10) {
        const label = innerPx(b - a) >= 30 ? fmtMin(a) : '';
        const selected =
          state.selectedRoom === room.id &&
          timeMin('startHour', 'startMin') < b &&
          timeMin('endHour', 'endMin') > a;
        cells.push(
          `<button type="button" class="tl-free${selected ? ' is-selected' : ''}"` +
            ` style="left:${((a - DAY_START) / SPAN) * 100}%;width:calc(${((b - a) / SPAN) * 100}% - 3px)"` +
            ` data-room="${room.id}" data-start="${a}" data-end="${b}"` +
            ` title="Free ${fmtMin(a)}–${fmtMin(b)} · ${
              state.selectedRoom === room.id && a >= timeMin('endHour', 'endMin')
                ? 'shift-click to select up to ' + fmtMin(b)
                : 'click to book ' + escapeHtml(room.name)
            }">${label}</button>`
        );
      }
      a = b;
    }
  };

  let cursor = DAY_START;
  for (const b of busy) {
    if (b.end <= DAY_START || b.start >= DAY_END) continue;
    const s = Math.max(DAY_START, b.start);
    if (s > cursor) emit(cursor, s);
    cursor = Math.max(cursor, Math.min(DAY_END, b.end));
  }
  if (cursor < DAY_END) emit(cursor, DAY_END);
  return cells.join('');
}

// The invited people, on the same time axis as the rooms — the whole point of
// the screen is that one glance covers both. A last row collapses everybody
// into the times when nobody is busy, and clicking it picks that time.
const BUSY_LABEL = { busy: 'Busy', tentative: 'Tentative', out: 'Out of office', elsewhere: 'Working elsewhere' };

function renderPeopleRows() {
  const people = attendees();
  if (!people.length) return '';

  let html =
    '<div class="tl-grouprow is-people"><div class="g-name">People</div>' +
    `<div class="g-sum">${state.participants.length} invited${
      state.fbMode === 'sample' ? ' · sample times' : ''
    }</div></div>`;

  for (const p of people) {
    const entry = state.freeBusy[p.email.toLowerCase()];
    const bars = ((entry && entry.busy) || [])
      .filter((b) => b.end > DAY_START && b.start < DAY_END)
      .map((b) => {
        const s = Math.max(DAY_START, b.start);
        const e = Math.min(DAY_END, b.end);
        const label = BUSY_LABEL[b.status] || 'Busy';
        return (
          `<div class="tl-busy is-${escapeHtml(b.status)}" style="left:${((s - DAY_START) / SPAN) * 100}%;` +
          `width:${((e - s) / SPAN) * 100}%" title="${escapeHtml(
            `${p.name} · ${label} ${fmtMin(s)}–${fmtMin(e)}`
          )}"></div>`
        );
      })
      .join('');
    const failed = entry && entry.error;
    html +=
      `<div class="tl-row is-person${p.self ? ' is-you' : ''}"><div class="tl-roomcell">` +
      `<span class="tl-dot" style="background:${colorForDept(p.email)}"></span>` +
      `<span class="tl-roomname" title="${escapeHtml(p.email)}">${escapeHtml(
        p.self ? `${p.name} (you)` : p.name
      )}</span></div>` +
      `<div class="tl-track">${hourLines()}${
        failed ? '<div class="tl-nocal">Calendar not available</div>' : bars
      }</div></div>`;
  }

  const free = commonFreeBlocks();
  const slots = free
    .map(
      (f) =>
        `<button type="button" class="tl-allfree" data-free-start="${f.start}" data-free-end="${f.end}"` +
        ` style="left:${((f.start - DAY_START) / SPAN) * 100}%;width:calc(${
          ((f.end - f.start) / SPAN) * 100
        }% - 2px)" title="Everyone free ${fmtMin(f.start)}–${fmtMin(
          f.end
        )} · click to use this time">${innerPx(f.end - f.start) >= 44 ? fmtMin(f.start) : ''}</button>`
    )
    .join('');
  html +=
    '<div class="tl-row is-allfree"><div class="tl-roomcell">' +
    '<span class="tl-roomname">Everyone free</span></div>' +
    `<div class="tl-track">${hourLines()}${
      slots || '<div class="tl-nocal">No time when everyone is free</div>'
    }</div></div>`;
  return html;
}

function renderTimeline(bookingsByRoom) {
  const el = document.getElementById('timeline');
  const rooms = visibleRooms();
  if (rooms.length === 0) {
    el.innerHTML = '<div class="tl-empty-msg">No rooms registered.</div>';
    return;
  }

  const headHours = [];
  for (let m = DAY_START; m <= DAY_END; m += 60) {
    const leftPct = ((m - DAY_START) / SPAN) * 100;
    // Every label is centred on its hour line except the first and last, which
    // would overflow the track and be hidden under the room column. The first
    // gets a small gap so it doesn't sit right against the column border; the
    // last is flush right, since insetting it too runs into the 19:00 label.
    const tx =
      m === DAY_END ? 'translateX(-100%)' : m === DAY_START ? 'translateX(6px)' : 'translateX(-50%)';
    const line = m < DAY_END ? `<div class="tl-hour" style="left:${leftPct}%"></div>` : '';
    headHours.push(
      line + `<div class="tl-hourlabel" style="left:${leftPct}%;transform:${tx}">${m / 60}:00</div>`
    );
  }

  const minWidth = ROOM_COL_PX + (SPAN / 60) * PX_PER_HOUR;
  let html = `<div class="tl-grid" style="min-width:${minWidth}px">`;
  // One line down the whole grid marking this minute. Positioned against the
  // track rather than the grid, so it lands on the same x as the bars do.
  const now = nowMinutes();
  if (isToday() && now >= DAY_START && now <= DAY_END) {
    // The track starts after the sticky room column and fills the rest, so the
    // line sits that far into what remains — expressed in CSS so it stays right
    // when the grid is wider than the panel and scrolls.
    const frac = ((now - DAY_START) / SPAN).toFixed(5);
    html +=
      `<div class="tl-nowline" style="left:calc(var(--tl-room-w) + (100% - var(--tl-room-w)) * ${frac})"` +
      ` aria-hidden="true"><span class="tl-nowdot"></span>` +
      `<span class="tl-nowtime">${fmtMin(now)}</span></div>`;
  }
  html += `<div class="tl-row tl-head"><div class="tl-roomcell">Room</div><div class="tl-track">${headHours.join(
    ''
  )}</div></div>`;

  html += renderPeopleRows();

  for (const loc of sortedLocations(rooms)) {
    const locRooms = rooms.filter((r) => (r.location || 'Other') === loc);
    const locBookings = locRooms.reduce((n, r) => n + (bookingsByRoom[r.id] || []).length, 0);
    html +=
      `<div class="tl-grouprow"><div class="g-name">${escapeHtml(loc)}</div>` +
      `<div class="g-sum">${locRooms.length} rooms · ${locBookings} bookings</div></div>`;

    for (const room of locRooms) {
      const list = (bookingsByRoom[room.id] || [])
        .map((b) => {
          let s = minutesOfDay(b.start_at, state.date);
          let e = minutesOfDay(b.end_at, state.date);
          return { b, start: s == null ? DAY_START : s, end: e == null ? DAY_END : e };
        })
        .sort((a, z) => a.start - z.start);

      const bars = list
        .filter((x) => x.end > DAY_START && x.start < DAY_END)
        .map((x) => {
          const s = Math.max(DAY_START, x.start);
          const e = Math.min(DAY_END, x.end);
          const leftPct = ((s - DAY_START) / SPAN) * 100;
          const widthPct = ((e - s) / SPAN) * 100;
          // How much the bar can say depends on how wide it is. A half-hour
          // booking is 30px and fits no time at all, but the grid already shows
          // when it is — so it gets the department code instead, which is the
          // part you cannot read off the position.
          const barPx = ((e - s) / 60) * PX_PER_HOUR;
          const range = `${fmtClock(x.b.start_at.slice(11, 16))}–${fmtClock(x.b.end_at.slice(11, 16))}`;
          const narrow = barPx < 50 && barPx >= 24;
          const time = barPx >= 84 ? range : barPx >= 50 ? fmtClock(x.b.start_at.slice(11, 16)) : '';
          const sub = barPx >= 50 ? x.b.purpose || x.b.department : narrow ? x.b.department : '';
          const title = x.b.mine
            ? `${range} ${x.b.purpose || ''} / your booking`
            : `${range} ${x.b.purpose || ''} / ${x.b.department} ${x.b.reserver}`;
          return (
            `<div class="tl-booking${x.b.mine ? ' is-mine' : ''}${narrow ? ' is-narrow' : ''}" style="left:${leftPct}%;width:${widthPct}%;background:${colorForDept(
              x.b.department
            )}"` +
            ` data-booking='${escapeHtml(JSON.stringify(x.b))}' title="${escapeHtml(title)}">` +
            `<span class="tl-time">${escapeHtml(time)}</span>` +
            `<span class="tl-purpose">${escapeHtml(sub)}</span></div>`
          );
        })
        .join('');

      html +=
        `<div class="tl-row"><div class="tl-roomcell">` +
        // The name carries its own tooltip: on a narrow screen the column is
        // too small for the longest of them and the end is cut off.
        `<span class="tl-roomname" title="${escapeHtml(room.name)}">${escapeHtml(
          room.name
        )}</span>` +
        (roomFacts(room) ? `<span class="tl-roomfacts">${escapeHtml(roomFacts(room))}</span>` : '') +
        '</div>' +
        `<div class="tl-track" data-room="${room.id}">${hourLines()}${renderFreeCells(
          room,
          list
        )}${bars}</div></div>`;
    }
  }
  html += '</div>';
  el.innerHTML = html;
}

function renderLocationFilters() {
  const el = document.getElementById('locFilters');
  const locs = ['All', ...sortedLocations(state.rooms)];
  el.innerHTML = locs
    .map((loc) => {
      const n = loc === 'All' ? state.rooms.length : state.rooms.filter((r) => (r.location || 'Other') === loc).length;
      const active = state.locFilter === loc ? ' active' : '';
      return `<button type="button" class="chip${active}" data-loc="${escapeHtml(loc)}">${escapeHtml(
        loc
      )}<span class="n">${n}</span></button>`;
    })
    .join('');
}

async function loadTimeline() {
  state.date = document.getElementById('tlDate').value || todayStr();
  document.getElementById('tlDateLabel').textContent = dayLabel(state.date);
  try {
    // Rooms come from a catalog that only changes on deploy, so they are fetched
    // once and kept — paging through a week was re-fetching the same 13 rows
    // with every arrow click.
    const [rooms, list] = await Promise.all([
      state.rooms.length ? state.rooms : api('/api/rooms'),
      api(`/api/bookings?from=${state.date}T00:00&to=${state.date}T23:59`),
    ]);
    state.rooms = rooms;
    renderLocationFilters();
    const byRoom = {};
    for (const b of list) (byRoom[b.room_id] = byRoom[b.room_id] || []).push(b);
    state.byRoom = byRoom;
    renderFreeNow(byRoom);
    renderTimeline(byRoom);
  } catch (err) {
    document.getElementById('timeline').innerHTML =
      `<div class="tl-empty-msg text-danger">${escapeHtml(err.message)}</div>`;
  }
}

function shiftDay(delta) {
  const d = new Date(`${document.getElementById('tlDate').value || todayStr()}T00:00`);
  d.setDate(d.getDate() + delta);
  document.getElementById('tlDate').value =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // Calendars are fetched a day at a time, so moving day has to fetch again.
  // With nobody invited this falls straight through to loadTimeline().
  refreshFreeBusy();
}

// Take a stretch when everyone is free and put it in the form. The whole block
// is rarely the meeting — keep the length already chosen and start it here,
// rather than proposing a four-hour booking because that much happens to be
// free.
function useTimeRange(blockStart, blockEnd) {
  const slot = state.config.slotMinutes;
  const current = timeMin('endHour', 'endMin') - timeMin('startHour', 'startMin');
  const length = Math.max(slot, Math.min(current > 0 ? current : 60, blockEnd - blockStart));
  const s = Math.max(DAY_START, Math.floor(blockStart / slot) * slot);
  const e = Math.min(blockEnd, DAY_END, s + length);

  document.getElementById('date').value = state.date;
  document.getElementById('startHour').value = Math.floor(s / 60);
  document.getElementById('startMin').value = s % 60;
  document.getElementById('endHour').value = Math.floor(e / 60);
  syncEndMinutes();
  document.getElementById('endMin').value = e % 60;
  findRooms().then(loadTimeline);
}

// How far the room stays free without a break, starting at `from`. Used to keep a
// shift-click from spanning an hour someone else has already booked.
function freeUntil(roomId, from) {
  const cells = [...document.querySelectorAll(`.tl-free[data-room="${roomId}"]`)]
    .map((c) => [+c.getAttribute('data-start'), +c.getAttribute('data-end')])
    .sort((a, b) => a[0] - b[0]);
  let reach = from;
  for (const [a, b] of cells) {
    if (b <= reach) continue;
    if (a > reach) break; // a booked hour in between
    reach = b;
  }
  return reach;
}

// A plain click always starts a fresh one-hour selection on that slot.
// Shift-clicking a later slot in the same room stretches the selection out to it.
function startFromCell(roomId, startMin, endMin, shiftKey = false) {
  const slot = state.config.slotMinutes;
  const curStart = timeMin('startHour', 'startMin');
  const spanning = shiftKey && state.selectedRoom === +roomId && endMin > curStart;

  let s = spanning
    ? curStart
    : Math.max(DAY_START, Math.floor(startMin / slot) * slot);
  s = Math.min(s, DAY_END - slot);
  let e = Math.min(Math.max(endMin, s + slot), DAY_END);
  // Stop at the first booked hour rather than selecting across it.
  if (spanning) e = Math.min(e, Math.max(freeUntil(roomId, s), s + slot));
  state.selectedRoom = +roomId;
  document.getElementById('date').value = state.date;
  document.getElementById('startHour').value = Math.floor(s / 60);
  document.getElementById('startMin').value = s % 60;
  document.getElementById('endHour').value = Math.floor(e / 60);
  syncEndMinutes();
  document.getElementById('endMin').value = e % 60;
  findRooms(roomId).then(loadTimeline);
}

// ---- Giving the room back, and keeping it a bit longer ---------------------
//
// Borrowed from the room displays the paid products sell: a meeting that
// finishes at twenty past should not hold the room until the hour. Both of
// these move only the end time, so they work on a booking already under way.

function isRunning(b) {
  if (b.start_at.slice(0, 10) !== todayStr()) return false;
  const now = nowMinutes();
  return minutesOfDay(b.start_at, b.start_at.slice(0, 10)) <= now &&
    minutesOfDay(b.end_at, b.start_at.slice(0, 10)) > now;
}

// End it at the next slot boundary — never before it started, never later than
// it was already going to end.
async function endNow(b) {
  const slot = state.config.slotMinutes;
  const start = minutesOfDay(b.start_at, b.start_at.slice(0, 10));
  const end = minutesOfDay(b.end_at, b.start_at.slice(0, 10));
  const at = Math.min(end, Math.max(start + slot, Math.ceil(nowMinutes() / slot) * slot));
  if (at >= end) {
    alert('This booking is already about to end.');
    return false;
  }
  return saveEnd(b, at, `Room freed from ${fmtMin(at)}.`);
}

async function extendBy(b, mins) {
  const end = minutesOfDay(b.end_at, b.start_at.slice(0, 10));
  const at = Math.min(DAY_END, end + mins);
  if (at <= end) {
    alert('This booking already runs to the end of the day.');
    return false;
  }
  return saveEnd(b, at, `Extended to ${fmtMin(at)}.`);
}

async function saveEnd(b, endMin, okMessage) {
  const date = b.start_at.slice(0, 10);
  try {
    await api(`/api/bookings/${b.id}`, {
      method: 'PUT',
      body: JSON.stringify({ end_at: `${date}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}` }),
    });
    showAlert(okMessage, 'success');
    loadTimeline();
    findRooms();
    return true;
  } catch (err) {
    // The usual reason an extension fails is that somebody has the next slot.
    showAlert(err.message, 'danger');
    return false;
  }
}

// ---- Telling the people you invited ----------------------------------------
//
// Sending mail from the server needs the company mail server, which needs IT.
// Opening the mail the user is already signed in to needs nothing, sends from
// their own address, and leaves a copy in their Sent items — so that is what
// this does. The calendar file is linked rather than attached, because a
// mailto: cannot carry an attachment.

function bookingMail(b) {
  const to = (b.participants || []).map((p) => p.email).join(',');
  const date = b.start_at.slice(0, 10);
  const when = `${dayLabel(date)}, ${fmtClock(b.start_at.slice(11, 16))}\u2013${fmtClock(
    b.end_at.slice(11, 16)
  )}`;
  const lines = [
    `When:  ${when}`,
    `Where: ${b.room_name}`,
  ];
  if (b.meeting_url) lines.push(`Join:  ${b.meeting_url}`);
  lines.push('', `Add it to your calendar: ${location.origin}/api/bookings/${b.id}/ics`);
  lines.push('', `Booked by ${b.reserver} (${b.department})`);

  const subject = b.purpose ? `Meeting: ${b.purpose}` : `Meeting room booked \u2014 ${b.room_name}`;
  return (
    `mailto:${encodeURIComponent(to)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(lines.join('\r\n'))}`
  );
}

function openBookingMail(b) {
  if (!(b.participants || []).length) return false;
  location.href = bookingMail(b);
  return true;
}

// ---- Changing a booking, and finding your own ------------------------------
//
// Until now the only way to move a booking was to cancel it and make another,
// which loses the room in between — someone else can take it in the gap.

function setEditing(booking) {
  state.editing = booking;
  const banner = document.getElementById('editBanner');
  banner.hidden = !booking;
  if (booking) {
    banner.firstChild.textContent =
      `Changing ${booking.reserver}'s booking on ${fmtStamp(booking.start_at)}. `;
  }
  updateBookButton();
}

// Load a booking into the form so it can be adjusted and saved back.
function editBooking(b) {
  setEditing(b);
  const date = b.start_at.slice(0, 10);
  const s = minutesOfDay(b.start_at, date);
  const e = minutesOfDay(b.end_at, date);
  document.getElementById('date').value = date;
  document.getElementById('tlDate').value = date;
  document.getElementById('startHour').value = Math.floor(s / 60);
  document.getElementById('startMin').value = s % 60;
  document.getElementById('endHour').value = Math.floor(e / 60);
  syncEndMinutes();
  document.getElementById('endMin').value = e % 60;
  document.getElementById('department').value = b.department;
  document.getElementById('reserver').value = b.reserver;
  document.getElementById('purpose').value = b.purpose || '';
  document.getElementById('meetingUrl').value = b.meeting_url || '';
  if (Array.isArray(b.participants) && b.participants.length) {
    state.participants = b.participants.map((p) => ({ name: p.name, email: p.email }));
    saveParticipants();
    renderParticipants();
  }
  state.selectedRoom = b.room_id;
  findRooms(b.room_id).then(loadTimeline);
  document.getElementById('bookingForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let myModal = null;

// Everything this browser booked that has not happened yet. Bookings are
// identified by device, so this is the only list of "mine" that exists without
// a login — and the only way to find one without knowing its date.
async function loadMyBookings() {
  const body = document.getElementById('myBody');
  body.innerHTML = '<div class="text-secondary">Loading…</div>';
  try {
    const now = new Date();
    const from = `${todayStr()}T00:00`;
    const ahead = new Date(now);
    ahead.setDate(ahead.getDate() + state.config.windowHrDays + 1);
    const to = `${ahead.getFullYear()}-${pad(ahead.getMonth() + 1)}-${pad(ahead.getDate())}T00:00`;
    const rows = await api(`/api/bookings?from=${from}&to=${to}`);
    const mine = rows.filter((b) => b.mine);
    updateMyCount(mine.length);
    if (!mine.length) {
      body.innerHTML =
        '<div class="text-secondary">Nothing booked from this computer yet.<br>' +
        'Bookings are remembered per computer, so one made elsewhere will not appear here.</div>';
      return;
    }
    body.innerHTML =
      '<div class="mine-list">' +
      mine
        .map(
          (b) =>
            `<div class="mine-row" data-booking='${escapeHtml(JSON.stringify(b))}'>` +
            `<div class="m-when"><b>${escapeHtml(fmtStamp(b.start_at))}</b>` +
            `<span>–${escapeHtml(fmtClock(b.end_at.slice(11, 16)))}</span></div>` +
            `<div class="m-what"><b>${escapeHtml(b.room_name)}</b>` +
            `<span>${escapeHtml(b.purpose || b.department)}</span></div>` +
            '<div class="m-act">' +
            (isRunning(b)
              ? '<button type="button" class="btn btn-sm btn-success" data-act="end">Free the room</button>'
              : '') +
            `<button type="button" class="btn btn-sm btn-outline-primary" data-act="edit">Change</button>` +
            `<a class="btn btn-sm btn-outline-secondary" href="/api/bookings/${b.id}/ics">Calendar</a>` +
            `<button type="button" class="btn btn-sm btn-outline-danger" data-act="cancel">Cancel</button>` +
            '</div></div>'
        )
        .join('') +
      '</div>';
  } catch (err) {
    body.innerHTML = `<div class="text-danger">${escapeHtml(err.message)}</div>`;
  }
}

function updateMyCount(n) {
  const el = document.getElementById('myCount');
  el.hidden = !n;
  el.textContent = n || '';
}

// ---- Booking detail modal ----
function openDetail(b) {
  state.detailBooking = b;
  // Anyone can cancel anything, so make it unmistakable whose booking this is
  // before the cancel button is within reach.
  // Only the computer that made a booking can cancel it, so for anyone else
  // the button is not there to press — showing a disabled one, or one that
  // fails when clicked, just invites the question.
  const banner = b.mine
    ? '<div class="own-note mb-3">You booked this from this computer.</div>'
    : `<div class="other-note mb-3">Booked by <strong>${escapeHtml(b.reserver)}</strong>` +
      ` (${escapeHtml(b.department)}) on another computer.<br>` +
      'Only that computer can cancel it — please ask them.</div>';
  const cancelBtn = document.getElementById('detailCancel');
  cancelBtn.hidden = !b.mine;
  cancelBtn.textContent = 'Cancel my booking';
  const people = (b.participants || []).length
    ? `<dt class="col-4">Participants</dt><dd class="col-8">${b.participants
        .map((p) => `<div title="${escapeHtml(p.email)}">${escapeHtml(p.name)}</div>`)
        .join('')}</dd>`
    : '';
  // Only ever an http(s) address — the server refuses to store anything else,
  // which is what makes it safe to put in an href here.
  const link = b.meeting_url
    ? `<dt class="col-4">Meeting link</dt><dd class="col-8">` +
      `<a href="${escapeHtml(b.meeting_url)}" target="_blank" rel="noopener noreferrer">Join</a></dd>`
    : '';
  document.getElementById('detailBody').innerHTML = banner + `
    <dl class="row mb-3">
      <dt class="col-4">Room</dt><dd class="col-8">${escapeHtml(b.room_name)}</dd>
      <dt class="col-4">Start</dt><dd class="col-8">${escapeHtml(fmtStamp(b.start_at))}</dd>
      <dt class="col-4">End</dt><dd class="col-8">${escapeHtml(fmtStamp(b.end_at))}</dd>
      <dt class="col-4">Department</dt><dd class="col-8">${escapeHtml(b.department)}</dd>
      <dt class="col-4">Name</dt><dd class="col-8">${escapeHtml(b.reserver)}</dd>
      <dt class="col-4">Purpose</dt><dd class="col-8">${escapeHtml(b.purpose || '-')}</dd>
      ${people}${link}
    </dl>
    <a class="btn btn-outline-primary btn-sm" href="/api/bookings/${b.id}/ics">Add to Outlook</a>` +
    ((b.participants || []).length
      ? ` <a class="btn btn-outline-primary btn-sm" href="${escapeHtml(
          bookingMail(b)
        )}">Email participants</a>`
      : '') +
    (b.mine
      ? ' <button type="button" class="btn btn-outline-secondary btn-sm" id="detailEdit">Change this booking</button>'
      : '') +
    (b.mine && isRunning(b)
      ? '<div class="running-acts"><span>Meeting under way</span>' +
        '<button type="button" class="btn btn-sm btn-success" id="detailEndNow">Finished — free the room</button>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" data-extend="10">+10 min</button>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" data-extend="30">+30 min</button></div>'
      : '');
  if (b.mine) {
    document.getElementById('detailEdit').addEventListener('click', () => {
      detailModal.hide();
      editBooking(b);
    });
  }
  if (b.mine && isRunning(b)) {
    document.getElementById('detailEndNow').addEventListener('click', async () => {
      if (await endNow(b)) detailModal.hide();
    });
    for (const btn of document.querySelectorAll('#detailBody [data-extend]')) {
      btn.addEventListener('click', async () => {
        if (await extendBy(b, +btn.getAttribute('data-extend'))) detailModal.hide();
      });
    }
  }
  detailModal.show();
}

async function cancelDetail() {
  if (!state.detailBooking) return;
  const b = state.detailBooking;
  const when = `${fmtStamp(b.start_at)}\u2013${fmtClock(b.end_at.slice(11, 16))}`;
  if (!confirm(`Cancel your booking?\n\n${b.room_name}  ${when}`)) return;
  try {
    await api(`/api/bookings/${state.detailBooking.id}`, { method: 'DELETE' });
    detailModal.hide();
    loadTimeline();
    findRooms();
  } catch (err) {
    alert(err.message);
  }
}

async function init() {
  detailModal = new bootstrap.Modal(document.getElementById('detailModal'));

  document.getElementById('bookingForm').addEventListener('submit', submitBooking);
  document.getElementById('department').addEventListener('change', () => {
    updateRuleHint();
    updateBookButton();
    rememberCurrent();
  });
  document.getElementById('reserver').addEventListener('input', updateBookButton);
  document.getElementById('reserver').addEventListener('change', rememberCurrent);
  document.getElementById('endHour').addEventListener('change', () => {
    syncEndMinutes();
    findRooms().then(loadTimeline);
  });
  ['date', 'startHour', 'startMin', 'endMin'].forEach((id) =>
    document.getElementById(id).addEventListener('change', () => findRooms().then(loadTimeline))
  );
  document.getElementById('dateToday').addEventListener('click', () => {
    document.getElementById('date').value = todayStr();
    findRooms().then(loadTimeline);
  });
  document.getElementById('roomId').addEventListener('change', (e) => {
    state.selectedRoom = e.target.value ? +e.target.value : null;
    updateBookButton();
    loadTimeline();
  });
  document.getElementById('prevDay').addEventListener('click', () => shiftDay(-1));
  document.getElementById('nextDay').addEventListener('click', () => shiftDay(1));
  document.getElementById('today').addEventListener('click', () => {
    document.getElementById('tlDate').value = todayStr();
    refreshFreeBusy();
  });
  document.getElementById('tlDate').addEventListener('change', refreshFreeBusy);

  // Participants
  // The browser's own complaint about a bad URL is "Please enter a URL", which
  // does not say what is wrong with the one that was pasted. Say it properly,
  // in the same words the server would use if it got this far.
  const meetingUrl = document.getElementById('meetingUrl');
  meetingUrl.addEventListener('input', () => {
    const value = meetingUrl.value.trim();
    let bad = '';
    if (value) {
      try {
        const u = new URL(value);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') bad = 'https';
      } catch (err) {
        bad = 'url';
      }
    }
    meetingUrl.setCustomValidity(
      bad ? 'Paste the whole link, starting with https:// — for example https://teams.microsoft.com/…' : ''
    );
  });

  document.getElementById('seats').addEventListener('change', () => findRooms().then(loadTimeline));
  document.getElementById('editCancel').addEventListener('click', () => {
    setEditing(null);
    findRooms();
  });

  // "Free right now": pick a length, or take a room straight from the strip.
  document.getElementById('freeNowDurs').addEventListener('click', (e) => {
    const btn = e.target.closest('.fn-dur');
    if (!btn) return;
    state.freeNowMins = +btn.getAttribute('data-mins');
    renderFreeNow(state.byRoom || {});
  });
  document.getElementById('freeNowList').addEventListener('click', (e) => {
    const btn = e.target.closest('.fn-room');
    if (btn) bookFromNow(btn.getAttribute('data-room'), +btn.getAttribute('data-from'));
  });

  // Your own bookings
  myModal = new bootstrap.Modal(document.getElementById('myModal'));
  document.getElementById('myBookingsBtn').addEventListener('click', () => {
    myModal.show();
    loadMyBookings();
  });
  document.getElementById('myBody').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const b = JSON.parse(act.closest('.mine-row').getAttribute('data-booking'));
    if (act.getAttribute('data-act') === 'edit') {
      myModal.hide();
      editBooking(b);
      return;
    }
    if (act.getAttribute('data-act') === 'end') {
      if (await endNow(b)) loadMyBookings();
      return;
    }
    const when = `${fmtStamp(b.start_at)}\u2013${fmtClock(b.end_at.slice(11, 16))}`;
    if (!confirm(`Cancel your booking?\n\n${b.room_name}  ${when}`)) return;
    try {
      await api(`/api/bookings/${b.id}`, { method: 'DELETE' });
      loadMyBookings();
      loadTimeline();
      findRooms();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('myEmail').addEventListener('change', () => {
    rememberCurrent();
    refreshFreeBusy();
  });
  document.getElementById('personSearch').addEventListener('input', onPersonSearch);
  document.getElementById('personSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideSuggestions();
  });
  document.getElementById('personSuggest').addEventListener('click', (e) => {
    const btn = e.target.closest('.sugg');
    if (!btn) return;
    addParticipant({ name: btn.getAttribute('data-name'), email: btn.getAttribute('data-email') });
    document.getElementById('personSearch').value = '';
    hideSuggestions();
  });
  document.getElementById('participantList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (btn) removeParticipant(+btn.getAttribute('data-remove'));
  });
  // Clicking away closes the suggestion list; without this it sits over the
  // form until something else is typed.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.people-pick')) hideSuggestions();
  });
  document.getElementById('detailCancel').addEventListener('click', cancelDetail);

  document.getElementById('locFilters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-loc]');
    if (!chip) return;
    state.locFilter = chip.getAttribute('data-loc');
    renderLocationFilters();
    findRooms().then(loadTimeline);
  });

  // Timeline clicks: bar -> details, free cell -> book that room/hour
  document.getElementById('timeline').addEventListener('click', (e) => {
    const bar = e.target.closest('.tl-booking');
    if (bar) {
      openDetail(JSON.parse(bar.getAttribute('data-booking')));
      return;
    }
    const allFree = e.target.closest('.tl-allfree');
    if (allFree) {
      useTimeRange(+allFree.getAttribute('data-free-start'), +allFree.getAttribute('data-free-end'));
      return;
    }
    const cell = e.target.closest('.tl-free');
    if (cell) {
      startFromCell(
        cell.getAttribute('data-room'),
        +cell.getAttribute('data-start'),
        +cell.getAttribute('data-end'),
        e.shiftKey
      );
    }
  });

  try {
    const [cfg, user] = await Promise.all([api('/api/config'), api('/api/auth/me')]);
    state.config = cfg;
    setLocationOrder(cfg.locations);
    DAY_START = cfg.businessStartHour * 60;
    DAY_END = cfg.businessEndHour * 60;
    SPAN = DAY_END - DAY_START;

    document.getElementById('appVersion').textContent = cfg.version ? `v${cfg.version}` : '';
    document.getElementById('tlRangeNote').textContent =
      `Shown range ${cfg.businessStartHour}:00–${cfg.businessEndHour}:00. ` +
      'Click a booking for details. Click a dashed slot to book that hour, then ' +
      'shift-click a later one to select everything up to it.';
    // With a real login the server knows who this is and the fields are fixed.
    // Without one ("mock"), whoever books types it once and the browser keeps it.
    state.authMode = user.mode;
    const me =
      user.mode === 'mock'
        ? remembered()
        : { name: user.name, department: user.department };

    fillDepartments(cfg.departments || [], me.department);
    document.getElementById('reserver').value = me.name || '';
    document.getElementById('myEmail').value = me.email || '';
    updateUserChip(me.name, document.getElementById('department').value);
    if (user.mode !== 'mock') {
      document.getElementById('department').disabled = true;
      document.getElementById('reserver').readOnly = true;
    }
    document.getElementById('date').value = todayStr();
    document.getElementById('tlDate').value = todayStr();

    fillTimeControls();
    updateRuleHint();
    // The line marking now, and what is free from now, both go stale on a
    // screen nobody has touched since the morning.
    setInterval(() => {
      if (isToday()) {
        renderFreeNow(state.byRoom || {});
        renderTimeline(state.byRoom || {});
      }
    }, NOW_TICK_MS);
    state.participants = loadParticipants();
    renderParticipants();
    await loadTimeline();
    // After the rooms are in: the size filter is built from their capacities.
    fillSeatOptions();
    findRooms();
    loadMyBookings().catch(() => {});
    // Calendars are fetched after the schedule is on screen: the room grid is
    // the part that must not wait on Microsoft answering.
    if (attendees().length) refreshFreeBusy();
  } catch (err) {
    showAlert(`Initialization failed: ${err.message}`);
  }
}

document.addEventListener('DOMContentLoaded', init);
