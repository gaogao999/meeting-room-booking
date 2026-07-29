'use strict';

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

async function loadRooms() {
  const tbody = document.getElementById('roomList');
  try {
    const res = await fetch('/api/rooms?all=1');
    const rooms = await res.json();
    if (!res.ok) throw new Error(rooms.error || `Error (${res.status})`);

    if (rooms.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="text-center text-muted py-4">No rooms configured</td></tr>';
      return;
    }

    tbody.innerHTML = rooms
      .map(
        (r) => `
      <tr class="${r.is_active ? '' : 'table-secondary'}">
        <td class="text-muted">${escapeHtml(r.location || '')}</td>
        <td class="fw-semibold">${escapeHtml(r.name)}</td>
        <td class="text-end">${r.capacity == null ? '<span class="text-muted">—</span>' : r.capacity}</td>
        <td>${escapeHtml(r.description || '')}</td>
        <td>${
          r.is_active
            ? '<span class="badge bg-success-subtle text-success-emphasis">Available</span>'
            : '<span class="badge bg-secondary">Disabled</span>'
        }</td>
      </tr>`
      )
      .join('');

    const active = rooms.filter((r) => r.is_active).length;
    document.getElementById('roomCount').textContent =
      active === rooms.length
        ? `${active} rooms`
        : `${active} available, ${rooms.length - active} disabled`;
  } catch (err) {
    tbody.innerHTML =
      `<tr><td colspan="5" class="text-danger text-center py-4">${escapeHtml(err.message)}</td></tr>`;
  }
}

document.addEventListener('DOMContentLoaded', loadRooms);
