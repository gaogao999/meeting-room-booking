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

  if (!start) return { ok: false, error: '開始日時の形式が正しくありません。' };
  if (!end) return { ok: false, error: '終了日時の形式が正しくありません。' };
  if (!department || !String(department).trim()) {
    return { ok: false, error: '部署名は必須です。' };
  }

  if (end <= start) {
    return { ok: false, error: '終了日時は開始日時より後にしてください。' };
  }

  // 10分（SLOT_MINUTES）単位であること
  if (start.getMinutes() % slot !== 0 || start.getSeconds() !== 0) {
    return { ok: false, error: `開始時刻は${slot}分単位で指定してください。` };
  }
  if (end.getMinutes() % slot !== 0 || end.getSeconds() !== 0) {
    return { ok: false, error: `終了時刻は${slot}分単位で指定してください。` };
  }
  const durationMin = (end - start) / 60000;
  if (durationMin % slot !== 0) {
    return { ok: false, error: `予約時間は${slot}分単位で指定してください。` };
  }

  // 過去の予約は不可（開始が現在より前）
  if (start < now) {
    return { ok: false, error: '過去の日時は予約できません。' };
  }

  // 部門ごとの予約可能期間
  const windowEnd = bookingWindowEnd(department, now);
  if (start > windowEnd) {
    const days = isHrDepartment(department)
      ? config.booking.windowHrDays
      : config.booking.windowDefaultDays;
    return {
      ok: false,
      error: `この部署は現在から${days}日先まで予約できます（${formatLocal(
        windowEnd
      ).slice(0, 10)} まで）。`,
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
