'use strict';

// ERP 連携 (mssql, SELECT のみ)。
// 現時点では雛形のみ。ERP_ENABLED=true かつ mssql パッケージが利用可能なときだけ接続する。
// 後日、実際の参照クエリをここに追加する。
const config = require('../config');

let sql = null;
let poolPromise = null;

function isEnabled() {
  return config.erp.enabled;
}

async function getPool() {
  if (!isEnabled()) {
    throw new Error('ERP 連携は無効です (ERP_ENABLED=false)。');
  }
  if (!sql) {
    try {
      // optionalDependency のため、未インストールでもアプリ全体は動く
      // eslint-disable-next-line global-require
      sql = require('mssql');
    } catch (e) {
      throw new Error('mssql パッケージがインストールされていません。');
    }
  }
  if (!poolPromise) {
    poolPromise = sql.connect({
      server: config.erp.server,
      port: config.erp.port,
      database: config.erp.database,
      user: config.erp.user,
      password: config.erp.password,
      options: { encrypt: config.erp.encrypt, trustServerCertificate: false },
    });
  }
  return poolPromise;
}

// 参照専用クエリの実行。SELECT 以外は拒否する。
async function query(sqlText, params = {}) {
  if (!/^\s*select\b/i.test(sqlText)) {
    throw new Error('ERP 連携では SELECT クエリのみ許可されています。');
  }
  const pool = await getPool();
  const request = pool.request();
  for (const [key, value] of Object.entries(params)) {
    request.input(key, value);
  }
  const result = await request.query(sqlText);
  return result.recordset;
}

module.exports = { isEnabled, query };
