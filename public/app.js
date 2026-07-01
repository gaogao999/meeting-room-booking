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
  rooms: [],
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

// Search time selects limited to the visible window
function fillSearchTimes() {
  const opts = [];
  for (let m = DAY_START; m <= DAY_END; m += state.config.slotMinutes) {
    opts.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  const start = document.getElementById('searchStart');
  const end = document.getElementById('searchEnd');
  start.innerHTML = opts
    .filter((t) => t !== '20:00')
    .map((t) => `<option value="${t}">${t}</option>`)
    .join('');
  end.innerHTML = opts.map((t) => `<option value="${t}">${t}</option>`).join('');
  start.value = '13:00';
  end.value = '14:00';
}

function fillRoomSelect() {
  const roomSel = document.getElementById('roomId');
  if (!state.rooms.length) {
    roomSel.innerHTML = '<option value="">No rooms registered</option>';
    return;
  }
  // Group rooms by location so repeated names (e.g. "Conference room 1" in
  // both factories) stay distinguishable.
  const groups = {};
  for (const r of state.rooms) {
    const loc = r.location || 'Other';
    (groups[loc] = groups[loc] || []).push(r);
  }
  roomSel.innerHTML = Object.keys(groups)
    .map(
      (loc) =>
        `<optgroup label="${escapeHtml(loc)}">` +
        groups[loc]
          .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`)
          .join('') +
        `</optgroup>`
    )
    .join('');
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

// ---- Booking form ----
function prefillForm({ room, date, start, end }) {
  if (room) document.getElementById('roomId').value = room;
  if (date) document.getElementById('date').value = date;
  if (start) {
    const s = document.getElementById('startTime');
    if ([...s.options].some((o) => o.value === start)) s.value = start;
  }
  if (end) {
    const e = document.getElementById('endTime');
    if ([...e.options].some((o) => o.value === end)) e.value = end;
  }
  updateRuleHint();
  document.getElementById('bookingForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function submitBooking(e) {
  e.preventDefault();
  const date = document.getElementById('date').value;
  const start = document.getElementById('startTime').value;
  const end = document.getElementById('endTime').value;

  // 24:00 means midnight of the next day
  let endDate = date;
  let endTime = end;
  if (end === '24:00') {
    const d = new Date(`${date}T00:00`);
    d.setDate(d.getDate() + 1);
    endDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    endTime = '00:00';
  }

  const payload = {
    room_id: document.getElementById('roomId').value,
    department: document.getElementById('department').value,
    reserver: document.getElementById('reserver').value,
    purpose: document.getElementById('purpose').value,
    start_at: `${date}T${start}`,
    end_at: `${endDate}T${endTime}`,
  };
  try {
    await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
    showAlert('Reservation created.', 'success');
    // Reflect on the schedule for the booked day
    document.getElementById('tlDate').value = date;
    loadTimeline();
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

function renderTimeline(bookingsByRoom) {
  const el = document.getElementById('timeline');
  if (state.rooms.length === 0) {
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

  for (const room of state.rooms) {
    const list = bookingsByRoom[room.id] || [];
    const bars = list
      .map((b) => {
        let s = minutesOfDay(b.start_at, state.date);
        let e = minutesOfDay(b.end_at, state.date);
        if (s == null) s = DAY_START;
        if (e == null) e = DAY_END;
        s = Math.max(DAY_START, s);
        e = Math.min(DAY_END, e);
        if (e <= s) return '';
        const leftPct = ((s - DAY_START) / SPAN) * 100;
        const widthPct = ((e - s) / SPAN) * 100;
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
      (room.location
        ? `<span class="tl-roomloc">${escapeHtml(room.location)}</span>`
        : '');
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
    const list = await api(`/api/bookings?from=${state.date}T00:00&to=${state.date}T23:59`);
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

// ---- Availability search ----
async function searchAvailability(e) {
  e.preventDefault();
  const date = document.getElementById('searchDate').value;
  const start = document.getElementById('searchStart').value;
  const end = document.getElementById('searchEnd').value;
  const box = document.getElementById('searchResult');
  if (!date) {
    box.innerHTML = '<div class="text-danger">Please select a date.</div>';
    return;
  }
  try {
    const data = await api(`/api/availability?start_at=${date}T${start}&end_at=${date}T${end}`);
    const avail = data.available
      .map(
        (r) =>
          `<button type="button" class="btn btn-sm btn-success m-1" ` +
          `data-book='${escapeHtml(JSON.stringify({ room: r.id, date, start, end }))}'>` +
          `Book ${escapeHtml(r.name)}${
            r.location ? ` — ${escapeHtml(r.location)}` : ''
          }${r.capacity ? ` (${r.capacity})` : ''}</button>`
      )
      .join('');
    const busy = data.busy
      .map(
        (x) =>
          `<span class="badge bg-secondary m-1" title="${x.conflicts
            .map((c) => `${c.start_at.slice(11)}-${c.end_at.slice(11)}`)
            .join(', ')}">${escapeHtml(x.room.name)} (busy)</span>`
      )
      .join('');
    box.innerHTML =
      `<div class="mb-2">Availability for ${date} ${start}&ndash;${end}</div>` +
      `<div><strong class="text-success">Available (${data.available.length}):</strong> ${
        avail || '<span class="text-muted">none</span>'
      }</div>` +
      `<div class="mt-2"><strong class="text-muted">Busy (${data.busy.length}):</strong> ${
        busy || '<span class="text-muted">none</span>'
      }</div>`;
    document.getElementById('tlDate').value = date;
    loadTimeline();
  } catch (err) {
    box.innerHTML = `<div class="text-danger">${escapeHtml(err.message)}</div>`;
  }
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
  } catch (err) {
    alert(err.message);
  }
}

async function init() {
  detailModal = new bootstrap.Modal(document.getElementById('detailModal'));

  document.getElementById('bookingForm').addEventListener('submit', submitBooking);
  document.getElementById('department').addEventListener('input', updateRuleHint);
  document.getElementById('searchForm').addEventListener('submit', searchAvailability);
  document.getElementById('prevDay').addEventListener('click', () => shiftDay(-1));
  document.getElementById('nextDay').addEventListener('click', () => shiftDay(1));
  document.getElementById('today').addEventListener('click', () => {
    document.getElementById('tlDate').value = todayStr();
    loadTimeline();
  });
  document.getElementById('tlDate').addEventListener('change', loadTimeline);
  document.getElementById('detailCancel').addEventListener('click', cancelDetail);

  // Availability "Book" buttons -> prefill the form
  document.getElementById('searchResult').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-book]');
    if (btn) prefillForm(JSON.parse(btn.getAttribute('data-book')));
  });

  // Timeline clicks: bar -> details, empty area -> prefill form
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
      const slot = state.config.slotMinutes;
      const minute = Math.floor((DAY_START + ratio * SPAN) / slot) * slot;
      prefillForm({
        room: track.getAttribute('data-room'),
        date: state.date,
        start: `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`,
      });
    }
  });

  try {
    const [cfg, user, rooms] = await Promise.all([
      api('/api/config'),
      api('/api/auth/me'),
      api('/api/rooms'),
    ]);
    state.config = cfg;
    state.user = user;
    state.rooms = rooms;

    document.getElementById('currentUser').textContent = user.name
      ? `${user.name} (${user.department})`
      : '';
    document.getElementById('department').value = user.department || '';
    document.getElementById('reserver').value = user.name || '';
    document.getElementById('date').value = todayStr();
    document.getElementById('tlDate').value = todayStr();
    document.getElementById('searchDate').value = todayStr();

    fillRoomSelect();
    fillTimeSelects();
    fillSearchTimes();
    updateRuleHint();
    loadTimeline();
  } catch (err) {
    showAlert(`Initialization failed: ${err.message}`);
  }
}

document.addEventListener('DOMContentLoaded', init);
