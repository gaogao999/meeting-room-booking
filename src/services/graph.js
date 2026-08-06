'use strict';

// Reading people's free/busy times out of Outlook.
//
// There is exactly one way to ask Microsoft when somebody is free — the Graph
// API — and it needs an app registered in Azure AD with an administrator's
// consent. Until IT grants that, nothing here can return a real answer.
//
// Rather than leave the feature invisible until then, an unconfigured install
// answers with clearly-marked sample data: the screen can be built, reviewed
// and shown to people now, and the day the credentials land in .env it starts
// showing real calendars with no other change. Every response says which of the
// two it is, and the UI says so on the page — sample times must never be
// mistaken for somebody's actual diary.

const config = require('../config');

const LOGIN = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';

// The free/busy view comes back as one character per interval.
const STATUS = { 0: 'free', 1: 'tentative', 2: 'busy', 3: 'out', 4: 'elsewhere' };

function isConfigured() {
  const g = config.graph;
  return Boolean(g.tenantId && g.clientId && g.clientSecret && g.organizer);
}

// ---------------------------------------------------------------- live mode

let cachedToken = { value: null, expiresAt: 0 };

async function getToken() {
  // Re-used until a minute before it expires, so a busy screen does not fetch a
  // new token for every keystroke.
  if (cachedToken.value && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const g = config.graph;
  const body = new URLSearchParams({
    client_id: g.clientId,
    client_secret: g.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(`${LOGIN}/${encodeURIComponent(g.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || 'Could not sign in to Microsoft 365.');
  }
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + Math.max(0, (json.expires_in || 3600) - 60) * 1000,
  };
  return cachedToken.value;
}

async function graphFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${GRAPH}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Microsoft 365 returned ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// ------------------------------------------------------------- sample mode

// A stand-in directory, so the screen has people to put on it before the real
// one is reachable. Deliberately obvious placeholders.
const SAMPLE_PEOPLE = [
  { name: 'Somchai Prasert', email: 'somchai.p@example.local', department: 'QA' },
  { name: 'Nattapong Suk', email: 'nattapong.s@example.local', department: 'PE' },
  { name: 'Ploy Thanit', email: 'ploy.t@example.local', department: 'SALES' },
  { name: 'Wichai Kraisorn', email: 'wichai.k@example.local', department: 'ACCT' },
  { name: 'Anan Rojana', email: 'anan.r@example.local', department: 'IT' },
  { name: 'Malee Chaiya', email: 'malee.c@example.local', department: 'GA.HR' },
  { name: 'Suchart Nimit', email: 'suchart.n@example.local', department: 'PD' },
  { name: 'Kittipong Lert', email: 'kittipong.l@example.local', department: 'WH' },
  { name: 'Siriporn Amara', email: 'siriporn.a@example.local', department: 'PUR' },
  { name: 'Thanawat Boon', email: 'thanawat.b@example.local', department: 'CD' },
  { name: 'Pimchanok Wong', email: 'pimchanok.w@example.local', department: 'EC' },
  { name: 'Chaiwat Manop', email: 'chaiwat.m@example.local', department: 'BOI' },
];

// Same person, same day, same answer — a schedule that reshuffled on every
// keystroke would be unreadable.
function seedOf(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function sampleBusy(email, date, startMin, endMin, interval) {
  const seed = seedOf(`${email}|${date}`);
  const blocks = [];
  // Two or three meetings spread over the day, on the hour or half hour, each
  // taken from a different part of it — one long block would tell you nothing
  // about whether the screen reads well.
  const count = 2 + (seed % 2);
  const bandMin = Math.floor((endMin - startMin) / count);
  for (let i = 0; i < count; i++) {
    const s = seedOf(`${email}|${date}|${i}`);
    const bandStart = startMin + i * bandMin;
    const slots = Math.max(1, Math.floor((bandMin - 60) / 30));
    const start = bandStart + (s % slots) * 30;
    const length = [30, 60, 60, 90][s % 4];
    const end = Math.min(endMin, start + length);
    if (end > start) blocks.push({ start, end, status: s % 7 === 0 ? 'tentative' : 'busy' });
  }
  blocks.sort((a, b) => a.start - b.start);
  // Merge anything that ran into the block before it.
  const merged = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }
  return merged.map((b) => ({
    start: Math.round(b.start / interval) * interval,
    end: Math.round(b.end / interval) * interval,
    status: b.status,
  }));
}

// ------------------------------------------------------------------- public

// Look somebody up by name or address. Directory search needs a second
// permission (User.Read.All) that IT may not grant, so a failure here is not
// fatal: the caller can still type a full address by hand.
async function searchPeople(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return { mode: isConfigured() ? 'live' : 'sample', people: [] };

  if (!isConfigured()) {
    const needle = q.toLowerCase();
    return {
      mode: 'sample',
      people: SAMPLE_PEOPLE.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.email.toLowerCase().includes(needle) ||
          p.department.toLowerCase().includes(needle)
      ).slice(0, 8),
    };
  }

  // Escape the single quote that would otherwise end the OData string.
  const safe = q.replace(/'/g, "''");
  const path =
    `/users?$top=8&$select=displayName,mail,userPrincipalName,department` +
    `&$filter=startswith(displayName,'${encodeURIComponent(safe)}')` +
    ` or startswith(mail,'${encodeURIComponent(safe)}')`;
  const json = await graphFetch(path);
  return {
    mode: 'live',
    people: (json.value || [])
      .filter((u) => u.mail || u.userPrincipalName)
      .map((u) => ({
        name: u.displayName || u.mail,
        email: u.mail || u.userPrincipalName,
        department: u.department || '',
      })),
  };
}

// When each of these people is busy on one day, as minutes from midnight.
// `date` is YYYY-MM-DD; startMin/endMin bound the working day being shown.
async function freeBusy(emails, date, startMin, endMin, interval) {
  const list = [...new Set(emails.filter(Boolean))].slice(0, 20);
  if (!list.length) return { mode: isConfigured() ? 'live' : 'sample', people: [] };

  if (!isConfigured()) {
    return {
      mode: 'sample',
      people: list.map((email) => ({
        email,
        busy: sampleBusy(email, date, startMin, endMin, interval),
      })),
    };
  }

  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (min) => `${date}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`;
  const tz = config.graph.timeZone;

  const json = await graphFetch(
    `/users/${encodeURIComponent(config.graph.organizer)}/calendar/getSchedule`,
    {
      method: 'POST',
      body: JSON.stringify({
        schedules: list,
        startTime: { dateTime: stamp(startMin), timeZone: tz },
        endTime: { dateTime: stamp(endMin), timeZone: tz },
        availabilityViewInterval: interval,
      }),
    }
  );

  return {
    mode: 'live',
    people: (json.value || []).map((entry) => ({
      email: entry.scheduleId,
      // A mailbox we are not allowed to read comes back with an error rather
      // than a view; say so on that row instead of implying the day is free.
      error: entry.error ? 'Calendar not available' : undefined,
      busy: viewToBlocks(entry.availabilityView || '', startMin, interval),
    })),
  };
}

// "0022200" -> one block per run of non-free intervals.
function viewToBlocks(view, startMin, interval) {
  const blocks = [];
  let i = 0;
  while (i < view.length) {
    if (view[i] === '0') {
      i++;
      continue;
    }
    const code = view[i];
    let j = i;
    while (j < view.length && view[j] === code) j++;
    blocks.push({
      start: startMin + i * interval,
      end: startMin + j * interval,
      status: STATUS[code] || 'busy',
    });
    i = j;
  }
  return blocks;
}

module.exports = { isConfigured, searchPeople, freeBusy, SAMPLE_PEOPLE };
