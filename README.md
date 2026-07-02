# 会議室予約システム（Meeting Room Booking）

会社の会議室を登録し、予約するための Web アプリケーションです。
日時を選ぶとその時間に空いている会議室だけが選べ、全社の予約状況をタイムラインで確認できます。

- 現在のバージョン: **v1.1.0**
- 画面 UI は英語表記です。

## 主な機能

- **会議室の登録・管理**（`Rooms` 画面）: 会議室名・場所・定員・説明を登録し、停止/再開ができます。
- **予約フロー**（`Booking` 画面）: 日付・開始/終了（時と分を分けて選択）を指定すると、
  **その時間に空いている会議室だけ**が候補に出ます。会議室を選び、部署名・氏名（ログインユーザーから自動入力）・
  目的を入力して予約します。予約は **10 分単位**で、**部署名・氏名が記録**されます。
- **スケジュール（タイムライン）**: 会議室（行）× 時間軸（07:00–21:00）で当日の予約をガントチャート風に表示。
  日付切替、バークリックで詳細（キャンセル可）、空き部分クリックでその会議室・時間の予約開始。
- **予約可能期間（部門別）**:
  - **HR 系部門**: 半年後（既定 180 日）まで予約可能
  - **その他部門**: 3 か月後（既定 90 日）まで予約可能
- **重複防止**: 同一会議室の時間帯重複を防止（トランザクションで同時予約も防止）。
- **営業時間**: 予約・表示は営業時間（既定 07:00–21:00）内に限定（サーバー側でも検証）。

## 技術スタック

- Node.js（v18 以上、推奨 v20）/ Express
- フロントエンド: HTML + Bootstrap 5（`public/vendor/` に同梱、CDN 非依存）
- DB: SQLite（better-sqlite3）
- PDF: pdf-lib + multer（バックエンドに予約確認書 PDF 生成のルートを同梱。現在 UI からは未使用）
- 認証: 既存 `/checklogin` を流用（開発中はモック認証）
- ERP 連携: mssql（SELECT のみ、雛形のみ・既定は無効）
- 機密情報: すべて `.env` で管理

## セットアップ

```bash
# 依存関係のインストール
npm install

# 環境変数ファイルを用意
cp .env.example .env

# 起動（初回起動時、会議室が空なら既定の会議室を自動投入します）
npm start

# 開発時（ファイル変更で自動再起動）
npm run dev
```

ブラウザで http://localhost:3000 を開きます。

> 会議室は**起動時に自動シード**されるため、通常 `npm run seed` は不要です。
> 明示的に投入したい場合のみ `npm run seed`、スキーマだけ作る場合は `npm run init-db` を使います。

## 既定の会議室

初回起動時（`rooms` テーブルが空のとき）に以下が自動投入されます。
一覧は **工場順（Factory 1 → 2 …）→ 会議室名順**で表示されます。

| 場所 | 会議室 |
| --- | --- |
| Factory 1 | Conference room 1 / Conference room 2 / Meeting space 1 / Meeting space 2 / Meeting space 3 |
| Factory 2 | Conference room 1 / Meeting room 1 / Meeting room 2 / Meeting room 3 |

会議室名は**場所ごとに一意**（`UNIQUE(name, location)`）のため、両工場に同名の部屋を登録できます。

## 環境変数（.env）

| 変数 | 説明 | 既定 |
| --- | --- | --- |
| `PORT` | 待ち受けポート | 3000 |
| `NODE_ENV` | 実行環境 | development |
| `DB_PATH` | SQLite ファイルパス | ./data/booking.db |
| `AUTH_MODE` | `mock` または `checklogin` | mock |
| `CHECKLOGIN_URL` | 本番連携時の /checklogin | （空） |
| `MOCK_USER_NAME` | モック認証の氏名 | Taro Yamada |
| `MOCK_USER_DEPARTMENT` | モック認証の部署 | General Affairs |
| `SLOT_MINUTES` | 予約の刻み（分） | 10 |
| `BUSINESS_START_HOUR` | 予約・表示の開始時刻（時） | 7 |
| `BUSINESS_END_HOUR` | 予約・表示の終了時刻（時） | 21 |
| `BOOKING_WINDOW_DEFAULT_DAYS` | 一般部門の予約可能日数 | 90 |
| `BOOKING_WINDOW_HR_DAYS` | HR 部門の予約可能日数 | 180 |
| `HR_DEPARTMENTS` | HR とみなす部門名（部分一致, カンマ区切り） | HR,Human Resources,Recruiting,People,Talent |
| `ERP_ENABLED` | ERP 連携の有効化 | false |

## 認証について

- 開発中は `AUTH_MODE=mock`。`.env` の `MOCK_USER_NAME` / `MOCK_USER_DEPARTMENT` がログインユーザーとして扱われます。
- 本番では `AUTH_MODE=checklogin` とし、既存の `/checklogin` の仕組み（リバースプロキシ/セッション）で
  検証済みのユーザー情報を利用します。連携ポイントは `src/middleware/auth.js` です。

### キャンセルの権限について（現状）

- 現在は**権限チェックなし**で、誰でもどの予約でもキャンセルできます。
- 「HR 系部門は全予約をキャンセル可 / その他は登録者本人のみ」というルールは**未実装**です。
  ログインユーザーが確定する `/checklogin` 認証の実装と合わせて導入するのが適切です。

## API 概要

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/config` | 予約ルール・営業時間・バージョン等の設定 |
| GET | `/api/auth/me` | ログインユーザー情報 |
| GET | `/api/rooms` | 会議室一覧（`?all=1` で停止中も含む） |
| POST | `/api/rooms` | 会議室の登録 |
| PUT | `/api/rooms/:id` | 会議室の更新 |
| DELETE | `/api/rooms/:id` | 会議室の停止（論理削除） |
| GET | `/api/availability?start_at=&end_at=` | 指定時間帯の空き/使用中の会議室 |
| GET | `/api/bookings` | 予約一覧（`room_id` / `from` / `to` でフィルタ） |
| POST | `/api/bookings` | 予約の作成 |
| PUT | `/api/bookings/:id` | 予約の更新 |
| DELETE | `/api/bookings/:id` | 予約の取消 |
| GET | `/api/pdf/booking/:id` | 予約確認書 PDF（UI からは未使用） |
| POST | `/api/pdf/upload` | PDF アップロード（連携用の受け口） |

## デプロイ（Render / 無料プラン）

バックエンド（Express + SQLite）を含むため、静的ホスティングでは動作しません。
同梱の `render.yaml`（Blueprint）で Render にデプロイできます。

1. https://dashboard.render.com/ → **New** → **Blueprint**
2. このリポジトリを選択（`render.yaml` が読み込まれます）
3. 数分後 `https://<サービス名>.onrender.com` で公開されます

補足:
- Node は `.node-version`（20.18.1）で固定しています（better-sqlite3 のビルド済みバイナリ利用のため）。
- 無料プランはアイドルでスリープし、ディスクが一時的です。再デプロイ/復帰で予約データはリセットされ、
  起動時に既定の会議室が自動投入されます。予約を永続化するには Render の Disk（有料）を使い、
  `render.yaml` の該当箇所を有効化して `DB_PATH` を `/data/booking.db` に変更してください。

## ディレクトリ構成

```
src/
  server.js               エントリポイント
  config.js               .env 読み込み・設定
  db/
    index.js              SQLite 接続・スキーマ適用・起動時の自動シード
    schema.sql            スキーマ
    defaultRooms.js       既定の会議室定義（自動シード / seed で共用）
    init.js               スキーマ作成のみ（npm run init-db）
    seed.js               既定会議室の投入（npm run seed）
  middleware/auth.js      認証（mock / checklogin）
  routes/
    auth.js               /api/auth
    rooms.js              /api/rooms
    bookings.js           /api/bookings（重複防止トランザクション）
    availability.js       /api/availability（空き検索）
    pdf.js                /api/pdf（確認書 PDF / アップロード）
  services/
    bookingRules.js       予約ルール（10分単位・営業時間・部門別期間・検証）
    erp.js                ERP 連携 (mssql, SELECT のみ) 雛形
public/
  index.html / app.js     Booking 画面（予約フォーム + スケジュール + 空き絞り込み）
  rooms.html / rooms.js   Rooms 画面（会議室管理）
  timeline.css            スケジュールのスタイル
  vendor/                 Bootstrap 5（同梱）
```

## 注意事項

- 予約確認書 PDF（`/api/pdf/booking/:id`）は pdf-lib の標準フォント（Helvetica）を使用するため、
  日本語はそのまま描画できません（現状は安全に置換）。日本語出力が必要な場合は fontkit で
  日本語 TTF を埋め込んでください。現在この機能は UI からは呼び出していません。
- ERP 連携（`src/services/erp.js`）は SELECT のみ許可の雛形です（既定は無効）。
