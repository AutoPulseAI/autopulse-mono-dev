// Client meeting 25 Nov 2026 (planning/MEETING-25-NOV-ACTIONS.md): the items built from it.
//   #8 inventory report: leads by car in stock (stock #, days in stock).
//   #12 reassigning several leads at once needs "Bulk Reassign Leads"; one lead needs only "Assign Leads".
//   #23 a super admin pauses / deactivates a dealership: it and its staff can't sign in; history kept.
//   #13 lead type: Internet / Phone / Walk-in / Campaign, else 'Not set' (no 'Other').
//   #7 one search box on the Leads page: name, phone, email or stock number.
//   #2 a lead is "tethered, not merged" to a customer with DealerVault (sale / service) history: own customer, shown as
//      a possible match, joined only after a manager's merge; #6 who merged.
// Uses its own local MongoDB database (meeting25_test, cleared before each test, dropped at the end; local hosts only;
// DB tests are skipped when MongoDB is not reachable).
//   Run: node --test test-meeting-25-nov.js
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

process.env.MONGODB_URI = process.env.MEETING25_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/meeting25_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.MONGODB_URI)) {
  throw new Error(`refusing non-local test DB ${process.env.MONGODB_URI}`);
}
process.env.JWT_SECRET = 'meeting25-test-jwt-secret';
delete process.env.CRM_LIVE_DB;

const { default: mongoose } = await import('mongoose');
const { default: Customer } = await import('./app/models/Customer.js');
const { default: Lead } = await import('./app/models/Lead.js');
const { default: User } = await import('./app/models/User.js');
const { linkCustomerToLead } = await import('./app/lib/customerResolver.js');
const { possibleMatchesFor, duplicateGroups } = await import('./app/lib/duplicateCustomers.js');
const { oneBoxConditions } = await import('./app/lib/leadSearch.js');
const { default: Vehicle } = await import('./app/models/Vehicle.js');
const { evaluateKpi } = await import('./app/lib/reporting/registry.js');
const { upType } = await import('./app/lib/reporting/normalize.js');
const { canReassign, ensureBulkReassignPermission, BULK_REASSIGN } = await import('./app/lib/bulkPermission.js');
const { default: Permission } = await import('./app/models/Permission.js');
const { default: Role } = await import('./app/models/Role.js');
const { dealershipBlockedMessage, setDealershipState, PAUSED_MESSAGE } = await import('./app/lib/dealerAccountStatus.js');

const DEALER = new mongoose.Types.ObjectId().toString();
let dbUp = false;
before(async () => {
  try { await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 1500 }); dbUp = true; } catch { dbUp = false; }
});
beforeEach(async () => { if (dbUp) await mongoose.connection.db.dropDatabase(); });
after(async () => { if (dbUp) { await mongoose.connection.db.dropDatabase(); await mongoose.disconnect(); } });
const db = (name, fn) => test(name, async (t) => { if (!dbUp) return t.skip('MongoDB not reachable'); await fn(t); });

const newLead = (fields) => Lead.create({ dealer_id: DEALER, name: 'Bibi Test', ...fields });

db('#2 a lead matching a sold customer on phone AND email gets its own customer and a possible-match notice', async () => {
  const sold = await Customer.create({ dealer_id: DEALER, name: 'Bibi Singh', dealervault_upload: true,
    phones: [{ value: '7185550101' }], emails: [{ value: 'bibi@example.com' }] });
  const lead = await newLead({ phone: '+17185550101', email: 'BIBI@example.com' });
  const r = await linkCustomerToLead(lead, { source: 'email' });
  assert.equal(r.created, true);
  const saved = await Lead.findById(lead._id).lean();
  assert.notEqual(String(saved.customer_id), String(sold._id));
  assert.deepEqual(r.possibleMatchIds, [String(sold._id)]);
  const soldAfter = await Customer.findById(sold._id).lean();
  assert.notEqual(soldAfter.inbound_lead, true, 'the sold customer is not touched');
  const matches = await possibleMatchesFor(DEALER, saved.customer_id);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]._id, String(sold._id));
  assert.equal(matches[0].dealership_history, true);
  const groups = await duplicateGroups(DEALER);
  assert.equal(groups.total, 1);
  assert.ok(groups.groups[0].customers.some((c) => c.dealership_history));
});

db('#2 a second lead from the same person joins the first lead\'s customer, not a third one', async () => {
  await Customer.create({ dealer_id: DEALER, name: 'Bibi Singh', dealervault_upload: true, phones: [{ value: '7185550101' }] });
  const a = await newLead({ phone: '7185550101' });
  const ra = await linkCustomerToLead(a);
  const b = await newLead({ phone: '718-555-0101', vehicle_make: 'Honda' });
  const rb = await linkCustomerToLead(b);
  assert.equal(rb.created, false);
  assert.equal(String(rb.customerId), String(ra.customerId));
  assert.equal(await Customer.countDocuments({ dealer_id: DEALER }), 2);
});

db('#2/#6 after a manager merges them, new leads join the sold customer; the merge shows who did it', async () => {
  const manager = await User.create({ name: 'Mercy Manager', email: `m${Date.now()}@example.com`, password: 'x', type: 'dealer' });
  const sold = await Customer.create({ dealer_id: DEALER, name: 'Bibi Singh', dealervault_upload: true, phones: [{ value: '7185550101' }] });
  const first = await newLead({ phone: '7185550101' });
  const r1 = await linkCustomerToLead(first);
  await Customer.updateOne({ _id: r1.customerId }, { $set: { merged_into: sold._id } });
  await Customer.updateOne({ _id: sold._id }, { $push: { merge_history: { merged_customer_id: r1.customerId,
    merged_by: manager._id, merged_at: new Date() } } });
  const next = await newLead({ phone: '7185550101' });
  const r2 = await linkCustomerToLead(next);
  assert.equal(String(r2.customerId), String(sold._id));
  const groups = await duplicateGroups(DEALER);
  assert.equal(groups.recent_merges[0].merged_by_name, 'Mercy Manager');
});

db('#2 customers without dealership history still link on phone or email as before', async () => {
  const earlier = await Customer.create({ dealer_id: DEALER, name: 'Walk In', inbound_lead: true, emails: [{ value: 'walk@example.com' }] });
  const lead = await newLead({ email: 'walk@example.com' });
  const r = await linkCustomerToLead(lead);
  assert.equal(String(r.customerId), String(earlier._id));
});

db('#7 one search box finds a lead by name, email, phone digits (any format) and inventory stock number', async () => {
  await Vehicle.create({ dealerId: DEALER, vin: '1HGCM82633A004352', stockNumber: 'P1234' }); // as lib/import.js stores it
  const byCar = await newLead({ name: 'Ann Stock', vin: '1HGCM82633A004352' });
  const byPhone = await newLead({ name: 'Ben Phone', phone: '+1 (718) 555-0199' });
  const byEmail = await newLead({ name: 'Cy Mail', email: 'cy@dealer.com' });
  const find = async (q) => (await Lead.find({ dealer_id: DEALER, $or: await oneBoxConditions(q, DEALER) }).lean())
    .map((l) => String(l._id)).sort();
  assert.deepEqual(await find('P1234'), [String(byCar._id)]);
  assert.deepEqual(await find('p12'), [String(byCar._id)], 'start of the stock number, any case');
  assert.deepEqual(await find('718-555-0199'), [String(byPhone._id)]);
  assert.deepEqual(await find('5550199'), [String(byPhone._id)]);
  assert.deepEqual(await find('cy@dealer'), [String(byEmail._id)]);
  assert.deepEqual(await find('ben'), [String(byPhone._id)]);
  assert.deepEqual(await find('(718'), [String(byPhone._id)], 'a typed bracket is not a broken regex');
});

db('#8 leads by car in stock: one group per car with stock #, car and days in stock; sold cars and no-VIN leads left out', async () => {
  const now = new Date();
  await Vehicle.create({ dealerId: DEALER, vin: 'AGED0000000000001', stockNumber: 'A1', year: 2019, make: 'Honda',
    model: 'Civic', age: 95 });
  await Vehicle.create({ dealerId: DEALER, vin: 'SOLD0000000000001', stockNumber: 'S1', removedAt: now });
  await newLead({ name: 'One', vin: 'aged0000000000001' });
  await newLead({ name: 'Two', vehicles_of_interest: [{ vin: 'AGED0000000000001' }] });
  await newLead({ name: 'Sold car', vin: 'SOLD0000000000001' });
  await newLead({ name: 'No car' });
  const day = now.toISOString().slice(0, 10);
  const r = await evaluateKpi('source.leads_by_car', { dealerId: DEALER, from: day, to: day, tz: 'UTC' }, {});
  assert.equal(r.state, 'live');
  assert.equal(r.count, 2);
  assert.deepEqual(r.breakdowns.car.map((g) => [g.key, g.count]), [['#A1 · 2019 Honda Civic · 95 days in stock', 2]]);
  assert.equal(r.rows[0].stock, 'A1');
});

test('#13 lead type has no "Other": unknown is "Not set"; campaign stays', () => {
  assert.equal(upType({ source: 'manual' }), 'Not set');
  assert.equal(upType({ lead_source: 'campaign_Spring' }), 'Campaign');
  assert.equal(upType({ contact_type: 'walk_in' }), 'Walk-in');
});

db('#12 bulk reassign: staff with only "Assign Leads" reassign one lead, not several; Sales Manager gets the new permission', async () => {
  const assign = await Permission.create({ permission_name: 'Assign Leads', entity: 'dealer', group: 'Leads Management' });
  const rep = await Role.create({ name: 'BDC Rep', entity: 'dealer', entity_id: DEALER, permissions: [assign._id] });
  const mgr = await Role.create({ name: 'Sales Manager', entity: 'dealer', entity_id: DEALER, permissions: [assign._id] });
  await ensureBulkReassignPermission();
  const bulk = await Permission.findOne({ permission_name: BULK_REASSIGN }).lean();
  assert.ok(bulk, 'the permission is created');
  assert.ok((await Role.findById(mgr._id).lean()).permissions.map(String).includes(String(bulk._id)));
  assert.ok(!(await Role.findById(rep._id).lean()).permissions.map(String).includes(String(bulk._id)));
  const mk = (role, n) => User.create({ name: n, email: `${n}${Date.now()}@x.test`, password: 'x', type: 'dealer',
    parent_id: DEALER, role });
  const repUser = await mk(rep._id, 'rep');
  const mgrUser = await mk(mgr._id, 'mgr');
  assert.equal(await canReassign(repUser, 1), true);
  assert.equal(await canReassign(repUser, 2), false);
  assert.equal(await canReassign(mgrUser, 25), true);
  assert.equal(await canReassign({ type: 'dealer', parent_id: null, _id: DEALER }, 50), true, 'the dealership account');
});

db('#23 pause a dealership: reason required, its staff are refused, history kept; reactivate lets them in again', async () => {
  const shop = await User.create({ name: 'Victory', email: `v${Date.now()}@x.test`, password: 'x', type: 'dealer' });
  const staff = await User.create({ name: 'Mercy', email: `s${Date.now()}@x.test`, password: 'x', type: 'dealer', parent_id: shop._id });
  assert.equal(await dealershipBlockedMessage(staff), null);
  assert.equal((await setDealershipState({ dealerId: shop._id, state: 'paused', reason: '' })).status, 400);
  assert.equal((await setDealershipState({ dealerId: staff._id, state: 'paused', reason: 'x' })).status, 404, 'staff are not dealerships');
  assert.equal((await setDealershipState({ dealerId: shop._id, state: 'paused', reason: 'Unpaid invoice', byName: 'Betsy' })).ok, true);
  assert.equal(await dealershipBlockedMessage(staff), PAUSED_MESSAGE);
  assert.equal(await dealershipBlockedMessage(await User.findById(shop._id).lean()), PAUSED_MESSAGE);
  await setDealershipState({ dealerId: shop._id, state: 'active', byName: 'Betsy' });
  assert.equal(await dealershipBlockedMessage(staff), null);
  const h = (await User.findById(shop._id).lean()).account_status_history;
  assert.deepEqual(h.map((x) => [x.from, x.to, x.by_name]), [['active', 'paused', 'Betsy'], ['paused', 'active', 'Betsy']]);
  assert.equal(h[0].reason, 'Unpaid invoice');
});
