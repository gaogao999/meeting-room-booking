'use strict';

// カレンダー連携の設定チェック（npm run check:graph）
//
// Azure AD の設定は、間違っていても画面上は「予定がない人」と区別がつかない。
// つながっているのか、つながっていないのか、どこで止まっているのかを、
// 推測せずに済むようにするための診断。
//
// 出力は日本語。使う人は Graph のエラーコードを読む人ではないので、
// Microsoft が返した文面をそのまま出すのではなく、何をすればいいかを書く。

require('dotenv').config();

const config = require('../src/config');
const graph = require('../src/services/graph');

const OK = '  OK   ';
const NG = '  NG   ';
const WARN = ' 注意  ';

let failed = false;

function line(mark, text, detail) {
  console.log(`[${mark}] ${text}`);
  if (detail) console.log(`         ${String(detail).split('\n').join('\n         ')}`);
}

function fail(text, detail) {
  failed = true;
  line(NG, text, detail);
}

// Microsoft のエラーは英語で、原因と対処が書かれていないことが多い。
// よく出るものは、何をすればいいかに翻訳する。
function explain(message) {
  const m = String(message || '');
  if (m.includes('AADSTS7000215')) {
    return 'クライアントシークレットが違います。\n' +
      'Entra 管理センター → アプリの登録 → 証明書とシークレット で作り直し、\n' +
      '「値」の方をコピーしてください（「シークレットID」ではありません）。';
  }
  if (m.includes('AADSTS700016') || m.includes('AADSTS900023') || m.includes('AADSTS700038')) {
    return 'アプリまたはテナントが見つかりません。\n' +
      'GRAPH_CLIENT_ID と GRAPH_TENANT_ID を確認してください。\n' +
      'Entra 管理センター → アプリの登録 → 概要 に両方載っています。';
  }
  if (m.includes('AADSTS7000222')) {
    return 'クライアントシークレットの有効期限が切れています。新しく発行してください。';
  }
  if (/Access is denied|Authorization_RequestDenied|insufficient privileges/i.test(m)) {
    return '権限が足りません。APIのアクセス許可で Calendars.Read を\n' +
      '「アプリケーションの許可」として追加し、「管理者の同意を与える」を押してください。\n' +
      '（「委任された許可」ではありません）';
  }
  if (/MailboxNotEnabledForRESTAPI|ResourceNotFound|ErrorInvalidUser/i.test(m)) {
    return 'そのアドレスにメールボックスがありません。\n' +
      'ライセンスが割り当てられている利用者のアドレスを指定してください。';
  }
  return m;
}

function checkClock() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '(不明)';
  // getTimezoneOffset は「UTC からの差」を分で、符号が逆に返る。
  const offsetHours = -new Date().getTimezoneOffset() / 60;
  const label = `${tz} / UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}`;

  // 予約は「8月7日 9:00」という文字列で保存され、過去かどうかの判定に
  // このサーバーの時計を使う。利用者と時計がずれていると、正しい時刻の予約が
  // 「過去です」と拒否される。タイは UTC+7。
  if (offsetHours === 7) {
    line(OK, `サーバーの時計: ${label}`);
  } else {
    line(
      WARN,
      `サーバーの時計: ${label}`,
      'タイ時間（UTC+7）とずれています。このままだと、正しい時刻の予約が\n' +
        '「過去です」と拒否されることがあります。\n' +
        '本番サーバーではタイムゾーンをタイ時間にしてもらってください。\n' +
        '手元で試すだけなら TZ=Asia/Bangkok npm start で回避できます。'
    );
  }
}

async function main() {
  console.log('\nカレンダー連携の設定を確認します\n' + '-'.repeat(56));

  checkClock();

  const missing = ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_ORGANIZER']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    fail(
      '設定が足りません: ' + missing.join(', '),
      '.env に4つとも書いてください。1つでも欠けるとサンプル表示のままになります。'
    );
    console.log('-'.repeat(56));
    console.log('\n今はサンプルデータで動作しています（画面にもそう表示されます）。\n');
    process.exit(1);
  }
  line(OK, '設定4項目そろっています');
  line(OK, `時刻の解釈に使うタイムゾーン: ${config.graph.timeZone}`);

  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;

  // 1. サインインできるか。ここで落ちるなら ID かシークレットの問題。
  let people;
  try {
    const result = await graph.freeBusy(
      [config.graph.organizer],
      date,
      config.booking.businessStartHour * 60,
      config.booking.businessEndHour * 60,
      config.booking.slotMinutes
    );
    if (result.mode !== 'live') {
      fail('サンプルモードのままです', '.env が読み込まれていない可能性があります。');
      process.exit(1);
    }
    line(OK, 'Microsoft 365 にサインインできました');
    people = result.people;
  } catch (err) {
    fail('Microsoft 365 にサインインできません', explain(err.message));
    console.log('-'.repeat(56) + '\n');
    process.exit(1);
  }

  // 2. カレンダーが実際に読めるか。読めない相手は空ではなくエラーで返るので、
  //    「予定がない人」と取り違えずに済む。
  const me = people[0];
  if (!me || me.error) {
    fail(
      `${config.graph.organizer} のカレンダーが読めません`,
      me && me.error ? explain(me.error) : '権限か、メールボックスの有無を確認してください。'
    );
  } else {
    const n = me.busy.length;
    line(
      OK,
      `カレンダーを読めました（${config.graph.organizer}）`,
      n
        ? `本日 ${date} の予定: ${n}件 — ` +
          me.busy
            .map((b) => `${Math.floor(b.start / 60)}:${String(b.start % 60).padStart(2, '0')}`)
            .join(', ')
        : `本日 ${date} は予定なしと返ってきました。\n` +
          'Outlook に予定を入れてからもう一度実行すると、読めているか確かめられます。'
    );
  }

  // 3. 名前検索（任意の権限）。無くても動くので、落とさず案内だけする。
  try {
    const found = await graph.searchPeople('a');
    if (found.people.length) {
      line(OK, `名前で検索できます（${found.people.length}件ヒット）`);
    } else {
      line(WARN, '名前検索は0件でした', 'User.Read.All が無いか、該当者がいません。無くても動きます。');
    }
  } catch (err) {
    line(
      WARN,
      '名前で検索できません',
      'User.Read.All の許可がありません。無くても動きますが、\n' +
        '招待する相手のメールアドレスを毎回入力することになります。'
    );
  }

  console.log('-'.repeat(56));
  console.log(
    failed
      ? '\n上の NG を直してから、もう一度実行してください。\n'
      : '\nすべて確認できました。npm start で本物のカレンダーが表示されます。\n'
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  fail('予期しないエラー', err.stack || err.message);
  process.exit(1);
});
