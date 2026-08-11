'use strict';

const express = require('express');
const config = require('../config');
const graph = require('../services/graph');

const router = express.Router();

const { parseLocal } = require('../services/bookingRules');

// Whether real calendars are reachable at all. The frontend asks once, on load,
// so it can say plainly on the page whether what follows is somebody's actual
// diary or a placeholder.
router.get('/mode', (req, res) => {
  res.json({ mode: graph.isConfigured() ? 'live' : 'sample' });
});

// Find someone to invite. Directory search needs a permission IT may not have
// granted even when free/busy works, so a failure is answered as "no matches"
// rather than an error — the address can still be typed out in full.
router.get('/', async (req, res, next) => {
  try {
    res.json(await graph.searchPeople(req.query.q));
  } catch (err) {
    if (err.status && err.status < 500) {
      return res.json({ mode: 'live', people: [], note: 'Directory search is not available.' });
    }
    next(err);
  }
});

// When these people are busy on one day, within business hours.
router.post('/freebusy', async (req, res, next) => {
  try {
    const body = req.body || {};
    // Parsed rather than pattern-matched: "2026-13-45" satisfies a regex and is
    // not a day, and asking Microsoft about it is a request that can only fail.
    const date = String(body.date || '');
    if (!parseLocal(date + 'T00:00')) {
      return res.status(400).json({ error: 'Please provide a valid date.' });
    }
    const emails = Array.isArray(body.emails) ? body.emails.map((e) => String(e).trim()) : [];
    // One row per person on a screen someone has to read — well past the point
    // where a wider net would help, and it bounds what one request can ask
    // Microsoft for.
    if (emails.length > 20) {
      return res.status(400).json({ error: 'Please check no more than 20 people at a time.' });
    }

    const { businessStartHour, businessEndHour, slotMinutes } = config.booking;
    const result = await graph.freeBusy(
      emails,
      date,
      businessStartHour * 60,
      businessEndHour * 60,
      slotMinutes
    );
    res.json({ date, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
