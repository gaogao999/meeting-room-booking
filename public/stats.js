'use strict';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Display order: Mon..Sun
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

async function api(path) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error (${res.status})`);
  return data;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function tile(val, label) {
  return `<div class="col-6 col-md-4 col-xl-2"><div class="stat-tile">
    <div class="val">${val}</div><div class="lbl">${label}</div></div></div>`;
}

function renderTiles(d) {
  const s = d.summary;
  document.getElementById('tiles').innerHTML =
    tile(s.confirmed, 'Bookings') +
    tile(`${s.totalBookedHours}h`, 'Booked hours') +
    tile(`${s.overallUtilization}%`, 'Overall utilization') +
    tile(`${s.avgDurationMin}m`, 'Avg duration') +
    tile(`${s.cancelRate}%`, 'Cancellation rate') +
    tile(s.roomCount, 'Active rooms');
  document.getElementById('rangeNote').textContent =
    `Range: ${d.from} to ${d.to} (${d.days} days). ` +
    `Utilization = booked hours ÷ (business hours ${d.businessStartHour}:00–${d.businessEndHour}:00 × days × rooms); includes weekends. ` +
    `Cancelled in range: ${s.cancelled}.`;
}

function renderPerRoom(d) {
  const el = document.getElementById('perRoom');
  if (!d.perRoom.length) {
    el.innerHTML = '<div class="text-muted">No data.</div>';
    return;
  }
  el.innerHTML = d.perRoom
    .map(
      (r) => `
      <div class="mb-3">
        <div class="d-flex justify-content-between small">
          <span>${escapeHtml(r.name)} <span class="text-muted">${escapeHtml(r.location || '')}</span></span>
          <span class="text-muted">${r.utilization}% · ${r.hours}h · ${r.count}×</span>
        </div>
        <div class="util-bar"><span style="width:${Math.min(100, r.utilization)}%"></span></div>
      </div>`
    )
    .join('');
}

function renderByDept(d) {
  const el = document.getElementById('byDept');
  if (!d.byDepartment.length) {
    el.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">No data.</td></tr>';
    return;
  }
  el.innerHTML = d.byDepartment
    .map(
      (x) =>
        `<tr><td>${escapeHtml(x.department)}</td><td class="text-end">${x.count}</td><td class="text-end">${x.hours}</td></tr>`
    )
    .join('');
}

function renderHeatmap(d) {
  const bs = d.businessStartHour;
  const be = d.businessEndHour;
  // find max cell value for scaling
  let max = 0;
  for (const row of d.heatmap) for (const v of row) if (v > max) max = v;
  max = max || 1;

  let html = '<thead><tr><th></th>';
  for (let h = bs; h < be; h++) html += `<th>${pad(h)}</th>`;
  html += '</tr></thead><tbody>';
  for (const dow of DOW_ORDER) {
    html += `<tr><td class="rowlbl">${DOW[dow]}</td>`;
    for (let i = 0; i < be - bs; i++) {
      const v = d.heatmap[dow][i] || 0;
      const alpha = v === 0 ? 0 : 0.12 + 0.88 * (v / max);
      const bg = v === 0 ? '#fff' : `rgba(13,110,253,${alpha.toFixed(3)})`;
      const color = alpha > 0.6 ? '#fff' : '#212529';
      html += `<td style="background:${bg};color:${color}" title="${DOW[dow]} ${pad(bs + i)}:00 — ${v} min">${v ? Math.round(v) : ''}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  document.getElementById('heatmap').innerHTML = html;
}

async function load() {
  const from = document.getElementById('from').value;
  const to = document.getElementById('to').value;
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  try {
    const d = await api(`/api/stats?${q.toString()}`);
    document.getElementById('from').value = d.from;
    document.getElementById('to').value = d.to;
    renderTiles(d);
    renderPerRoom(d);
    renderByDept(d);
    renderHeatmap(d);
  } catch (err) {
    document.getElementById('tiles').innerHTML =
      `<div class="text-danger">${escapeHtml(err.message)}</div>`;
  }
}

document.getElementById('apply').addEventListener('click', load);
document.addEventListener('DOMContentLoaded', load);
