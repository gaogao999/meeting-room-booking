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
  date: null,
  rooms: [],
  locFilter: 'All',
  selectedRoom: null,
  detailBooking: null,
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

function showAlert(message, type = 'danger') {
  document.getElementById('formAlert').innerHTML =
    `<div class="alert alert-${type} alert-dismissible fade show" role="alert">${escapeHtml(
      message
    )}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
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
  const isHr = state.config.hrDepartments.some((k) =>
    dep.toLowerCase().includes(String(k).toLowerCase())
  );
  const days = isHr ? state.config.windowHrDays : state.config.windowDefaultDays;
  const kind = isHr ? 'HR department' : 'General department';
  document.getElementById('ruleHint').innerHTML =
    `${kind} — book up to <strong>${days} days</strong> ahead, in ${state.config.slotMinutes}-minute steps.`;
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
  btn.disabled = !sel.value;
  btn.textContent = room
    ? `Book ${room.name} · ${fmtMin(timeMin('startHour', 'startMin'))}–${fmtMin(timeMin('endHour', 'endMin'))}`
    : 'Select a room first';
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
  const payload = {
    room_id: roomId,
    department: document.getElementById('department').value,
    reserver: document.getElementById('reserver').value,
    purpose: document.getElementById('purpose').value,
    start_at: `${date}T${timeStr('startHour', 'startMin')}`,
    end_at: `${date}T${timeStr('endHour', 'endMin')}`,
  };
  try {
    await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
    showAlert('Reservation created.', 'success');
    document.getElementById('purpose').value = '';
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
          const px = innerPx(e - s);
          const range = `${fmtClock(x.b.start_at.slice(11, 16))}–${fmtClock(x.b.end_at.slice(11, 16))}`;
          const time = px >= 66 ? range : px >= 32 ? fmtClock(x.b.start_at.slice(11, 16)) : '';
          const sub = px >= 32 ? x.b.purpose || x.b.department : '';
          const title = `${range} ${x.b.purpose || ''} / ${x.b.department} ${x.b.reserver}`;
          return (
            `<div class="tl-booking" style="left:${leftPct}%;width:${widthPct}%;background:${colorForDept(
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
    const [rooms, list] = await Promise.all([
      api('/api/rooms'),
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
  loadTimeline();
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
  document.getElementById('detailBody').innerHTML = `
    <dl class="row mb-0">
      <dt class="col-4">Room</dt><dd class="col-8">${escapeHtml(b.room_name)}</dd>
      <dt class="col-4">Start</dt><dd class="col-8">${escapeHtml(fmtStamp(b.start_at))}</dd>
      <dt class="col-4">End</dt><dd class="col-8">${escapeHtml(fmtStamp(b.end_at))}</dd>
      <dt class="col-4">Department</dt><dd class="col-8">${escapeHtml(b.department)}</dd>
      <dt class="col-4">Name</dt><dd class="col-8">${escapeHtml(b.reserver)}</dd>
      <dt class="col-4">Purpose</dt><dd class="col-8">${escapeHtml(b.purpose || '-')}</dd>
    </dl>`;
  detailModal.show();
}

async function cancelDetail() {
  if (!state.detailBooking) return;
  if (!confirm('Cancel this booking?')) return;
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
  document.getElementById('department').addEventListener('input', updateRuleHint);
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
    loadTimeline();
  });
  document.getElementById('tlDate').addEventListener('change', loadTimeline);
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
    if (user.name) {
      document.getElementById('currentUser').hidden = false;
      document.getElementById('userName').textContent = user.name;
      document.getElementById('userDept').textContent = user.department || '';
      document.getElementById('userInitials').textContent = user.name
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
    }
    document.getElementById('department').value = user.department || '';
    document.getElementById('reserver').value = user.name || '';
    document.getElementById('date').value = todayStr();
    document.getElementById('tlDate').value = todayStr();

    fillTimeControls();
    updateRuleHint();
    await loadTimeline();
    findRooms();
  } catch (err) {
    showAlert(`Initialization failed: ${err.message}`);
  }
}

document.addEventListener('DOMContentLoaded', init);
