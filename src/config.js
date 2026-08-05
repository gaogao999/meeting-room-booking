'use strict';

require('dotenv').config();

// App version (surfaced in /api/config and shown in the UI)
const pkg = require('../package.json');
const { DEPARTMENTS } = require('./departments');

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  version: pkg.version,
  port: toInt(process.env.PORT, 3000),
  // false | true | a hop count — see src/server.js
  trustProxy: process.env.TRUST_PROXY
    ? Number.isFinite(parseInt(process.env.TRUST_PROXY, 10))
      ? parseInt(process.env.TRUST_PROXY, 10)
      : true
    : false,

  auth: {
    mode: process.env.AUTH_MODE || 'mock',
  },

  booking: {
    slotMinutes: toInt(process.env.SLOT_MINUTES, 10),
    // Selectable business hours (24h). Bookings and the schedule are limited to this range.
    businessStartHour: toInt(process.env.BUSINESS_START_HOUR, 8),
    businessEndHour: toInt(process.env.BUSINESS_END_HOUR, 20),
    windowDefaultDays: toInt(process.env.BOOKING_WINDOW_DEFAULT_DAYS, 90),
    windowHrDays: toInt(process.env.BOOKING_WINDOW_HR_DAYS, 180),
    // Matched against the department the booking is filed under, as a
    // case-insensitive substring. Keep it in step with ./departments.js —
    // renaming the HR department there without changing this would quietly
    // drop it back to the 90-day window.
    hrDepartments: toList(process.env.HR_DEPARTMENTS).length
      ? toList(process.env.HR_DEPARTMENTS)
      : ['GA.HR', 'HR'],
    departments: DEPARTMENTS,
  },
};

module.exports = config;
