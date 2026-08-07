'use strict';

// Diagnose the Outlook connection (npm run check:graph).
//
// Azure AD is configured by hand across half a dozen screens, and a mistake in
// any of them looks exactly like a colleague with an empty diary. This asks the
// questions that tell those apart, so nobody has to guess which it is.
//
// The output is Japanese, and deliberately not a copy of what Microsoft said:
// whoever runs this is not a person who reads AADSTS codes. It says what to
// change.

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

// Microsoft's errors name the failure but rarely the fix. Translate the ones
// that actually come up into an instruction.
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
  // getTimezoneOffset returns minutes, and with the opposite sign to the one
  // everybody expects.
  const offsetHours = -new Date().getTimezoneOffset() / 60;
  const label = `${tz} / UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}`;

  // Bookings are stored as wall-clock strings and "is this in the past" is
  // decided against this server's own clock. A server in the wrong zone
  // therefore rejects times that are perfectly valid where the users are.
  // Thailand is UTC+7.
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

  // 1. Can it sign in at all? A failure here is the ids or the secret.
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

  // 2. Can a calendar actually be read? A mailbox that cannot be read comes
  //    back as an error rather than as an empty day, which is the whole
  //    difference between "free" and "we could not look".
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

  // 3. Directory search needs a second permission that may not be granted.
  //    It is optional, so this reports rather than fails.
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
