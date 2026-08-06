'use strict';

// Visible timeline window (minutes). Set from business hours in init();
// the deployment runs 08:00-20:00 (BUSINESS_START_HOUR / BUSINESS_END_HOUR).
let DAY_START = 8 * 60;
let DAY_END = 20 * 60;
let SPAN = DAY_END - DAY_START;

// One hour is always this wide, so bar labels never collapse. The grid scrolls
// horizontally on narrow screens rather than squeezing the day.
const PX_PER_HOUR = 60;
const ROOM_COL_PX = 172;

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
};

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

function remember(name, department) {
  try {
    localStorage.setItem(ME_KEY, JSON.stringify({ name, department }));
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
  remember(name, department);
  updateUserChip(name, department);
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
  if (!state.participants.length) {
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
      body: JSON.stringify({ date, emails: state.participants.map((p) => p.email) }),
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
  for (const p of state.participants) {
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
  btn.textContent = !room
    ? 'Select a room first'
    : !department
      ? 'Select your department'
      : !reserver
        ? 'Enter your name'
        : `Book ${room.name} · ${fmtMin(timeMin('startHour', 'startMin'))}–${fmtMin(timeMin('endHour', 'endMin'))}`;
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
    // Respect the location filter so the dropdown matches the schedule below
    const available =
      state.locFilter === 'All'
        ? data.available
        : data.available.filter((r) => (r.location || 'Other') === state.locFilter);

    if (available.length === 0) {
      hint.textContent = `No rooms available for ${fmtClock(startStr)}–${fmtClock(endStr)}.`;
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
              .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`)
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
    const created = await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
    // The booking is made; the next thing anyone wants is it in their own
    // calendar, so offer that here rather than making them find the booking
    // again to get at it.
    showAlert(
      `Reservation created. <a class="alert-link" href="/api/bookings/${created.id}/ics">Add to Outlook</a>`,
      'success',
      { html: true }
    );
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
  if (!state.participants.length) return '';

  let html =
    '<div class="tl-grouprow is-people"><div class="g-name">People</div>' +
    `<div class="g-sum">${state.participants.length} invited${
      state.fbMode === 'sample' ? ' · sample times' : ''
    }</div></div>`;

  for (const p of state.participants) {
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
      '<div class="tl-row is-person"><div class="tl-roomcell">' +
      `<span class="tl-dot" style="background:${colorForDept(p.email)}"></span>` +
      `<span class="tl-roomname" title="${escapeHtml(p.email)}">${escapeHtml(p.name)}</span></div>` +
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
        `<span class="tl-roomname">${escapeHtml(room.name)}</span></div>` +
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
    <a class="btn btn-outline-primary btn-sm" href="/api/bookings/${b.id}/ics">Add to Outlook</a>`;
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
    updateUserChip(me.name, document.getElementById('department').value);
    if (user.mode !== 'mock') {
      document.getElementById('department').disabled = true;
      document.getElementById('reserver').readOnly = true;
    }
    document.getElementById('date').value = todayStr();
    document.getElementById('tlDate').value = todayStr();

    fillTimeControls();
    updateRuleHint();
    state.participants = loadParticipants();
    renderParticipants();
    await loadTimeline();
    findRooms();
    // Calendars are fetched after the schedule is on screen: the room grid is
    // the part that must not wait on Microsoft answering.
    if (state.participants.length) refreshFreeBusy();
  } catch (err) {
    showAlert(`Initialization failed: ${err.message}`);
  }
}

document.addEventListener('DOMContentLoaded', init);
