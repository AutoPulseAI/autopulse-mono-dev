// Desk Log (Priority 3; app/lib/deskLog, app/api/desk-log): edit rules (stages not linear, unsold needs a reason,
// Future Follow-Up needs a date, history of every change), the outcome -> lead status mapping, check-in, the list and
// its manager views, who may use it, the cards, and the Desk Log numbers in the reports (visits in Betsy's source
// table, T.O. rate, appraisal to proposal).
//
// Uses its own local MongoDB database (desklog_test, cleared before each test, dropped at the end; DB tests are
// skipped when MongoDB is not reachable).
//   Run: node --test test-desk-log.js
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
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

const URI = process.env.DESK_LOG_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/desklog_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) throw new Error(`refusing non-local test DB ${URI}`);
process.env.MONGODB_URI = URI;
process.env.JWT_SECRET = 'desk-log-test-secret';
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
delete process.env.FEATURE_TEST_DEALERS;

const { default: mongoose } = await import('mongoose');
const { default: jwt } = await import('jsonwebtoken');
const { default: moment } = await import('moment-timezone');
const { default: User } = await import('./app/models/User.js');
const { default: DeskLogEntry } = await import('./app/models/DeskLogEntry.js');
const { STAGES, UNSOLD_REASONS, leadStatusForOutcome, planChanges } = await import('./app/lib/deskLog/deskLog.js');
const { deskLogList } = await import('./app/lib/deskLog/list.js');
const { deskLogCards } = await import('./app/lib/deskLog/cards.js');
const { evaluateKpi } = await import('./app/lib/reporting/registry.js');
const { sourcePerformance } = await import('./app/lib/reporting/sourcePerformance.js');
const listRoute = await import('./app/api/desk-log/route.js');
const oneRoute = await import('./app/api/desk-log/[id]/route.js');
const searchRoute = await import('./app/api/desk-log/customers/route.js');

const { ObjectId } = mongoose.Types;
const id = (n) => new ObjectId(`66f0000000000000000d${String(n).padStart(4, '0')}`);
const ADMIN = id(1), DEALER = id(2), STAFF = id(3), OTHER_DEALER = id(4), SP = id(5), MGR = id(6);
const L = { web: id(11), walk: id(12), phone: id(13), other: id(14) };
const NY = 'America/New_York';
const DAY = '2026-11-05';
const at = (local) => moment.tz(local, 'YYYY-MM-DD HH:mm', NY).toDate();
const sign = (claims) => jwt.sign(claims, process.env.JWT_SECRET);
const ADMIN_IN_DEALER = () => sign({ userId: String(DEALER), impersonated_by: String(ADMIN), impersonator_type: 'admin' });
const DEALER_TOKEN = () => sign({ userId: String(DEALER) });
const req = (url, token, init = {}) => new Request(`http://localhost${url}`, { ...init,
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });

// ---- rules (no database) ----

test('stages: any order, optional, unknown refused; every change goes to history', () => {
  const now = new Date('2026-11-05T15:00:00Z');
  let plan = planChanges({ stage: 'QUALIFY' }, { stage: 'APPRAISAL' }, { now });
  assert.deepEqual(plan.set, { stage: 'APPRAISAL', stage_at: now });
  assert.deepEqual(plan.history, [{ field: 'stage', from: 'QUALIFY', to: 'APPRAISAL' }]);
  plan = planChanges({ stage: 'PROPOSAL' }, { stage: 'TEST DRIVE' }, { now }); // back is allowed
  assert.equal(plan.set.stage, 'TEST DRIVE');
  plan = planChanges({ stage: 'QUALIFY' }, { stage: null }, { now });
  assert.equal(plan.set.stage, null);
  assert.ok(planChanges({}, { stage: 'CLOSED' }).errors);
  assert.deepEqual(planChanges({ stage: 'QUALIFY' }, { stage: 'QUALIFY' }).history, []);
  assert.deepEqual(STAGES, ['QUALIFY', 'TEST DRIVE', 'APPRAISAL', 'PROPOSAL', 'T.O.', 'VERBAL AGREEMENT']);
});

test('outcome: unsold needs a reason, Future Follow-Up a date; an outcome is changed, not removed', () => {
  assert.match(planChanges({}, { outcome: 'UNSOLD' }).errors[0], /unsold reason/);
  assert.match(planChanges({}, { outcome: 'UNSOLD', unsold_reason: 'Bored' }).errors[0], /unsold_reason/);
  assert.match(planChanges({}, { outcome: 'UNSOLD', unsold_reason: 'Future Follow-Up' }).errors[0], /date/);
  const ok = planChanges({}, { outcome: 'UNSOLD', unsold_reason: 'Future Follow-Up',
    next_step_at: '2026-11-08T15:00:00Z' });
  assert.equal(ok.outcomeChanged, true);
  assert.equal(ok.set.unsold_reason, 'Future Follow-Up');
  // The date of a Future Follow-Up can be moved, not removed.
  assert.ok(planChanges({ outcome: 'UNSOLD', unsold_reason: 'Future Follow-Up', next_step_at: new Date() },
    { next_step_at: null }).errors);
  assert.ok(planChanges({ outcome: 'SOLD PENDING' }, { outcome: null }).errors);
  // Sold clears the reason.
  const sold = planChanges({ outcome: 'UNSOLD', unsold_reason: 'Credit' }, { outcome: 'SOLD PENDING' });
  assert.equal(sold.set.outcome, 'SOLD PENDING');
  assert.equal(sold.set.unsold_reason, null);
  assert.equal(planChanges({ outcome: 'SOLD PENDING' }, { outcome: 'SOLD PENDING' }).outcomeChanged, false);
});

test('outcome -> lead status through the existing status route; DND is the Opt-Out status', () => {
  assert.deepEqual(leadStatusForOutcome('SOLD PENDING'), { status: 'Visited', manager_outcome: 'Sold Pending' });
  assert.deepEqual(leadStatusForOutcome('SOLD DELIVERED'), { status: 'Visited', manager_outcome: 'Sold Delivered' });
  assert.deepEqual(leadStatusForOutcome('UNSOLD', 'Credit'), { status: 'Visited', manager_outcome: 'Unsold' });
  assert.deepEqual(leadStatusForOutcome('UNSOLD', UNSOLD_REASONS.DND), { status: 'DND' });
  assert.equal(leadStatusForOutcome(null), null);
});

test('people, stock, vehicle: ids checked, only changed fields kept', () => {
  assert.ok(planChanges({}, { salesperson_id: 'nope' }).errors);
  const plan = planChanges({ vehicle: { make: 'Ford', model: 'F-150' } },
    { salesperson_id: String(SP), stock_number: ' STK1 ', vehicle: { make: 'Ford', model: 'Ranger', year: '2025' } });
  assert.equal(String(plan.set.salesperson_id), String(SP));
  assert.equal(plan.set.stock_number, 'STK1');
  assert.equal(plan.set['vehicle.model'], 'Ranger');
  assert.equal(plan.set['vehicle.year'], 2025);
  assert.ok(!('vehicle.make' in plan.set));
  assert.ok(planChanges({}, { vehicle: { year: 'abc' } }).errors);
});

// ---- database ----

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
});

const visit = (o) => ({ dealer_id: String(DEALER), department: 'sales', vehicle: {}, trade: {}, notes: [],
  history: [], ...o });

beforeEach(async () => {
  if (!connected) return;
  const db = mongoose.connection.db;
  for (const c of await db.collections()) await c.deleteMany({});
  await User.create([
    { _id: ADMIN, email: 'a@dl.test', name: 'Admin', password: 'x', type: 'admin' },
    { _id: DEALER, email: 'd@dl.test', name: 'Dealer', password: 'x', type: 'dealer',
      dealer_account_information: { time_zone: NY } },
    { _id: OTHER_DEALER, email: 'o@dl.test', name: 'Other', password: 'x', type: 'dealer',
      dealer_account_information: { time_zone: NY } },
    { _id: SP, email: 'sp@dl.test', name: 'Jessica S', password: 'x', type: 'dealer', parent_id: DEALER },
    { _id: MGR, email: 'm@dl.test', name: 'Mike K', password: 'x', type: 'dealer', parent_id: DEALER },
  ]);
  const d = String(DEALER);
  const lead = (o) => ({ dealer_id: d, fe_lead_status: 'Lead', contact_type: 'internet', ...o });
  await db.collection('leads').insertMany([
    lead({ _id: L.web, name: 'John Smith', phone: '+1 (555) 201-0001', lead_source: 'CarGurus', source: 'CarGurus',
      sub_source: 'Digital Deal', vehicle_year: 2025, vehicle_make: 'Toyota', vehicle_model: 'RAV4', assigned_to: MGR,
      createdAt: at(`${DAY} 09:00`) }),
    lead({ _id: L.walk, name: 'Maria Lopez', phone: '5552010002', lead_source: 'Walk-in', source: 'walk-in',
      contact_type: 'walk_in', createdAt: at(`${DAY} 10:00`) }),
    lead({ _id: L.phone, name: 'David Kim', phone: '5552010003', lead_source: 'Phone', source: 'phone',
      contact_type: 'phone', createdAt: at('2026-10-20 10:00') }),
    { _id: L.other, dealer_id: String(OTHER_DEALER), name: 'Not Ours', createdAt: at(`${DAY} 10:00`) },
  ]);
  await db.collection('tradeins').insertOne({ dealer_id: d, customer_id: id(90), lead_id: L.web, year: 2022,
    make: 'Toyota', model: 'Camry', status: 'open', createdAt: new Date(), updatedAt: new Date() });
  await DeskLogEntry.insertMany([
    visit({ _id: id(21), lead_id: L.web, checked_in_at: at(`${DAY} 11:00`), stage: 'PROPOSAL',
      stage_at: at(`${DAY} 12:00`), salesperson_id: SP,
      history: [{ field: 'stage', from: null, to: 'APPRAISAL', at: at(`${DAY} 11:10`) },
        { field: 'stage', from: 'APPRAISAL', to: 'PROPOSAL', at: at(`${DAY} 12:00`) }] }),
    visit({ _id: id(22), lead_id: L.walk, checked_in_at: at(`${DAY} 13:00`), stage: 'T.O.', stage_at: at(`${DAY} 13:30`),
      outcome: 'UNSOLD', unsold_reason: 'Price/Payment', history: [{ field: 'stage', to: 'T.O.', at: at(`${DAY} 13:30`) }] }),
    visit({ _id: id(23), lead_id: L.phone, checked_in_at: at(`${DAY} 14:00`), outcome: 'SOLD PENDING' }),
    visit({ _id: id(24), lead_id: L.web, checked_in_at: at('2026-11-02 10:00'), outcome: 'UNSOLD',
      unsold_reason: 'DND' }),
    { ...visit({ _id: id(25), lead_id: L.other, checked_in_at: at(`${DAY} 11:00`) }), dealer_id: String(OTHER_DEALER) },
  ]);
});

test('list: the day\'s visits of this dealer, with lead, people, filters and manager views', async (t) => {
  if (needDb(t)) return;
  const now = at(`${DAY} 15:00`);
  const base = { dealerId: String(DEALER), tz: NY, from: DAY, to: DAY, now };
  const all = await deskLogList(base);
  assert.deepEqual(all.rows.map((r) => r.customer), ['David Kim', 'Maria Lopez', 'John Smith']);
  const john = all.rows.find((r) => r.customer === 'John Smith');
  assert.equal(john.lead_type, 'Internet');
  assert.equal(john.source, 'CarGurus');
  assert.equal(john.salesperson, 'Jessica S');
  assert.equal(john.minutes_in_stage, 180);
  assert.deepEqual((await deskLogList({ ...base, filters: { lead_type: 'Walk-in' } })).rows.map((r) => r.customer),
    ['Maria Lopez']);
  assert.deepEqual((await deskLogList({ ...base, filters: { salesperson_id: String(SP) } })).rows
    .map((r) => r.customer), ['John Smith']);
  assert.deepEqual((await deskLogList({ ...base, view: 'open' })).rows.map((r) => r.customer), ['John Smith']);
  assert.deepEqual((await deskLogList({ ...base, view: 'stalled' })).rows.map((r) => r.customer), ['John Smith']);
  assert.deepEqual((await deskLogList({ ...base, view: 'unsold_follow_up' })).rows.map((r) => r.customer),
    ['Maria Lopez']);
  assert.deepEqual((await deskLogList({ ...base, q: '201-0003' })).rows.map((r) => r.customer), ['David Kim']);
  // DND unsold (2 Nov) is not on the "to follow up" list.
  assert.deepEqual((await deskLogList({ ...base, from: '2026-11-01', view: 'unsold_follow_up' })).rows
    .map((r) => r.customer), ['Maria Lopez']);
});

test('API: only where the feature is visible (admin / login as); another dealer\'s visit is not found', async (t) => {
  if (needDb(t)) return;
  const q = `/api/desk-log?dealer_id=${DEALER}&start_date=${DAY}&end_date=${DAY}`;
  assert.equal((await listRoute.GET(req(q, DEALER_TOKEN()))).status, 404);
  const ok = await listRoute.GET(req(`${q}&cards=1`, ADMIN_IN_DEALER()));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.rows.length, 3);
  assert.ok(body.cards.cards.find((c) => c.key === 'walk_in'));
  assert.equal((await listRoute.GET(req(`${q}&view=nope`, ADMIN_IN_DEALER()))).status, 400);
  const otherVisit = await oneRoute.GET(req(`/api/desk-log/${id(25)}`, ADMIN_IN_DEALER()),
    { params: Promise.resolve({ id: String(id(25)) }) });
  assert.equal(otherVisit.status, 404);
  const search = await searchRoute.GET(req(`/api/desk-log/customers?dealer_id=${DEALER}&q=555%20201`,
    ADMIN_IN_DEALER()));
  assert.deepEqual((await search.json()).leads.map((l) => l.name).sort(), ['David Kim', 'John Smith', 'Maria Lopez']);
});

test('check in: filled from the lead (vehicle, BDC owner, open trade-in); another dealer\'s lead refused', async (t) => {
  if (needDb(t)) return;
  const post = (body) => listRoute.POST(req('/api/desk-log', ADMIN_IN_DEALER(), { method: 'POST',
    body: JSON.stringify({ dealer_id: String(DEALER), ...body }) }));
  const res = await post({ lead_id: String(L.web), salesperson_id: String(SP), stage: 'QUALIFY', note: 'Wants AWD' });
  assert.equal(res.status, 201);
  const e = await DeskLogEntry.findById((await res.json()).entry.id).lean();
  assert.equal(e.vehicle.model, 'RAV4');
  assert.equal(e.trade.model, 'Camry');
  assert.equal(String(e.bdc_agent_id), String(MGR));
  assert.equal(e.stage, 'QUALIFY');
  assert.equal(e.notes[0].text, 'Wants AWD');
  assert.deepEqual(e.history.map((h) => h.field), ['checked_in', 'stage']);
  assert.equal((await post({ lead_id: String(L.other) })).status, 404);
  assert.equal((await post({ lead_id: String(L.web), outcome: 'SOLD PENDING' })).status, 201); // outcome ignored
  assert.equal((await post({ lead_id: String(L.web), checked_in_at: '2099-01-01T00:00:00Z' })).status, 400);
});

test('edit: stage and people saved with who and when; nothing changed = nothing saved', async (t) => {
  if (needDb(t)) return;
  const patch = (body) => oneRoute.PATCH(req(`/api/desk-log/${id(21)}`, ADMIN_IN_DEALER(), { method: 'PATCH',
    body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(id(21)) }) });
  let res = await patch({ stage: 'T.O.', sales_manager_id: String(MGR), note: 'Manager on it' });
  assert.equal(res.status, 200);
  const e = await DeskLogEntry.findById(id(21)).lean();
  assert.equal(e.stage, 'T.O.');
  assert.equal(String(e.sales_manager_id), String(MGR));
  const last = e.history.slice(-2);
  assert.deepEqual(last.map((h) => [h.field, h.from, String(h.to)]), [['stage', 'PROPOSAL', 'T.O.'],
    ['sales_manager_id', null, String(MGR)]]);
  assert.equal(String(last[0].by), String(DEALER));
  assert.equal(e.notes.at(-1).text, 'Manager on it');
  res = await patch({ stage: 'T.O.' });
  assert.equal((await res.json()).changed, false);
  assert.equal((await patch({ outcome: 'UNSOLD' })).status, 400);
});

test('outcome: changes the lead status through the existing route, then saves; same status not sent twice',
  async (t) => {
    if (needDb(t)) return;
    const patch = (visitId, body) => oneRoute.PATCH(req(`/api/desk-log/${visitId}`, ADMIN_IN_DEALER(), {
      method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(visitId) }) });
    const res = await patch(id(21), { outcome: 'SOLD PENDING' });
    assert.equal(res.status, 200, await res.clone().text());
    const lead = await mongoose.connection.db.collection('leads').findOne({ _id: L.web });
    assert.equal(lead.fe_lead_status, 'Sold Pending');
    assert.equal((await DeskLogEntry.findById(id(21)).lean()).outcome, 'SOLD PENDING');
    // Price/Payment -> Credit: the lead stays "Unsold"; the status route is not called again.
    const before = await mongoose.connection.db.collection('leads').findOne({ _id: L.walk });
    const res2 = await patch(id(22), { outcome: 'UNSOLD', unsold_reason: 'Credit' });
    assert.equal(res2.status, 200);
    const afterLead = await mongoose.connection.db.collection('leads').findOne({ _id: L.walk });
    assert.equal(afterLead.fe_lead_status, before.fe_lead_status);
    assert.equal((await DeskLogEntry.findById(id(22)).lean()).unsold_reason, 'Credit');
  });

test('reports: visits fill Betsy\'s Visits column; T.O. rate and appraisal to proposal from the Desk Log', async (t) => {
  if (needDb(t)) return;
  const args = { dealerId: String(DEALER), from: DAY, to: DAY, tz: NY };
  const visits = await evaluateKpi('sales.showroom_visits', args, {});
  assert.equal(visits.state, 'live');
  assert.equal(visits.count, 3);
  assert.ok(visits.breakdowns.outcome);
  const to = await evaluateKpi('sales.to_rate', args, {});
  assert.equal(to.numerator.count, 1);
  assert.equal(to.denominator.count, 3);
  const ap = await evaluateKpi('sales.appraisal_to_proposal', args, {});
  assert.equal(ap.numerator.count, 1);
  assert.equal(ap.denominator.count, 1);
  const unsold = await evaluateKpi('sales.unsold_reasons', args, {});
  assert.equal(unsold.count, 1);

  const timeframe = await sourcePerformance(args, { basis: 'timeframe' });
  assert.equal(timeframe.rows[0].visits, 3);
  const walkIn = timeframe.rows.find((r) => r.level === 'type' && r.up_type === 'Walk-in');
  assert.equal(walkIn.visits, 1);
  // The phone lead came in last month: its visit counts in the timeframe, not among current leads.
  const current = await sourcePerformance(args, { basis: 'current' });
  assert.equal(current.rows[0].visits, 2);
});

test('cards: today and month to date, by lead type', async (t) => {
  if (needDb(t)) return;
  const { cards } = await deskLogCards(String(DEALER), NY, DAY);
  const card = (k) => cards.find((c) => c.key === k);
  assert.deepEqual([card('internet').today, card('walk_in').today, card('phone').today], [1, 1, 0]);
  assert.equal(card('phone').mtd, 0); // its lead came in on 20 Oct
  assert.equal(cards.length, 9);
});
