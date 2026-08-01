'use strict';

const path = require('path');
require('dotenv').config();

// App version (surfaced in /api/config and shown in the UI)
const pkg = require('../package.json');

// Default DB location: a sibling directory next to the app folder, e.g.
//   .../meeting-room-booking/        (app code — replaced wholesale on updates)
//   .../meeting-room-booking-data/   (booking.db — untouched by updates)
// This keeps the database outside the app directory by default, without
// requiring any server setup, so a routine "swap the app folder" deployment
// can never delete it. DB_PATH still overrides this when set explicitly.
function defaultDbPath() {
  const appDir = path.resolve(__dirname, '..');
  const dataDir = `${appDir}-data`;
  return path.join(dataDir, 'booking.db');
}

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

  dbPath: process.env.DB_PATH || defaultDbPath(),

  backup: {
    dir: process.env.BACKUP_DIR || './backups',
    keep: toInt(process.env.BACKUP_KEEP, 14),
  },

  auth: {
    mode: process.env.AUTH_MODE || 'mock',
    mockUser: {
      name: process.env.MOCK_USER_NAME || 'Dev User',
      department: process.env.MOCK_USER_DEPARTMENT || 'General Affairs',
    },
  },

  booking: {
    slotMinutes: toInt(process.env.SLOT_MINUTES, 10),
    // Selectable business hours (24h). Bookings and the schedule are limited to this range.
    businessStartHour: toInt(process.env.BUSINESS_START_HOUR, 8),
    businessEndHour: toInt(process.env.BUSINESS_END_HOUR, 20),
    windowDefaultDays: toInt(process.env.BOOKING_WINDOW_DEFAULT_DAYS, 90),
    windowHrDays: toInt(process.env.BOOKING_WINDOW_HR_DAYS, 180),
    hrDepartments: toList(process.env.HR_DEPARTMENTS).length
      ? toList(process.env.HR_DEPARTMENTS)
      : ['HR', 'Human Resources', 'Recruiting', 'People', 'Talent'],
  },
};

module.exports = config;
