'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

// List rooms
router.get('/', (req, res) => {
  const includeInactive = req.query.all === '1';
  // Order by location (Factory 1, 2, 3 ...) first, then by room name.
  // Rooms without a location go last.
  const order = 'ORDER BY location IS NULL, location, name';
  const rows = includeInactive
    ? db.prepare(`SELECT * FROM rooms ${order}`).all()
    : db.prepare(`SELECT * FROM rooms WHERE is_active = 1 ${order}`).all();
  res.json(rows);
});

// Get one room
router.get('/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  res.json(room);
});

// Create a room
router.post('/', (req, res) => {
  const { name, location, capacity, description } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Room name is required.' });
  }
  const cap = capacity === undefined || capacity === '' ? null : parseInt(capacity, 10);
  if (cap !== null && (!Number.isFinite(cap) || cap < 0)) {
    return res.status(400).json({ error: 'Capacity must be a non-negative integer.' });
  }
  try {
    const info = db
      .prepare(
        'INSERT INTO rooms (name, location, capacity, description) VALUES (?, ?, ?, ?)'
      )
      .run(String(name).trim(), location || null, cap, description || null);
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(room);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A room with the same name already exists in this location.' });
    }
    throw err;
  }
});

// Update a room
router.put('/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found.' });

  const { name, location, capacity, description, is_active } = req.body || {};
  const cap =
    capacity === undefined || capacity === '' ? room.capacity : parseInt(capacity, 10);
  if (cap !== null && (!Number.isFinite(cap) || cap < 0)) {
    return res.status(400).json({ error: 'Capacity must be a non-negative integer.' });
  }
  try {
    db.prepare(
      `UPDATE rooms SET name = ?, location = ?, capacity = ?, description = ?, is_active = ?
       WHERE id = ?`
    ).run(
      name !== undefined ? String(name).trim() : room.name,
      location !== undefined ? location : room.location,
      cap,
      description !== undefined ? description : room.description,
      is_active !== undefined ? (is_active ? 1 : 0) : room.is_active,
      req.params.id
    );
    const updated = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A room with the same name already exists in this location.' });
    }
    throw err;
  }
});

// Delete a room (soft delete)
router.delete('/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  db.prepare('UPDATE rooms SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
