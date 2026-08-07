'use strict';

const express = require('express');
const { prisma } = require('../db');
const { byLocationThenName } = require('../db/roomCatalog');
const { parseLocal, formatLocal } = require('../services/bookingRules');

const router = express.Router();

// Which rooms are free for [start_at, end_at), all in one go. How far ahead a
// department may book is not considered here — this answers only "is it taken".
router.get('/', async (req, res, next) => {
  try {
    const s = parseLocal(req.query.start_at);
    const e = parseLocal(req.query.end_at);
    if (!s || !e) {
      return res.status(400).json({ error: 'Please provide start and end date/time.' });
    }
    if (e <= s) {
      return res.status(400).json({ error: 'End time must be after start time.' });
    }
    const startAt = formatLocal(s);
    const endAt = formatLocal(e);

    const rooms = (await prisma.rooms.findMany({ where: { is_active: true } })).sort(
      byLocationThenName
    );

    // Overlap on the half-open interval [start, end): a booking that ends
    // exactly when this one starts does not count.
    // One query for every room rather than one per room, and it asks only which
    // rooms are taken — who booked them is on the schedule, and this endpoint has
    // no reason to hand it out.
    const grouped = await prisma.bookings.groupBy({
      by: ['room_id'],
      where: { status: 'confirmed', start_at: { lt: endAt }, end_at: { gt: startAt } },
      _count: { _all: true },
    });
    const taken = new Map(grouped.map((g) => [g.room_id, g._count._all]));

    const available = rooms.filter((r) => !taken.has(r.id));
    const busy = rooms
      .filter((r) => taken.has(r.id))
      .map((r) => ({ room: r, conflicts: taken.get(r.id) }));

    res.json({ start_at: startAt, end_at: endAt, available, busy });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
