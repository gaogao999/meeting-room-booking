'use strict';

const config = require('../config');

// ---- Date helpers. Local time throughout, in the form "YYYY-MM-DDTHH:MM" ----

// Turn "2026-07-01T09:30" into a Date. Built field by field rather than with
// new Date(str), whose reading of the time zone is ambiguous.
function parseLocal(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(str || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    0,
    0
  );
  // Date rolls an impossible day forward — 30 February becomes 2 March — so
  // check the parts came back as they went in.
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(mo) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return null;
  }
  return date;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Render a Date back as "YYYY-MM-DDTHH:MM".
function formatLocal(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// Is this an HR department? Matched loosely, so "GA.HR" and "HR" both count.
function isHrDepartment(department) {
  if (!department) return false;
  const dep = String(department).toLowerCase();
  return config.booking.hrDepartments.some((keyword) =>
    dep.includes(String(keyword).toLowerCase())
  );
}

// The furthest ahead this department may book. HR gets a longer window.
function bookingWindowEnd(department, now = new Date()) {
  const days = isHrDepartment(department)
    ? config.booking.windowHrDays
    : config.booking.windowDefaultDays;
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  return end;
}

// Long enough for any real department code, name or meeting title, short
// enough that nobody can park a novel in the database.
const MAX_LENGTHS = { department: 60, reserver: 80, purpose: 200 };

function checkLengths({ department, reserver, purpose }) {
  for (const [field, max] of Object.entries(MAX_LENGTHS)) {
    const value = { department, reserver, purpose }[field];
    if (value && String(value).length > max) {
      const label = field[0].toUpperCase() + field.slice(1);
      return { ok: false, error: `${label} must be ${max} characters or fewer.` };
    }
  }
  return { ok: true };
}

// The invited people, as they arrive from the browser: an array of
// {name, email}. Returns the list to store, or an error to show.
//
// The cap matches what the free/busy lookup will accept, and both exist for the
// same reason — a meeting nobody can read the attendee list of is not a meeting
// this app needs to support.
const MAX_PARTICIPANTS = 20;

function normalizeParticipants(input) {
  if (input === undefined || input === null || input === '') return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'Participants must be a list.' };
  if (input.length > MAX_PARTICIPANTS) {
    return { ok: false, error: `You can invite up to ${MAX_PARTICIPANTS} people.` };
  }

  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const entry = raw && typeof raw === 'object' ? raw : { email: raw };
    const email = String(entry.email || '').trim();
    const name = String(entry.name || '').trim() || email;
    if (!email) continue;
    // Deliberately loose: enough to catch a typed mistake, not an attempt to
    // decide which addresses Microsoft considers real.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
      return { ok: false, error: `"${email}" does not look like an email address.` };
    }
    if (name.length > 80) return { ok: false, error: 'A participant name is too long.' };
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, email });
  }
  return { ok: true, value: out };
}

// The join link for the online meeting. Only http(s): a javascript: or data:
// URL here would end up as the href of a link the whole company clicks.
function checkMeetingUrl(url) {
  if (!url) return { ok: true, value: null };
  const value = String(url).trim();
  if (!value) return { ok: true, value: null };
  if (value.length > 500) return { ok: false, error: 'Meeting link is too long.' };
  let parsed;
  try {
    parsed = new URL(value);
  } catch (err) {
    return { ok: false, error: 'Meeting link must be a full address starting with https://' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Meeting link must start with https://' };
  }
  return { ok: true, value };
}

function validateBooking({ startAt, endAt, department }, now = new Date()) {
  const start = parseLocal(startAt);
  const end = parseLocal(endAt);
  const slot = config.booking.slotMinutes;

  if (!start) return { ok: false, error: 'Invalid start date/time format.' };
  if (!end) return { ok: false, error: 'Invalid end date/time format.' };
  if (!department || !String(department).trim()) {
    return { ok: false, error: 'Department is required.' };
  }

  if (end <= start) {
    return { ok: false, error: 'End time must be after start time.' };
  }

  // Must be aligned to the slot (10 minutes / SLOT_MINUTES)
  if (start.getMinutes() % slot !== 0 || start.getSeconds() !== 0) {
    return { ok: false, error: `Start time must be in ${slot}-minute increments.` };
  }
  if (end.getMinutes() % slot !== 0 || end.getSeconds() !== 0) {
    return { ok: false, error: `End time must be in ${slot}-minute increments.` };
  }
  const durationMin = (end - start) / 60000;
  if (durationMin % slot !== 0) {
    return { ok: false, error: `Duration must be in ${slot}-minute increments.` };
  }

  // No bookings in the past (start before now)
  if (start < now) {
    return { ok: false, error: 'Cannot book a time in the past.' };
  }

  // Must be within business hours on a single day (e.g. 7:00-21:00).
  // The form already limits this; enforce it server-side too.
  const bs = config.booking.businessStartHour;
  const be = config.booking.businessEndHour;
  const startMinOfDay = start.getHours() * 60 + start.getMinutes();
  const endMinOfDay = end.getHours() * 60 + end.getMinutes();
  if (
    start.toDateString() !== end.toDateString() ||
    startMinOfDay < bs * 60 ||
    endMinOfDay > be * 60
  ) {
    return {
      ok: false,
      error: `Bookings must be within business hours (${bs}:00–${be}:00).`,
    };
  }

  // Per-department booking window
  const windowEnd = bookingWindowEnd(department, now);
  if (start > windowEnd) {
    const days = isHrDepartment(department)
      ? config.booking.windowHrDays
      : config.booking.windowDefaultDays;
    return {
      ok: false,
      error: `This department can book up to ${days} days ahead (until ${formatLocal(
        windowEnd
      ).slice(0, 10)}).`,
    };
  }

  return {
    ok: true,
    normalized: { startAt: formatLocal(start), endAt: formatLocal(end) },
  };
}

// isHrDepartment / bookingWindowEnd are only used by validateBooking below, so
// they stay private to this module.
module.exports = {
  parseLocal,
  formatLocal,
  validateBooking,
  checkLengths,
  normalizeParticipants,
  checkMeetingUrl,
};
