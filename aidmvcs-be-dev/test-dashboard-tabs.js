// The reports as sections of the Dashboard (app/dealer/dashboard/page.js, 11 Nov 2026: one page, no tabs): a dealer or
// its staff gets no report sections (no request, and the reports API still answers 404), a super admin - directly or
// through "login as" - gets them; every SOW dashboard is in a section; /dealer/reports redirects to /dealer/dashboard;
// the sidebar has no Reports entry.
//
// Uses its own local MongoDB database (dashboardtabs_test, collections cleared before each test, dropped at the end;
// DB tests are skipped when MongoDB is not reachable).
//   Run: node --test test-dashboard-tabs.js
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = pathToFileURL(`${process.cwd()}/`).href;
const loader = `
const ROOT = ${JSON.stringify(ROOT)};
const ALIAS = { '@lib/': 'app/lib/', '@models/': 'app/models/', '@utils/': 'app/utils/', '@hooks/': 'app/hooks/' };
export async function resolve(spec, ctx, next) {
  for (const [a, dir] of Object.entries(ALIAS)) if (spec.startsWith(a)) spec = ROOT + dir + spec.slice(a.length);
  try { return await next(spec, ctx); } catch (e) {
    if (!['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(e.code)) throw e;
    for (const tail of ['.js', '/index.js']) { try { return await next(spec + tail, ctx); } catch {} }
    throw e;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

const URI = process.env.DASHBOARD_TABS_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/dashboardtabs_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) throw new Error(`refusing non-local test DB ${URI}`);
process.env.MONGODB_URI = URI;
process.env.JWT_SECRET = 'dashboard-tabs-test-secret';
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
delete process.env.FEATURE_TEST_DEALERS;
delete process.env.CRM_LIVE_DB;

const { default: mongoose } = await import('mongoose');
const { default: jwt } = await import('jsonwebtoken');
const { default: User } = await import('./app/models/User.js');
const route = await import('./app/api/reports/kpis/route.js');
const { closeCache } = await import('./app/api/reports/kpis/cache.js');
const { reportsVisible } = await import('./app/dealer/reports/reportsAccess.js');
const { listDashboards } = await import('./app/lib/reporting/registry.js');

const { ObjectId } = mongoose.Types;
const ADMIN = new ObjectId('66f0000000000000000b0001');
const DEALER = new ObjectId('66f0000000000000000b0002');
const STAFF = new ObjectId('66f0000000000000000b0003');
const OTHER = new ObjectId('66f0000000000000000b0004');
const sign = (claims) => jwt.sign(claims, process.env.JWT_SECRET);
// The tokens login and login-as issue (app/api/auth/login, app/api/login-as).
const TOKENS = {
  dealer: sign({ userId: String(DEALER), type: 'dealer' }),
  staff: sign({ userId: String(STAFF), type: 'dealer' }),
  loginAs: sign({ userId: String(DEALER), type: 'dealer', impersonated_by: String(ADMIN), impersonator_type: 'admin' }),
  // A forged claim: says the impersonator was an admin, but the user behind it is a dealer.
  forged: sign({ userId: String(DEALER), type: 'dealer', impersonated_by: String(OTHER), impersonator_type: 'admin' }),
};

let connected = false;
const needDb = (t) => {
  if (!connected) t.skip('MongoDB not reachable');
  return !connected;
};

before(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 2000 });
    connected = true;
  } catch { connected = false; }
});
after(async () => {
  if (connected) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  await closeCache();
});
beforeEach(async () => {
  if (!connected) return;
  for (const c of await mongoose.connection.db.collections()) await c.deleteMany({});
  await User.create([
    { _id: ADMIN, email: 'admin@t.test', name: 'Admin', password: 'x', type: 'admin' },
    { _id: DEALER, email: 'd@t.test', name: 'Dealer', password: 'x', type: 'dealer',
      dealer_account_information: { time_zone: 'America/New_York' } },
    { _id: STAFF, email: 's@t.test', name: 'Staff', password: 'x', type: 'dealer', parent_id: DEALER },
    { _id: OTHER, email: 'o@t.test', name: 'Other', password: 'x', type: 'dealer' },
  ]);
});

// The browser the Dashboard runs in: its sign-in token, and fetch answered by the real reports route.
function browserAs(token) {
  const calls = [];
  globalThis.window = {};
  globalThis.localStorage = { getItem: (k) => (k === 'dealertoken' ? token : null) };
  globalThis.fetch = async (url, init = {}) => {
    calls.push(url);
    const headers = new Headers(init.headers || {});
    return route.GET(new Request(`http://localhost${url}`, { headers }));
  };
  return calls;
}
const realFetch = globalThis.fetch;
function closeBrowser() {
  delete globalThis.window;
  delete globalThis.localStorage;
  globalThis.fetch = realFetch;
}

const reportsApi = (qs, token) => route.GET(new Request(`http://localhost/api/reports/kpis?${qs}`,
  { headers: { Authorization: `Bearer ${token}` } }));

// The sections are read from the component's source: it is JSX, which plain node can't import.
async function sectionsFromSource() {
  const src = await readFile(new URL('./app/dealer/reports/components/ReportSections.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('export const SECTIONS'), src.indexOf(']);', src.indexOf('export const SECTIONS')));
  return [...block.matchAll(/key: "(\w+)", title: "([^"]+)", own: \[([^\]]*)\], uses: \[([^\]]*)\], open: (true|false)/g)]
    .map(([, key, title, own, uses, open]) => ({ key, title, open: open === 'true',
      own: [...own.matchAll(/"(\w+)"/g)].map((m) => m[1]), uses: [...uses.matchAll(/"(\w+)"/g)].map((m) => m[1]) }));
}

test('sections: every SOW dashboard is in exactly one section, in the agreed order', async () => {
  const sections = await sectionsFromSource();
  assert.deepEqual(sections.map((s) => s.key), ['sources', 'outcomes', 'work', 'sales', 'service', 'health']);
  // The first four open by default; Service and Data health start closed.
  assert.deepEqual(sections.map((s) => s.open), [true, true, true, true, false, false]);
  const owned = sections.flatMap((s) => s.own);
  assert.equal(new Set(owned).size, owned.length, 'no report listed in two sections');
  const known = listDashboards().map((d) => d.id).sort();
  assert.deepEqual([...owned].sort(), known);
  for (const s of sections) for (const d of s.uses) assert.ok(known.includes(d), d);
});

test('dealer and staff: no report sections, no extra request, the reports API still 404s', async (t) => {
  if (needDb(t)) return;
  try {
    for (const who of ['dealer', 'staff']) {
      const calls = browserAs(TOKENS[who]);
      assert.equal(await reportsVisible(String(DEALER)), false, who);
      assert.deepEqual(calls, [], `${who} makes no request`);
      assert.equal((await reportsApi(`dealer_id=${DEALER}&check=1`, TOKENS[who])).status, 404, who);
      assert.equal((await reportsApi(`dealer_id=${DEALER}&dashboard=executive&start_date=2026-11-01`,
        TOKENS[who])).status, 404, who);
    }
    // A forged admin claim gets as far as the check, and the server says no.
    const calls = browserAs(TOKENS.forged);
    assert.equal(await reportsVisible(String(DEALER)), false);
    assert.equal(calls.length, 1);
  } finally { closeBrowser(); }
});

test('super admin through "login as": the report sections show', async (t) => {
  if (needDb(t)) return;
  try {
    const calls = browserAs(TOKENS.loginAs);
    assert.equal(await reportsVisible(String(DEALER)), true);
    assert.deepEqual(calls, [`/api/reports/kpis?check=1&dealer_id=${DEALER}`]);
    const res = await reportsApi(`dealer_id=${DEALER}&dashboard=executive&start_date=2026-11-01&end_date=2026-11-05`,
      TOKENS.loginAs);
    assert.equal(res.status, 200);
  } finally { closeBrowser(); }
});

test('no sign-in or no dealer yet: no report sections', async () => {
  try {
    browserAs(null);
    assert.equal(await reportsVisible(String(DEALER)), false);
    browserAs(TOKENS.loginAs);
    assert.equal(await reportsVisible(null), false);
  } finally { closeBrowser(); }
});

test('/dealer/reports redirects to the Dashboard', async () => {
  const { default: ReportsRedirect } = await import('./app/dealer/reports/page.js');
  let err = null;
  try { ReportsRedirect(); } catch (e) { err = e; }
  assert.ok(err, 'redirect throws');
  assert.match(String(err.digest), /^NEXT_REDIRECT;[a-z]+;\/dealer\/dashboard;/);
});

test('the sidebar has no Reports entry; the Dashboard shows the sections only after the same check', async () => {
  const sidebar = await readFile(new URL('./app/dealer/components/Sidebar.js', import.meta.url), 'utf8');
  assert.ok(!sidebar.includes('/dealer/reports'));
  assert.ok(!sidebar.includes('reportsVisible'));
  const page = await readFile(new URL('./app/dealer/dashboard/page.js', import.meta.url), 'utf8');
  assert.match(page, /reportsVisible\(reportsDealerId\)/);
  assert.match(page, /reportsAllowed === true && \(\s*<ReportSections /);
  assert.ok(!/tabRow|DASHBOARD_TABS|\?tab=/.test(page), 'no tab row left');
});
