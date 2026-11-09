// Dashboard "Customer replies by lead age" / "Appointments made" links: /api/leads?reply_cohort= / ?appt_attribution=
// list exactly the leads behind each number (app/lib/reporting/drillLeads.js), CSV = list, admins only, and the
// existing links unchanged. MongoDB tests use their own local database (dashlinks_test: created once, collections
// cleared between tests; skipped when MongoDB is not reachable). No email, SMS or AI-service call is made.
// Run: node --test test-dashboard-links.js
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

process.env.MONGODB_URI = process.env.DASHLINKS_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/dashlinks_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.MONGODB_URI)) {
  throw new Error(`refusing non-local test DB ${process.env.MONGODB_URI}`);
}
process.env.JWT_SECRET = 'dashlinks-test-jwt-secret';
delete process.env.FEATURE_TEST_DEALERS;
delete process.env.CRM_LIVE_DB;

const { default: mongoose } = await import('mongoose');
const { default: jwt } = await import('jsonwebtoken');
const { default: moment } = await import('moment-timezone');
const { default: User } = await import('./app/models/User.js');
const { default: Lead } = await import('./app/models/Lead.js');
const { default: Email } = await import('./app/models/Email.js');
const { default: Booking } = await import('./app/models/Booking.js');
const { default: Customer } = await import('./app/models/Customer.js');
const { repliedLeadIds } = await import('./app/lib/contactedLeads.js');
const { localDayRange } = await import('./app/lib/reporting/time.js');
const { REPLY_COHORTS, APPT_ATTRIBUTION, replyCohortLeads } = await import('./app/lib/reporting/drillLeads.js');
const leadsRoute = await import('./app/api/leads/route.js');
const replyRoute = await import('./app/api/reports/reply-cohorts/route.js');
const splitRoute = await import('./app/api/reports/appointment-split/route.js');

const NY = 'America/New_York';
const DAY = '2026-11-05';
const at = (local) => moment.tz(local, 'YYYY-MM-DD HH:mm', NY).toDate();
const daysBefore = (n, hm = '09:00') => at(`${moment(DAY).subtract(n, 'days').format('YYYY-MM-DD')} ${hm}`);
const id = (n) => new mongoose.Types.ObjectId(`66f0000000000000000e${String(n).padStart(4, '0')}`);
const ADMIN = id(1), DEALER_A = id(2), DEALER_B = id(3), STAFF_A = id(4);
const bearer = (userId, extra = {}) => ({
  Authorization: `Bearer ${jwt.sign({ userId: String(userId), ...extra }, process.env.JWT_SECRET)}` });
const LOGIN_AS = () => bearer(DEALER_A, { impersonated_by: String(ADMIN), impersonator_type: 'admin' });
const instants = (from = DAY, to = from) => localDayRange(from, to, NY);
// The dashboard's link params (page.js getRangeParams) and the section's report params.
const listRange = (from, to) => {
  const { start, end } = instants(from, to);
  return `startDate=${encodeURIComponent(start.toISOString())}&endDate=${encodeURIComponent(end.toISOString())}`;
};
const reportRange = (from, to) => {
  const { start, end } = instants(from, to);
  return `start_date=${start.toISOString()}&end_date=${end.toISOString()}`;
};
const call = (route, path, headers = {}) => route.GET(new Request(`http://localhost:3000${path}`, { headers }));

async function list(params, headers = bearer(ADMIN)) {
  const res = await call(leadsRoute, `/api/leads?dealer_id=${DEALER_A}&limit=100&${params}`, headers);
  assert.equal(res.status, 200);
  return res.json();
}
async function csvRows(params, headers = bearer(ADMIN)) {
  const res = await call(leadsRoute, `/api/leads?format=csv&dealer_id=${DEALER_A}&${params}`, headers);
  assert.equal(res.status, 200);
  const lines = (await res.text()).split('\n').filter(Boolean);
  return lines.length ? lines.length - 1 : 0; // header line, then one per lead
}
async function section(from = DAY, to = from) {
  const r = await call(replyRoute, `/api/reports/reply-cohorts?dealer_id=${DEALER_A}&${reportRange(from, to)}`,
    bearer(ADMIN));
  assert.equal(r.status, 200);
  return r.json();
}
async function splitTotals(from = DAY, to = from) {
  const r = await call(splitRoute, `/api/reports/appointment-split?dealer_id=${DEALER_A}&${reportRange(from, to)}`,
    bearer(ADMIN));
  assert.equal(r.status, 200);
  return (await r.json()).totals;
}
// The number on each card / bar, as ReplyCohortsSection shows it.
const cardNumber = (d, key) => ({
  today: d.totals.todays_leads_replied, past: d.totals.past_leads_replied, all: d.totals.customers_replied,
  d7: d.cumulative.d7, d15: d.cumulative.d15, d30: d.cumulative.d30, d60: d.cumulative.d60,
  b0: d.buckets.d0, b1_6: d.buckets.d1_6, b7_14: d.buckets.d7_14, b15_29: d.buckets.d15_29,
  b30_59: d.buckets.d30_59, b60: d.buckets.d60_plus,
}[key]);

// --- pure ------------------------------------------------------------------------------------------------------

test('replyCohortLeads: one lead per unit (latest reply), needs review counted but not listed', () => {
  const report = {
    units: [{ unit_key: 'c1|d', bucket: 'd15_29' }, { unit_key: 'c2|d', bucket: 'needs_review' },
      { unit_key: 'c3|d', bucket: 'd0' }],
    rows: [
      { unit_key: 'c1|d', lead_id: 'A', reply_at: at('2026-11-05 09:00') },
      { unit_key: 'c1|d', lead_id: 'B', reply_at: at('2026-11-05 11:00') },
      { unit_key: 'c2|d', lead_id: null, reply_at: at('2026-11-05 10:00') },
      { unit_key: 'c3|d', lead_id: 'C', reply_at: at('2026-11-05 10:00') },
    ],
  };
  assert.deepEqual(replyCohortLeads(report, 'b15_29'), { card_count: 1, lead_ids: ['B'], needs_review: 0, repeat_days: 0 });
  assert.deepEqual(replyCohortLeads(report, 'all'), { card_count: 3, lead_ids: ['B', 'C'], needs_review: 1, repeat_days: 0 });
  assert.equal(replyCohortLeads(report, 'nope'), null);
});

// --- MongoDB ---------------------------------------------------------------------------------------------------

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
  await User.collection.insertMany([
    { _id: ADMIN, email: 'admin@t.test', name: 'Admin', password: 'x', type: 'admin' },
    { _id: DEALER_A, email: 'a@t.test', name: 'Dealer A', password: 'x', type: 'dealer',
      dealer_account_information: { time_zone: NY } },
    { _id: DEALER_B, email: 'b@t.test', name: 'Dealer B', password: 'x', type: 'dealer' },
    { _id: STAFF_A, email: 'sa@t.test', name: 'Staff A', password: 'x', type: 'dealer', parent_id: DEALER_A },
  ]);
});
const maybe = (name, fn) => test(name, async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  return fn(t);
});

async function seedLead(createdAt, extra = {}) {
  const _id = new mongoose.Types.ObjectId();
  await Lead.collection.insertOne({ _id, dealer_id: String(DEALER_A), name: `Lead ${_id}`, createdAt,
    updatedAt: createdAt, ...extra });
  return _id;
}
async function seedEmail(leadId, timestamp, extra = {}) {
  const _id = new mongoose.Types.ObjectId();
  await Email.collection.insertOne({ _id, dealer_id: String(DEALER_A), lead_id: leadId, timestamp, date: timestamp,
    sender: '+15550001111', status: 'received', communication_type: 'sms', mail_content: 'hi', is_note: false,
    message_id: `SM${_id}`, ...extra });
  return _id;
}
const booking = (leadId, createdBy, extra = {}) => Booking.collection.insertOne({ dealer_id: String(DEALER_A),
  lead_id: String(leadId), customerName: 'C', bookingDate: at('2026-11-08 00:00'), bookingTime: '10:00',
  booking_status: 'pending', createdAt: at(`${DAY} 12:00`), updatedAt: at(`${DAY} 12:00`),
  ...(createdBy ? { created_by: createdBy } : {}), ...extra });

// Replies on DAY in every age group, two needs-review customers, a customer with two leads in one group, a lead
// that didn't reply and another dealer's lead.
async function seedReplies() {
  const leads = {};
  for (const [name, age] of [['l0', 0], ['l3', 3], ['l10', 10], ['l20', 20], ['l45', 45], ['l90', 90], ['l91', 91]]) {
    leads[name] = await seedLead(daysBefore(age, age === 0 ? '08:00' : '09:00'));
    await seedEmail(leads[name], at(`${DAY} 10:00`));
  }
  // One customer, two leads 20 and 22 days old, both replied on DAY: one customer on the card, one lead listed.
  const cust = new mongoose.Types.ObjectId();
  await Customer.collection.insertOne({ _id: cust, dealer_id: String(DEALER_A), name: 'Two Leads' });
  leads.c1 = await seedLead(daysBefore(20), { customer_id: cust });
  leads.c2 = await seedLead(daysBefore(22), { customer_id: cust });
  await seedEmail(leads.c1, at(`${DAY} 09:00`), { sender: '+15550002222' });
  await seedEmail(leads.c2, at(`${DAY} 11:00`), { sender: '+15550002222' });
  // Needs review: no lead linked; a lead that doesn't exist.
  await seedEmail(null, at(`${DAY} 10:30`), { sender: '+15550003333' });
  await seedEmail(new mongoose.Types.ObjectId(), at(`${DAY} 10:40`), { sender: '+15550004444' });
  // Not counted: no reply; reply outside the range; other dealer.
  leads.quiet = await seedLead(daysBefore(5));
  leads.later = await seedLead(daysBefore(5));
  await seedEmail(leads.later, at('2026-11-07 10:00'));
  const other = new mongoose.Types.ObjectId();
  await Lead.collection.insertOne({ _id: other, dealer_id: String(DEALER_B), name: 'B', createdAt: daysBefore(40) });
  await seedEmail(other, at(`${DAY} 10:00`), { dealer_id: String(DEALER_B) });
  return leads;
}

maybe('reply_cohort: every card and bar lists exactly the leads behind its number; CSV rows = list', async () => {
  const leads = await seedReplies();
  const d = await section();
  assert.equal(d.totals.needs_review, 2);
  assert.equal(d.totals.customers_replied, 10);
  for (const key of Object.keys(REPLY_COHORTS)) {
    const params = `reply_cohort=${key}&${listRange(DAY)}`;
    const body = await list(params);
    const expected = cardNumber(d, key) - (key === 'all' ? d.totals.needs_review : 0);
    assert.equal(body.pagination.totalItems, expected, `${key}: list total`);
    assert.equal(body.data.length, expected, `${key}: rows`);
    assert.equal(await csvRows(params), expected, `${key}: CSV rows`);
    const f = body.drill.filters[0];
    assert.equal(f.param, 'reply_cohort');
    assert.equal(f.card_count, cardNumber(d, key), `${key}: card count in the chip`);
    assert.deepEqual(body.drill.range, { from: DAY, to: DAY });
    if (key === 'all') assert.match(f.note, /2 customers need review/);
    else assert.equal(f.note, '');
  }
  // The two-lead customer: the lead of the later reply that day.
  const b15 = (await list(`reply_cohort=b15_29&${listRange(DAY)}`)).data.map((l) => String(l._id)).sort();
  assert.deepEqual(b15, [leads.l20, leads.c2].map(String).sort());
  const ids = (await list(`reply_cohort=d60&${listRange(DAY)}`)).data.map((l) => String(l._id)).sort();
  assert.deepEqual(ids, [leads.l90, leads.l91].map(String).sort());
  // "Login as" sees it too; combined with the other filters as usual.
  assert.equal((await list(`reply_cohort=d60&${listRange(DAY)}`, LOGIN_AS())).pagination.totalItems, 2);
  await Lead.collection.updateOne({ _id: leads.l90 }, { $set: { name: 'Zed Unique' } });
  assert.equal((await list(`reply_cohort=d60&name=Zed&${listRange(DAY)}`)).pagination.totalItems, 1);
});

maybe('reply_cohort over several days: card counts customer-days, the list each lead once and says so', async () => {
  const lead = await seedLead(daysBefore(40));
  await seedEmail(lead, at('2026-11-04 10:00'));
  await seedEmail(lead, at('2026-11-05 10:00'));
  const d = await section('2026-11-04', DAY);
  assert.equal(d.cumulative.d30, 2);
  const params = `reply_cohort=d30&${listRange('2026-11-04', DAY)}`;
  const body = await list(params);
  assert.equal(body.pagination.totalItems, 1);
  assert.equal(await csvRows(params), 1);
  assert.equal(body.drill.filters[0].card_count, 2);
  assert.match(body.drill.filters[0].note, /1 repeat day of the same lead is listed once/);
});

maybe('appt_attribution: each figure lists its bookings\' leads; CSV rows = list', async () => {
  const leads = {};
  for (const n of ['ai', 'assist', 'human', 'cust', 'none']) leads[n] = await seedLead(daysBefore(10));
  await seedEmail(leads.assist, at('2026-11-04 09:00'), { status: 'delivered', ai_generated: true });
  await booking(leads.ai, 'ai');
  await booking(leads.assist, 'staff');
  await booking(leads.human, 'staff');
  await booking(leads.cust, 'customer');
  await booking(leads.none, null);
  // Created outside the range: not counted.
  await booking(await seedLead(daysBefore(10)), 'ai', { createdAt: at('2026-11-07 12:00') });
  const totals = await splitTotals();
  assert.deepEqual([totals.ai, totals.ai_assisted, totals.human_only, totals.unknown], [1, 1, 1, 2]);
  for (const key of Object.keys(APPT_ATTRIBUTION)) {
    const params = `appt_attribution=${key}&${listRange(DAY)}`;
    const body = await list(params);
    assert.equal(body.pagination.totalItems, totals[key], `${key}: list total`);
    assert.equal(await csvRows(params), totals[key], `${key}: CSV rows`);
    assert.equal(body.drill.filters[0].card_count, totals[key]);
    assert.equal(body.drill.filters[0].note, '');
  }
  const ai = (await list(`appt_attribution=ai&${listRange(DAY)}`)).data.map((l) => String(l._id));
  assert.deepEqual(ai, [String(leads.ai)]);
});

maybe('appt_attribution: a booking with no lead and two bookings on one lead are counted, not invented', async () => {
  const lead = await seedLead(daysBefore(10));
  await booking(lead, 'staff', { bookingTime: '09:00' });
  await booking(lead, 'staff', { bookingTime: '11:00' }); // a different slot: not a duplicate
  await booking(new mongoose.Types.ObjectId(), 'staff'); // lead gone -> unknown
  const totals = await splitTotals();
  assert.equal(totals.human_only, 2);
  assert.equal(totals.unknown, 1);
  let body = await list(`appt_attribution=human_only&${listRange(DAY)}`);
  assert.equal(body.pagination.totalItems, 1);
  assert.match(body.drill.filters[0].note, /1 more booking is on a lead already listed/);
  body = await list(`appt_attribution=unknown&${listRange(DAY)}`);
  assert.equal(body.pagination.totalItems, 0);
  assert.equal(await csvRows(`appt_attribution=unknown&${listRange(DAY)}`), 0);
  assert.match(body.drill.filters[0].note, /1 booking has no lead in the list/);
});

maybe('dealer-only caller (dealer, staff): the params are ignored and the list is unchanged', async () => {
  await seedReplies();
  await booking(await seedLead(at(`${DAY} 08:30`)), 'ai');
  for (const who of [DEALER_A, STAFF_A]) {
    const plain = await list(listRange(DAY), bearer(who));
    for (const params of ['reply_cohort=d60', 'reply_cohort=all', 'appt_attribution=ai']) {
      const body = await list(`${params}&${listRange(DAY)}`, bearer(who));
      assert.equal(body.drill, undefined);
      assert.equal(body.pagination.totalItems, plain.pagination.totalItems);
      assert.deepEqual(body.data.map((l) => String(l._id)), plain.data.map((l) => String(l._id)));
      assert.equal(await csvRows(`${params}&${listRange(DAY)}`, bearer(who)), await csvRows(listRange(DAY), bearer(who)));
    }
  }
  // An unknown value is ignored for an admin too.
  const plain = await list(listRange(DAY));
  const odd = await list(`reply_cohort=nope&${listRange(DAY)}`);
  assert.equal(odd.drill, undefined);
  assert.equal(odd.pagination.totalItems, plain.pagination.totalItems);
});

maybe('existing link: status=Contacted with the range lists who replied in it, as before (admin and dealer)', async () => {
  const leads = await seedReplies();
  const all = (await Lead.find({ dealer_id: String(DEALER_A) }).select('_id').lean()).map((l) => l._id);
  const { start, end } = instants(DAY);
  const expected = (await repliedLeadIds(all, start, end)).map((r) => String(r._id));
  assert.ok(expected.length >= 9 && !expected.includes(String(leads.later)) && !expected.includes(String(leads.quiet)));
  for (const who of [ADMIN, DEALER_A]) {
    const params = `fe_lead_status=Contacted&${listRange(DAY)}`;
    const body = await list(params, bearer(who));
    assert.equal(body.drill, undefined);
    assert.deepEqual(body.data.map((l) => String(l._id)).sort(), [...expected].sort()); // replies tie at 10:00
    assert.equal(body.pagination.totalItems, expected.length);
    assert.equal(await csvRows(params, bearer(who)), expected.length);
  }
});
