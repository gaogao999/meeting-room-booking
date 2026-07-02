'use strict';

// Visible timeline window (minutes). Set from business hours in init().
let DAY_START = 7 * 60;
let DAY_END = 21 * 60;
let SPAN = DAY_END - DAY_START;

// Color palette for booking bars (cycled by a key)
const PALETTE = [
  '#5b8def', '#38b2ac', '#ed8936', '#e53e3e', '#9f7aea',
  '#48bb78', '#d69e2e', '#0bc5ea', '#ed64a6', '#667eea',
];

const state = {
  config: {
    slotMinutes: 10,
    businessStartHour: 7,
    businessEndHour: 21,
    windowDefaultDays: 90,
    windowHrDays: 180,
    hrDepartments: [],
  },
  user: { name: '', department: '' },
  date: null,
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
  document.getElementById('ruleHint').textContent =
    `${kind}: can book up to ${days} days ahead, in ${state.config.slotMinutes}-minute increments.`;
}

// ---- Step 1+2: find available rooms for the chosen time slot ----
async function findRooms(preselectRoomId = null) {
  const date = document.getElementById('date').value;
  const startStr = timeStr('startHour', 'startMin');
  const endStr = timeStr('endHour', 'endMin');
  const sel = document.getElementById('roomId');
  const hint = document.getElementById('availHint');
  const book = document.getElementById('bookBtn');

  const reset = (msg) => {
    sel.innerHTML = `<option value="">${escapeHtml(msg)}</option>`;
    sel.disabled = true;
    book.disabled = true;
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
    if (data.available.length === 0) {
      hint.textContent = `No rooms available for ${date} ${startStr}–${endStr} (busy: ${data.busy.length}).`;
      reset('No rooms available');
      return;
    }
    // Group available rooms by location
    const groups = {};
    for (const r of data.available) {
      const loc = r.location || 'Other';
      (groups[loc] = groups[loc] || []).push(r);
    }
    sel.innerHTML =
      '<option value="">Select a room</option>' +
      Object.keys(groups)
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
    hint.textContent = `${data.available.length} room(s) available for ${date} ${startStr}–${endStr}.`;
    if (preselectRoomId && [...sel.options].some((o) => o.value === String(preselectRoomId))) {
      sel.value = String(preselectRoomId);
    }
    book.disabled = !sel.value;
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
    showAlert('Please find and select an available room first.');
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

function colorFor(key) {
  let h = 0;
  const s = String(key || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % PALETTE.length;
  return PALETTE[h];
}

function hourLines() {
  // Draw a gridline at the start of each hour column, but NOT at 100%:
  // a 1px border at the right edge would overflow and cause a scrollbar.
  const n = (DAY_END - DAY_START) / 60;
  return Array.from({ length: n }, (_, i) => {
    const leftPct = ((i * 60) / SPAN) * 100;
    return `<div class="tl-hour" style="left:${leftPct}%"></div>`;
  }).join('');
}

function renderTimeline(rooms, bookingsByRoom) {
  const el = document.getElementById('timeline');
  if (rooms.length === 0) {
    el.innerHTML = '<div class="tl-empty-msg">No rooms registered.</div>';
    return;
  }

  const headHours = [];
  for (let m = DAY_START; m <= DAY_END; m += 60) {
    const leftPct = ((m - DAY_START) / SPAN) * 100;
    // Keep the first/last labels inside the track so they don't overflow and
    // trigger a horizontal scrollbar.
    const tx = m === DAY_END ? 'translateX(-100%)' : m === DAY_START ? 'translateX(0)' : 'translateX(-50%)';
    // Skip the gridline at 100% so it doesn't overflow and cause a scrollbar.
    const line = m < DAY_END ? `<div class="tl-hour" style="left:${leftPct}%"></div>` : '';
    headHours.push(
      line + `<div class="tl-hourlabel" style="left:${leftPct}%;transform:${tx}">${pad(m / 60)}:00</div>`
    );
  }

  let html = '<div class="tl-grid">';
  html += `<div class="tl-row tl-head"><div class="tl-roomcell">Room</div><div class="tl-track">${headHours.join(
    ''
  )}</div></div>`;

  for (const room of rooms) {
    const list = bookingsByRoom[room.id] || [];
    const bars = list
      .map((b) => {
        let s = minutesOfDay(b.start_at, state.date);
        let en = minutesOfDay(b.end_at, state.date);
        if (s == null) s = DAY_START;
        if (en == null) en = DAY_END;
        s = Math.max(DAY_START, s);
        en = Math.min(DAY_END, en);
        if (en <= s) return '';
        const leftPct = ((s - DAY_START) / SPAN) * 100;
        const widthPct = ((en - s) / SPAN) * 100;
        const color = colorFor(b.purpose || b.department || b.id);
        const label = `${b.start_at.slice(11)}-${b.end_at.slice(11)}`;
        const title = `${label} ${b.purpose || ''} / ${b.department} ${b.reserver}`;
        return (
          `<div class="tl-booking" style="left:${leftPct}%;width:${widthPct}%;background:${color}"` +
          ` data-booking='${escapeHtml(JSON.stringify(b))}' title="${escapeHtml(title)}">` +
          `<span class="tl-time">${escapeHtml(label)}</span>` +
          `<span class="tl-purpose">${escapeHtml(b.purpose || b.department)}</span>` +
          `</div>`
        );
      })
      .join('');
    const roomLabel =
      `${escapeHtml(room.name)}` +
      (room.location ? `<span class="tl-roomloc">${escapeHtml(room.location)}</span>` : '');
    html +=
      `<div class="tl-row"><div class="tl-roomcell">${roomLabel}</div>` +
      `<div class="tl-track" data-room="${room.id}">${hourLines()}${bars}</div></div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

async function loadTimeline() {
  state.date = document.getElementById('tlDate').value || todayStr();
  document.getElementById('tlDateLabel').textContent = state.date;
  try {
    const [rooms, list] = await Promise.all([
      api('/api/rooms'),
      api(`/api/bookings?from=${state.date}T00:00&to=${state.date}T23:59`),
    ]);
    const byRoom = {};
    for (const b of list) (byRoom[b.room_id] = byRoom[b.room_id] || []).push(b);
    renderTimeline(rooms, byRoom);
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

// Click an empty timeline area -> set that room + date + time and search
function startFromTimeline(roomId, startMin) {
  const slot = state.config.slotMinutes;
  // Clamp so the start never lands on/after the closing hour (keeps a valid slot)
  let s = Math.floor(startMin / slot) * slot;
  s = Math.max(DAY_START, Math.min(s, DAY_END - slot));
  const en = Math.min(s + 60, DAY_END);
  document.getElementById('date').value = state.date;
  document.getElementById('startHour').value = Math.floor(s / 60);
  document.getElementById('startMin').value = s % 60;
  document.getElementById('endHour').value = Math.floor(en / 60);
  syncEndMinutes();
  document.getElementById('endMin').value = en % 60;
  document.getElementById('bookingForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  findRooms(roomId);
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
  // Re-search when the time slot changes
  document.getElementById('endHour').addEventListener('change', () => {
    syncEndMinutes();
    findRooms();
  });
  ['date', 'startHour', 'startMin', 'endMin'].forEach((id) =>
    document.getElementById(id).addEventListener('change', () => findRooms())
  );
  document.getElementById('roomId').addEventListener('change', (e) => {
    document.getElementById('bookBtn').disabled = !e.target.value;
  });
  document.getElementById('prevDay').addEventListener('click', () => shiftDay(-1));
  document.getElementById('nextDay').addEventListener('click', () => shiftDay(1));
  document.getElementById('today').addEventListener('click', () => {
    document.getElementById('tlDate').value = todayStr();
    loadTimeline();
  });
  document.getElementById('tlDate').addEventListener('change', loadTimeline);
  document.getElementById('detailCancel').addEventListener('click', cancelDetail);

  // Timeline clicks: bar -> details, empty area -> start a booking for that room/time
  document.getElementById('timeline').addEventListener('click', (e) => {
    const bar = e.target.closest('.tl-booking');
    if (bar) {
      openDetail(JSON.parse(bar.getAttribute('data-booking')));
      return;
    }
    const track = e.target.closest('.tl-track[data-room]');
    if (track) {
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      startFromTimeline(track.getAttribute('data-room'), DAY_START + ratio * SPAN);
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
      `Shown range is ${cfg.businessStartHour}:00–${cfg.businessEndHour}:00. ` +
      'Click a bar for details, or click an empty area to start a booking for that room and time.';
    document.getElementById('currentUser').textContent = user.name
      ? `${user.name} (${user.department})`
      : '';
    document.getElementById('department').value = user.department || '';
    document.getElementById('reserver').value = user.name || '';
    document.getElementById('date').value = todayStr();
    document.getElementById('tlDate').value = todayStr();

    fillTimeControls();
    updateRuleHint();
    loadTimeline();
    findRooms();
  } catch (err) {
    showAlert(`Initialization failed: ${err.message}`);
  }
}

document.addEventListener('DOMContentLoaded', init);
