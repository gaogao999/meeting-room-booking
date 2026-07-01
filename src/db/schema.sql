-- 会議室
CREATE TABLE IF NOT EXISTS rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  location    TEXT,
  capacity    INTEGER,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 予約
-- start_at / end_at は UTC ではなくローカルの ISO8601 文字列 (YYYY-MM-DDTHH:MM) で保持する。
CREATE TABLE IF NOT EXISTS bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id      INTEGER NOT NULL,
  department   TEXT    NOT NULL,
  reserver     TEXT    NOT NULL,
  purpose      TEXT,
  start_at     TEXT    NOT NULL,
  end_at       TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'confirmed',
  created_by   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookings_room_time
  ON bookings (room_id, start_at, end_at);
