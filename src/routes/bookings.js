'use strict';

const express = require('express');
const db = require('../db');
const { validateBooking } = require('../services/bookingRules');

const router = express.Router();

// 指定した時間帯に、対象会議室で重複する予約があるか調べる。
// [start, end) の半開区間として扱う（隣接は重複としない）。
function findOverlap(roomId, startAt, endAt, excludeId = null) {
  const params = [roomId, endAt, startAt];
  let sql = `
    SELECT * FROM bookings
    WHERE room_id = ?
      AND status = 'confirmed'
      AND start_at < ?
      AND end_at > ?`;
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  return db.prepare(sql).get(...params);
}

// 予約一覧（フィルタ: room_id, from, to）
router.get('/', (req, res) => {
  const { room_id, from, to } = req.query;
  const clauses = [];
  const params = [];
  if (room_id) {
    clauses.push('b.room_id = ?');
    params.push(room_id);
  }
  if (from) {
    clauses.push('b.end_at > ?');
    params.push(from);
  }
  if (to) {
    clauses.push('b.start_at < ?');
    params.push(to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT b.*, r.name AS room_name
       FROM bookings b JOIN rooms r ON r.id = b.room_id
       ${where}
       ORDER BY b.start_at`
    )
    .all(...params);
  res.json(rows);
});

// 予約 1件
router.get('/:id', (req, res) => {
  const row = db
    .prepare(
      `SELECT b.*, r.name AS room_name
       FROM bookings b JOIN rooms r ON r.id = b.room_id
       WHERE b.id = ?`
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: '予約が見つかりません。' });
  res.json(row);
});

// 予約の作成
router.post('/', (req, res) => {
  const body = req.body || {};
  const roomId = parseInt(body.room_id, 10);
  // 部署名・名前は予約者本人の情報を既定とし、指定があれば上書きする
  const department = (body.department || req.user?.department || '').trim();
  const reserver = (body.reserver || req.user?.name || '').trim();
  const purpose = body.purpose ? String(body.purpose).trim() : null;

  if (!Number.isFinite(roomId)) {
    return res.status(400).json({ error: '会議室を指定してください。' });
  }
  if (!reserver) {
    return res.status(400).json({ error: '予約者名は必須です。' });
  }

  const room = db.prepare('SELECT * FROM rooms WHERE id = ? AND is_active = 1').get(roomId);
  if (!room) {
    return res.status(404).json({ error: '会議室が見つからないか、利用できません。' });
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

  const overlap = findOverlap(roomId, startAt, endAt);
  if (overlap) {
    return res.status(409).json({
      error: 'その時間帯は既に予約されています。',
      conflict: { start_at: overlap.start_at, end_at: overlap.end_at },
    });
  }

  const info = db
    .prepare(
      `INSERT INTO bookings
        (room_id, department, reserver, purpose, start_at, end_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(roomId, department, reserver, purpose, startAt, endAt, req.user?.name || null);

  const created = db
    .prepare(
      `SELECT b.*, r.name AS room_name
       FROM bookings b JOIN rooms r ON r.id = b.room_id
       WHERE b.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json(created);
});

// 予約の更新
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '予約が見つかりません。' });

  const body = req.body || {};
  const roomId = body.room_id !== undefined ? parseInt(body.room_id, 10) : existing.room_id;
  const department =
    body.department !== undefined ? String(body.department).trim() : existing.department;
  const reserver =
    body.reserver !== undefined ? String(body.reserver).trim() : existing.reserver;
  const purpose = body.purpose !== undefined ? body.purpose : existing.purpose;
  const startAt = body.start_at !== undefined ? body.start_at : existing.start_at;
  const endAt = body.end_at !== undefined ? body.end_at : existing.end_at;

  if (!reserver) return res.status(400).json({ error: '予約者名は必須です。' });

  const room = db.prepare('SELECT * FROM rooms WHERE id = ? AND is_active = 1').get(roomId);
  if (!room) {
    return res.status(404).json({ error: '会議室が見つからないか、利用できません。' });
  }

  const check = validateBooking({ startAt, endAt, department });
  if (!check.ok) return res.status(400).json({ error: check.error });
  const norm = check.normalized;

  const overlap = findOverlap(roomId, norm.startAt, norm.endAt, existing.id);
  if (overlap) {
    return res.status(409).json({
      error: 'その時間帯は既に予約されています。',
      conflict: { start_at: overlap.start_at, end_at: overlap.end_at },
    });
  }

  db.prepare(
    `UPDATE bookings
       SET room_id = ?, department = ?, reserver = ?, purpose = ?, start_at = ?, end_at = ?
     WHERE id = ?`
  ).run(roomId, department, reserver, purpose, norm.startAt, norm.endAt, existing.id);

  const updated = db
    .prepare(
      `SELECT b.*, r.name AS room_name
       FROM bookings b JOIN rooms r ON r.id = b.room_id
       WHERE b.id = ?`
    )
    .get(existing.id);
  res.json(updated);
});

// 予約の取消
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '予約が見つかりません。' });
  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
