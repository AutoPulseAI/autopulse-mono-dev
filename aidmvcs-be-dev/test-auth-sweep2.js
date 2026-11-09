// Auth sweep, second pass (Nov 2026): routes that read the token but treated it as optional, or trusted the dealer_id /
// user_id sent (planning/auth-sweep.md, "Second pass"). Each FIXED route: signed out
// -> 401, another dealer / not allowed -> 403 (or 404), its own dealer / agency / super admin -> passes the check.
// Route handlers are called with fake Requests against their own MongoDB database (authsweep2_test: created once,
// collections cleared between tests; skipped when MongoDB is not reachable). Allowed calls are checked on a path that
// stops before any email, SMS, S3, Stripe or AI-service call.
//   Run: node --test test-auth-sweep2.js
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

process.env.MONGODB_URI = process.env.AUTHSWEEP2_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/authsweep2_test';
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
const BAD = { Authorization: 'Bearer not-a-valid-token' };

// --- campaigns (the proven case) --------------------------------------------------------------------------------

test('campaigns GET/POST: no token or a bad one is 401, another dealer 403, own dealer / agency / admin 200', async (t) => {
  if (needDb(t)) return;
  const { default: Campaign } = await import('./app/models/Campaign.js');
  await Campaign.collection.insertMany([{ _id: id(10), name: 'A', dealer_id: DEALER_A, status: 'draft', createdAt: new Date() },
    { _id: id(11), name: 'B', dealer_id: DEALER_B, status: 'draft', createdAt: new Date() }]);
  const { GET, POST } = await route('campaigns');
  const list = async (path, headers = {}) => GET(req(path, { headers }));
  assert.equal((await list('/api/campaigns')).status, 401, 'no token, no dealer_id: was every dealer\'s campaigns');
  assert.equal((await list(`/api/campaigns?dealer_id=${DEALER_B}`)).status, 401);
  assert.equal((await list(`/api/campaigns?dealer_id=${DEALER_B}`, BAD)).status, 401);
  assert.equal((await list(`/api/campaigns?dealer_id=${DEALER_B}`, bearer(DEALER_A))).status, 403);
  assert.equal((await list(`/api/campaigns?dealer_id=${DEALER_A}`, bearer(AGENCY_2))).status, 403);
  let res = await list('/api/campaigns', bearer(STAFF_A));
  assert.deepEqual((await res.json()).data.map((c) => c.name), ['A'], 'no dealer_id: the caller\'s own dealership');
  res = await list(`/api/campaigns?dealer_id=${DEALER_A}`, bearer(AGENCY));
  assert.deepEqual((await res.json()).data.map((c) => c.name), ['A']);
  res = await list(`/api/campaigns?dealer_id=${DEALER_B}`, cookie('admintoken', ADMIN));
  assert.deepEqual((await res.json()).data.map((c) => c.name), ['B']);

  const make = (headers, dealer) => POST(req('/api/campaigns', { method: 'POST', headers,
    body: { name: 'New', dealer_id: String(dealer), message_type: 'sms', status: 'draft' } }));
  assert.equal((await make({}, DEALER_B)).status, 401);
  assert.equal((await make(BAD, DEALER_B)).status, 401);
  assert.equal((await make(bearer(DEALER_A), DEALER_B)).status, 403);
  assert.equal(await Campaign.collection.countDocuments({ name: 'New' }), 0);
});

// --- conversations ----------------------------------------------------------------------------------------------

test('conversations: counts, mark-read, lead status, reply and draft check the dealer', async (t) => {
  if (needDb(t)) return;
  const { default: Lead } = await import('./app/models/Lead.js');
  const { default: Email } = await import('./app/models/Email.js');
  const LEAD_B = id(20);
  await Lead.collection.insertOne({ _id: LEAD_B, dealer_id: DEALER_B, name: 'Customer', status: 'New', fe_lead_status: 'New' });
  await Email.collection.insertOne({ _id: id(21), message_id: 'm-b', lead_id: LEAD_B, dealer_id: String(DEALER_B),
    status: 'incoming', communication_type: 'sms', sender: '+15550001111', recipient: '+15550000002', timestamp: new Date() });

  for (const p of ['conversations/unread-count', 'conversations/message-stats']) {
    const { GET } = await route(p);
    assert.equal((await GET(req(`/api/x?dealer_id=${DEALER_B}`, { headers: bearer(DEALER_A) }))).status, 403, p);
    assert.equal((await GET(req(`/api/x?dealer_id=${DEALER_B}`, { headers: bearer(DEALER_B) }))).status, 200, p);
  }
  const markRead = (await route('conversations/mark-read')).POST;
  assert.equal((await markRead(req('/api/x', { method: 'POST', headers: bearer(DEALER_A), body: { lead_id: String(LEAD_B) } }))).status, 403);
  assert.notEqual((await Email.collection.findOne({ _id: id(21) })).read, true);
  assert.equal((await markRead(req('/api/x', { method: 'POST', headers: bearer(DEALER_B), body: { lead_id: String(LEAD_B) } }))).status, 200);

  const status = (await route('conversations/lead/status')).PUT;
  const put = (headers) => status(req('/api/x', { method: 'PUT', headers, body: { id: String(LEAD_B), status: 'DND' } }));
  assert.equal((await put({})).status, 401);
  assert.equal((await put(BAD)).status, 401, 'a bad token used to fall through');
  assert.equal((await put(bearer(DEALER_A))).status, 403);
  assert.equal((await Lead.collection.findOne({ _id: LEAD_B })).status, 'New');

  const reply = (await route('conversations/reply')).POST;
  const send = (headers) => reply(req('/api/x', { method: 'POST', headers,
    body: { parent_message_id: 'm-b', content: 'hi', communicationType: 'sms' } }));
  assert.equal((await send({})).status, 401);
  assert.equal((await send(BAD)).status, 401, 'a bad token used to fall through and send');
  assert.equal((await send(bearer(DEALER_A))).status, 403);
  assert.equal(await Email.collection.countDocuments({}), 1, 'nothing sent');

  const draft = (await route('conversations/lead/draft')).POST;
  assert.equal((await draft(req('/api/x', { method: 'POST', headers: bearer(DEALER_A), body: { lead_id: String(LEAD_B), channel: 'sms' } }))).status, 403);
});

// --- leads POST, staff list, dealer profile ---------------------------------------------------------------------

test('leads POST, staff/list and dealers/profile: only the dealer\'s own', async (t) => {
  if (needDb(t)) return;
  const { default: Lead } = await import('./app/models/Lead.js');
  const { POST } = await route('leads');
  const add = (headers) => POST(req('/api/leads', { method: 'POST', headers, body: { dealer_id: String(DEALER_B), name: 'X', phone: '5551234567' } }));
  assert.equal((await add({})).status, 401);
  assert.equal((await add(BAD)).status, 401, 'a bad token used to fall through');
  assert.equal((await add(bearer(DEALER_A))).status, 403);
  assert.equal(await Lead.collection.countDocuments({}), 0);

  const staff = (await route('staff/list')).GET;
  assert.equal((await staff(req(`/api/x?dealer_id=${DEALER_A}`))).status, 401);
  assert.equal((await staff(req(`/api/x?dealer_id=${DEALER_A}`, { headers: BAD }))).status, 401);
  assert.equal((await staff(req(`/api/x?dealer_id=${DEALER_A}`, { headers: bearer(DEALER_B) }))).status, 403);
  assert.equal((await staff(req(`/api/x?dealer_id=${DEALER_A}`, { headers: bearer(STAFF_A) }))).status, 200);

  const profile = (await route('dealers/profile')).GET;
  assert.equal((await profile(req(`/api/x?dealer_id=${DEALER_A}`))).status, 401);
  assert.equal((await profile(req(`/api/x?dealer_id=${DEALER_A}`, { headers: bearer(DEALER_B) }))).status, 403);
  assert.equal((await profile(req(`/api/x?dealer_id=${ADMIN}`, { headers: bearer(DEALER_A) }))).status, 403);
  assert.equal((await profile(req(`/api/x?dealer_id=${DEALER_A}`, { headers: bearer(STAFF_A) }))).status, 200);
  assert.equal((await profile(req(`/api/x?dealer_id=${AGENCY}`, { headers: cookie('vendortoken', AGENCY) }))).status, 200);
});

// --- tickets, campaign report, manual subscriptions -------------------------------------------------------------

test('tickets PUT/status: another agency is refused; the campaign report lets the owning agency in', async (t) => {
  if (needDb(t)) return;
  const { default: Ticket } = await import('./app/models/Ticket.js');
  const T = id(30);
  await Ticket.collection.insertOne({ _id: T, title: 'A', description: 'd', category: 'general', priority: 'low',
    createdBy: DEALER_A, createdByModel: 'dealer', messages: [], status: 'open' });
  const c = ctx({ id: String(T) });
  const one = await route('tickets/[id]');
  const st = await route('tickets/[id]/status');
  assert.equal((await one.PUT(req('/api/x', { method: 'PUT', headers: bearer(AGENCY_2), body: { title: 'hacked' } }), c)).status, 403);
  assert.equal((await st.PUT(req('/api/x', { method: 'PUT', headers: bearer(AGENCY_2), body: { status: 'closed' } }), c)).status, 403);
  assert.equal((await st.PUT(req('/api/x', { method: 'PUT', headers: bearer(DEALER_B), body: { status: 'closed' } }), c)).status, 403);
  const left = await Ticket.collection.findOne({ _id: T });
  assert.equal(left.title, 'A');
  assert.equal(left.status, 'open');
  assert.equal((await one.PUT(req('/api/x', { method: 'PUT', headers: bearer(STAFF_A), body: { title: 'Renamed' } }), c)).status, 200, 'dealer staff');

  const { default: Campaign } = await import('./app/models/Campaign.js');
  await Campaign.collection.insertOne({ _id: id(31), name: 'A', dealer_id: DEALER_A, stats: {} });
  const report = (await route('campaigns/[id]/report')).GET;
  const cr = ctx({ id: String(id(31)) });
  assert.equal((await report(req('/api/x'), cr)).status, 401);
  assert.equal((await report(req('/api/x', { headers: bearer(DEALER_B) }), cr)).status, 403);
  assert.equal((await report(req('/api/x', { headers: bearer(AGENCY_2) }), cr)).status, 403);
  assert.equal((await report(req('/api/x', { headers: bearer(AGENCY) }), cr)).status, 200, 'the dealer\'s agency');
});

test('subscriptions/manual: super admin only', async (t) => {
  if (needDb(t)) return;
  const { POST } = await route('subscriptions/manual');
  const call = (headers) => POST(req('/api/x', { method: 'POST', headers, body: { user_id: String(DEALER_A), package_id: String(id(97)) } }));
  assert.equal((await call({})).status, 401);
  assert.equal((await call(BAD)).status, 401);
  assert.equal((await call(bearer(DEALER_A))).status, 403, 'a dealer could give itself a free plan');
  assert.equal((await call(bearer(AGENCY))).status, 403);
  assert.equal((await call(cookie('admintoken', ADMIN))).status, 404, 'admin: through the check (made-up package)');
});

// --- roles and agency accounts ----------------------------------------------------------------------------------

test('roles: list, create, edit and delete only for the caller\'s own account and kind', async (t) => {
  if (needDb(t)) return;
  const { default: Role } = await import('./app/models/Role.js');
  const { default: Permission } = await import('./app/models/Permission.js');
  const P_DEALER = id(40), P_ADMIN = id(41), ROLE_B = id(42), ROLE_SUPER = id(43);
  await Permission.collection.insertMany([{ _id: P_DEALER, permission_name: 'Manage Leads', entity: 'dealer' },
    { _id: P_ADMIN, permission_name: 'Manage Dealers', entity: 'admin' }]);
  await Role.collection.insertMany([{ _id: ROLE_B, name: 'Sales', entity: 'dealer', entity_id: DEALER_B, permissions: [] },
    { _id: ROLE_SUPER, name: 'Admin', entity: 'admin', entity_id: ADMIN, permissions: [] }]);
  const roles = await route('roles');
  const rolesId = await route('roles/[id]');
  for (const GET of [roles.GET, (r) => rolesId.GET(r, ctx({ id: String(ROLE_B) }))]) {
    assert.equal((await GET(req(`/api/roles?type=dealer&entity_id=${DEALER_B}`))).status, 401);
    assert.equal((await GET(req(`/api/roles?type=dealer&entity_id=${DEALER_B}`, { headers: BAD }))).status, 401);
    assert.equal((await GET(req(`/api/roles?type=dealer&entity_id=${DEALER_B}`, { headers: bearer(DEALER_A) }))).status, 403);
    assert.equal((await GET(req('/api/roles?type=admin', { headers: bearer(DEALER_A) }))).status, 403);
    assert.equal((await GET(req(`/api/roles?type=dealer&entity_id=${DEALER_B}`, { headers: bearer(DEALER_B) }))).status, 200);
    assert.equal((await GET(req('/api/roles?type=admin', { headers: cookie('admintoken', ADMIN) }))).status, 200);
  }
  const create = (headers, entity, permissions) => roles.POST(req('/api/roles', { method: 'POST', headers, body: { name: 'R', entity, permissions } }));
  assert.equal((await create(BAD, 'dealer', [])).status, 401);
  assert.equal((await create(bearer(DEALER_A), 'admin', [String(P_ADMIN)])).status, 403, 'a dealer making an admin role');
  assert.equal((await create(bearer(DEALER_A), 'dealer', [String(P_ADMIN)])).status, 403, 'admin permission on a dealer role');
  assert.equal((await create(bearer(DEALER_A), 'dealer', [String(P_DEALER)])).status, 201);
  const edit = (headers, roleId, permissions) => roles.PUT(req('/api/roles', { method: 'PUT', headers, body: { roleId: String(roleId), permissions } }));
  assert.equal((await edit(bearer(DEALER_A), ROLE_B, [String(P_DEALER)])).status, 403);
  assert.equal((await edit(bearer(DEALER_B), ROLE_SUPER, [String(P_ADMIN)])).status, 403);
  assert.equal((await edit(bearer(DEALER_B), ROLE_B, [String(P_ADMIN)])).status, 403);
  assert.equal((await edit(bearer(DEALER_B), ROLE_B, [String(P_DEALER)])).status, 200);
  const del = (headers, roleId) => roles.DELETE(req('/api/roles', { method: 'DELETE', headers, body: { roleId: String(roleId) } }));
  assert.equal((await del({}, ROLE_B)).status, 401);
  assert.equal((await del(bearer(DEALER_A), ROLE_B)).status, 403);
  assert.equal((await del(bearer(DEALER_A), ROLE_SUPER)).status, 403);
  assert.equal(await Role.collection.countDocuments({ _id: { $in: [ROLE_B, ROLE_SUPER] } }), 2);
  assert.equal((await del(bearer(DEALER_B), ROLE_B)).status, 200);
});

test('vendors POST/PUT/DELETE: super admin only (a dealer could rewrite or delete any account)', async (t) => {
  if (needDb(t)) return;
  const vendors = await route('vendors');
  const put = (headers) => vendors.PUT(req('/api/vendors', { method: 'PUT', headers, body: { vendorId: String(ADMIN), email: 'attacker@t.test' } }));
  assert.equal((await put({})).status, 401);
  assert.equal((await put(bearer(DEALER_A))).status, 403);
  assert.equal((await User.findById(ADMIN).lean()).email, 'admin@t.test');
  const del = (headers, vendorId) => vendors.DELETE(req('/api/vendors', { method: 'DELETE', headers, body: { vendorId: String(vendorId) } }));
  assert.equal((await del(bearer(DEALER_A), ADMIN)).status, 403);
  assert.equal((await del(cookie('admintoken', ADMIN), DEALER_A)).status, 404, 'only agency accounts are deleted here');
  assert.equal(await User.countDocuments({ _id: { $in: [ADMIN, DEALER_A] } }), 2);
  assert.equal((await vendors.POST(req('/api/vendors', { method: 'POST', headers: bearer(DEALER_A), body: { name: 'x', email: 'x@t.test', password: 'p' } }))).status, 403);
  assert.equal((await del(cookie('admintoken', ADMIN), AGENCY_2)).status, 200);
});
