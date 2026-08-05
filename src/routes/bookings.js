'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { validateBooking, checkLengths } = require('../services/bookingRules');

const router = express.Router();

// Which browser is asking. Set by every request the frontend makes; absent for
// anything else (curl, another tool), which just means nothing looks "mine".
function deviceOf(req) {
  const id = req.get('X-Device-Id');
  return id && /^[a-f0-9]{8,64}$/i.test(id) ? id : null;
}

// device_id and created_ip stay on the server. The browser is told whether a
// booking is its own, not what everyone else's identifiers are.
function present(row, device) {
  const { device_id, created_ip, ...rest } = row;
  return { ...rest, mine: Boolean(device && device_id === device) };
}

// Find a confirmed booking that overlaps [startAt, endAt) for the room.
// Half-open interval: adjacent bookings (end == next start) do NOT overlap.
function findOverlap(roomId, startAt, endAt, excludeId = null) {
  const params = [roomId, endAt, startAt];
  let sql = `
    SELECT * FROM bookings
    WHERE room_id = ?
      AND status = 'confirmed'
      AND start_at < ?
      AND end_at > ?`;
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  return db.prepare(sql).get(...params);
}

// Atomically check for overlap and insert. Wrapped in an IMMEDIATE transaction
// so the write lock is taken before the overlap check — this prevents a race
// where two concurrent requests both pass the check and double-book (even across
// multiple processes sharing the SQLite file). Returns the overlapping row if any.
const insertIfFree = db.transaction((data) => {
  const overlap = findOverlap(data.roomId, data.startAt, data.endAt);
  if (overlap) return { overlap };
  const info = db
    .prepare(
      `INSERT INTO bookings
        (room_id, department, reserver, purpose, start_at, end_at, created_by, device_id, created_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.roomId,
      data.department,
      data.reserver,
      data.purpose,
      data.startAt,
      data.endAt,
      data.createdBy,
      data.deviceId,
      data.createdIp
    );
  return { id: info.lastInsertRowid };
});

const updateIfFree = db.transaction((data) => {
  const overlap = findOverlap(data.roomId, data.startAt, data.endAt, data.id);
  if (overlap) return { overlap };
  db.prepare(
    `UPDATE bookings
       SET room_id = ?, department = ?, reserver = ?, purpose = ?, start_at = ?, end_at = ?
     WHERE id = ?`
  ).run(
    data.roomId,
    data.department,
    data.reserver,
    data.purpose,
    data.startAt,
    data.endAt,
    data.id
  );
  return { id: data.id };
});

// List bookings (filters: room_id, from, to, status)
// By default only confirmed bookings are returned (cancelled ones are kept in the
// database for analytics but hidden from the schedule). Pass status=all to include them.
router.get('/', (req, res) => {
  const { room_id, status } = req.query;
  let { from, to } = req.query;
  // With no range at all this returned every booking ever made — a couple of
  // megabytes after a year, for a screen that only ever shows one day. Default
  // to the window bookings can actually fall in: a month back for the analytics
  // and the longest booking window forward. An explicit from/to still goes
  // through untouched.
  if (!from && !to) {
    const day = (offset) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}T00:00`;
    };
    from = day(-30);
    to = day(config.booking.windowHrDays + 1);
  }
  const clauses = [];
  const params = [];
  if (status !== 'all') {
    clauses.push('b.status = ?');
    params.push(status || 'confirmed');
  }
  if (room_id) {
    clauses.push('b.room_id = ?');
    params.push(room_id);
  }
  if (from) {
    clauses.push('b.end_at > ?');
    params.push(from);
  }
  if (to) {
    clauses.push('b.start_at < ?');
    params.push(to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT b.*, r.name AS room_name
       FROM bookings b JOIN rooms r ON r.id = b.room_id
       ${where}
       ORDER BY b.start_at`
    )
    .all(...params);
  const device = deviceOf(req);
  res.json(rows.map((r) => present(r, device)));
});

// Get one booking
router.get('/:id', (req, res) => {
  const row = db
    .prepare(
      `SELECT b.*, r.name AS room_name
       FROM bookings b JOIN rooms r ON r.id = b.room_id
       WHERE b.id = ?`
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Booking not found.' });
  res.json(present(row, deviceOf(req)));
});

// Create a booking
router.post('/', (req, res) => {
  const body = req.body || {};
  const roomId = parseInt(body.room_id, 10);
  // Only fall back to the logged-in user when there actually is one. In mock
  // mode there is no login, so an empty field must fail rather than quietly
  // file the booking under a placeholder name.
  const authed = req.user?.mode !== 'mock';
  const department = (body.department || (authed ? req.user?.department : '') || '').trim();
  const reserver = (body.reserver || (authed ? req.user?.name : '') || '').trim();
  const purpose = body.purpose ? String(body.purpose).trim() : null;

  if (!Number.isFinite(roomId)) {
    return res.status(400).json({ error: 'Please select a room.' });
  }
  if (!reserver) {
    return res.status(400).json({ error: 'Reserver name is required.' });
  }
  const lengths = checkLengths({ department, reserver, purpose });
  if (!lengths.ok) return res.status(400).json({ error: lengths.error });

  const room = db.prepare('SELECT * FROM rooms WHERE id = ? AND is_active = 1').get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found or unavailable.' });
  }

  const check = validateBooking({
    startAt: body.start_at,
    endAt: body.end_at,
    department,
  });
  if (!check.ok) {
    return res.status(400).json({ error: check.error });
  }
  const { startAt, endAt } = check.normalized;

  const result = insertIfFree({
    roomId,
    department,
    reserver,
    purpose,
    startAt,
    endAt,
    createdBy: req.user?.name || null,
    deviceId: deviceOf(req),
    createdIp: req.ip || null,
  });
  if (result.overlap) {
    return res.status(409).json({
      error: 'This time slot is already booked.',
      conflict: { start_at: result.overlap.start_at, end_at: result.overlap.end_at },
    });
  }

  const created = db
    .prepare(
      `SELECT b.*, r.name AS room_name
       FROM bookings b JOIN rooms r ON r.id = b.room_id
       WHERE b.id = ?`
    )
    .get(result.id);
  res.status(201).json(present(created, deviceOf(req)));
});

// Update a booking
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Booking not found.' });

  const body = req.body || {};
  const roomId = body.room_id !== undefined ? parseInt(body.room_id, 10) : existing.room_id;
  const department =
    body.department !== undefined ? String(body.department).trim() : existing.department;
  const reserver =
    body.reserver !== undefined ? String(body.reserver).trim() : existing.reserver;
  const purpose = body.purpose !== undefined ? body.purpose : existing.purpose;
  const startAt = body.start_at !== undefined ? body.start_at : existing.start_at;
  const endAt = body.end_at !== undefined ? body.end_at : existing.end_at;

  if (!reserver) return res.status(400).json({ error: 'Reserver name is required.' });
  const lengths = checkLengths({ department, reserver, purpose });
  if (!lengths.ok) return res.status(400).json({ error: lengths.error });

  const room = db.prepare('SELECT * FROM rooms WHERE id = ? AND is_active = 1').get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found or unavailable.' });
  }

  const check = validateBooking({ startAt, endAt, department });
  if (!check.ok) return res.status(400).json({ error: check.error });
  const norm = check.normalized;

  const result = updateIfFree({
    id: existing.id,
    roomId,
    department,
    reserver,
    purpose,
    startAt: norm.startAt,
    endAt: norm.endAt,
  });
  if (result.overlap) {
    return res.status(409).json({
      error: 'This time slot is already booked.',
      conflict: { start_at: result.overlap.start_at, end_at: result.overlap.end_at },
    });
  }

  const updated = db
    .prepare(
      `SELECT b.*, r.name AS room_name
       FROM bookings b JOIN rooms r ON r.id = b.room_id
       WHERE b.id = ?`
    )
    .get(existing.id);
  res.json(present(updated, deviceOf(req)));
});

// Cancel a booking (soft delete: keep the row for analytics, mark it cancelled).
// Cancelled bookings no longer block the slot and are hidden from the schedule.
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Booking not found.' });

  // Only the browser that made a booking may cancel it. Enforced here rather
  // than by hiding the button, because a hidden button is not a rule.
  //
  // Two things are deliberately still allowed. A booking with no device
  // recorded — made before this rule, or from a script — can be cancelled by
  // anyone, otherwise nothing could ever clear it. And with a real login the
  // server knows who is asking, so the rule will belong to the user rather than
  // the browser; until that exists this applies to the no-login mode only.
  const authed = req.user?.mode !== 'mock';
  if (!authed && existing.device_id && existing.device_id !== deviceOf(req)) {
    return res.status(403).json({
      error: `This booking was made by ${existing.reserver} (${existing.department}) on another computer, so it can only be cancelled there.`,
    });
  }

  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
