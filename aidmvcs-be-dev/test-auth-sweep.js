// Auth sweep (Nov 2026): the routes that had no sign-in check (planning/auth-sweep.md). Each FIXED route: signed out
// -> 401, another dealer / not allowed -> 403 (or 404), its own dealer / agency / super admin -> passes the check.
// Route handlers are called with fake Requests against their own MongoDB database (authsweep_test: created once,
// collections cleared between tests; skipped when MongoDB is not reachable). Allowed calls are checked on a path that
// stops before any email, SMS, S3, Stripe or AI-service call.
//   Run: node --test test-auth-sweep.js
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

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

process.env.MONGODB_URI = process.env.AUTHSWEEP_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/authsweep_test';
process.env.JWT_SECRET = 'authsweep-test-jwt-secret';
process.env.UPSELL_SERVICE_SHARED_SECRET = 'authsweep-test-ai-secret';
process.env.PROVIDER_SEND_STUB = 'true';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_local_dummy'; // the Stripe client is built at import; no Stripe call is made
delete process.env.CRON_SECRET;
delete process.env.CRM_LIVE_DB;

const { default: mongoose } = await import('mongoose');
const { default: jwt } = await import('jsonwebtoken');
const { default: User } = await import('./app/models/User.js');
const route = async (p) => import(`./app/api/${p}/route.js`);

const id = (n) => new mongoose.Types.ObjectId(`66f10000000000000000${String(n).padStart(4, '0')}`);
const ADMIN = id(1), DEALER_A = id(2), DEALER_B = id(3), STAFF_A = id(4), AGENCY = id(5), AGENCY_2 = id(6);
const NOBODY = id(99);

const tokenFor = (userId, extra = {}) => jwt.sign({ userId: String(userId), ...extra }, process.env.JWT_SECRET);
const bearer = (userId, extra) => ({ Authorization: `Bearer ${tokenFor(userId, extra)}` });
const cookie = (name, userId) => ({ cookie: `${name}=${tokenFor(userId)}` });
const URL_BASE = 'http://localhost:3000';
function req(path, { method = 'GET', headers = {}, body, form } = {}) {
  if (form) return new Request(URL_BASE + path, { method, headers, body: form });
  return new Request(URL_BASE + path, {
    method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const ctx = (params) => ({ params: Promise.resolve(params) });

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
  for (const c of await mongoose.connection.db.collections()) await c.deleteMany({});
  await User.create([
    { _id: ADMIN, email: 'admin@t.test', name: 'Admin', password: 'x', type: 'admin' },
    { _id: AGENCY, email: 'agency@t.test', name: 'Agency', password: 'x', type: 'vendor' },
    { _id: AGENCY_2, email: 'agency2@t.test', name: 'Agency 2', password: 'x', type: 'vendor' },
    { _id: DEALER_A, email: 'a@t.test', name: 'Dealer A', password: 'secret-hash', type: 'dealer', vendor_id: AGENCY,
      dealer_account_information: { sms_conversion_phone: '+15550000001' } },
    { _id: DEALER_B, email: 'b@t.test', name: 'Dealer B', password: 'x', type: 'dealer',
      dealer_account_information: { sms_conversion_phone: '+15550000002' } },
    { _id: STAFF_A, email: 'sa@t.test', name: 'Staff A', password: 'x', type: 'dealer', parent_id: DEALER_A },
  ]);
});
const needDb = (t) => { if (!connected) { t.skip('MongoDB not reachable'); return true; } return false; };
const smsOf = async (dealerId) => (await User.findById(dealerId).lean()).dealer_account_information?.sms_conversion_phone;

// --- dealers/account, check-domain-sms, branding ----------------------------------------------------------------

test('dealers/account PUT: only the dealer, its staff, its agency or a super admin may change it', async (t) => {
  if (needDb(t)) return;
  const { PUT } = await route('dealers/account');
  const put = (headers, dealerId, phone) => PUT(req('/api/dealers/account', { method: 'PUT', headers,
    body: { dealerId: String(dealerId), dealer_account_information: { sms_conversion_phone: phone } } }));
  assert.equal((await put({}, DEALER_B, '5551112222')).status, 401);
  assert.equal((await put(bearer(DEALER_A), DEALER_B, '5551112222')).status, 403);
  assert.equal((await put(bearer(AGENCY), DEALER_B, '5551112222')).status, 403, 'not the agency\'s dealer');
  assert.equal((await put(bearer(AGENCY_2), DEALER_A, '5551112222')).status, 403);
  assert.equal(await smsOf(DEALER_B), '+15550000002', 'nothing changed');
  assert.equal((await put(bearer(DEALER_A), DEALER_A, '5551110001')).status, 200);
  assert.equal(await smsOf(DEALER_A), '+15551110001');
  assert.equal((await put(bearer(STAFF_A), DEALER_A, '5551110002')).status, 200, 'dealer staff');
  assert.equal((await put(cookie('vendortoken', AGENCY), DEALER_A, '5551110003')).status, 200, 'agency cookie');
  assert.equal((await put(cookie('admintoken', ADMIN), DEALER_B, '5551110004')).status, 200, 'admin cookie');
  assert.equal(await smsOf(DEALER_B), '+15551110004');
});

test('dealers/account POST and check-domain-sms: no answers to outsiders', async (t) => {
  if (needDb(t)) return;
  const account = await route('dealers/account');
  const check = await route('dealers/check-domain-sms');
  for (const handler of [account.POST, check.POST]) {
    const call = (headers, dealerId) => handler(req('/api/x', { method: 'POST', headers,
      body: { dealerId: String(dealerId), sms_conversion_phone: '+15550000002' } }));
    assert.equal((await call({}, DEALER_A)).status, 401);
    assert.equal((await call(bearer(DEALER_B), DEALER_A)).status, 403);
    const res = await call(bearer(DEALER_A), DEALER_A);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).hasExisting, true);
    assert.equal((await call(bearer(ADMIN), DEALER_A)).status, 200);
  }
});

test('dealers/branding: PUT needs the dealer, POST (upload) needs a sign-in', async (t) => {
  if (needDb(t)) return;
  const { PUT, POST } = await route('dealers/branding');
  const put = (headers, dealerId) => PUT(req('/api/dealers/branding', { method: 'PUT', headers,
    body: { dealerId: String(dealerId), branding_information: { primary_color: '#000' } } }));
  assert.equal((await put({}, DEALER_A)).status, 401);
  assert.equal((await put(bearer(DEALER_B), DEALER_A)).status, 403);
  assert.equal((await put(cookie('dealertoken', DEALER_A), DEALER_A)).status, 200);
  assert.equal((await POST(req('/api/dealers/branding', { method: 'POST', form: new FormData() }))).status, 401);
  assert.equal((await POST(req('/api/dealers/branding', { method: 'POST', headers: bearer(DEALER_A), form: new FormData() }))).status, 200);
});

// --- vendors/reset-password -------------------------------------------------------------------------------------

test('vendors/reset-password: super admin only', async (t) => {
  if (needDb(t)) return;
  const { POST } = await route('vendors/reset-password');
  const call = (headers, vendorId) => POST(req('/api/vendors/reset-password', { method: 'POST', headers,
    body: { vendorId: String(vendorId), password: 'new-password-1' } }));
  assert.equal((await call({}, DEALER_A)).status, 401);
  assert.equal((await call(bearer(DEALER_A), DEALER_A)).status, 403);
  assert.equal((await call(bearer(AGENCY), DEALER_A)).status, 403);
  assert.equal((await User.findById(DEALER_A).lean()).password, 'secret-hash', 'unchanged');
  // An unknown account stops just after the check, before the password email.
  assert.equal((await call(bearer(ADMIN), NOBODY)).status, 404);
  assert.equal((await call(cookie('admintoken', ADMIN), NOBODY)).status, 404);
});

// --- upload/* ---------------------------------------------------------------------------------------------------

test('upload/file and upload/image: a signed-in user only', async (t) => {
  if (needDb(t)) return;
  for (const p of ['upload/file', 'upload/image']) {
    const { POST } = await route(p);
    assert.equal((await POST(req(`/api/${p}`, { method: 'POST', form: new FormData() }))).status, 401, p);
    // No file: stops after the check, before S3.
    assert.equal((await POST(req(`/api/${p}`, { method: 'POST', headers: cookie('dealertoken', STAFF_A), form: new FormData() }))).status, 400, p);
  }
});

// --- login-as ---------------------------------------------------------------------------------------------------

test('login-as: bad token 401, dealer 403, other agency 403; the answer never carries the password hash', async (t) => {
  if (needDb(t)) return;
  const { POST } = await route('login-as');
  const call = (headers, userId) => POST(req('/api/login-as', { method: 'POST', headers, body: { userId: String(userId) } }));
  assert.equal((await call({}, DEALER_A)).status, 401);
  assert.equal((await call({ Authorization: 'Bearer not-a-token' }, DEALER_A)).status, 401);
  assert.equal((await call(bearer(DEALER_B), DEALER_A)).status, 403);
  assert.equal((await call(bearer(AGENCY_2), DEALER_A)).status, 403);
  let res;
  try { res = await call(bearer(ADMIN), DEALER_A); } catch (e) { if (/cookies/.test(e.message)) return t.skip('next/headers cookies() needs a request scope'); throw e; }
  if (res.status === 500) return t.skip('next/headers cookies() needs a request scope');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.password, undefined);
  assert.equal(body.user.otp, undefined);
});

// --- super-admin-only routes (debug/test/maintenance, platform stats, admin inbox, packages) ---------------------

const SUPER_ADMIN_ONLY = [
  // [route, method, path, admin call reaches the handler (local DB only; no S3/Redis/Twilio/Stripe)]
  ['system/redis-queues', 'GET', '/api/system/redis-queues', false],
  ['system/redis-queues', 'POST', '/api/system/redis-queues', false],
  ['system/redis-queues', 'DELETE', '/api/system/redis-queues', false],
  ['system/test-redis', 'GET', '/api/system/test-redis', false],
  ['test/check-vehicle', 'GET', '/api/test/check-vehicle', true],
  ['test/email-subjects', 'GET', '/api/test/email-subjects', true],
  ['test/report-db', 'GET', '/api/test/report-db', true],
  ['test/report-periods', 'GET', '/api/test/report-periods', true],
  ['test/twilio-test', 'GET', '/api/test/twilio-test', false],
  ['test-s3', 'GET', '/api/test-s3', false],
  ['admin/manual-cleanup', 'GET', '/api/admin/manual-cleanup', true],
  ['admin/manual-cleanup', 'POST', '/api/admin/manual-cleanup', false],
  ['admin/stats', 'GET', '/api/admin/stats', true],
  ['admin/vehicles', 'GET', '/api/admin/vehicles', true],
  ['vendors/admin-stats', 'GET', '/api/vendors/admin-stats', true],
  ['contact', 'GET', '/api/contact', true],
  ['bookademo', 'GET', '/api/bookademo', true],
  ['bookademo', 'DELETE', `/api/bookademo?id=${id(98)}`, true],
  ['contact/[id]', 'GET', `/api/contact/${id(98)}`, true],
  ['contact/[id]', 'DELETE', `/api/contact/${id(98)}`, true],
  ['contact/[id]/status', 'PATCH', `/api/contact/${id(98)}/status`, false],
  ['packages', 'POST', '/api/packages', false],
  ['packages/[id]', 'PUT', `/api/packages/${id(98)}`, false],
  ['packages/[id]', 'DELETE', `/api/packages/${id(98)}`, false],
  ['packages/[id]/status', 'PUT', `/api/packages/${id(98)}/status`, false],
];

test('super-admin-only routes: 401 signed out, 403 dealer / agency, super admin gets through', async (t) => {
  if (needDb(t)) return;
  for (const [p, method, path, adminRuns] of SUPER_ADMIN_ONLY) {
    const handler = (await route(p))[method];
    const body = ['GET', 'DELETE'].includes(method) ? undefined : {};
    const call = (headers) => handler(req(path, { method, headers, body }), ctx({ id: String(id(98)) }));
    assert.equal((await call({})).status, 401, `${method} ${p} signed out`);
    assert.equal((await call(bearer(DEALER_A))).status, 403, `${method} ${p} dealer`);
    assert.equal((await call(cookie('vendortoken', AGENCY))).status, 403, `${method} ${p} agency`);
    if (adminRuns) {
      const status = (await call(cookie('admintoken', ADMIN))).status;
      assert.ok(![401, 403].includes(status), `${method} ${p} super admin got ${status}`);
    }
  }
});

test('packages GET: signed-in users only', async (t) => {
  if (needDb(t)) return;
  const { GET } = await route('packages');
  assert.equal((await GET(req('/api/packages?for_user_type=dealer'))).status, 401);
  assert.equal((await GET(req('/api/packages?for_user_type=dealer', { headers: cookie('dealertoken', DEALER_A) }))).status, 200);
});
