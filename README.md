# 会議室予約システム

会社の会議室を登録し、予約するための Web アプリケーションです。

## 主な機能

- **会議室の登録・管理**: 会議室名・場所・定員・説明を登録し、停止/再開ができます。
- **予約**: 会議室を **10分単位** で予約でき、予約時に **部署名・氏名** を記録します。
- **予約可能期間**: 部門によって先の予約可能範囲が変わります。
  - **HR 系部門**: 半年後（既定 180 日）まで予約可能
  - **その他部門**: 3か月後（既定 90 日）まで予約可能
- **重複チェック**: 同一会議室の時間帯の重複を防止します。
- **確認書 PDF**: 予約ごとに確認書 PDF をダウンロードできます（pdf-lib）。
- **PDF アップロード受け口**: multer によるアップロードエンドポイントを用意（後続連携用）。
- **ERP 連携 (mssql, SELECT のみ)**: 雛形を同梱。既定は無効（後日追加）。

## 技術スタック

- Node.js (v18 以上) / Express
- フロントエンド: HTML + Bootstrap 5（CDN）
- DB: SQLite（better-sqlite3）
- PDF: pdf-lib + multer
- 認証: 既存 `/checklogin` を流用（開発中はモック認証）
- 機密情報: すべて `.env` で管理

## セットアップ

```bash
# 依存関係のインストール
npm install

# 環境変数ファイルを用意
cp .env.example .env

# DB を初期化し、サンプルの会議室を投入
npm run seed

# 起動
npm start
# 開発時（ファイル変更で自動再起動）
npm run dev
```

ブラウザで http://localhost:3000 を開きます。

## デプロイ（Render / 無料プラン）

本アプリはバックエンド（Express + SQLite）を含むため、静的ホスティング（GitHub Pages 等）
では動作しません。Node アプリを実行できる Render などの PaaS を利用します。

同梱の `render.yaml`（Blueprint）で無料プランにデプロイできます。

1. https://dashboard.render.com/ → **New** → **Blueprint**
2. このリポジトリ（`gaogao999/meeting-room-booking`）を選択
3. `render.yaml` が読み込まれ Web Service が作成される
4. 数分後 `https://<サービス名>.onrender.com` で公開される

無料プランの注意:

- 一定時間アクセスが無いとスリープし、次アクセス時に復帰まで数十秒かかります。
- ディスクは一時的で、再デプロイ/復帰で SQLite の予約データはリセットされ、
  起動時に `seed` でサンプル会議室が再投入されます。
- 予約データを永続化する場合は Render の Disk（有料）を利用し、`render.yaml` の
  「永続ディスク」コメントを有効化して `DB_PATH` を `/data/booking.db` に変更します。

## 環境変数（.env）

主要な設定は `.env.example` を参照してください。

| 変数 | 説明 | 既定 |
| --- | --- | --- |
| `PORT` | 待ち受けポート | 3000 |
| `DB_PATH` | SQLite ファイルパス | ./data/booking.db |
| `AUTH_MODE` | `mock` または `checklogin` | mock |
| `SLOT_MINUTES` | 予約の刻み（分） | 10 |
| `BOOKING_WINDOW_DEFAULT_DAYS` | 一般部門の予約可能日数 | 90 |
| `BOOKING_WINDOW_HR_DAYS` | HR 部門の予約可能日数 | 180 |
| `HR_DEPARTMENTS` | HR とみなす部門名（部分一致, カンマ区切り） | 人事部,HR,... |
| `ERP_ENABLED` | ERP 連携の有効化 | false |

## 認証について

- 開発中は `AUTH_MODE=mock` により `.env` の `MOCK_USER_NAME` /
  `MOCK_USER_DEPARTMENT` がログインユーザーとして扱われます。
- 本番では `AUTH_MODE=checklogin` とし、既存の `/checklogin` の仕組み
  （リバースプロキシ/セッション）で検証済みのユーザー情報を利用します。
  `src/middleware/auth.js` が連携ポイントです。

## API 概要

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/rooms` | 会議室一覧（`?all=1` で停止中も含む） |
| POST | `/api/rooms` | 会議室の登録 |
| PUT | `/api/rooms/:id` | 会議室の更新 |
| DELETE | `/api/rooms/:id` | 会議室の停止（論理削除） |
| GET | `/api/bookings` | 予約一覧（`room_id` / `from` / `to` でフィルタ） |
| POST | `/api/bookings` | 予約の作成 |
| PUT | `/api/bookings/:id` | 予約の更新 |
| DELETE | `/api/bookings/:id` | 予約の取消 |
| GET | `/api/pdf/booking/:id` | 予約確認書 PDF |
| POST | `/api/pdf/upload` | PDF アップロード |
| GET | `/api/auth/me` | ログインユーザー情報 |
| GET | `/api/config` | 予約ルール等の設定 |

## ディレクトリ構成

```
src/
  server.js            エントリポイント
  config.js            .env 読み込み
  db/                  SQLite 接続・スキーマ・初期化
  middleware/auth.js   認証（mock / checklogin）
  routes/              rooms / bookings / pdf / auth
  services/
    bookingRules.js    予約ルール（10分単位・予約可能期間・検証）
    erp.js             ERP 連携 (mssql, SELECT のみ) 雛形
public/                フロントエンド（Bootstrap 5）
```

## 注意事項

- 予約確認書 PDF は pdf-lib の標準フォント（Helvetica）を使用するため、
  日本語はそのまま描画できません（現状は安全に置換）。日本語を出力する場合は
  fontkit で日本語 TTF を埋め込んでください（後日対応予定）。
