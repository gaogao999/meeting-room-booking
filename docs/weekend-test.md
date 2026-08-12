# 自分の M365 で試す（本番に近い形のリハーサル）

会社の IT を待たずに、カレンダー連携まで含めて丸ごと動かしてみるための手順。
自分が管理者のテナントを 1 つ用意すれば、承認も自分で出せる。

ここで作る認証情報は**このリハーサル専用**で、会社のテナントでは使えない。
本番の値は改めて IT から受け取る。会社の本物の予定はここに入れないこと。

所要時間はだいたい 2〜3 時間。ほとんどは待ち時間。

## 会社の環境と、手元で再現するもの

| | 会社（本番） | 自宅（リハーサル） | 同じか |
| --- | --- | --- | --- |
| OS | Windows Server | macOS | 違うが影響は小さい |
| データベース | SQL Server（社内サーバー） | SQL Server 2022（Docker） | **同じ製品** |
| Node.js | 22 | 22 | 同じ |
| タイムゾーン | タイ時間 | `TZ=Asia/Bangkok` を付ける | 同じにできる |
| ログイン | 社内の `/checklogin` | `scripts/mock-login-proxy.js` | **形は同じ**（ヘッダーで受け取る） |
| カレンダー | 会社のテナント | 自分の試用テナント | **同じ Microsoft Graph** |
| 会議室 | まだメールボックス無し | テスト用に 1 つ作る | 将来の姿を先に試せる |
| 利用者 | 数十人・複数端末 | スマホ＋PC の 2 台 | 最低限は再現できる |

ここまで揃えば、**本番で起きることのほとんどは手元で先に起こせる**。
再現できない差は「8. 会社の環境に近づける」の末尾にまとめてある。

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
PORT=3011
AUTH_MODE=mock
```

そして:

```bash
npm run db:deploy
TZ=Asia/Bangkok npm start
```

http://localhost:3011 を開く。ここまでで予約機能はすべて動く。
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
   **アプリケーションの許可** → `Calendars.ReadBasic` を選ぶ。
   無い場合や動かない場合は `Calendars.Read`。
   （Microsoft の資料で必要権限の記述が2箇所で食い違っている。弱い方から試す）
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

## 6. 会議室にメールアドレスを持たせる（往復連携の下準備）

会社の会議室はまだ Outlook 上に存在しない。将来そうする前に、**どう振る舞うのかを
自分のテナントで先に見ておく**。これを知らないまま IT に依頼すると、
会議の件名が全部消えるという失敗を本番でやることになる。

> ここで試すのは **Exchange 側の挙動**。アプリからの自動登録と取り込みは
> まだ実装していない。先に Exchange の動きを確かめておくと、実装したとき
> 「どちらが悪いのか」で悩まずに済む。

### 6-1. 会議室を作る

Microsoft 365 管理センター → **リソース** → **会議室と備品** → 追加。
名前を `Test Room`、メールアドレスを `testroom@あなたの名前.onmicrosoft.com` にする。

**会議室メールボックスにライセンスは要らない。**（無料で作れる。本番で15室作っても
ライセンス費は増えない — これは IT に伝える価値がある）

### 6-2. 件名が消える設定を直す

**ここが一番大事**。初期設定のままだと、会議室のカレンダーは**会議の件名を消して
主催者の名前に置き換える**。Microsoft の資料に「仕様です」と書かれている挙動で、
このまま連携するとアプリにもドア表示にも「Tanaka」としか出ない。

PowerShell（Mac なら `pwsh`）で:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser   # 初回のみ
Connect-ExchangeOnline

Set-CalendarProcessing -Identity "Test Room" `
  -AutomateProcessing AutoAccept `
  -DeleteSubject $false `
  -AddOrganizerToSubject $false `
  -AllowRecurringMeetings $true `
  -RemovePrivateProperty $false

Get-CalendarProcessing -Identity "Test Room" | Format-List AutomateProcessing,DeleteSubject,AddOrganizerToSubject
```

最後の行で `DeleteSubject: False` と出れば正しい。
**この PowerShell はそのまま IT への依頼文に使える。**

### 6-3. 往復を目で見る

Outlook（web でよい）で会議を作り、**出席者に `Test Room` を入れて**送る。

確かめること:

- 数秒で**自動的に承諾**の返信が来る
- `Test Room` のカレンダーに予定が入っている（管理者なら Outlook から開ける）
- **件名がそのまま残っている**（6-2 をやっていないとここで名前に化ける）
- **同じ時間にもう一件**同じ部屋を入れると、**自動的に辞退される** ← これが
  「アプリと Outlook で二重予約が起きない」根拠
- 時間を変更すると、会議室側の予定も追従する

ここまで確認できれば、往復連携は「あとはアプリを書くだけ」の状態になる。

---

## 7. ログインありの状態で開く

本番ではログイン後の名前・部署・メールアドレスがヘッダーで渡ってくる想定
（`AUTH_MODE=checklogin`）。ブラウザではヘッダーを付けられないので、
**会社のログインを装う小さなプロキシ**を同梱してある。

ターミナルを 2 つ使う。

```bash
# 1つ目: アプリ本体をログインありで起動
AUTH_MODE=checklogin PORT=3011 TZ=Asia/Bangkok npm start

# 2つ目: ログインを装うプロキシ
node scripts/mock-login-proxy.js
```

**http://localhost:3012** を開く。3011 ではなく 3012 の方。

確かめること:

- 名前と部署が**入力済みで、変更できない**状態になっている
- 「Who」の欄に**自分のメールアドレスを入力する欄が無く**、
  「Your calendar (…) is shown automatically.」と出ている
- http://localhost:3012/_who で別の人に切り替えると、画面の名前が変わる
- **`Kittipong S.` に切り替える**と、メールアドレスの入力欄が**戻ってくる**
  （ログインはあるがメールボックスが無い人の再現。会社で必ずいる）

> 3人目がいる理由：社内ログインが名前と部署は渡すが**メールアドレスは渡さない**
> という結果は十分ありうる。そのとき画面が壊れず、入力欄が戻るだけで済むかを
> 確かめるためのテスト。IT に「メールアドレスも渡せますか」と聞く前に、
> 渡せなかった場合の姿を見ておく。

このプロキシは**リハーサル専用**。クッキーを見て誰にでも化けられるので、
社内サーバーには絶対に置かないこと。

---

## 8. 会社の環境に近づける

手元で試すと、どうしても本番と違う条件になる。違いのうち**実際に問題を起こしうる
ものだけ**を挙げる。上から順に効く。

### 8-1. 自分以外の端末から開く（最重要）

`localhost` だけで試していると、**利用者が複数いる状態を一度も試さないまま**
本番に出ることになる。このアプリは「どの端末が予約したか」で
キャンセルの可否を決めているので、ここは必ず確かめる。

Mac の IP を調べて（システム設定 → ネットワーク、`192.168.x.x` の形）、
同じ Wi-Fi のスマホや別の PC から開く。

```
http://192.168.x.x:3011
```

確認すること:

- スマホから予約 → Mac の画面では「別のパソコンで予約されました」と出て、
  キャンセルボタンが**出ない**
- Mac で予約したものは Mac からキャンセル**できる**
- 同じ部屋・同じ時間を同時に取ろうとすると、後の方が断られる

### 8-2. カレンダーの無い人を混ぜる

会社では、役職やライセンスによって**カレンダーを持たない人がいる**可能性が高い。
その人を招待したとき画面がどう見えるかは、本番で必ず起きる状況なので先に見ておく。

M365 の管理センターで、**ライセンスを割り当てないユーザー**を 1 人作り、
そのアドレスを招待してみる。行が空欄ではなく
「Calendar not available」と出れば正しい。

> 空欄と「読めない」を取り違えると、**予定が読めていないだけの人を
> 「一日中空いている」と誤解する**。そこを確認するためのテスト。

### 8-3. 社外のアドレスを招待してみる

自分の Gmail など、テナントの外のアドレスを入れてみる。
これも「読めないのか、空いているのか」の見え方を確認するため。

### 8-4. 対象を絞る設定を実際にかける

既定では、承認した権限が**全社員のカレンダー**に及ぶ。特定の人だけに絞る設定が
あり、IT に依頼する予定のものを自分のテナントで先に試しておく。

現在の方法は **RBAC for Applications**。以前からある
`New-ApplicationAccessPolicy` はレガシー扱いで、Microsoft は新規に使わないよう
案内している（いずれ移行が必要になる）。

Exchange Online PowerShell で、対象にしたい人の範囲を作り、アプリに割り当てる:

```powershell
Connect-ExchangeOnline

# 1. 対象範囲をつくる（例: 部署が QA の人だけ）
New-ManagementScope -Name "QA staff" -RecipientRestrictionFilter "Department -eq 'QA'"

# 2. アプリを Exchange 側に登録する
New-ServicePrincipal -AppId <クライアントID> -ObjectId <エンタープライズ アプリケーションのオブジェクトID>

# 3. その範囲にだけ権限を割り当てる
New-ManagementRoleAssignment -App <上のサービスプリンシパル> `
  -Role "Application Calendars.Read" -CustomResourceScope "QA staff"

# 4. 効いているか確かめる
Test-ServicePrincipalAuthorization -Identity <クライアントID> -Resource <誰かのアドレス>
```

かけたあと、範囲外の人を招待すると読めなくなる。
**この挙動を自分の目で見ておくと、IT との会話が具体的になる。**

> 設定の反映には時間がかかることがある（レガシー側は最大1時間以上）。
> すぐ効かなくても、しばらく待ってから試すこと。

### 8-5. 時計をわざとずらす

`TZ=Asia/Bangkok` を付けずに起動してみる。Mac が日本時間なら 2 時間ずれ、
タイ時間の朝の予約が「過去です」と断られるのが再現できる。
**本番で最も起きやすい設定ミス**なので、症状を知っておく価値がある。

### 8-6. データベースを落として戻す

サーバーの再起動やメンテナンスで、本番では必ず起きる。

```bash
docker restart mssql
```

止まっている間は画面に
「予約システムがデータベースに接続できません」と出て、
**データベースが戻れば操作は自動的に復旧する**。
アプリを再起動する必要はない（検証済み）。

### 8-7. ドア横の表示を試す

会議室の入口に置く想定の 1 部屋専用の画面。専用機は要らず、
**ブラウザが動く端末なら何でもいい**（市販の Skedda も同じ方式）。

「Rooms」の画面に部屋ごとの **Door display → Open** がある。
そこで開いた URL（`/display.html?room=3` の形）を、余っているタブレットや
古いスマホで開く。

```
http://192.168.x.x:3011/display.html?room=3
```

確認すること:

- 部屋名・現在時刻・「In use / Free」が**離れた場所から読める**大きさで出ている
- 会議中の部屋は赤、空いている部屋は緑。次の予約が30分以内なら黄色
- 予約を入れてから**1分以内**に画面が変わる
- **Wi-Fi を切ってみる**。画面はそのまま残り、5分後に右下へ小さく
  `not updating` と出る（真っ白やエラー画面にはならない）

端末側でやっておくこと:

- ホーム画面に追加する（アドレスバーが消え、誤操作しにくくなる）
- 画面の自動スリープを**なし**にする
- 自動画面回転を切る

---

### どうしても再現できないこと

| 差 | どうするか |
| --- | --- |
| 本番は Windows Server、手元は Mac | Node と Prisma は共通なので影響は小さい |
| SQL Server の接続文字列（名前付きインスタンス、専用アカウント、証明書） | IT から値をもらってから調整する。手元では試せない |
| サーバーから Microsoft への通信がファイアウォールで止まる | IT に事前確認する（`login.microsoftonline.com` と `graph.microsoft.com`） |
| ドメインが 2 つ（テナントが 2 つかもしれない） | 答えが出てから対応。アプリ側の改修が要る場合がある |

---

## 9. わざと壊してみる

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
