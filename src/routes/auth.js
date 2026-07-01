'use strict';

const express = require('express');
const config = require('../config');

const router = express.Router();

// 現在ログイン中のユーザー情報を返す。
// フロントエンドは予約フォームの部署名・氏名の初期値としてこれを利用する。
router.get('/me', (req, res) => {
  res.json({
    name: req.user?.name || '',
    department: req.user?.department || '',
    mode: req.user?.mode || config.auth.mode,
  });
});

module.exports = router;
