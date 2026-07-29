'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

// Read-only. Rooms are configured in src/db/roomCatalog.js and synced on boot,
// so there is deliberately no way to add or change them over the API.

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

module.exports = router;
