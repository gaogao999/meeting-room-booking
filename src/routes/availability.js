'use strict';

const express = require('express');
const db = require('../db');
const { parseLocal, formatLocal } = require('../services/bookingRules');

const router = express.Router();

// 指定した時間帯 [start_at, end_at) に空いている会議室を一括検索する。
// 予約可能期間（部門ルール）は検索段階では考慮しない（純粋な空き状況の照会）。
router.get('/', (req, res) => {
  const s = parseLocal(req.query.start_at);
  const e = parseLocal(req.query.end_at);
  if (!s || !e) {
    return res.status(400).json({ error: '開始日時と終了日時を指定してください。' });
  }
  if (e <= s) {
    return res.status(400).json({ error: '終了日時は開始日時より後にしてください。' });
  }
  const startAt = formatLocal(s);
  const endAt = formatLocal(e);

  const rooms = db.prepare('SELECT * FROM rooms WHERE is_active = 1 ORDER BY name').all();
  // 半開区間 [start, end) の重複判定
  const overlapStmt = db.prepare(
    `SELECT * FROM bookings
       WHERE room_id = ? AND status = 'confirmed'
         AND start_at < ? AND end_at > ?
       ORDER BY start_at`
  );

  const available = [];
  const busy = [];
  for (const room of rooms) {
    const conflicts = overlapStmt.all(room.id, endAt, startAt);
    if (conflicts.length === 0) available.push(room);
    else busy.push({ room, conflicts });
  }

  res.json({ start_at: startAt, end_at: endAt, available, busy });
});

module.exports = router;
