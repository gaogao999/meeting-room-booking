'use strict';

const express = require('express');
const { prisma } = require('../db');
const { byLocationThenName } = require('../db/roomCatalog');

const router = express.Router();

// Read-only. Rooms are configured in src/db/roomCatalog.js and synced on boot,
// so there is deliberately no way to add or change them over the API.

// List rooms
router.get('/', async (req, res, next) => {
  try {
    const includeInactive = req.query.all === '1';
    const rows = await prisma.rooms.findMany(includeInactive ? {} : { where: { is_active: true } });
    res.json(rows.sort(byLocationThenName));
  } catch (err) {
    next(err);
  }
});

// Get one room
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const room = Number.isFinite(id) ? await prisma.rooms.findUnique({ where: { id } }) : null;
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    res.json(room);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
