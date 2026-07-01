'use strict';

// スキーマを適用してテーブルを作成する。
// 実行: npm run init-db
const fs = require('fs');
const path = require('path');
const db = require('./index');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

console.log('データベースを初期化しました。');
