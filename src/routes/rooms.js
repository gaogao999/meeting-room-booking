'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

// 会議室一覧
router.get('/', (req, res) => {
  const includeInactive = req.query.all === '1';
  const rows = includeInactive
    ? db.prepare('SELECT * FROM rooms ORDER BY name').all()
    : db.prepare('SELECT * FROM rooms WHERE is_active = 1 ORDER BY name').all();
  res.json(rows);
});

// 会議室 1件
router.get('/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: '会議室が見つかりません。' });
  res.json(room);
});

// 会議室の登録
router.post('/', (req, res) => {
  const { name, location, capacity, description } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: '会議室名は必須です。' });
  }
  const cap = capacity === undefined || capacity === '' ? null : parseInt(capacity, 10);
  if (cap !== null && (!Number.isFinite(cap) || cap < 0)) {
    return res.status(400).json({ error: '定員は0以上の整数で指定してください。' });
  }
  try {
    const info = db
      .prepare(
        'INSERT INTO rooms (name, location, capacity, description) VALUES (?, ?, ?, ?)'
      )
      .run(String(name).trim(), location || null, cap, description || null);
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(room);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: '同名の会議室が既に存在します。' });
    }
    throw err;
  }
});

// 会議室の更新
router.put('/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: '会議室が見つかりません。' });

  const { name, location, capacity, description, is_active } = req.body || {};
  const cap =
    capacity === undefined || capacity === '' ? room.capacity : parseInt(capacity, 10);
  if (cap !== null && (!Number.isFinite(cap) || cap < 0)) {
    return res.status(400).json({ error: '定員は0以上の整数で指定してください。' });
  }
  try {
    db.prepare(
      `UPDATE rooms SET name = ?, location = ?, capacity = ?, description = ?, is_active = ?
       WHERE id = ?`
    ).run(
      name !== undefined ? String(name).trim() : room.name,
      location !== undefined ? location : room.location,
      cap,
      description !== undefined ? description : room.description,
      is_active !== undefined ? (is_active ? 1 : 0) : room.is_active,
      req.params.id
    );
    const updated = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: '同名の会議室が既に存在します。' });
    }
    throw err;
  }
});

// 会議室の削除（論理削除）
router.delete('/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: '会議室が見つかりません。' });
  db.prepare('UPDATE rooms SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
