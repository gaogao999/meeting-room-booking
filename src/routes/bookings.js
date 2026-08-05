'use strict';

const express = require('express');
const { prisma } = require('../db');
const config = require('../config');
const { validateBooking, checkLengths } = require('../services/bookingRules');

const router = express.Router();

// Which browser is asking. Set by every request the frontend makes; absent for
// anything else (curl, another tool), which just means nothing looks "mine".
function deviceOf(req) {
  const id = req.get('X-Device-Id');
  return id && /^[a-f0-9]{8,64}$/i.test(id) ? id : null;
}

// The identifiers stay on the server. A browser is told whether a booking is its
// own, never what anyone else's device id is — including the one that cancelled
// something. The joined room is flattened to room_name so the JSON keeps the
// shape the frontend already reads.
function present(row, device) {
  const { device_id, created_ip, cancelled_device, room, ...rest } = row;
  return {
    ...rest,
    room_name: room ? room.name : rest.room_name,
    mine: Boolean(device && device_id === device),
  };
}

// Find a confirmed booking that overlaps [startAt, endAt) for the room.
// Half-open interval: adjacent bookings (end == next start) do NOT overlap.
function findOverlap(tx, roomId, startAt, endAt, excludeId = null) {
  return tx.bookings.findFirst({
    // Only the three columns the caller needs, which is also every column of
    // the (room_id, start_at, end_at) index — so the check is answered from the
    // index alone. Selecting the whole row made SQL Server scan the table
    // instead, because fetching the rest meant a lookup per candidate row.
    select: { id: true, start_at: true, end_at: true },
    where: {
      room_id: roomId,
      status: 'confirmed',
      start_at: { lt: endAt },
      end_at: { gt: startAt },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

// Two people pressing Book on the same room at the same moment must not both
// succeed, and "check, then insert" is two steps with a gap between them.
//
// A serializable transaction closes the gap, but two of them taking range locks
// on the same room and then both inserting deadlock each other: SQL Server kills
// one with error 1205 and that caller sees a crash instead of "already booked".
// An application lock keyed on the room is deterministic instead — whoever
// arrives first does the check and the insert while anyone else booking that
// room waits their turn, and bookings for every other room carry on untouched.
async function lockRoom(tx, roomId) {
  await tx.$executeRawUnsafe(
    `DECLARE @res int;
     EXEC @res = sp_getapplock @Resource = @P1, @LockMode = 'Exclusive',
                               @LockOwner = 'Transaction', @LockTimeout = 8000;
     IF @res < 0 THROW 51000, 'Timed out waiting for another booking on this room', 1;`,
    `room-${roomId}`
  );
}

// Long enough that a queue of people booking the same room all get served
// rather than the last of them timing out.
const TX_OPTIONS = { timeout: 20000, maxWait: 20000 };

function insertIfFree(data) {
  return prisma.$transaction(async (tx) => {
    await lockRoom(tx, data.roomId);
    const overlap = await findOverlap(tx, data.roomId, data.startAt, data.endAt);
    if (overlap) return { overlap };
    const created = await tx.bookings.create({
      data: {
        room_id: data.roomId,
        department: data.department,
        reserver: data.reserver,
        purpose: data.purpose,
        start_at: data.startAt,
        end_at: data.endAt,
        created_by: data.createdBy,
        device_id: data.deviceId,
        created_ip: data.createdIp,
      },
    });
    return { id: created.id };
  }, TX_OPTIONS);
}

function updateIfFree(data) {
  return prisma.$transaction(async (tx) => {
    await lockRoom(tx, data.roomId);
    const overlap = await findOverlap(tx, data.roomId, data.startAt, data.endAt, data.id);
    if (overlap) return { overlap };
    await tx.bookings.update({
      where: { id: data.id },
      data: {
        room_id: data.roomId,
        department: data.department,
        reserver: data.reserver,
        purpose: data.purpose,
        start_at: data.startAt,
        end_at: data.endAt,
      },
    });
    return { id: data.id };
  }, TX_OPTIONS);
}

const withRoom = { include: { room: { select: { name: true } } } };

// List bookings (filters: room_id, from, to, status)
// By default only confirmed bookings are returned (cancelled ones are kept in the
// database for analytics but hidden from the schedule). Pass status=all to include them.
router.get('/', async (req, res, next) => {
  try {
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

    const where = {};
    if (status !== 'all') where.status = status || 'confirmed';
    if (room_id) {
      const id = parseInt(room_id, 10);
      if (Number.isFinite(id)) where.room_id = id;
    }
    if (from) where.end_at = { gt: String(from) };
    if (to) where.start_at = { lt: String(to) };

    const rows = await prisma.bookings.findMany({
      where,
      ...withRoom,
      orderBy: { start_at: 'asc' },
    });
    const device = deviceOf(req);
    res.json(rows.map((r) => present(r, device)));
  } catch (err) {
    next(err);
  }
});

// Get one booking
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = Number.isFinite(id)
      ? await prisma.bookings.findUnique({ where: { id }, ...withRoom })
      : null;
    if (!row) return res.status(404).json({ error: 'Booking not found.' });
    res.json(present(row, deviceOf(req)));
  } catch (err) {
    next(err);
  }
});

// Create a booking
router.post('/', async (req, res, next) => {
  try {
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

    const room = await prisma.rooms.findFirst({ where: { id: roomId, is_active: true } });
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

    const result = await insertIfFree({
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

    const created = await prisma.bookings.findUnique({ where: { id: result.id }, ...withRoom });
    res.status(201).json(present(created, deviceOf(req)));
  } catch (err) {
    next(err);
  }
});

// Update a booking
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = Number.isFinite(id)
      ? await prisma.bookings.findUnique({ where: { id } })
      : null;
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

    const room = await prisma.rooms.findFirst({ where: { id: roomId, is_active: true } });
    if (!room) {
      return res.status(404).json({ error: 'Room not found or unavailable.' });
    }

    const check = validateBooking({ startAt, endAt, department });
    if (!check.ok) return res.status(400).json({ error: check.error });
    const norm = check.normalized;

    const result = await updateIfFree({
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

    const updated = await prisma.bookings.findUnique({ where: { id: existing.id }, ...withRoom });
    res.json(present(updated, deviceOf(req)));
  } catch (err) {
    next(err);
  }
});

// Cancel a booking (soft delete: keep the row for analytics, mark it cancelled).
// Cancelled bookings no longer block the slot and are hidden from the schedule.
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = Number.isFinite(id)
      ? await prisma.bookings.findUnique({ where: { id } })
      : null;
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

    await prisma.bookings.update({
      where: { id },
      // Record who dropped it and when. Overwriting the status alone said a
      // booking was gone but not by whose hand, which is the first thing anyone
      // asks when a meeting vanishes from the schedule.
      data: {
        status: 'cancelled',
        cancelled_at: new Date(),
        cancelled_device: deviceOf(req),
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
