'use strict';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Display order: Mon..Sun
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
// Same location order as the booking screen
const LOCATION_ORDER = ['Bangna Office', 'Factory 1', 'Factory 2', 'Factory 3'];
const HEAT_SCALE = ['#e4eaf4', '#b9c9e6', '#7d9bd1', '#3f6cb5', '#0b3d91'];

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
const PALETTE = ['#2563eb', '#0f766e', '#b45309', '#6d28d9', '#be185d', '#475569', '#15803d', '#0e7490'];

// Locations the user has expanded (all collapsed by default: with 17 rooms the
// flat list was too long to scan)
const openLocations = new Set();
let lastData = null;

async function api(path) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error (' + res.status + ')');
  return data;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function colorForDept(department) {
  const key = String(department || '').toLowerCase().trim();
  if (DEPT_COLORS[key]) return DEPT_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % PALETTE.length;
  return PALETTE[h];
}

function utilColor(u) {
  return u >= 30 ? '#b45309' : u >= 20 ? '#2563eb' : '#7c98c4';
}

function sortedLocations(list) {
  const seen = [...new Set(list.map((r) => r.location || 'Other'))];
  const known = LOCATION_ORDER.filter((l) => seen.includes(l));
  const rest = seen.filter((l) => !LOCATION_ORDER.includes(l)).sort();
  return [...known, ...rest];
}

function tile(val, label) {
  return (
    '<div class="col-6 col-md-4 col-xl-2"><div class="tile">' +
    '<div class="lbl">' + label + '</div><div class="val">' + val + '</div></div></div>'
  );
}

function renderTiles(d) {
  const s = d.summary;
  document.getElementById('tiles').innerHTML =
    tile(s.confirmed, 'Bookings') +
    tile(s.totalBookedHours, 'Booked hours') +
    tile(s.overallUtilization + '%', 'Utilization') +
    tile(s.avgDurationMin + ' m', 'Avg duration') +
    tile(s.cancelRate + '%', 'Cancelled') +
    tile(s.roomCount, 'Active rooms');
  document.getElementById('rangeNote').textContent =
    d.from + ' to ' + d.to + ' · ' + d.days + ' days · ' + s.roomCount + ' rooms · ' +
    d.businessStartHour + ':00–' + d.businessEndHour + ':00';
}

// Room utilization, grouped by location and collapsible: the location row shows
// the average, expanding it shows each room. Percentage only.
function renderPerRoom(d) {
  const el = document.getElementById('perRoom');
  if (!d.perRoom.length) {
    el.innerHTML = '<div class="text-muted p-3">No data.</div>';
    return;
  }
  el.innerHTML = sortedLocations(d.perRoom)
    .map((loc) => {
      const rooms = d.perRoom
        .filter((r) => (r.location || 'Other') === loc)
        .sort((a, b) => b.utilization - a.utilization);
      const avg = Math.round(rooms.reduce((s, r) => s + r.utilization, 0) / rooms.length);
      const open = openLocations.has(loc);
      const head =
        '<button type="button" class="util-loc util-grid" data-loc="' + escapeHtml(loc) + '">' +
        '<span class="chev">' + (open ? '▾' : '▸') + '</span>' +
        '<span class="nm">' + escapeHtml(loc) +
        ' <span class="fw-normal text-secondary">' + rooms.length + ' rooms</span></span>' +
        '<span class="bar"><span style="width:' + Math.min(100, avg) + '%;background:' + utilColor(avg) + '"></span></span>' +
        '<span class="pct">' + avg + '%</span></button>';
      if (!open) return head;
      const body =
        '<div class="util-rooms">' +
        rooms
          .map(
            (r) =>
              '<div class="util-room util-grid"><span></span>' +
              '<span class="nm">' + escapeHtml(r.name) + '</span>' +
              '<span class="bar sm"><span style="width:' + Math.min(100, r.utilization) + '%;background:' +
              utilColor(r.utilization) + '"></span></span>' +
              '<span class="pct">' + r.utilization + '%</span></div>'
          )
          .join('') +
        '</div>';
      return head + body;
    })
    .join('');
}

// Usage by department: hours only, on a fixed grid so the bars line up.
function renderByDept(d) {
  const el = document.getElementById('byDept');
  if (!d.byDepartment.length) {
    el.innerHTML = '<div class="text-muted p-3">No data.</div>';
    return;
  }
  const max = Math.max(...d.byDepartment.map((x) => x.hours)) || 1;
  el.innerHTML = d.byDepartment
    .map((x) => {
      const c = colorForDept(x.department);
      return (
        '<div class="dept-row"><span class="sw" style="background:' + c + '"></span>' +
        '<span class="nm">' + escapeHtml(x.department) + '</span>' +
        '<span class="bar"><span style="width:' + (x.hours / max) * 100 + '%;background:' + c + '"></span></span>' +
        '<span class="h">' + x.hours + ' h</span></div>'
      );
    })
    .join('');
}

function renderHeatmap(d) {
  const bs = d.businessStartHour;
  const be = d.businessEndHour;
  let max = 0;
  for (const row of d.heatmap) for (const v of row) if (v > max) max = v;
  max = max || 1;

  document.getElementById('heatScale').innerHTML =
    'Low' + HEAT_SCALE.map((c) => '<span class="sw" style="background:' + c + '"></span>').join('') + 'High';

  let html = '<thead><tr><th></th>';
  for (let h = bs; h < be; h++) html += '<th>' + h + '</th>';
  html += '</tr></thead><tbody>';
  for (const dow of DOW_ORDER) {
    html += '<tr><td class="rowlbl">' + DOW[dow] + '</td>';
    for (let i = 0; i < be - bs; i++) {
      const v = d.heatmap[dow][i] || 0;
      const alpha = v === 0 ? 0 : 0.14 + 0.86 * (v / max);
      const bg = v === 0 ? '#f4f6f9' : 'rgba(11,61,145,' + alpha.toFixed(3) + ')';
      const color = alpha > 0.55 ? '#fff' : '#3a444f';
      html +=
        '<td style="background:' + bg + ';color:' + color + '" title="' + DOW[dow] + ' ' +
        (bs + i) + ':00 — ' + v + ' min">' + (v ? Math.round(v) : '') + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody>';
  document.getElementById('heatmap').innerHTML = html;
}

// ---- CSV export ----------------------------------------------------------
// Built in the browser from the figures already on screen, so there is no
// second endpoint to keep in step with the page and no library to ship.

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvRows(d) {
  const s = d.summary;
  const rows = [
    ['Meeting room utilization'],
    ['From', d.from],
    ['To', d.to],
    ['Days', d.days],
    ['Business hours', d.businessStartHour + ':00-' + d.businessEndHour + ':00'],
    [],
    ['Summary'],
    ['Bookings', s.confirmed],
    ['Booked hours', s.totalBookedHours],
    ['Utilization %', s.overallUtilization],
    ['Avg duration (min)', s.avgDurationMin],
    ['Cancelled %', s.cancelRate],
    ['Active rooms', s.roomCount],
    [],
    ['Room utilization'],
    ['Location', 'Room', 'Bookings', 'Booked hours', 'Utilization %'],
  ];

  for (const loc of sortedLocations(d.perRoom)) {
    const inLoc = d.perRoom.filter((r) => (r.location || 'Other') === loc);
    for (const r of inLoc.sort((a, b) => b.utilization - a.utilization)) {
      rows.push([loc, r.name, r.count, r.hours, r.utilization]);
    }
  }

  rows.push([], ['Usage by department'], ['Department', 'Bookings', 'Booked hours']);
  for (const x of d.byDepartment) rows.push([x.department, x.count, x.hours]);

  // Weekday x hour, same orientation as the heatmap on screen
  const hours = [];
  for (let h = d.businessStartHour; h < d.businessEndHour; h++) hours.push(h);
  rows.push([], ['Busy times (booked minutes)'], ['Weekday', ...hours.map((h) => h + ':00')]);
  for (const dow of DOW_ORDER) {
    rows.push([DOW[dow], ...hours.map((_, i) => Math.round(d.heatmap[dow][i] || 0))]);
  }

  return rows;
}

function exportCsv() {
  if (!lastData) return;
  // CRLF and a BOM: without them Excel splits nothing onto rows and mangles any
  // non-ASCII department name.
  const body = csvRows(lastData).map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `meeting-room-usage_${lastData.from}_${lastData.to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function load() {
  const from = document.getElementById('from').value;
  const to = document.getElementById('to').value;
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  try {
    const d = await api('/api/stats?' + q.toString());
    lastData = d;
    document.getElementById('from').value = d.from;
    document.getElementById('to').value = d.to;
    renderTiles(d);
    renderPerRoom(d);
    renderByDept(d);
    renderHeatmap(d);
    document.getElementById('exportCsv').disabled = false;
  } catch (err) {
    document.getElementById('tiles').innerHTML =
      '<div class="text-danger">' + escapeHtml(err.message) + '</div>';
    document.getElementById('exportCsv').disabled = true;
  }
}

document.getElementById('apply').addEventListener('click', load);
document.getElementById('exportCsv').addEventListener('click', exportCsv);
document.getElementById('perRoom').addEventListener('click', (e) => {
  const btn = e.target.closest('.util-loc[data-loc]');
  if (!btn || !lastData) return;
  const loc = btn.getAttribute('data-loc');
  if (openLocations.has(loc)) openLocations.delete(loc);
  else openLocations.add(loc);
  renderPerRoom(lastData);
});
document.addEventListener('DOMContentLoaded', load);
