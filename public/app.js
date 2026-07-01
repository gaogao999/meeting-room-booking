'use strict';

const state = {
  rooms: [],
  config: { slotMinutes: 10, windowDefaultDays: 90, windowHrDays: 180, hrDepartments: [] },
  user: { name: '', department: '' },
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `エラー (${res.status})`);
  return data;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function showAlert(message, type = 'danger') {
  document.getElementById('formAlert').innerHTML =
    `<div class="alert alert-${type} alert-dismissible fade show" role="alert">${message}` +
    `<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
}

// 10分刻みの時刻オプションを生成
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
  // 終了時刻は 24:00 も選べるようにする
  const endOpts = [...opts, '24:00'];
  endSel.innerHTML = endOpts.map((t) => `<option value="${t}">${t}</option>`).join('');
  startSel.value = '09:00';
  endSel.value = '10:00';
}

function fillRoomSelects() {
  const roomSel = document.getElementById('roomId');
  const filterSel = document.getElementById('filterRoom');
  roomSel.innerHTML = state.rooms
    .map((r) => `<option value="${r.id}">${r.name}</option>`)
    .join('');
  filterSel.innerHTML =
    '<option value="">すべての会議室</option>' +
    state.rooms.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
  if (state.rooms.length === 0) {
    roomSel.innerHTML = '<option value="">会議室が未登録です</option>';
  }
}

function updateRuleHint() {
  const dep = document.getElementById('department').value;
  const isHr = state.config.hrDepartments.some((k) =>
    dep.toLowerCase().includes(String(k).toLowerCase())
  );
  const days = isHr ? state.config.windowHrDays : state.config.windowDefaultDays;
  const kind = isHr ? 'HR系部門' : '一般部門';
  document.getElementById('ruleHint').textContent =
    `${kind}: 現在から ${days} 日先まで、${state.config.slotMinutes} 分単位で予約できます。`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function fmtRange(startAt, endAt) {
  const d = startAt.slice(0, 10);
  return `${d}<br><span class="text-muted small">${startAt.slice(11)} - ${endAt.slice(11)}</span>`;
}

async function loadBookings() {
  const roomId = document.getElementById('filterRoom').value;
  const date = document.getElementById('filterDate').value;
  const params = new URLSearchParams();
  if (roomId) params.set('room_id', roomId);
  if (date) {
    params.set('from', `${date}T00:00`);
    params.set('to', `${date}T23:59`);
  }
  const tbody = document.getElementById('bookingList');
  try {
    const list = await api(`/api/bookings?${params.toString()}`);
    if (list.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="text-center text-muted py-4">予約はありません</td></tr>';
      return;
    }
    tbody.innerHTML = list
      .map(
        (b) => `
      <tr>
        <td>${escapeHtml(b.room_name)}</td>
        <td>${fmtRange(b.start_at, b.end_at)}</td>
        <td>${escapeHtml(b.department)}<br><span class="text-muted small">${escapeHtml(b.reserver)}</span></td>
        <td>${escapeHtml(b.purpose || '')}</td>
        <td class="text-nowrap">
          <a class="btn btn-sm btn-outline-secondary" href="/api/pdf/booking/${b.id}" title="確認書PDF">PDF</a>
          <button class="btn btn-sm btn-outline-danger" data-cancel="${b.id}">取消</button>
        </td>
      </tr>`
      )
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger text-center py-4">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function cancelBooking(id) {
  if (!confirm('この予約を取り消しますか？')) return;
  try {
    await api(`/api/bookings/${id}`, { method: 'DELETE' });
    loadBookings();
  } catch (err) {
    alert(err.message);
  }
}

async function submitBooking(e) {
  e.preventDefault();
  const date = document.getElementById('date').value;
  const start = document.getElementById('startTime').value;
  const end = document.getElementById('endTime').value;
  // 24:00 は翌日 00:00 として扱う（日付を翌日に補正）
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
    showAlert('予約を登録しました。', 'success');
    loadBookings();
  } catch (err) {
    showAlert(err.message, 'danger');
  }
}

async function init() {
  document.getElementById('bookingForm').addEventListener('submit', submitBooking);
  document.getElementById('department').addEventListener('input', updateRuleHint);
  document.getElementById('filterRoom').addEventListener('change', loadBookings);
  document.getElementById('filterDate').addEventListener('change', loadBookings);
  document.getElementById('bookingList').addEventListener('click', (e) => {
    const id = e.target.getAttribute('data-cancel');
    if (id) cancelBooking(id);
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
      ? `${user.name}（${user.department}）`
      : '';
    document.getElementById('department').value = user.department || '';
    document.getElementById('reserver').value = user.name || '';

    // 既定の日付は本日
    const today = new Date();
    document.getElementById('date').value =
      `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    fillRoomSelects();
    fillTimeSelects();

    // スケジュール/空き検索からの遷移: クエリで会議室・日時を初期化
    const q = new URLSearchParams(location.search);
    if (q.get('room')) document.getElementById('roomId').value = q.get('room');
    if (q.get('date')) document.getElementById('date').value = q.get('date');
    if (q.get('start')) {
      const s = document.getElementById('startTime');
      if ([...s.options].some((o) => o.value === q.get('start'))) s.value = q.get('start');
    }
    if (q.get('end')) {
      const e = document.getElementById('endTime');
      if ([...e.options].some((o) => o.value === q.get('end'))) e.value = q.get('end');
    }

    updateRuleHint();
    loadBookings();
  } catch (err) {
    showAlert(`初期化に失敗しました: ${err.message}`);
  }
}

document.addEventListener('DOMContentLoaded', init);
