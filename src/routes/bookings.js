'use strict';

const express = require('express');
const db = require('../db');
const { validateBooking } = require('../services/bookingRules');

const router = express.Router();

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
        (room_id, department, reserver, purpose, start_at, end_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.roomId,
      data.department,
      data.reserver,
      data.purpose,
      data.startAt,
      data.endAt,
      data.createdBy
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

// List bookings (filters: room_id, from, to)
router.get('/', (req, res) => {
  const { room_id, from, to } = req.query;
  const clauses = [];
  const params = [];
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
  res.json(rows);
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
  res.json(row);
});

// Create a booking
router.post('/', (req, res) => {
  const body = req.body || {};
  const roomId = parseInt(body.room_id, 10);
  const department = (body.department || req.user?.department || '').trim();
  const reserver = (body.reserver || req.user?.name || '').trim();
  const purpose = body.purpose ? String(body.purpose).trim() : null;

  if (!Number.isFinite(roomId)) {
    return res.status(400).json({ error: 'Please select a room.' });
  }
  if (!reserver) {
    return res.status(400).json({ error: 'Reserver name is required.' });
  }

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
  res.status(201).json(created);
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
  res.json(updated);
});

// Cancel a booking
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Booking not found.' });
  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
