'use strict';

// Shared by the booking, rooms and analytics pages. Loaded before each page's
// own script. These were copied into all three files, which meant the
// department colours could drift apart and show a team in one colour on the
// schedule and another in the analytics.

// Locations are shown in this order; anything unknown is appended alphabetically.
const LOCATION_ORDER = ['Bangna Office', 'Factory 1', 'Factory 2', 'Factory 3'];

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

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
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

function colorForDept(department) {
  const key = String(department || '').toLowerCase().trim();
  if (DEPT_COLORS[key]) return DEPT_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % PALETTE.length;
  return PALETTE[h];
}

// Takes anything with a .location, so it works on both rooms and per-room stats.
function sortedLocations(list) {
  const seen = [...new Set(list.map((r) => r.location || 'Other'))];
  const known = LOCATION_ORDER.filter((l) => seen.includes(l));
  const rest = seen.filter((l) => !LOCATION_ORDER.includes(l)).sort();
  return [...known, ...rest];
}
