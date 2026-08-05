'use strict';

const express = require('express');
const { prisma } = require('../db');
const { byLocationThenName } = require('../db/roomCatalog');
const config = require('../config');

const router = express.Router();

function ymd(d) {
  return (
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getDate()).padStart(2, '0')}`
  );
}

// Utilization / usage statistics for a date range.
// GET /api/stats?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults: last 30 days)
router.get('/', async (req, res, next) => {
  try {
    const bs = config.booking.businessStartHour;
    const be = config.booking.businessEndHour;
    const busyPerDay = (be - bs) * 60; // available minutes per room per day

    const today = new Date();
    const defTo = ymd(today);
    const d0 = new Date(today);
    d0.setDate(d0.getDate() - 29);
    const defFrom = ymd(d0);
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = dateRe.test(req.query.from || '') ? req.query.from : defFrom;
    const to = dateRe.test(req.query.to || '') ? req.query.to : defTo;

    const days = Math.max(
      1,
      Math.round((new Date(`${to}T00:00`) - new Date(`${from}T00:00`)) / 86400000) + 1
    );

    const rooms = (await prisma.rooms.findMany({ where: { is_active: true } })).sort(
      byLocationThenName
    );

    // Compared as strings rather than with substr(): start_at is a fixed-width
    // "YYYY-MM-DDTHH:MM", so a plain range covers the same days and can use the
    // index, where wrapping the column in a function cannot.
    const rangeStart = `${from}T00:00`;
    const rangeEnd = `${to}T23:59`;

    const rows = await prisma.bookings.findMany({
      where: { status: 'confirmed', start_at: { gte: rangeStart, lte: rangeEnd } },
      select: { room_id: true, department: true, start_at: true, end_at: true },
    });

    const cancelledCount = await prisma.bookings.count({
      where: { status: 'cancelled', start_at: { gte: rangeStart, lte: rangeEnd } },
    });

    const perRoom = new Map(
      rooms.map((r) => [r.id, { id: r.id, name: r.name, location: r.location, minutes: 0, count: 0 }])
    );
    const byDept = new Map();
    const heat = Array.from({ length: 7 }, () => Array(be - bs).fill(0)); // [dow][hourIndex]
    let totalMinutes = 0;

    for (const b of rows) {
      const startMin = parseInt(b.start_at.slice(11, 13), 10) * 60 + parseInt(b.start_at.slice(14, 16), 10);
      const endMin = parseInt(b.end_at.slice(11, 13), 10) * 60 + parseInt(b.end_at.slice(14, 16), 10);
      const dur = Math.max(0, endMin - startMin);
      totalMinutes += dur;

      const pr = perRoom.get(b.room_id);
      if (pr) {
        pr.minutes += dur;
        pr.count += 1;
      }

      const dept = b.department || '(none)';
      const dd = byDept.get(dept) || { department: dept, minutes: 0, count: 0 };
      dd.minutes += dur;
      dd.count += 1;
      byDept.set(dept, dd);

      const dow = new Date(`${b.start_at.slice(0, 10)}T00:00`).getDay();
      for (let h = bs; h < be; h++) {
        const overlap = Math.max(0, Math.min(endMin, (h + 1) * 60) - Math.max(startMin, h * 60));
        if (overlap > 0) heat[dow][h - bs] += overlap;
      }
    }

    const perRoomArr = [...perRoom.values()]
      .map((r) => ({
        ...r,
        hours: Math.round(r.minutes / 6) / 10,
        utilization: Math.round((r.minutes / (busyPerDay * days)) * 1000) / 10,
      }))
      .sort((a, b) => b.utilization - a.utilization);

    const byDeptArr = [...byDept.values()]
      .map((d) => ({ ...d, hours: Math.round(d.minutes / 6) / 10 }))
      .sort((a, b) => b.minutes - a.minutes);

    const confirmed = rows.length;
    const total = confirmed + cancelledCount;

    res.json({
      from,
      to,
      days,
      businessStartHour: bs,
      businessEndHour: be,
      summary: {
        confirmed,
        cancelled: cancelledCount,
        cancelRate: total ? Math.round((cancelledCount / total) * 1000) / 10 : 0,
        avgDurationMin: confirmed ? Math.round(totalMinutes / confirmed) : 0,
        totalBookedHours: Math.round(totalMinutes / 6) / 10,
        overallUtilization: rooms.length
          ? Math.round((totalMinutes / (busyPerDay * days * rooms.length)) * 1000) / 10
          : 0,
        roomCount: rooms.length,
      },
      perRoom: perRoomArr,
      byDepartment: byDeptArr,
      heatmap: heat,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
