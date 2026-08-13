# Claude Code への指示：会社環境を自宅で再現する

このファイルを Claude Code に読ませて、そのまま作業を進めてもらうための指示書。
使うときは、リポジトリのフォルダで Claude Code を起動して、こう頼む。

```
docs/weekend-setup-prompt.md を読んで、そのとおりに進めてください。
```

---

## あなた（Claude Code）への前提

会議室予約アプリを、**会社の本番環境にできるだけ近い形で** macOS（Apple Silicon）
の上に再現する作業を手伝ってほしい。目的は機能を作ることではなく、
**本番で起きる問題を先に起こしておくこと**。

詳しい背景と検証項目は `docs/weekend-test.md` にある。**まずそれを読むこと。**
このファイルは、その手順を「誰がどこまでやるか」に分けた作業指示。

私（依頼者）は技術者ではない。エラーが出たら、原因と対処を**日本語で、
専門用語を避けて**説明してほしい。コマンドは私に打たせず、あなたが実行してよい。

---

## 分担

あなたが実行してよいもの（確認は不要）:

- `node`, `npm`, `docker` コマンドの実行
- `.env` ファイルの作成・編集（**値は私が渡す。あなたが推測して埋めない**）
- `npm run db:deploy`, `npm run check:graph` の実行
- アプリとプロキシの起動・停止
- テスト用の予約データの投入
- ログやエラーの調査

**私にしかできないもの**（ここに来たら手を止めて、何をすればいいか教えてほしい）:

- Docker Desktop / Node.js / VS Code のインストール
- Microsoft 365 の申し込み
- Entra（Azure AD）の画面でのアプリ登録、権限の同意、シークレット発行
- Microsoft 365 管理センターでの会議室の作成
- PowerShell の `Connect-ExchangeOnline`（ブラウザでのサインインが要る）
- スマホやタブレットからの動作確認

**やってはいけないこと**:

- `.env` の中身（特にシークレット）を画面に表示したり、ファイルに書き出したりしない
- `git commit` / `git push` をしない。これは検証作業で、コードは変えない
- 私が渡していない値を「たぶんこれだろう」で埋めない。分からなければ聞く
- 作業が終わる前に Docker コンテナを消さない

---

## フェーズ 0：前提の確認

まずこれを実行して、何が入っていて何が足りないかを報告してほしい。

```bash
sw_vers ; uname -m
node -v
npm -v
docker version --format '{{.Server.Version}}' 2>/dev/null || echo "Docker が起動していない"
```

- `uname -m` が `arm64` なら Apple Silicon。想定どおり
- Node は 22 以上であること。無い、または古ければ**そこで止めて**、
  https://nodejs.org の macOS 版インストーラを入れるよう私に伝えてほしい
- Docker が動いていなければ、Docker Desktop を起動するよう伝えてほしい。
  未インストールなら https://docker.com から Apple Silicon 版を入れる。
  入れたあと **設定 → General → Use Rosetta for x86_64/amd64 emulation** に
  チェックを入れる必要がある（SQL Server は x86 のイメージしかないため）

そのあと、リポジトリの中にいることを確認する。

```bash
pwd
ls package.json src public docs
git log --oneline -3
```

---

## フェーズ 1：データベースとアプリ（カレンダー連携なし）

`docs/weekend-test.md` の「1」と「2」を実行する。要点だけ再掲する。

```bash
docker run -d --name mssql --platform linux/amd64 \
  -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='Str0ng!Passw0rd' \
  -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest
```

起動には 1〜2 分かかる。**待ってから**次に進むこと。準備できたかは、
これが成功するかで判断できる（失敗したら数秒おいて再試行してよい）。

```bash
docker exec mssql /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P 'Str0ng!Passw0rd' -C -Q "SELECT 1"
```

つながったらデータベースを作り、`.env` を用意して、スキーマを流す。

```bash
docker exec mssql /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P 'Str0ng!Passw0rd' -C \
  -Q "CREATE DATABASE MeetingRoomBooking"

cp .env.example .env
```

`.env` の `DATABASE_URL` を手元用に書き換える:

```
DATABASE_URL="sqlserver://localhost:1433;database=MeetingRoomBooking;user=sa;password=Str0ng!Passw0rd;encrypt=true;trustServerCertificate=true"
PORT=3011
AUTH_MODE=mock
```

```bash
npm install
npm run db:deploy
TZ=Asia/Bangkok npm start
```

**`TZ=Asia/Bangkok` を必ず付けること。** これを忘れると、Mac が日本時間で動くため
タイ時間の朝の予約が「過去です」と断られる。本番と同じ条件にするための指定。

起動したら http://localhost:3011 が開けるか確認して、**私に報告してほしい**。
私がブラウザで見て、予約をいくつか入れてみる。

### ここで確認したいこと

私が画面を触ったあと、あなたに調べてほしいこと:

- 予約が実際にデータベースに入っているか
- 同じ部屋・同じ時間の予約が拒否されるか（`docs/weekend-test.md` の 8-1 参照）

---

## フェーズ 2：Microsoft 365（ここは私の作業が中心）

`docs/weekend-test.md` の「3」「4」を私がやる。あなたは待機してほしい。

私が以下の 4 つの値を渡すので、`.env` に追記してほしい。**値は私が貼る。**

```
GRAPH_TENANT_ID=
GRAPH_CLIENT_ID=
GRAPH_CLIENT_SECRET=
GRAPH_ORGANIZER=
```

追記したら、これを実行する。

```bash
npm run check:graph
```

**この診断が今回の最大の関門。** 出力は日本語で、つまずいた箇所と対処が出る。

- 全部 OK になったら、アプリを再起動して私に知らせてほしい
- どこかで失敗したら、**その出力をそのまま見せて、あなたの見立ても添えてほしい**。
  よくある原因は、権限の種類の間違い（「委任」を選んでしまった）、
  管理者の同意を押していない、シークレットの「値」ではなく「ID」を貼った、の 3 つ

失敗した場合、`.env` を勝手に書き換えて試行錯誤しないこと。
**何が違うと思うかを説明して、私に直させてほしい。** 私が Entra の画面を見る。

---

## フェーズ 3：会議室メールボックス（往復連携の下準備）

`docs/weekend-test.md` の「6」。会議室の作成と PowerShell は私がやる。

あなたにお願いしたいのは、**私が実行する PowerShell を、私のテナント名に
合わせて書き出すこと**。`Test Room` という名前で作る前提でよい。

実行後、私が Outlook で会議室を招待してテストする。そのとき、
アプリ側から見て何か確認できることがあれば教えてほしい
（この時点では、アプリは会議室メールボックスをまだ読まない。それでよい）。

---

## フェーズ 4：ログインありの状態とドア表示

`docs/weekend-test.md` の「7」と「8-7」。ここはあなたの作業。

ターミナルを 2 つ使う。両方バックグラウンドで起動してよい。

```bash
# アプリ本体（ログインあり）
AUTH_MODE=checklogin PORT=3011 TZ=Asia/Bangkok npm start

# 会社のログインを装うプロキシ
node scripts/mock-login-proxy.js
```

起動したら、まずあなたが `curl` で 3 人分の応答を確認してほしい。

```bash
curl -s localhost:3012/api/auth/me
curl -s -b "mock_user=2" localhost:3012/api/auth/me
curl -s -b "mock_user=3" localhost:3012/api/auth/me
```

3 人目（Kittipong）の `email` が空で返ることを確認する。
**これがログインはあるがメールアドレスが渡ってこない人の再現**で、
そのとき画面にメールアドレスの入力欄が戻ってくるのが正しい挙動。

そのあと、私がスマホで見られるように、Mac の LAN 側 IP を調べて教えてほしい。

```bash
ipconfig getifaddr en0 || ipconfig getifaddr en1
```

私に伝えてほしい URL:

- 予約画面（ログインなし）：`http://<IP>:3011`
- 予約画面（ログインあり）：`http://<IP>:3012`
- ドア表示：`http://<IP>:3011/display.html?room=1`
- 部屋の一覧（各部屋のドア表示リンクがある）：`http://<IP>:3011/rooms.html`

ドア表示は、**私がスマホをドアに見立てて確認する**。そのとき
「Wi-Fi を切ると `not updating` と出るか」を試したいので、
アプリを止めてもらう場面があるかもしれない。指示したら止めてほしい。

---

## 詰まったときの報告のしかた

エラーが出たら、次の形で教えてほしい。

1. **何をしようとして**、何が起きたか（実行したコマンドと、出力そのまま）
2. あなたの見立て（原因の候補。断定できないなら「たぶん」でよい）
3. **私がやるべきこと**（画面のどこを見て、何を直すか）
4. あなたがやれること（あるなら）

分からないときは「分からない」と言ってほしい。推測で `.env` や設定を
書き換えられるのが一番困る。

---

## 終わったら

私が「終わり」と言ったら、後片付けをしてほしい。

```bash
# 起動しているアプリとプロキシを止める
# データベースを消す（中のテストデータごと消える）
docker rm -f mssql
```

`.env` はそのまま残してよい（Git には入らない設定になっている）。
次にやるときはフェーズ 1 から、ただし M365 の設定は再利用できる。

最後に、**この週末で分かったことを箇条書きでまとめてほしい**。

- 動いたもの
- 動かなかったもの、その原因
- 会社の IT に確認・依頼が必要になった項目
- ドキュメント（`docs/weekend-test.md`）の記述で、実際と違っていた箇所

最後の項目が特に重要。手順書は会社で使うものなので、間違いは直しておきたい。
