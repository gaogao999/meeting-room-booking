'use strict';

// A stand-in for the company's login, so AUTH_MODE=checklogin can be tried in a
// browser at home.
//
// On the real server the app sits behind something that has already identified
// the user and passes the name, department and mailbox on in request headers.
// There is no such thing on a laptop, and headers cannot be typed into a
// browser — so without this, the login mode can only ever be tested with curl,
// and the half that matters (what the page looks like when it knows who you
// are) never gets tested at all.
//
// This is a rehearsal tool. It trusts a cookie that anyone could set, which is
// exactly what makes it useless anywhere but a laptop. It is never deployed.
//
//   Terminal 1:  AUTH_MODE=checklogin PORT=3011 TZ=Asia/Bangkok npm start
//   Terminal 2:  node scripts/mock-login-proxy.js
//   Browser:     http://localhost:3012

const http = require('http');

const PORT = Number(process.env.PROXY_PORT || 3012);
const TARGET_HOST = process.env.PROXY_TARGET_HOST || '127.0.0.1';
const TARGET_PORT = Number(process.env.PROXY_TARGET_PORT || process.env.PORT || 3011);

// The people this proxy can pretend to be. Edit freely — the point is to have
// more than one, in more than one department, with one of them deliberately
// missing a mailbox: that is the case the office will actually contain, and the
// form has to keep asking that person for their address.
const USERS = [
  { id: '1', name: 'Somchai Prasert', department: 'QA', email: 'somchai@example.onmicrosoft.com' },
  { id: '2', name: 'Nattaya Wong', department: 'PD', email: 'nattaya@example.onmicrosoft.com' },
  { id: '3', name: 'Kittipong S.', department: 'WH', email: '' },
];

const COOKIE = 'mock_user';

function userFrom(req) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((c) => c.trim().split('='));
  const id = (hit.find(([k]) => k === COOKIE) || [])[1];
  return USERS.find((u) => u.id === id) || USERS[0];
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// The switcher. Kept at a path the app itself will never use.
function whoPage(current) {
  const rows = USERS.map(
    (u) =>
      `<li><a href="/_who?user=${u.id}">${esc(u.name)}</a> — ${esc(u.department)} — ` +
      `${u.email ? esc(u.email) : '<i>no mailbox</i>'}${u.id === current.id ? ' <b>(now)</b>' : ''}</li>`
  ).join('');
  return (
    '<!doctype html><meta charset="utf-8"><title>Who am I</title>' +
    '<style>body{font:16px system-ui;margin:40px;line-height:1.7}li{margin:.4em 0}</style>' +
    '<h1>Pretend to be…</h1><ul>' +
    rows +
    '</ul><p><a href="/">Open the booking page</a></p>' +
    '<p style="color:#666">This proxy stands in for the company login. It exists only ' +
    'so the signed-in screens can be tried on a laptop.</p>'
  );
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/_who') {
    const want = url.searchParams.get('user');
    const picked = USERS.find((u) => u.id === want);
    if (picked) {
      res.writeHead(302, {
        'Set-Cookie': `${COOKIE}=${picked.id}; Path=/; SameSite=Lax`,
        Location: '/_who',
      });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(whoPage(userFrom(req)));
  }

  const user = userFrom(req);
  const headers = {
    ...req.headers,
    'X-User-Name': user.name,
    'X-User-Department': user.department,
    // Absent rather than empty when the person has no mailbox, so the app sees
    // the same thing a real login without an address would send.
    ...(user.email ? { 'X-User-Email': user.email } : {}),
  };
  delete headers['x-user-name'];
  delete headers['x-user-department'];
  if (!user.email) delete headers['x-user-email'];

  const upstream = http.request(
    { host: TARGET_HOST, port: TARGET_PORT, method: req.method, path: req.url, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Cannot reach the app on ${TARGET_HOST}:${TARGET_PORT}. Is it running?`);
  });
  req.pipe(upstream);
});

server.listen(PORT, () => {
  console.log(`\nログインを装うプロキシを起動しました`);
  console.log(`  ブラウザ   http://localhost:${PORT}`);
  console.log(`  誰になるか http://localhost:${PORT}/_who`);
  console.log(`  転送先     http://${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`\nアプリ側は AUTH_MODE=checklogin で起動してください。\n`);
});
