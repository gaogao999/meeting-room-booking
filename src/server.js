'use strict';

const path = require('path');
const express = require('express');
const config = require('./config');
const { authenticate } = require('./middleware/auth');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静的ファイル（フロントエンド）
app.use(express.static(path.join(__dirname, '..', 'public')));

// ヘルスチェック
app.get('/healthz', (req, res) => res.json({ ok: true }));

// 認証（開発中はモック）。API 全体に適用する。
app.use('/api', authenticate);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/pdf', require('./routes/pdf'));

// 設定情報（フロントで利用する予約ルールなど）
app.get('/api/config', (req, res) => {
  res.json({
    slotMinutes: config.booking.slotMinutes,
    windowDefaultDays: config.booking.windowDefaultDays,
    windowHrDays: config.booking.windowHrDays,
    hrDepartments: config.booking.hrDepartments,
  });
});

// 404
app.use('/api', (req, res) => res.status(404).json({ error: 'Not Found' }));

// エラーハンドラ
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'サーバーエラーが発生しました。' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`会議室予約システムを起動しました: http://localhost:${config.port}`);
    console.log(`認証モード: ${config.auth.mode}`);
  });
}

module.exports = app;
