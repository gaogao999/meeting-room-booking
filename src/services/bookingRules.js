'use strict';

const config = require('../config');

// ---- 日時ユーティリティ（ローカルタイム、ISO8601 "YYYY-MM-DDTHH:MM" 想定）----

// "2026-07-01T09:30" 形式の文字列を Date に変換する。
// new Date(str) はタイムゾーンの解釈が曖昧なため、明示的にローカル生成する。
function parseLocal(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(str || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    0,
    0
  );
  // 例: 2月30日のような不正値は Date が繰り上げるので検証する
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(mo) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return null;
  }
  return date;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Date を "YYYY-MM-DDTHH:MM" に正規化する
function formatLocal(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// 部門が HR 系かどうかを判定する（部分一致）
function isHrDepartment(department) {
  if (!department) return false;
  const dep = String(department).toLowerCase();
  return config.booking.hrDepartments.some((keyword) =>
    dep.includes(String(keyword).toLowerCase())
  );
}

// 部門ごとの予約可能な最終日時（この時刻以前まで予約可）を返す
function bookingWindowEnd(department, now = new Date()) {
  const days = isHrDepartment(department)
    ? config.booking.windowHrDays
    : config.booking.windowDefaultDays;
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  return end;
}

// 予約内容を検証する。問題があれば { ok:false, error } を返す。
function validateBooking({ startAt, endAt, department }, now = new Date()) {
  const start = parseLocal(startAt);
  const end = parseLocal(endAt);
  const slot = config.booking.slotMinutes;

  if (!start) return { ok: false, error: 'Invalid start date/time format.' };
  if (!end) return { ok: false, error: 'Invalid end date/time format.' };
  if (!department || !String(department).trim()) {
    return { ok: false, error: 'Department is required.' };
  }

  if (end <= start) {
    return { ok: false, error: 'End time must be after start time.' };
  }

  // Must be aligned to the slot (10 minutes / SLOT_MINUTES)
  if (start.getMinutes() % slot !== 0 || start.getSeconds() !== 0) {
    return { ok: false, error: `Start time must be in ${slot}-minute increments.` };
  }
  if (end.getMinutes() % slot !== 0 || end.getSeconds() !== 0) {
    return { ok: false, error: `End time must be in ${slot}-minute increments.` };
  }
  const durationMin = (end - start) / 60000;
  if (durationMin % slot !== 0) {
    return { ok: false, error: `Duration must be in ${slot}-minute increments.` };
  }

  // No bookings in the past (start before now)
  if (start < now) {
    return { ok: false, error: 'Cannot book a time in the past.' };
  }

  // Must be within business hours on a single day (e.g. 7:00-21:00).
  // The form already limits this; enforce it server-side too.
  const bs = config.booking.businessStartHour;
  const be = config.booking.businessEndHour;
  const startMinOfDay = start.getHours() * 60 + start.getMinutes();
  const endMinOfDay = end.getHours() * 60 + end.getMinutes();
  if (
    start.toDateString() !== end.toDateString() ||
    startMinOfDay < bs * 60 ||
    endMinOfDay > be * 60
  ) {
    return {
      ok: false,
      error: `Bookings must be within business hours (${bs}:00–${be}:00).`,
    };
  }

  // Per-department booking window
  const windowEnd = bookingWindowEnd(department, now);
  if (start > windowEnd) {
    const days = isHrDepartment(department)
      ? config.booking.windowHrDays
      : config.booking.windowDefaultDays;
    return {
      ok: false,
      error: `This department can book up to ${days} days ahead (until ${formatLocal(
        windowEnd
      ).slice(0, 10)}).`,
    };
  }

  return {
    ok: true,
    normalized: { startAt: formatLocal(start), endAt: formatLocal(end) },
  };
}

module.exports = {
  parseLocal,
  formatLocal,
  isHrDepartment,
  bookingWindowEnd,
  validateBooking,
};
