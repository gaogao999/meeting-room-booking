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
  port: toInt(process.env.PORT, 3011),
  // false | true | a hop count — see src/server.js
  trustProxy: process.env.TRUST_PROXY
    ? Number.isFinite(parseInt(process.env.TRUST_PROXY, 10))
      ? parseInt(process.env.TRUST_PROXY, 10)
      : true
    : false,

  auth: {
    mode: process.env.AUTH_MODE || 'mock',
  },

  // Reading colleagues' free/busy times out of Outlook, via Microsoft Graph.
  // All four are handed over by IT once an app is registered in Azure AD and an
  // administrator has consented. With any of them missing the feature runs on
  // clearly-labelled sample data instead — see src/services/graph.js.
  graph: {
    tenantId: process.env.GRAPH_TENANT_ID || '',
    clientId: process.env.GRAPH_CLIENT_ID || '',
    clientSecret: process.env.GRAPH_CLIENT_SECRET || '',
    // App-only calls have no "me", so the free/busy lookup is made through a
    // named mailbox. Any mailbox in the tenant will do.
    organizer: process.env.GRAPH_ORGANIZER || '',
    // Windows time zone id. Thailand is "SE Asia Standard Time"; this is what
    // the times sent to and read back from Graph are interpreted in, so it must
    // match the wall clock the bookings are written in.
    timeZone: process.env.GRAPH_TIMEZONE || 'SE Asia Standard Time',
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
