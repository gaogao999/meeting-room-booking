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

## 6. 会社の環境に近づける

手元で試すと、どうしても本番と違う条件になる。違いのうち**実際に問題を起こしうる
ものだけ**を挙げる。上から順に効く。

### 6-1. 自分以外の端末から開く（最重要）

`localhost` だけで試していると、**利用者が複数いる状態を一度も試さないまま**
本番に出ることになる。このアプリは「どの端末が予約したか」で
キャンセルの可否を決めているので、ここは必ず確かめる。

Mac の IP を調べて（システム設定 → ネットワーク、`192.168.x.x` の形）、
同じ Wi-Fi のスマホや別の PC から開く。

```
http://192.168.x.x:3000
```

確認すること:

- スマホから予約 → Mac の画面では「別のパソコンで予約されました」と出て、
  キャンセルボタンが**出ない**
- Mac で予約したものは Mac からキャンセル**できる**
- 同じ部屋・同じ時間を同時に取ろうとすると、後の方が断られる

### 6-2. カレンダーの無い人を混ぜる

会社では、役職やライセンスによって**カレンダーを持たない人がいる**可能性が高い。
その人を招待したとき画面がどう見えるかは、本番で必ず起きる状況なので先に見ておく。

M365 の管理センターで、**ライセンスを割り当てないユーザー**を 1 人作り、
そのアドレスを招待してみる。行が空欄ではなく
「Calendar not available」と出れば正しい。

> 空欄と「読めない」を取り違えると、**予定が読めていないだけの人を
> 「一日中空いている」と誤解する**。そこを確認するためのテスト。

### 6-3. 社外のアドレスを招待してみる

自分の Gmail など、テナントの外のアドレスを入れてみる。
これも「読めないのか、空いているのか」の見え方を確認するため。

### 6-4. 対象を絞る設定を実際にかける

IT に依頼する予定の設定を、自分のテナントで先に試しておく。
Exchange Online PowerShell で:

```powershell
New-ApplicationAccessPolicy -AppId <クライアントID> `
  -PolicyScopeGroupId <グループのアドレス> -AccessRight RestrictAccess `
  -Description "Meeting room booking app"
```

かけたあと、グループ外の人を招待すると読めなくなる。
**この挙動を自分の目で見ておくと、IT との会話が具体的になる。**

### 6-5. 時計をわざとずらす

`TZ=Asia/Bangkok` を付けずに起動してみる。Mac が日本時間なら 2 時間ずれ、
タイ時間の朝の予約が「過去です」と断られるのが再現できる。
**本番で最も起きやすい設定ミス**なので、症状を知っておく価値がある。

### 6-6. データベースを落として戻す

サーバーの再起動やメンテナンスで、本番では必ず起きる。

```bash
docker restart mssql
```

止まっている間は画面に
「予約システムがデータベースに接続できません」と出て、
**データベースが戻れば操作は自動的に復旧する**。
アプリを再起動する必要はない（検証済み）。

### どうしても再現できないこと

| 差 | どうするか |
| --- | --- |
| 本番は Windows Server、手元は Mac | Node と Prisma は共通なので影響は小さい |
| SQL Server の接続文字列（名前付きインスタンス、専用アカウント、証明書） | IT から値をもらってから調整する。手元では試せない |
| サーバーから Microsoft への通信がファイアウォールで止まる | IT に事前確認する（`login.microsoftonline.com` と `graph.microsoft.com`） |
| ドメインが 2 つ（テナントが 2 つかもしれない） | 答えが出てから対応。アプリ側の改修が要る場合がある |

---

## 7. わざと壊してみる

本番で同じことが起きたとき、原因が分かる状態にしておくためのもの。

- シークレットを 1 文字変えて `npm run check:graph`
- Entra で権限の同意を取り消して `npm run check:graph`
- `GRAPH_ORGANIZER` に存在しないアドレスを入れる

いずれも、何が起きたかと何を直せばいいかが日本語で出るはず。
出ないパターンを見つけたら教えてほしい。診断の方を直す。

---

## 終わったら

```bash
docker rm -f mssql     # データベースごと消える
```

M365 の試用は、続けないなら期限内に解約する。
`.env` はもともと Git に入らない設定なので、そのままで構わない。
