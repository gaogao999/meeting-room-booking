'use strict';

require('dotenv').config();

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
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
  port: toInt(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',

  dbPath: process.env.DB_PATH || './data/booking.db',

  auth: {
    mode: process.env.AUTH_MODE || 'mock',
    checkloginUrl: process.env.CHECKLOGIN_URL || '',
    mockUser: {
      name: process.env.MOCK_USER_NAME || 'Dev User',
      department: process.env.MOCK_USER_DEPARTMENT || 'General Affairs',
    },
  },

  booking: {
    slotMinutes: toInt(process.env.SLOT_MINUTES, 10),
    windowDefaultDays: toInt(process.env.BOOKING_WINDOW_DEFAULT_DAYS, 90),
    windowHrDays: toInt(process.env.BOOKING_WINDOW_HR_DAYS, 180),
    hrDepartments: toList(process.env.HR_DEPARTMENTS).length
      ? toList(process.env.HR_DEPARTMENTS)
      : ['HR', 'Human Resources', 'Recruiting', 'People', 'Talent'],
  },

  erp: {
    enabled: toBool(process.env.ERP_ENABLED, false),
    server: process.env.ERP_DB_SERVER || '',
    port: toInt(process.env.ERP_DB_PORT, 1433),
    database: process.env.ERP_DB_DATABASE || '',
    user: process.env.ERP_DB_USER || '',
    password: process.env.ERP_DB_PASSWORD || '',
    encrypt: toBool(process.env.ERP_DB_ENCRYPT, true),
  },
};

module.exports = config;
