// Client meeting 25 Nov 2026 (planning/MEETING-25-NOV-ACTIONS.md): the items built from it.
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
