// Security fixes (Nov 2026): who may call which API route. The route handlers are imported and called with fake
// Requests against their own MongoDB database (sec_test, wiped before each test; skipped when MongoDB is not
// reachable). No email, SMS or AI-service call is made: allowed calls are checked on a path that stops before any.
//   Run: node --test test-security-guards.js
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Next.js resolves "@lib/x", "@models/x" and extensionless imports; plain Node needs this small resolver for the
// route files.
const ROOT = pathToFileURL(`${process.cwd()}/`).href;
const loader = `
const ROOT = ${JSON.stringify(ROOT)};
const ALIAS = { '@lib/': 'app/lib/', '@models/': 'app/models/', '@utils/': 'app/utils/', '@hooks/': 'app/hooks/', '@seeder/': 'app/seeder/' };
export async function resolve(spec, ctx, next) {
  for (const [a, dir] of Object.entries(ALIAS)) if (spec.startsWith(a)) spec = ROOT + dir + spec.slice(a.length);
  try { return await next(spec, ctx); } catch (e) {
    if (!['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(e.code)) throw e;
    for (const tail of ['.js', '/index.js']) { try { return await next(spec + tail, ctx); } catch {} }
    throw e;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

process.env.MONGODB_URI = process.env.SEC_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/sec_test';
process.env.JWT_SECRET = 'sec-test-jwt-secret';
process.env.UPSELL_SERVICE_SHARED_SECRET = 'sec-test-ai-secret';
delete process.env.CRON_SECRET;
delete process.env.CRM_LIVE_DB;

const { default: mongoose } = await import('mongoose');
const { default: jwt } = await import('jsonwebtoken');
const { default: User } = await import('./app/models/User.js');
const { default: Role } = await import('./app/models/Role.js');
const { default: Permission } = await import('./app/models/Permission.js');
const { default: Lead } = await import('./app/models/Lead.js');
const { default: Booking } = await import('./app/models/Booking.js');
const { default: EmailAccount } = await import('./app/models/EmailAccount.js');
const guard = await import('./app/lib/apiGuard.js');
const staffRoute = await import('./app/api/staff/route.js');
const dealersRoute = await import('./app/api/dealers/route.js');
const reportCron = await import('./app/api/cron/report-service/route.js');
const campaignsCron = await import('./app/api/cron/campaigns/route.js');
const leadsRoute = await import('./app/api/leads/route.js');
const statsRoute = await import('./app/api/leads/stats/route.js');
const conversationsRoute = await import('./app/api/conversations/route.js');
const emailAccountsRoute = await import('./app/api/email-accounts/route.js');
const reportSettingsRoute = await import('./app/api/dealers/report-settings/route.js');
const bookingRoute = await import('./app/api/booking/route.js');

const id = (n) => new mongoose.Types.ObjectId(`66f00000000000000000${String(n).padStart(4, '0')}`);
const ADMIN = id(1), DEALER_A = id(2), DEALER_B = id(3), STAFF_A = id(4), AGENCY = id(5), STAFF_A_PLAIN = id(6);
const ROLE_A = id(20), ROLE_ADMIN = id(21), PERM = id(30);

const tokenFor = (userId, extra = {}) => jwt.sign({ userId: String(userId), ...extra }, process.env.JWT_SECRET);
const bearer = (userId) => ({ Authorization: `Bearer ${tokenFor(userId)}` });
const URL_BASE = 'http://localhost:3000';
function req(path, { method = 'GET', headers = {}, body } = {}) {
  return new Request(URL_BASE + path, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

let connected = false;
before(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    connected = true;
  } catch { connected = false; }
});
after(async () => {
  if (connected) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});
beforeEach(async () => {
  if (!connected) return;
  delete process.env.CRON_SECRET;
  await mongoose.connection.dropDatabase();
  await Permission.create({ _id: PERM, permission_name: 'Manage Employee', entity: 'dealer' });
  await Role.create({ _id: ROLE_A, name: 'Manager', entity: 'dealer', entity_id: DEALER_A, permissions: [PERM] });
  await Role.create({ _id: ROLE_ADMIN, name: 'Super', entity: 'admin', permissions: [] });
  await User.create([
    { _id: ADMIN, email: 'admin@t.test', name: 'Admin', password: 'x', type: 'admin' },
    { _id: AGENCY, email: 'agency@t.test', name: 'Agency', password: 'x', type: 'vendor' },
    { _id: DEALER_A, email: 'a@t.test', name: 'Dealer A', password: 'x', type: 'dealer', vendor_id: AGENCY },
    { _id: DEALER_B, email: 'b@t.test', name: 'Dealer B', password: 'x', type: 'dealer' },
    { _id: STAFF_A, email: 'sa@t.test', name: 'Staff A', password: 'x', type: 'dealer', parent_id: DEALER_A, role: ROLE_A },
    { _id: STAFF_A_PLAIN, email: 'sp@t.test', name: 'Staff Plain', password: 'x', type: 'dealer', parent_id: DEALER_A },
  ]);
});
const needDb = (t) => { if (!connected) { t.skip('MongoDB not reachable'); return true; } return false; };

// --- SEC-1 /api/staff ------------------------------------------------------------------------------------------

test('staff: no sign-in -> 401', async (t) => {
  if (needDb(t)) return;
  const res = await staffRoute.POST(req('/api/staff', { method: 'POST', body: { email: 'n@t.test', type: 'admin' } }));
  assert.equal(res.status, 401);
});

test('staff: a dealer cannot create a super admin, an admin-role user, or staff under another dealer', async (t) => {
  if (needDb(t)) return;
  const base = { name: 'New', email: 'new@t.test', password: 'pw', role: String(ROLE_A) };
  let res = await staffRoute.POST(req('/api/staff', { method: 'POST', headers: bearer(DEALER_A), body: { ...base, type: 'admin' } }));
  assert.equal(res.status, 403);
  res = await staffRoute.POST(req('/api/staff', { method: 'POST', headers: bearer(DEALER_A), body: { ...base, type: 'dealer', parent_id: String(DEALER_B) } }));
  assert.equal(res.status, 403);
  res = await staffRoute.POST(req('/api/staff', { method: 'POST', headers: bearer(DEALER_A), body: { ...base, type: 'dealer', role: String(ROLE_ADMIN) } }));
  assert.equal(res.status, 403);
  // Staff without "Manage Employee" cannot add employees; nothing was created.
  res = await staffRoute.POST(req('/api/staff', { method: 'POST', headers: bearer(STAFF_A_PLAIN), body: { ...base, type: 'dealer', parent_id: String(DEALER_A) } }));
  assert.equal(res.status, 403);
  assert.equal(await User.countDocuments({ email: 'new@t.test' }), 0);
});

test('staff: the dealer UI request (own type and parent) still passes the check', async (t) => {
  if (needDb(t)) return;
  // An existing email stops it just after the check, before any account email is sent.
  const body = { name: 'New', email: 'sa@t.test', password: 'pw', role: String(ROLE_A), type: 'dealer', parent_id: String(DEALER_A) };
  let res = await staffRoute.POST(req('/api/staff', { method: 'POST', headers: bearer(DEALER_A), body }));
  assert.equal(res.status, 400);
  res = await staffRoute.POST(req('/api/staff', { method: 'POST', headers: bearer(STAFF_A), body }));
  assert.equal(res.status, 400, 'staff with Manage Employee');
  res = await staffRoute.POST(req('/api/staff', { method: 'POST', headers: bearer(ADMIN), body: { ...body, type: 'admin', parent_id: undefined } }));
  assert.equal(res.status, 400, 'super admin');
});

test('staff: a dealer lists only its own employees and cannot edit or delete others', async (t) => {
  if (needDb(t)) return;
  let res = await staffRoute.GET(req('/api/staff?type=admin', { headers: bearer(DEALER_A) }));
  assert.equal(res.status, 200);
  const names = (await res.json()).staff.map((s) => s.name).sort();
  assert.deepEqual(names, ['Staff A', 'Staff Plain']);
  res = await staffRoute.PUT(req('/api/staff', { method: 'PUT', headers: bearer(DEALER_B), body: { staffId: String(ADMIN), name: 'Hacked' } }));
  assert.equal(res.status, 404);
  res = await staffRoute.DELETE(req('/api/staff', { method: 'DELETE', headers: bearer(DEALER_B), body: { staffId: String(STAFF_A) } }));
  assert.equal(res.status, 404);
  assert.equal(await User.countDocuments({ _id: STAFF_A }), 1);
  res = await staffRoute.PUT(req('/api/staff', { method: 'PUT', headers: bearer(DEALER_A), body: { staffId: String(STAFF_A), name: 'Renamed' } }));
  assert.equal(res.status, 200);
});

// --- SEC-2 /api/dealers ----------------------------------------------------------------------------------------

test('dealers: delete needs a super admin or the owning agency', async (t) => {
  if (needDb(t)) return;
  const del = (headers, dealerId) => dealersRoute.DELETE(req('/api/dealers', { method: 'DELETE', headers, body: { dealerId: String(dealerId) } }));
  assert.equal((await del({}, DEALER_B)).status, 401);
  assert.equal((await del(bearer(DEALER_A), DEALER_B)).status, 403);
  assert.equal((await del(bearer(AGENCY), DEALER_B)).status, 404, 'not the agency\'s dealer');
  assert.equal(await User.countDocuments({ _id: DEALER_B }), 1);
  assert.equal((await del(bearer(ADMIN), DEALER_B)).status, 200);
  assert.equal(await User.countDocuments({ _id: DEALER_B }), 0);
  assert.equal((await del(bearer(AGENCY), DEALER_A)).status, 200);
});

test('dealers: list needs sign-in; an agency sees only its dealers; the admin cookie works', async (t) => {
  if (needDb(t)) return;
  assert.equal((await dealersRoute.GET(req('/api/dealers'))).status, 401);
  let res = await dealersRoute.GET(req('/api/dealers', { headers: { cookie: `admintoken=${tokenFor(ADMIN)}` } }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).dealers.length, 2);
  res = await dealersRoute.GET(req(`/api/dealers?vendor_id=${id(99)}`, { headers: bearer(AGENCY) }));
  assert.deepEqual((await res.json()).dealers.map((d) => d.name), ['Dealer A']);
});

// --- SEC-3 /api/cron/* -----------------------------------------------------------------------------------------

test('cron: report-service needs a super admin (header or admin cookie) or CRON_SECRET', async (t) => {
  if (needDb(t)) return;
  assert.equal((await reportCron.GET(req('/api/cron/report-service'))).status, 401);
  assert.equal((await reportCron.GET(req('/api/cron/report-service', { headers: bearer(DEALER_A) }))).status, 403);
  assert.equal((await reportCron.GET(req('/api/cron/report-service', { headers: bearer(ADMIN) }))).status, 200);
  assert.equal((await reportCron.GET(req('/api/cron/report-service', { headers: { cookie: `x=1; admintoken=${tokenFor(ADMIN)}` } }))).status, 200);
  process.env.CRON_SECRET = 'cron-secret';
  assert.equal((await reportCron.GET(req('/api/cron/report-service', { headers: { 'x-cron-secret': 'cron-secret' } }))).status, 200);
  assert.equal((await reportCron.GET(req('/api/cron/report-service', { headers: { 'x-cron-secret': 'wrong' } }))).status, 401);
});

test('cron: campaigns keeps working for the server scheduler until CRON_SECRET is set, then needs it', async (t) => {
  if (needDb(t)) return;
  assert.equal((await campaignsCron.GET(req('/api/cron/campaigns'))).status, 200);
  process.env.CRON_SECRET = 'cron-secret';
  assert.equal((await campaignsCron.GET(req('/api/cron/campaigns'))).status, 401);
  assert.equal((await campaignsCron.GET(req('/api/cron/campaigns', { headers: { Authorization: 'Bearer cron-secret' } }))).status, 200);
});

// --- SEC-4 read routes -----------------------------------------------------------------------------------------

test('read routes: 401 signed out, 403 other dealer, 200 own dealer / super admin / owning agency', async (t) => {
  if (needDb(t)) return;
  const cases = [
    ['leads/stats', statsRoute.GET, (d) => `/api/leads/stats?dealer_id=${d}`],
    ['conversations', conversationsRoute.GET, (d) => `/api/conversations?dealer_id=${d}`],
    ['email-accounts', emailAccountsRoute.GET, (d) => `/api/email-accounts?dealer_id=${d}`],
    ['report-settings', reportSettingsRoute.GET, (d) => `/api/dealers/report-settings?dealer_id=${d}`],
  ];
  for (const [name, handler, path] of cases) {
    assert.equal((await handler(req(path(DEALER_A)))).status, 401, `${name} signed out`);
    assert.equal((await handler(req(path(DEALER_A), { headers: bearer(DEALER_B) }))).status, 403, `${name} other dealer`);
    assert.equal((await handler(req(path(DEALER_A), { headers: bearer(DEALER_A) }))).status, 200, `${name} own dealer`);
    assert.equal((await handler(req(path(DEALER_A), { headers: bearer(STAFF_A) }))).status, 200, `${name} own staff`);
    assert.equal((await handler(req(path(DEALER_A), { headers: { cookie: `dealertoken=${tokenFor(DEALER_A)}` } }))).status, 200, `${name} dealer cookie`);
    assert.equal((await handler(req(path(DEALER_A), { headers: bearer(ADMIN) }))).status, 200, `${name} super admin`);
    assert.equal((await handler(req(path(DEALER_A), { headers: bearer(AGENCY) }))).status, 200, `${name} owning agency`);
  }
  // Without a dealer_id (every dealer's messages): super admin only.
  assert.equal((await conversationsRoute.GET(req('/api/conversations', { headers: bearer(DEALER_A) }))).status, 403);
  assert.equal((await conversationsRoute.GET(req('/api/conversations', { headers: bearer(ADMIN) }))).status, 200);
});

test('email accounts / conversations: the agency pages (own id as dealer_id) still work; another dealer cannot edit', async (t) => {
  if (needDb(t)) return;
  const res = await emailAccountsRoute.GET(req(`/api/email-accounts?dealer_id=${AGENCY}`, { headers: bearer(AGENCY) }));
  assert.equal(res.status, 200);
  const convo = await conversationsRoute.GET(req(`/api/conversations?dealer_id=${AGENCY}`, { headers: bearer(AGENCY) }));
  assert.equal(convo.status, 200, 'agency conversations page sends its own id');
  const acct = await EmailAccount.create({ dealer_id: DEALER_A, account_name: 'Sales', email_address: 's@a.test',
    email_password: 'x', event_type: 'lead', active: true });
  const put = await emailAccountsRoute.PUT(req('/api/email-accounts', { method: 'PUT', headers: bearer(DEALER_B), body: { id: String(acct._id), account_name: 'X' } }));
  assert.equal(put.status, 403);
  const own = await emailAccountsRoute.PUT(req('/api/email-accounts', { method: 'PUT', headers: bearer(DEALER_A), body: { id: String(acct._id), account_name: 'Renamed' } }));
  assert.equal(own.status, 200);
});

// --- SEC-5 GET /api/leads --------------------------------------------------------------------------------------

test('leads list / CSV: another dealer\'s dealer_id -> 403; own -> 200', async (t) => {
  if (needDb(t)) return;
  assert.equal((await leadsRoute.GET(req(`/api/leads?dealer_id=${DEALER_A}`))).status, 401);
  assert.equal((await leadsRoute.GET(req(`/api/leads?dealer_id=${DEALER_A}`, { headers: bearer(DEALER_B) }))).status, 403);
  assert.equal((await leadsRoute.GET(req(`/api/leads?format=csv&dealer_id=${DEALER_A}`, { headers: bearer(DEALER_B) }))).status, 403);
  assert.equal((await leadsRoute.GET(req(`/api/leads?dealer_id=${DEALER_A}`, { headers: bearer(DEALER_A) }))).status, 200);
  assert.equal((await leadsRoute.GET(req(`/api/leads?dealer_id=${DEALER_A}`, { headers: bearer(ADMIN) }))).status, 200);
  assert.equal((await leadsRoute.GET(req(`/api/leads?dealer_id=${DEALER_A}`, { headers: bearer(AGENCY) }))).status, 200);
  assert.equal((await leadsRoute.GET(req(`/api/leads?dealer_id=${DEALER_A}`, { headers: { Authorization: `Bearer ${tokenFor(DEALER_A, { impersonated_by: String(ADMIN) })}` } }))).status, 200, 'login as dealer');
});

// --- SEC-6 /api/booking ----------------------------------------------------------------------------------------

test('booking PUT: signed out 401, other dealer 404, own staff / AI token allowed; public POST still accepted', async (t) => {
  if (needDb(t)) return;
  const lead = await Lead.create({ dealer_id: String(DEALER_A), name: 'Pat', email: 'pat@x.test' });
  const booking = await Booking.collection.insertOne({ dealer_id: String(DEALER_A), lead_id: lead._id,
    bookingDate: new Date('2031-03-03T14:00:00Z'), bookingTime: '10:00', booking_status: 'pending' });
  const bookingId = String(booking.insertedId);
  // An invalid status stops each allowed call before anything is changed or anyone is told.
  const put = (headers, extra = {}) => bookingRoute.PUT(req('/api/booking', { method: 'PUT', headers, body: { bookingId, booking_status: 'nope', ...extra } }));
  assert.equal((await put({})).status, 401);
  assert.equal((await put(bearer(DEALER_B))).status, 404);
  assert.equal((await put(bearer(STAFF_A))).status, 422);
  assert.equal((await put(bearer(ADMIN))).status, 422);
  const ai = { Authorization: `Bearer ${process.env.UPSELL_SERVICE_SHARED_SECRET}` };
  assert.equal((await put(ai, { dealer_id: String(DEALER_A) })).status, 422);
  assert.equal((await put(ai, { dealer_id: String(DEALER_B) })).status, 404);
  // The public customer booking page posts without a token: it is not turned away (an unknown lead -> 404, not 401).
  const post = await bookingRoute.POST(req('/api/booking', { method: 'POST', body: { dealer_id: String(DEALER_A), lead_id: String(id(77)),
    customerName: 'Pat', email: 'pat@x.test', phone: '5550001111', bookingDate: '2031-03-03', bookingTime: '10:00' } }));
  assert.equal(post.status, 404);
  const prefill = await bookingRoute.GET(req(`/api/booking?lead_id=${lead._id}`));
  assert.equal(prefill.status, 200, 'public booking page prefill');
});

test('guard: deleted user\'s token and a bad token are refused', async (t) => {
  if (needDb(t)) return;
  assert.equal((await guard.requireUser(req('/x', { headers: bearer(id(999)) }))).response.status, 401);
  assert.equal((await guard.requireUser(req('/x', { headers: { Authorization: 'Bearer garbage' } }))).response.status, 401);
  assert.equal(String((await guard.requireUser(req('/x', { headers: bearer(DEALER_A) }))).user._id), String(DEALER_A));
});
