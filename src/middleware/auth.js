'use strict';

const config = require('../config');

// 認証ミドルウェア。
// - 開発中 (AUTH_MODE=mock): .env のモックユーザーを req.user に設定する。
// - 本番 (AUTH_MODE=checklogin): 既存の /checklogin を利用する想定。
//   ここでは連携ポイントのみ用意し、セッション/ヘッダからユーザーを取得する。
async function authenticate(req, res, next) {
  try {
    // No login: the browser sends the department and name with each booking,
    // and remembers them locally between visits.
    if (config.auth.mode === 'mock') {
      req.user = { name: '', department: '', authenticated: false, mode: 'mock' };
      return next();
    }

    // 本番: 既存 /checklogin を流用する連携ポイント。
    // 実際の運用ではリバースプロキシ/セッションで検証済みのユーザー情報が
    // ヘッダ等で渡ってくる想定。ここではヘッダをフォールバックとして読む。
    const name = req.get('X-User-Name');
    const department = req.get('X-User-Department');
    if (name) {
      req.user = {
        name,
        department: department || '',
        authenticated: true,
        mode: 'checklogin',
      };
      return next();
    }

    return res.status(401).json({ error: 'Authentication required.' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { authenticate };
