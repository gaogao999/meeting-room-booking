'use strict';

// The door-side display. One room, today, no interaction: a screen by the door
// that says whether the room is in use, by whom, and what is coming next.
//
// Two things shape everything below. It runs unattended for months, so it can
// never end up on an error page a person would have to come and clear; and it
// is read by visitors, so what it shows must be a fact, not a guess. When the
// server cannot be reached it keeps showing the last thing it knew and marks
// itself as not updating, rather than blanking or claiming the room is free.

// How often to ask the server, and how often to re-read the clock. The second
// is much shorter because a room becomes free at a particular minute, and a
// screen that says "in use" for another minute after the meeting ended is the
// error people notice. Fetching that often would be pointless — the bookings
// themselves rarely change.
const POLL_MS = 60 * 1000;
const TICK_MS = 5 * 1000;
// After this long with no successful fetch, say so.
const STALE_MS = 5 * 60 * 1000;

const state = {
  roomId: null,
  room: null,
  bookings: [],
  lastOk: 0,
};

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-08-12T13:30" -> minutes since midnight. The app stores and returns local
// wall-clock times as text, so there is nothing to convert.
function minutesOf(local) {
  return parseInt(local.slice(11, 13), 10) * 60 + parseInt(local.slice(14, 16), 10);
}

function fmtMin(m) {
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// "1 h 20 min" — spoken the way someone waiting outside a door would say it.
function durText(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

// ---- choosing the room, once, when the tablet is set up ---------------------

async function showPicker() {
  const box = document.getElementById('picker');
  box.hidden = false;
  const rooms = await api('/api/rooms');
  setLocationOrder((await api('/api/config')).locations);
  const list = document.getElementById('pickerList');
  list.innerHTML = sortedLocations(rooms)
    .map((loc) => {
      const inLoc = rooms.filter((r) => (r.location || 'Other') === loc);
      return (
        `<div class="loc">${escapeHtml(loc)}</div>` +
        inLoc
          .map((r) => `<a href="/display.html?room=${r.id}">${escapeHtml(r.name)}</a>`)
          .join('')
      );
    })
    .join('');
}

// ---- the screen itself ------------------------------------------------------

async function fetchDay() {
  const date = todayStr();
  const list = await api(
    `/api/bookings?room_id=${state.roomId}&from=${date}T00:00&to=${date}T23:59`
  );
  // Belt and braces: the range above is already one day, but a booking from
  // another date on this screen would be worse than one missing.
  state.bookings = list
    .filter((b) => b.start_at.slice(0, 10) === date)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  state.lastOk = Date.now();
}

function render() {
  const now = nowMinutes();
  const running = state.bookings.find((b) => minutesOf(b.start_at) <= now && minutesOf(b.end_at) > now);
  const later = state.bookings.filter((b) => minutesOf(b.start_at) > now);
  const next = later[0] || null;

  const status = document.getElementById('status');
  const stateText = document.getElementById('stateText');
  const detail = document.getElementById('stateDetail');
  const who = document.getElementById('stateWho');

  status.classList.remove('is-busy', 'is-soon');
  if (running) {
    status.classList.add('is-busy');
    stateText.textContent = 'In use';
    detail.textContent = running.purpose || `${running.department} meeting`;
    who.textContent =
      `${running.department} · ${running.reserver} · until ${fmtMin(minutesOf(running.end_at))}` +
      ` (${durText(minutesOf(running.end_at) - now)} left)`;
  } else {
    stateText.textContent = 'Free';
    if (next) {
      const gap = minutesOf(next.start_at) - now;
      // Under half an hour is not really free — long enough to sit down, not
      // long enough to hold a meeting.
      if (gap <= 30) status.classList.add('is-soon');
      detail.textContent = `Free for ${durText(gap)}`;
      who.textContent = `Next booking starts at ${fmtMin(minutesOf(next.start_at))}`;
    } else {
      detail.textContent = 'Free for the rest of the day';
      who.textContent = '';
    }
  }

  const nextBox = document.getElementById('next');
  if (next && running) {
    nextBox.hidden = false;
    document.getElementById('nextTime').textContent =
      `${fmtMin(minutesOf(next.start_at))}–${fmtMin(minutesOf(next.end_at))}`;
    document.getElementById('nextWhat').textContent =
      `${next.purpose || next.department + ' meeting'} · ${next.department}`;
  } else {
    nextBox.hidden = true;
  }

  // The rest of the day, as chips. When there is nothing running the next
  // booking is already named in the band above, so it is not repeated here.
  const rest = running ? later : later.slice(1);
  document.getElementById('rest').innerHTML = rest
    .map(
      (b) =>
        `<span class="item"><b>${fmtMin(minutesOf(b.start_at))}</b> ${escapeHtml(
          b.purpose || b.department + ' meeting'
        )}</span>`
    )
    .join('');

  const d = new Date();
  document.getElementById('clock').textContent = `${d.getHours()}:${pad(d.getMinutes())}`;
  document.getElementById('dateLabel').textContent = d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  document.getElementById('footNote').textContent = state.bookings.length
    ? `${state.bookings.length} booking${state.bookings.length > 1 ? 's' : ''} today`
    : 'Nothing booked today';
  document.getElementById('stale').hidden = Date.now() - state.lastOk < STALE_MS;
}

async function poll() {
  try {
    await fetchDay();
  } catch (err) {
    // Left deliberately silent on screen. The stale mark in the footer is the
    // only thing a visitor should ever see of a network problem.
  }
  render();
}

async function init() {
  const room = parseInt(qs('room'), 10);
  if (!Number.isFinite(room)) {
    showPicker().catch(() => {
      document.getElementById('pickerList').textContent =
        'Cannot reach the booking system. Check the tablet is on the office network.';
    });
    return;
  }
  state.roomId = room;

  try {
    state.room = await api(`/api/rooms/${room}`);
  } catch (err) {
    // A screen pointed at a room that no longer exists should say which room it
    // was looking for, so whoever finds it knows what to fix.
    document.getElementById('picker').hidden = false;
    document.getElementById('pickerList').textContent = `Room ${room} was not found.`;
    return;
  }

  document.getElementById('panel').hidden = false;
  document.getElementById('roomName').textContent = state.room.name;
  document.getElementById('roomLoc').textContent = state.room.location || '';
  document.title = `${state.room.name} — Room display`;

  await poll();
  setInterval(poll, POLL_MS);
  // Between fetches the clock and the "in use / free" line still have to move.
  setInterval(render, TICK_MS);
  // A day rolls over at midnight; without this the screen would show yesterday
  // until someone reloaded it.
  let day = todayStr();
  setInterval(() => {
    if (todayStr() !== day) {
      day = todayStr();
      poll();
    }
  }, TICK_MS);
}

document.addEventListener('DOMContentLoaded', init);
