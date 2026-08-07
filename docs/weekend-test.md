# 自分の M365 で試す（本番に近い形のリハーサル）

会社の IT を待たずに、カレンダー連携まで含めて丸ごと動かしてみるための手順。
自分が管理者のテナントを 1 つ用意すれば、承認も自分で出せる。

ここで作る認証情報は**このリハーサル専用**で、会社のテナントでは使えない。
本番の値は改めて IT から受け取る。会社の本物の予定はここに入れないこと。

所要時間はだいたい 2〜3 時間。ほとんどは待ち時間。

---

## 0. 用意するもの（Mac / Apple Silicon）

| | 入手先 |
| --- | --- |
| VS Code | https://code.visualstudio.com |
| Node.js LTS | https://nodejs.org → macOS → prebuilt installer（`.pkg`） |
| Docker Desktop | https://docker.com → Apple Silicon 版 |

Docker Desktop を入れたら、歯車 → General →
**Use Rosetta for x86_64/amd64 emulation** にチェック → Apply & Restart。

---

## 1. データベースを立てる

ターミナルにそのまま貼る。

```bash
docker run -d --name mssql --platform linux/amd64 \
  -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='Str0ng!Passw0rd' \
  -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest
```

1 分ほど待ってから、データベースを作る。

```bash
docker exec mssql /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P 'Str0ng!Passw0rd' -C \
  -Q "CREATE DATABASE MeetingRoomBooking"
```

`Str0ng!Passw0rd` は手元専用の仮パスワード。本番では使わない。

- 止める: `docker stop mssql`
- 再開: `docker start mssql`
- 消す: `docker rm -f mssql`

---

## 2. アプリを動かす（カレンダー連携なし）

ZIP を解凍したフォルダを VS Code で開き、ターミナルで:

```bash
npm install
```

`.env.example` をコピーして `.env` を作り、最低限この 3 行にする。

```
DATABASE_URL="sqlserver://localhost:1433;database=MeetingRoomBooking;user=sa;password=Str0ng!Passw0rd;encrypt=true;trustServerCertificate=true"
PORT=3000
AUTH_MODE=mock
```

そして:

```bash
npm run db:deploy
TZ=Asia/Bangkok npm start
```

http://localhost:3000 を開く。ここまでで予約機能はすべて動く。
参加者の欄に人を足すと、**サンプルの予定**が表示される（画面に黄色い帯で
「サンプルです」と出る）。

> `TZ=Asia/Bangkok` を付けているのは、予約の「過去かどうか」の判定に
> サーバーの時計を使うため。Mac が日本時間だと 2 時間ずれて、正しい時刻の
> 予約が「過去です」と断られる。本番サーバーでも同じ設定が要る。

---

## 3. Microsoft 365 を契約する

**Microsoft 365 Business Basic** の無料試用（1 か月・25 ユーザーまで）。
カレンダー（Exchange）が付いていることが条件で、Basic で足りる。

- `あなたの名前.onmicrosoft.com` というドメインが自動でもらえる。独自ドメイン不要
- 申し込んだ人が自動的に**全体管理者**になる。だから承認を自分で出せる
- 試用後は 1 ユーザー月 900 円ほど。いつでも解約できる

申し込んだら、管理センターで**テスト用のユーザーを 2 人追加**してライセンスを
割り当てる。自分と合わせて 3 人。それぞれ Outlook を開いて、その日の予定を
いくつか入れておく（「Everyone free」が正しく出るか確かめるため）。

---

## 4. アプリを登録して権限をもらう

https://entra.microsoft.com を開く。

1. **アプリの登録** → **新規登録**。名前は `Meeting Room Booking` など。
   サポートされるアカウントの種類は「この組織ディレクトリのみ」。
2. できた画面の**概要**に出ている
   **アプリケーション (クライアント) ID** と **ディレクトリ (テナント) ID** を控える。
3. **APIのアクセス許可** → アクセス許可の追加 → Microsoft Graph →
   **アプリケーションの許可** → `Calendars.Read` を選ぶ。
   - ここで「委任された許可」を選ぶと動かない。**アプリケーションの許可**の方。
   - 追加したら **「(テナント名) に管理者の同意を与えます」** を押す。
     緑のチェックが付けば完了。
4. 名前で人を検索したいなら、同じ手順で `User.Read.All` も追加して同意する。
   無くても動く（メールアドレスを直接入力する形になる）。
5. **証明書とシークレット** → 新しいクライアントシークレット → 追加。
   出てきた**「値」**をコピーする。**「シークレット ID」ではない**。
   この値は一度しか表示されない。

---

## 5. つないで確認する

`.env` に 4 行足す。

```
GRAPH_TENANT_ID=（ディレクトリ (テナント) ID）
GRAPH_CLIENT_ID=（アプリケーション (クライアント) ID）
GRAPH_CLIENT_SECRET=（シークレットの「値」）
GRAPH_ORGANIZER=あなた@あなたの名前.onmicrosoft.com
```

確認する:

```bash
npm run check:graph
```

サインインできるか、カレンダーが読めるか、時計がずれていないかを順に見て、
つまずいた箇所と対処を日本語で出す。すべて OK になったら:

```bash
TZ=Asia/Bangkok npm start
```

黄色い「サンプルです」の帯が消えて、**本物のカレンダー**が並ぶ。

---

## 6. 余裕があれば試すこと

- **対象を絞る設定** — 既定では全ユーザーのカレンダーが読める。
  Exchange Online PowerShell の `New-ApplicationAccessPolicy` で、特定の
  グループだけに制限できる。会社に依頼するときこれを自分から提案できると、
  承認が通りやすい。ここで一度試しておくと話が早い。
- **わざと壊す** — シークレットを 1 文字変える、権限の同意を取り消す、
  存在しないアドレスを招待する。`npm run check:graph` が何と言うか、
  画面がどう見えるかを見ておくと、本番で同じことが起きたとき困らない。
- **時計をずらす** — Mac の時計を日本時間に戻して `TZ` を付けずに起動すると、
  タイムゾーンのずれがどう出るか再現できる。

---

## 終わったら

```bash
docker rm -f mssql     # データベースごと消える
```

M365 の試用は、続けないなら期限内に解約する。
`.env` はもともと Git に入らない設定なので、そのままで構わない。
