'use strict';

// 表示する時間帯（分）: 8:00〜20:00
const DAY_START = 8 * 60;
const DAY_END = 20 * 60;
const SPAN = DAY_END - DAY_START;

// 予約バーの色パレット（用件などをキーに循環）
const PALETTE = [
  '#5b8def', '#38b2ac', '#ed8936', '#e53e3e', '#9f7aea',
  '#48bb78', '#d69e2e', '#0bc5ea', '#ed64a6', '#667eea',
];

const state = { rooms: [], config: { slotMinutes: 10 }, date: null };

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

// "YYYY-MM-DDTHH:MM" -> 当日 0:00 起点の分。別日なら null。
function minutesOfDay(iso, baseDate) {
  if (!iso.startsWith(baseDate)) return null;
  const hh = parseInt(iso.slice(11, 13), 10);
  const mm = parseInt(iso.slice(14, 16), 10);
  return hh * 60 + mm;
}

function colorFor(key) {
  let h = 0;
  const s = String(key || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % PALETTE.length;
  return PALETTE[h];
}

function slotOptions(slot) {
  const opts = [];
  for (let m = DAY_START; m <= DAY_END; m += slot) {
    opts.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return opts;
}

function fillSearchTimes() {
  const opts = slotOptions(state.config.slotMinutes);
  const start = document.getElementById('searchStart');
  const end = document.getElementById('searchEnd');
  start.innerHTML = opts
    .filter((t) => t !== `${pad(DAY_END / 60)}:00`)
    .map((t) => `<option value="${t}">${t}</option>`)
    .join('');
  end.innerHTML = opts.map((t) => `<option value="${t}">${t}</option>`).join('');
  start.value = '13:00';
  end.value = '14:00';
}

// ---- タイムライン描画 ----
function renderTimeline(bookingsByRoom) {
  const el = document.getElementById('timeline');
  if (state.rooms.length === 0) {
    el.innerHTML = '<div class="tl-empty-msg">会議室が登録されていません。</div>';
    return;
  }

  // 時間軸ヘッダ（1時間ごとの目盛り）
  const hours = [];
  for (let m = DAY_START; m <= DAY_END; m += 60) {
    const leftPct = ((m - DAY_START) / SPAN) * 100;
    hours.push(
      `<div class="tl-hour" style="left:${leftPct}%"></div>` +
        `<div class="tl-hourlabel" style="left:${leftPct}%">${pad(m / 60)}:00</div>`
    );
  }
  const hourLines = () =>
    Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => {
      const leftPct = ((i * 60) / SPAN) * 100;
      return `<div class="tl-hour" style="left:${leftPct}%"></div>`;
    }).join('');

  let html = '<div class="tl-grid">';
  html += `<div class="tl-row tl-head"><div class="tl-roomcell">会議室</div><div class="tl-track">${hours.join('')}</div></div>`;

  for (const room of state.rooms) {
    const list = bookingsByRoom[room.id] || [];
    const bars = list
      .map((b) => {
        let s = minutesOfDay(b.start_at, state.date);
        let e = minutesOfDay(b.end_at, state.date);
        // 日跨ぎ等は表示窓にクランプ
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
    html +=
      `<div class="tl-row"><div class="tl-roomcell">${escapeHtml(room.name)}</div>` +
      `<div class="tl-track" data-room="${room.id}">${hourLines()}${bars}</div></div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

async function loadTimeline() {
  state.date = document.getElementById('tlDate').value || todayStr();
  document.getElementById('tlDateLabel').textContent = state.date;
  try {
    const list = await api(
      `/api/bookings?from=${state.date}T00:00&to=${state.date}T23:59`
    );
    const byRoom = {};
    for (const b of list) {
      (byRoom[b.room_id] = byRoom[b.room_id] || []).push(b);
    }
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

// ---- 空き検索 ----
async function searchAvailability(e) {
  e.preventDefault();
  const date = document.getElementById('searchDate').value;
  const start = document.getElementById('searchStart').value;
  const end = document.getElementById('searchEnd').value;
  const box = document.getElementById('searchResult');
  if (!date) {
    box.innerHTML = '<div class="text-danger">日付を選択してください。</div>';
    return;
  }
  try {
    const data = await api(
      `/api/availability?start_at=${date}T${start}&end_at=${date}T${end}`
    );
    const avail = data.available
      .map(
        (r) =>
          `<a href="/?room=${r.id}&date=${date}&start=${start}&end=${end}"` +
          ` class="btn btn-sm btn-success m-1">${escapeHtml(r.name)}${
            r.capacity ? `（${r.capacity}名）` : ''
          } で予約</a>`
      )
      .join('');
    const busy = data.busy
      .map(
        (x) =>
          `<span class="badge bg-secondary m-1" title="${x.conflicts
            .map((c) => `${c.start_at.slice(11)}-${c.end_at.slice(11)}`)
            .join(', ')}">${escapeHtml(x.room.name)}（使用中）</span>`
      )
      .join('');
    box.innerHTML =
      `<div class="mb-2">${date} ${start}〜${end} の空き状況</div>` +
      `<div><strong class="text-success">空き ${data.available.length}件:</strong> ${
        avail || '<span class="text-muted">空きなし</span>'
      }</div>` +
      `<div class="mt-2"><strong class="text-muted">使用中 ${data.busy.length}件:</strong> ${
        busy || '<span class="text-muted">なし</span>'
      }</div>`;
    // 検索した日付をタイムラインにも反映
    document.getElementById('tlDate').value = date;
    loadTimeline();
  } catch (err) {
    box.innerHTML = `<div class="text-danger">${escapeHtml(err.message)}</div>`;
  }
}

function showBookingDetail(b) {
  const msg =
    `会議室: ${b.room_name}\n` +
    `日時: ${b.start_at.replace('T', ' ')} 〜 ${b.end_at.replace('T', ' ')}\n` +
    `部署: ${b.department}\n氏名: ${b.reserver}\n用件: ${b.purpose || '-'}`;
  alert(msg);
}

async function init() {
  document.getElementById('searchForm').addEventListener('submit', searchAvailability);
  document.getElementById('prevDay').addEventListener('click', () => shiftDay(-1));
  document.getElementById('nextDay').addEventListener('click', () => shiftDay(1));
  document.getElementById('today').addEventListener('click', () => {
    document.getElementById('tlDate').value = todayStr();
    loadTimeline();
  });
  document.getElementById('tlDate').addEventListener('change', loadTimeline);

  // タイムライン内クリック: 予約バー=詳細 / 空き=予約フォームへ
  document.getElementById('timeline').addEventListener('click', (e) => {
    const bar = e.target.closest('.tl-booking');
    if (bar) {
      showBookingDetail(JSON.parse(bar.getAttribute('data-booking')));
      return;
    }
    const track = e.target.closest('.tl-track[data-room]');
    if (track) {
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      let minute = DAY_START + ratio * SPAN;
      const slot = state.config.slotMinutes;
      minute = Math.floor(minute / slot) * slot;
      const hhmm = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
      window.location.href =
        `/?room=${track.getAttribute('data-room')}&date=${state.date}&start=${hhmm}`;
    }
  });

  try {
    const [cfg, user, rooms] = await Promise.all([
      api('/api/config'),
      api('/api/auth/me'),
      api('/api/rooms'),
    ]);
    state.config = cfg;
    state.rooms = rooms;
    document.getElementById('currentUser').textContent = user.name
      ? `${user.name}（${user.department}）`
      : '';
    document.getElementById('tlDate').value = todayStr();
    document.getElementById('searchDate').value = todayStr();
    fillSearchTimes();
    loadTimeline();
  } catch (err) {
    document.getElementById('timeline').innerHTML =
      `<div class="tl-empty-msg text-danger">初期化に失敗しました: ${escapeHtml(err.message)}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
