'use strict';

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `エラー (${res.status})`);
  return data;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function showAlert(message, type = 'danger') {
  document.getElementById('formAlert').innerHTML =
    `<div class="alert alert-${type} alert-dismissible fade show" role="alert">${message}` +
    `<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
}

function resetForm() {
  document.getElementById('roomForm').reset();
  document.getElementById('roomId').value = '';
  document.getElementById('formTitle').textContent = '会議室の登録';
  document.getElementById('submitBtn').textContent = '登録する';
  document.getElementById('cancelEdit').classList.add('d-none');
}

async function loadRooms() {
  const tbody = document.getElementById('roomList');
  try {
    const rooms = await api('/api/rooms?all=1');
    if (rooms.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="text-center text-muted py-4">会議室は未登録です</td></tr>';
      return;
    }
    tbody.innerHTML = rooms
      .map(
        (r) => `
      <tr class="${r.is_active ? '' : 'table-secondary'}">
        <td>${escapeHtml(r.name)} ${r.is_active ? '' : '<span class="badge bg-secondary">停止中</span>'}</td>
        <td>${escapeHtml(r.location || '')}</td>
        <td>${r.capacity == null ? '' : r.capacity + ' 名'}</td>
        <td>${escapeHtml(r.description || '')}</td>
        <td class="text-nowrap">
          <button class="btn btn-sm btn-outline-primary" data-edit='${JSON.stringify(r)}'>編集</button>
          ${
            r.is_active
              ? `<button class="btn btn-sm btn-outline-danger" data-delete="${r.id}">停止</button>`
              : `<button class="btn btn-sm btn-outline-success" data-activate="${r.id}">再開</button>`
          }
        </td>
      </tr>`
      )
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger text-center py-4">${escapeHtml(err.message)}</td></tr>`;
  }
}

function editRoom(room) {
  document.getElementById('roomId').value = room.id;
  document.getElementById('name').value = room.name;
  document.getElementById('location').value = room.location || '';
  document.getElementById('capacity').value = room.capacity == null ? '' : room.capacity;
  document.getElementById('description').value = room.description || '';
  document.getElementById('formTitle').textContent = `会議室の編集: ${room.name}`;
  document.getElementById('submitBtn').textContent = '更新する';
  document.getElementById('cancelEdit').classList.remove('d-none');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitRoom(e) {
  e.preventDefault();
  const id = document.getElementById('roomId').value;
  const payload = {
    name: document.getElementById('name').value,
    location: document.getElementById('location').value,
    capacity: document.getElementById('capacity').value,
    description: document.getElementById('description').value,
  };
  try {
    if (id) {
      await api(`/api/rooms/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showAlert('会議室を更新しました。', 'success');
    } else {
      await api('/api/rooms', { method: 'POST', body: JSON.stringify(payload) });
      showAlert('会議室を登録しました。', 'success');
    }
    resetForm();
    loadRooms();
  } catch (err) {
    showAlert(err.message);
  }
}

async function setActive(id, active) {
  try {
    if (active) {
      await api(`/api/rooms/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: 1 }),
      });
    } else {
      await api(`/api/rooms/${id}`, { method: 'DELETE' });
    }
    loadRooms();
  } catch (err) {
    alert(err.message);
  }
}

function init() {
  document.getElementById('roomForm').addEventListener('submit', submitRoom);
  document.getElementById('cancelEdit').addEventListener('click', resetForm);
  document.getElementById('roomList').addEventListener('click', (e) => {
    const editData = e.target.getAttribute('data-edit');
    const deleteId = e.target.getAttribute('data-delete');
    const activateId = e.target.getAttribute('data-activate');
    if (editData) editRoom(JSON.parse(editData));
    if (deleteId) setActive(deleteId, false);
    if (activateId) setActive(activateId, true);
  });
  loadRooms();
}

document.addEventListener('DOMContentLoaded', init);
