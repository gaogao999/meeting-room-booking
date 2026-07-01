'use strict';

// Visible timeline window (minutes): 8:00-20:00
const DAY_START = 8 * 60;
const DAY_END = 20 * 60;
const SPAN = DAY_END - DAY_START;

// Color palette for booking bars (cycled by a key)
const PALETTE = [
  '#5b8def', '#38b2ac', '#ed8936', '#e53e3e', '#9f7aea',
  '#48bb78', '#d69e2e', '#0bc5ea', '#ed64a6', '#667eea',
];

const state = {
  config: { slotMinutes: 10, windowDefaultDays: 90, windowHrDays: 180, hrDepartments: [] },
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

function toMin(hhmm) {
  if (hhmm === '24:00') return 24 * 60;
  return parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3, 5), 10);
}

// Resolve an end time, mapping 24:00 to 00:00 of the next day
function resolveEnd(date, end) {
  if (end === '24:00') {
    const d = new Date(`${date}T00:00`);
    d.setDate(d.getDate() + 1);
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: '00:00' };
  }
  return { date, time: end };
}

function showAlert(message, type = 'danger') {
  document.getElementById('formAlert').innerHTML =
    `<div class="alert alert-${type} alert-dismissible fade show" role="alert">${escapeHtml(
      message
    )}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
}

// Build time options in slot increments across the whole day
function timeOptions(slot) {
  const opts = [];
  for (let m = 0; m < 24 * 60; m += slot) {
    opts.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return opts;
}

function fillTimeSelects() {
  const opts = timeOptions(state.config.slotMinutes);
  const startSel = document.getElementById('startTime');
  const endSel = document.getElementById('endTime');
  startSel.innerHTML = opts.map((t) => `<option value="${t}">${t}</option>`).join('');
  endSel.innerHTML = [...opts, '24:00'].map((t) => `<option value="${t}">${t}</option>`).join('');
  startSel.value = '09:00';
  endSel.value = '10:00';
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
  const start = document.getElementById('startTime').value;
  const end = document.getElementById('endTime').value;
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
  if (toMin(end) <= toMin(start)) {
    hint.textContent = 'End time must be after start time.';
    reset('Invalid time range');
    return;
  }

  const e = resolveEnd(date, end);
  try {
    const data = await api(
      `/api/availability?start_at=${date}T${start}&end_at=${e.date}T${e.time}`
    );
    if (data.available.length === 0) {
      hint.textContent = `No rooms available for ${date} ${start}–${end} (busy: ${data.busy.length}).`;
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
    hint.textContent = `${data.available.length} room(s) available for ${date} ${start}–${end}.`;
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
  const start = document.getElementById('startTime').value;
  const end = document.getElementById('endTime').value;
  const roomId = document.getElementById('roomId').value;
  if (!roomId) {
    showAlert('Please find and select an available room first.');
    return;
  }
  const e = resolveEnd(date, end);
  const payload = {
    room_id: roomId,
    department: document.getElementById('department').value,
    reserver: document.getElementById('reserver').value,
    purpose: document.getElementById('purpose').value,
    start_at: `${date}T${start}`,
    end_at: `${e.date}T${e.time}`,
  };
  try {
    await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
    showAlert('Reservation created.', 'success');
    document.getElementById('purpose').value = '';
    document.getElementById('tlDate').value = date;
    loadTimeline();
    // Refresh the available-room list (the booked room is now busy)
    findRooms();
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
  return Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => {
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
    headHours.push(
      `<div class="tl-hour" style="left:${leftPct}%"></div>` +
        `<div class="tl-hourlabel" style="left:${leftPct}%">${pad(m / 60)}:00</div>`
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
  const s = Math.floor(startMin / slot) * slot;
  const en = Math.min(s + 60, DAY_END);
  document.getElementById('date').value = state.date;
  const startSel = document.getElementById('startTime');
  const endSel = document.getElementById('endTime');
  startSel.value = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  endSel.value = `${pad(Math.floor(en / 60))}:${pad(en % 60)}`;
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
  document.getElementById('detailPdf').href = `/api/pdf/booking/${b.id}`;
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
  document.getElementById('findRoomsBtn').addEventListener('click', () => findRooms());
  document.getElementById('department').addEventListener('input', updateRuleHint);
  // Re-search when the time slot changes; selecting a room enables Book
  ['date', 'startTime', 'endTime'].forEach((id) =>
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

    document.getElementById('currentUser').textContent = user.name
      ? `${user.name} (${user.department})`
      : '';
    document.getElementById('department').value = user.department || '';
    document.getElementById('reserver').value = user.name || '';
    document.getElementById('date').value = todayStr();
    document.getElementById('tlDate').value = todayStr();

    fillTimeSelects();
    updateRuleHint();
    loadTimeline();
    findRooms();
  } catch (err) {
    showAlert(`Initialization failed: ${err.message}`);
  }
}

document.addEventListener('DOMContentLoaded', init);
