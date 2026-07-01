'use strict';

// サンプルデータを投入する。
// 実行: npm run seed
const fs = require('fs');
const path = require('path');
const db = require('./index');

// テーブルが無ければ作成しておく
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const rooms = [
  { name: '大会議室 A', location: '本社 3F', capacity: 20, description: 'プロジェクター・ホワイトボード完備' },
  { name: '中会議室 B', location: '本社 3F', capacity: 10, description: 'テレビ会議システムあり' },
  { name: '小会議室 C', location: '本社 4F', capacity: 4, description: '少人数向け' },
  { name: '応接室', location: '本社 1F', capacity: 6, description: '来客対応用' },
];

const insert = db.prepare(
  'INSERT OR IGNORE INTO rooms (name, location, capacity, description) VALUES (@name, @location, @capacity, @description)'
);

const tx = db.transaction((list) => {
  for (const r of list) insert.run(r);
});
tx(rooms);

console.log(`会議室のサンプルデータを投入しました（${rooms.length}件）。`);
