'use strict';

// 予約確認書 PDF の生成、および PDF アップロードの受け口。
// pdf-lib + multer を利用する。
//
// 注意: pdf-lib の標準フォント (Helvetica) は WinAnsi のみ対応のため、
// 日本語をそのまま描画すると例外になる。ここでは描画不能な文字を安全に
// 置換して出力する。日本語をそのまま出したい場合は fontkit で日本語 TTF を
// 埋め込む（後日対応）。
const express = require('express');
const multer = require('multer');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const db = require('../db');

const router = express.Router();

// アップロードはメモリ上で受け取り、PDF のみ許可する
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error('PDF ファイルのみアップロードできます。'));
  },
});

// WinAnsi で描画できない文字を '?' に置換する
function ansiSafe(text) {
  return String(text == null ? '' : text).replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

// 予約確認書 PDF を生成してダウンロードさせる
router.get('/booking/:id', async (req, res, next) => {
  try {
    const b = db
      .prepare(
        `SELECT b.*, r.name AS room_name, r.location AS room_location
         FROM bookings b JOIN rooms r ON r.id = b.room_id
         WHERE b.id = ?`
      )
      .get(req.params.id);
    if (!b) return res.status(404).json({ error: '予約が見つかりません。' });

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]); // A4
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const draw = (text, x, y, size = 12, f = font) =>
      page.drawText(ansiSafe(text), { x, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });

    draw('Meeting Room Booking Confirmation', 50, 780, 18, bold);
    page.drawLine({
      start: { x: 50, y: 770 },
      end: { x: 545, y: 770 },
      thickness: 1,
      color: rgb(0.6, 0.6, 0.6),
    });

    const rows = [
      ['Booking ID', String(b.id)],
      ['Room', `${b.room_name}${b.room_location ? ` (${b.room_location})` : ''}`],
      ['Department', b.department],
      ['Reserver', b.reserver],
      ['Purpose', b.purpose || '-'],
      ['Start', b.start_at.replace('T', ' ')],
      ['End', b.end_at.replace('T', ' ')],
      ['Status', b.status],
    ];
    let y = 730;
    for (const [label, value] of rows) {
      draw(label, 50, y, 12, bold);
      draw(value, 200, y, 12);
      y -= 28;
    }

    const bytes = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="booking-${b.id}.pdf"`
    );
    res.end(Buffer.from(bytes));
  } catch (err) {
    next(err);
  }
});

// PDF アップロードの受け口（後続処理の連携ポイント）
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ファイルがありません。' });
  res.json({
    ok: true,
    filename: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
});

module.exports = router;
