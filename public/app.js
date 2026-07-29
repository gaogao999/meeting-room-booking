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

// Bookings are coloured by department so the same team reads the same colour
// everywhere (schedule, legend, analytics).
const DEPT_COLORS = {
  engineering: '#2563eb',
  sales: '#0f766e',
  'quality assurance': '#b45309',
  'production control': '#6d28d9',
  hr: '#be185d',
  'human resources': '#be185d',
  'general affairs': '#475569',
  maintenance: '#15803d',
};
// Fallback palette for departments not in the map above (all dark enough for white text)
const PALETTE = ['#2563eb', '#0f766e', '#b45309', '#6d28d9', '#be185d', '#475569', '#15803d', '#0e7490'];

// Locations are shown in this order; anything unknown is appended alphabetically.
const LOCATION_ORDER = ['Bangna Office', 'Factory 1', 'Factory 2', 'Factory 3'];

const state = {
  config: {
    slotMinutes: 10,
    businessStartHour: 8,
    businessEndHour: 20,
    windowDefaultDays: 90,
    windowHrDays: 180,
    hrDepartments: [],
  },
  user: { name: '', department: '' },
  date: null,
  rooms: [],
  locFilter: 'All',
  selectedRoom: null,
  detailBooking: null,
};

let detailModal = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error (${res.status})`);
  return data;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtMin(m) {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function durText(m) {
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} m` : `${h} h`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(iso) {
  const d = new Date(`${iso}T00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function colorForDept(department) {
  const key = String(department || '').toLowerCase().trim();
  if (DEPT_COLORS[key]) return DEPT_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % PALETTE.length;
  return PALETTE[h];
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

function sortedLocations(rooms) {
  const seen = [...new Set(rooms.map((r) => r.location || 'Other'))];
  const known = LOCATION_ORDER.filter((l) => seen.includes(l));
  const rest = seen.filter((l) => !LOCATION_ORDER.includes(l)).sort();
  return [...known, ...rest];
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
  startHour.innerHTML = startHours.map((h) => `<option value="${h}">${pad(h)}</option>`).join('');
  endHour.innerHTML = endHours.map((h) => `<option value="${h}">${pad(h)}</option>`).join('');

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
    ? `Book ${room.name} · ${timeStr('startHour', 'startMin')}–${timeStr('endHour', 'endMin')}`
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
      hint.textContent = `No rooms available for ${startStr}–${endStr}.`;
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
  let freeMin = 0;
  const emit = (from, to) => {
    if (to - from < 10) return;
    freeMin += to - from;
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
            ` title="Free ${fmtMin(a)}–${fmtMin(b)} · click to book ${escapeHtml(room.name)}">${label}</button>`
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
  return { html: cells.join(''), freeMin };
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
    // Keep the first/last labels inside the track so they don't overflow.
    const tx = m === DAY_END ? 'translateX(-100%)' : m === DAY_START ? 'translateX(0)' : 'translateX(-50%)';
    const line = m < DAY_END ? `<div class="tl-hour" style="left:${leftPct}%"></div>` : '';
    headHours.push(
      line + `<div class="tl-hourlabel" style="left:${leftPct}%;transform:${tx}">${pad(m / 60)}:00</div>`
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
          const range = `${x.b.start_at.slice(11, 16)}–${x.b.end_at.slice(11, 16)}`;
          const time = px >= 66 ? range : px >= 32 ? x.b.start_at.slice(11, 16) : '';
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

      const free = renderFreeCells(room, list);
      html +=
        `<div class="tl-row"><div class="tl-roomcell">` +
        `<span class="tl-roomname">${escapeHtml(room.name)}</span>` +
        `<span class="tl-roomfree">${durText(free.freeMin)} free</span></div>` +
        `<div class="tl-track" data-room="${room.id}">${hourLines()}${free.html}${bars}</div></div>`;
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

function renderDeptLegend(bookings) {
  const depts = [...new Set(bookings.map((b) => b.department).filter(Boolean))].sort();
  document.getElementById('deptLegend').innerHTML = depts
    .map(
      (d) =>
        `<span class="item"><span class="sw" style="background:${colorForDept(d)}"></span>${escapeHtml(
          d
        )}</span>`
    )
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
    renderDeptLegend(list);
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

// Click a free cell -> that room + date + exactly that hour, then re-check availability
function startFromCell(roomId, startMin, endMin) {
  const slot = state.config.slotMinutes;
  let s = Math.max(DAY_START, Math.floor(startMin / slot) * slot);
  s = Math.min(s, DAY_END - slot);
  const e = Math.min(Math.max(endMin, s + slot), DAY_END);
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
      <dt class="col-4">Start</dt><dd class="col-8">${escapeHtml(b.start_at.replace('T', ' '))}</dd>
      <dt class="col-4">End</dt><dd class="col-8">${escapeHtml(b.end_at.replace('T', ' '))}</dd>
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
      startFromCell(cell.getAttribute('data-room'), +cell.getAttribute('data-start'), +cell.getAttribute('data-end'));
    }
  });

  try {
    const [cfg, user] = await Promise.all([api('/api/config'), api('/api/auth/me')]);
    state.config = cfg;
    state.user = user;
    DAY_START = cfg.businessStartHour * 60;
    DAY_END = cfg.businessEndHour * 60;
    SPAN = DAY_END - DAY_START;

    document.getElementById('appVersion').textContent = cfg.version ? `v${cfg.version}` : '';
    document.getElementById('tlRangeNote').textContent =
      `Shown range ${pad(cfg.businessStartHour)}:00–${pad(cfg.businessEndHour)}:00. ` +
      'Click a booking for details, or a dashed slot to book that room and hour.';
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
