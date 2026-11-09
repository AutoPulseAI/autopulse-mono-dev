// The Reports page (P1 plan items 1, 4, 5): every live KPI's number equals its drill-down ids and its CSV rows for
// the same filters; dealer-local date boundaries; who may call /api/reports/kpis; blocked / needs-data KPIs return a
// state, never a number; the status normaliser; the legacy-status script's dry run changes nothing.
//
// Uses its own local MongoDB database (reportspage_test, wiped before each test, dropped at the end; skipped when
// MongoDB is not reachable) and its own Redis database for the cache test (REPORTS_TEST_REDIS_DB, default 13).
//   Run: node --test test-reports-page.js
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

const URI = process.env.REPORTS_PAGE_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/reportspage_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) throw new Error(`refusing non-local test DB ${URI}`);
process.env.MONGODB_URI = URI;
process.env.JWT_SECRET = 'reports-page-test-secret';
process.env.REDIS_HOST = process.env.REPORTS_TEST_REDIS_HOST || '127.0.0.1';
process.env.REDIS_PORT = process.env.REPORTS_TEST_REDIS_PORT || '6380';
process.env.REDIS_DB = process.env.REPORTS_TEST_REDIS_DB || '13';
delete process.env.REDIS_URL;
delete process.env.REPORTS_CACHE;
delete process.env.FEATURE_TEST_DEALERS;
delete process.env.CRM_LIVE_DB;

const { default: mongoose } = await import('mongoose');
const { default: jwt } = await import('jsonwebtoken');
const { default: moment } = await import('moment-timezone');
const { default: Redis } = await import('ioredis');
const { default: User } = await import('./app/models/User.js');
const route = await import('./app/api/reports/kpis/route.js');
const { closeCache, CACHE_PREFIX } = await import('./app/api/reports/kpis/cache.js');
const { listKpis, getKpi, runKpi, evaluateKpi, kpisForDashboard, listDashboards } = await import(
  './app/lib/reporting/registry.js');
const norm = await import('./app/lib/reporting/normalize.js');
const { normalizeLegacyStatuses, isLocalUri } = await import('./scripts/normalize-legacy-statuses.js');

const { ObjectId } = mongoose.Types;
const id = (n) => new ObjectId(`66f0000000000000000a${String(n).padStart(4, '0')}`);
const ADMIN = id(1), DEALER = id(2), OTHER = id(3), STAFF = id(4), STAFF2 = id(5);
const NY = 'America/New_York';
const DAY = '2026-11-05';
const at = (local) => moment.tz(local, 'YYYY-MM-DD HH:mm:ss', NY).toDate();
const token = (userId, extra = {}) => jwt.sign({ userId: String(userId), ...extra }, process.env.JWT_SECRET);
const auth = (userId, extra) => ({ Authorization: `Bearer ${token(userId, extra)}` });
const call = (qs, headers = {}) => route.GET(new Request(`http://localhost/api/reports/kpis?${qs}`, { headers }));
const base = (extra = '') => `dealer_id=${DEALER}&start_date=${DAY}&end_date=${DAY}${extra}`;

// Count CSV records (quoted fields may hold commas; the route turns line breaks into spaces).
const csvRows = (text) => text.split('\r\n').filter(Boolean).length - 1;

// --- pure: normaliser --------------------------------------------------------------------------------------------

test('normaliser: governed values stay, legacy spellings map, ambiguous ones need a person', () => {
  for (const s of norm.GOVERNED_STATUSES) {
    const n = norm.normalizeStatus(s);
    assert.equal(n.legacy, false, s);
    assert.equal(n.governed, s);
    assert.equal(n.fix, null);
  }
  const cases = [
    ['visited', 'Visited', 'VISITED'], ['VISITED ', 'Visited', 'VISITED'], ['Contacted', 'Contacted - No Next Action',
      'WORKING'], ['New', 'Lead', 'NEW'], ['Closed Lost', 'Closed - Lost', 'CLOSED_LOST'],
    ['Appointment Set', 'Appointment Booked', 'APPT_SET'], ['Sales Visit', 'Visited', 'VISITED'],
    ['Opt-Out', 'DND', 'OPTED_OUT'], ['sold  pending', 'Sold Pending', 'SOLD_PENDING'],
  ];
  for (const [raw, fix, group] of cases) {
    const n = norm.normalizeStatus(raw);
    assert.equal(n.legacy, true, raw);
    assert.equal(n.fix, fix, raw);
    assert.equal(n.group, group, raw);
  }
  const sold = norm.normalizeStatus('Sold');
  assert.equal(sold.fix, null);
  assert.equal(sold.needs_review, true);
  assert.equal(sold.group, 'SOLD_UNSPECIFIED');
  assert.ok(norm.isSoldGroup(sold.group));
  assert.equal(norm.normalizeStatus('Deal Close').fix, null);
  assert.equal(norm.normalizeStatus('Banana').group, 'UNKNOWN');
  assert.equal(norm.normalizeStatus(null).needs_review, true);
  // Opted Out and DND are both governed (the AI treats them differently) and report as one group.
  assert.equal(norm.statusGroup('Opted Out'), norm.statusGroup('DND'));
  assert.equal(norm.normalizeStatus('Opted Out').fix, null);
  const re = norm.statusRegexFor(['VISITED']);
  for (const v of ['Visited', 'visited', ' Sales  Visit ']) assert.ok(re.test(v), v);
  assert.ok(!re.test('Visited later'));
  assert.equal(norm.aiStageGroup('sold_pending'), 'SOLD_PENDING');
});

test('normaliser: sources roll up to one provider name; channels are separate', () => {
  assert.equal(norm.normalizeProvider('CarGurus'), 'CarGurus');
  assert.equal(norm.normalizeProvider('cargurus.com lead'), 'CarGurus');
  assert.equal(norm.normalizeProvider('Cars.com'), 'Cars.com');
  assert.equal(norm.normalizeProvider('campaign_Spring'), 'Campaign');
  assert.equal(norm.normalizeProvider(null, 'email'), 'Unknown');
  assert.equal(norm.normalizeProvider('', 'Autotrader'), 'Autotrader');
  assert.equal(norm.normalizeProvider('unknown'), 'Unknown');
  assert.equal(norm.normalizeChannel({ source: 'csv_import_auto' }), 'csv_import');
  assert.equal(norm.normalizeChannel({ lead_source: 'campaign_x', source: 'campaign' }), 'campaign');
  assert.equal(norm.normalizeChannel({ source: 'CarGurus', lead_source: 'CarGurus' }), 'internet');
  assert.equal(norm.normalizeChannel({ contact_type: 'walk_in' }), 'walk_in');
  assert.ok(norm.isUnmappedSource('  ') && norm.isUnmappedSource('Unknown') && !norm.isUnmappedSource('KBB'));
});

test('registry: every Reports KPI has a definition; blocked / needs-data ones have a reason', () => {
  const report = listKpis().filter((k) => k.dashboard);
  assert.ok(report.length >= 80);
  for (const k of report) {
    for (const f of ['id', 'label', 'grain', 'dateBasis', 'numerator', 'exclusions', 'state', 'kind']) {
      assert.ok(k[f], `${k.id} ${f}`);
    }
    assert.equal(k.evaluate, undefined);
    if (k.state !== 'live') assert.ok(k.reason, `${k.id} reason`);
    if (k.kind === 'rate') assert.ok(k.denominator, `${k.id} denominator`);
  }
  for (const d of listDashboards()) assert.ok(kpisForDashboard(d.id).length > 0, d.id);
  for (const k of kpisForDashboard('sales').filter((x) => !x.proxy)) {
    assert.equal(k.state, 'blocked');
    assert.equal(k.reason, 'Desk Log (Priority 3)');
  }
  assert.ok(kpisForDashboard('sales').some((k) => k.proxy && k.state === 'live'));
  for (const id of ['source.roi', 'source.cost_per_lead']) assert.match(getKpi(id).reason, /needs spend data/i);
});

test('script: only local hosts unless --allow-remote', () => {
  assert.ok(isLocalUri('mongodb://127.0.0.1:27018/x'));
  assert.ok(isLocalUri('mongodb://localhost/x'));
  assert.ok(isLocalUri('mongodb://u:p@localhost:27017,127.0.0.1:27018/x?rs=1'));
  assert.ok(!isLocalUri('mongodb://db.example.com:27017/x'));
  assert.ok(!isLocalUri('mongodb+srv://cluster.example.net/x'));
  assert.ok(!isLocalUri('mongodb://localhost,db.example.com/x'));
});

// --- MongoDB -----------------------------------------------------------------------------------------------------

let connected = false;
let redis = null;
before(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 2000 });
    connected = true;
  } catch { connected = false; }
  try {
    redis = new Redis({ host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT),
      db: Number(process.env.REDIS_DB), lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1000,
      retryStrategy: () => null });
    redis.on('error', () => {});
    await redis.connect();
  } catch { redis = null; }
});
after(async () => {
  if (connected) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  if (redis) { await clearCache(); await redis.quit(); }
  await closeCache();
});

async function clearCache() {
  if (!redis) return;
  const keys = await redis.keys(`${CACHE_PREFIX}:*`);
  if (keys.length) await redis.del(keys);
}

const L = { a: id(101), b: id(102), c: id(103), d: id(104), e: id(105), old: id(106), other: id(107) };
const C = { a: id(201), b: id(202), dupe: id(203) };
const B = { ai: id(301), staff: id(302), dup: id(303), cancelled: id(304), service: id(305), noOutcome: id(306) };

async function seed() {
  const db = mongoose.connection.db;
  await User.create([
    { _id: ADMIN, email: 'admin@r.test', name: 'Admin', password: 'x', type: 'admin' },
    { _id: DEALER, email: 'd@r.test', name: 'Dealer', password: 'x', type: 'dealer',
      dealer_account_information: { time_zone: NY } },
    { _id: OTHER, email: 'o@r.test', name: 'Other', password: 'x', type: 'dealer' },
    { _id: STAFF, email: 's@r.test', name: 'Sam Staff', password: 'x', type: 'dealer', parent_id: DEALER },
    { _id: STAFF2, email: 's2@r.test', name: 'Pat Staff', password: 'x', type: 'dealer', parent_id: DEALER },
  ]);
  const d = String(DEALER);
  await db.collection('customers').insertMany([
    { _id: C.a, dealer_id: d, name: 'Ann', phones: [{ value: '+1 (555) 000-1111' }], emails: [], createdAt: at(`${DAY} 09:00:00`) },
    { _id: C.b, dealer_id: d, name: 'Bob', phones: [], emails: [{ value: 'bob@x.test' }], createdAt: at('2026-10-01 09:00:00') },
    { _id: C.dupe, dealer_id: d, name: 'Ann again', phones: [{ value: '5550001111' }], emails: [],
      createdAt: at(`${DAY} 10:00:00`) },
  ]);
  await db.collection('leads').insertMany([
    // Inside 5 Nov (New York): 00:00:30 and 23:59:59.
    { _id: L.a, dealer_id: d, name: 'Ann', source: 'CarGurus', lead_source: 'CarGurus', fe_lead_status: 'Sold Pending',
      assigned_to: STAFF, customer_id: C.a, createdAt: at(`${DAY} 00:00:30`) },
    { _id: L.b, dealer_id: d, name: 'Ben', source: 'email', lead_source: 'cargurus.com', fe_lead_status: 'visited',
      assigned_to: STAFF2, customer_id: null, createdAt: at(`${DAY} 23:59:59`) },
    { _id: L.c, dealer_id: d, name: 'Cat', source: 'campaign', lead_source: 'campaign_Spring', fe_lead_status: 'Lead',
      customer_id: C.b, createdAt: at(`${DAY} 12:00:00`) },
    // Outside: 4 Nov 23:59:59 and 6 Nov 00:00:00 New York (5 Nov in UTC for the first).
    { _id: L.d, dealer_id: d, name: 'Dan', source: 'sms', lead_source: '', fe_lead_status: 'Sold',
      createdAt: at('2026-11-04 23:59:59') },
    { _id: L.e, dealer_id: d, name: 'Eve', source: 'sms', lead_source: 'Unknown', fe_lead_status: 'Lead',
      createdAt: at('2026-11-06 00:00:00') },
    { _id: L.old, dealer_id: d, name: 'Old', source: 'Cars.com', lead_source: 'Cars.com', fe_lead_status: 'Contacted',
      customer_id: C.b, assigned_to: STAFF, createdAt: at('2026-09-01 10:00:00') },
    { _id: L.other, dealer_id: String(OTHER), name: 'Not ours', lead_source: 'CarGurus', fe_lead_status: 'visited',
      createdAt: at(`${DAY} 10:00:00`) },
  ]);
  const bk = (o) => ({ dealer_id: d, customerName: 'x', bookingTime: '10:00', appointment_type: 'sales', ...o });
  await db.collection('bookings').insertMany([
    bk({ _id: B.ai, lead_id: String(L.a), created_by: 'ai', booking_status: 'confirmed', showed: true,
      bookingDate: at(`${DAY} 00:00:00`), createdAt: at(`${DAY} 08:00:00`) }),
    bk({ _id: B.dup, lead_id: String(L.a), created_by: 'ai', booking_status: 'confirmed',
      bookingDate: at(`${DAY} 00:00:00`), createdAt: at(`${DAY} 08:05:00`) }),
    bk({ _id: B.staff, lead_id: String(L.old), created_by: 'staff', booking_status: 'pending', showed: false,
      bookingTime: '15:00', bookingDate: at(`${DAY} 00:00:00`), createdAt: at(`${DAY} 11:00:00`) }),
    bk({ _id: B.cancelled, lead_id: String(L.b), created_by: 'staff', booking_status: 'cancelled',
      bookingDate: at('2026-11-07 00:00:00'), createdAt: at(`${DAY} 13:00:00`) }),
    bk({ _id: B.service, lead_id: String(L.c), created_by: 'customer', booking_status: 'pending',
      appointment_type: 'service', bookingDate: at('2026-11-09 00:00:00'), createdAt: at(`${DAY} 14:00:00`) }),
    bk({ _id: B.noOutcome, lead_id: String(L.b), created_by: 'staff', booking_status: 'pending', bookingTime: '16:00',
      bookingDate: at(`${DAY} 00:00:00`), createdAt: at('2026-11-01 09:00:00') }),
  ]);
  const em = (o) => ({ dealer_id: d, sender: 'x', is_note: false, communication_type: 'sms', ...o });
  await db.collection('emails').insertMany([
    // AI before the staff booking on L.old -> AI-assisted.
    em({ lead_id: L.old, status: 'delivered', ai_generated: true, timestamp: at('2026-11-04 09:00:00') }),
    em({ lead_id: L.old, status: 'received', timestamp: at(`${DAY} 09:00:00`), mail_content: 'yes please' }),
    em({ lead_id: L.old, status: 'delivered', ai_generated: true, timestamp: at(`${DAY} 09:04:00`) }),
    em({ lead_id: L.a, status: 'sent', communication_type: 'email', ai_generated: true, timestamp: at(`${DAY} 00:10:00`) }),
    em({ lead_id: L.a, status: 'incoming', timestamp: at(`${DAY} 07:00:00`) }),
    em({ lead_id: L.a, status: 'delivered', message_by: STAFF, timestamp: at(`${DAY} 07:30:00`) }),
    em({ lead_id: L.b, status: 'failed', message_by: STAFF2, communication_type: 'email', timestamp: at(`${DAY} 23:59:59`) }),
    em({ lead_id: L.c, status: 'received', communication_type: 'email', is_lead_email: true, timestamp: at(`${DAY} 12:00:00`) }),
    // Outside the day (6 Nov 00:00 New York).
    em({ lead_id: L.a, status: 'delivered', message_by: STAFF, timestamp: at('2026-11-06 00:00:00') }),
    em({ lead_id: L.a, status: 'note', communication_type: 'note', is_note: true, message_by: STAFF, timestamp: at(`${DAY} 10:00:00`) }),
  ]);
  await db.collection('activitylogs').insertMany([
    { dealer_id: d, lead_id: L.a, actor_type: 'staff', action: 'status_changed', from: 'Visited', to: 'Sold Pending', at: at(`${DAY} 15:00:00`) },
    { dealer_id: d, lead_id: L.b, actor_type: 'staff', action: 'status_changed', from: 'Lead', to: 'visited', at: at(`${DAY} 16:00:00`) },
    { dealer_id: d, lead_id: L.old, actor_type: 'staff', action: 'status_changed', to: 'Sold', at: at('2026-10-01 10:00:00') },
    { dealer_id: d, lead_id: L.old, actor_type: 'staff', action: 'status_changed', to: 'Sold Delivered', at: at(`${DAY} 11:00:00`) },
    { dealer_id: d, lead_id: L.a, actor_type: 'staff', actor_name: 'Sam Staff', action: 'ai_turned_off', at: at(`${DAY} 07:31:00`) },
  ]);
  await db.collection('ai_call_tasks').insertMany([
    { dealer_id: d, lead_id: String(L.a), assigned_to: String(STAFF), status: 'completed', outcome: 'connected',
      opened_at: at(`${DAY} 05:00:00`), closed_at: at(`${DAY} 06:00:00`) },
    { dealer_id: d, lead_id: String(L.b), assigned_to: String(STAFF2), status: 'missed', due_by: at(`${DAY} 17:00:00`),
      missed_at: at(`${DAY} 17:00:00`), opened_at: at(`${DAY} 09:00:00`) },
    { dealer_id: d, lead_id: String(L.c), assigned_to: String(STAFF2), status: 'open', due_by: at(`${DAY} 18:00:00`),
      opened_at: at(`${DAY} 09:00:00`) },
  ]);
  await db.collection('ai_lead_state').insertMany([
    { dealer_id: d, lead_id: String(L.a), status: 'handoff', status_reason: 'Customer asked for a person: call me',
      status_at: at(`${DAY} 07:10:00`) },
    { dealer_id: d, lead_id: String(L.c), status: 'handoff', status_reason: "AI couldn't write a safe reply",
      status_at: at(`${DAY} 12:10:00`) },
  ]);
  await db.collection('ai_touches').insertMany([
    { dealer_id: d, touch_id: 't1', lead_id: String(L.a), kind: 'first_reply', sent_at: at(`${DAY} 00:10:00`),
      replied_24h: true, replied_72h: true, meaningful_reply: true },
    { dealer_id: d, touch_id: 't2', lead_id: String(L.old), kind: 'cadence', sent_at: at(`${DAY} 09:04:00`),
      opted_out_at: at(`${DAY} 10:00:00`) },
  ]);
  await db.collection('ai_customer_status').insertMany([
    { dealer_id: d, customer_id: String(C.a), customer_status: 'ACTIVE' },
    { dealer_id: d, customer_id: String(C.b), customer_status: 'INACTIVE' },
  ]);
  await db.collection('ai_vehicle_ownership').insertOne({ dealer_id: d, customer_id: String(C.a), vin: 'VIN1',
    ownership_status: 'ACTIVE' });
  await db.collection('ai_service_events').insertOne({ dealer_id: d, type: 'RECALL', vin: 'VIN1', customer_facing: true,
    status: 'queued', created_at: at(`${DAY} 08:00:00`) });
  await db.collection('ai_consent').insertOne({ dealer_id: d, lead_id: String(L.old), channel: 'sms',
    consent_type: 'opt_out', consent_status: 'opted_out', consent_source: 'stop', recorded_at: at(`${DAY} 10:00:00`) });
  await db.collection('ai_compliance_log').insertOne({ dealer_id: d, lead_id: String(L.b), channel: 'sms',
    decision: 'BLOCK', decision_reason: 'opted out', rule: 'opt_out', at: at(`${DAY} 10:00:00`) });
  await db.collection('campaignleads').insertOne({ dealer_id: d, campaign_id: 'c1', lead_id: L.c, status: 'blocked',
    block_reason: 'quiet hours', updatedAt: at(`${DAY} 10:00:00`) });
  await db.collection('dealervaultimportbatches').insertOne({ dealer_id: d, fileName: 'f.csv', fileType: 'sales',
    status: 'completed_with_errors', failed_count: 2, createdAt: at(`${DAY} 03:00:00`) });
  await db.collection('vehicleclicks').insertMany([
    { dealer_id: d, vehicle_id: id(900), clickedAt: at(`${DAY} 10:00:00`) },
    { dealer_id: d, vehicle_id: id(900), clickedAt: at(`${DAY} 10:01:00`), isBot: true },
  ]);
}

beforeEach(async () => {
  if (!connected) return;
  await mongoose.connection.dropDatabase();
  await seed();
  await clearCache();
});
const needDb = (t) => { if (!connected) { t.skip('MongoDB not reachable'); return true; } return false; };

const FILTER_VARIANTS = ['', `&lead_source=CarGurus`, `&assigned_to=${STAFF}`, '&actor=ai', '&appointment_type=service',
  '&channel=sms'];

test('every live KPI: count = drill-down ids = CSV rows, for the same filters', async (t) => {
  if (needDb(t)) return;
  let checked = 0;
  for (const variant of FILTER_VARIANTS) {
    for (const d of listDashboards()) {
      const res = await call(base(`&dashboard=${d.id}${variant}`), auth(ADMIN));
      assert.equal(res.status, 200, `${d.id}${variant}`);
      const body = await res.json();
      assert.ok(body.last_updated);
      for (const k of body.kpis) {
        assert.notEqual(k.state, 'error', `${k.id} errored`);
        if (k.state !== 'live') {
          assert.equal(k.value, null, `${k.id} has no number`);
          assert.equal(k.count, null);
          assert.ok(k.reason);
          continue;
        }
        const rowsRes = await call(base(`&kpi=${k.id}&rows=1${variant}`), auth(ADMIN));
        assert.equal(rowsRes.status, 200, k.id);
        const drill = await rowsRes.json();
        assert.equal(drill.ids.length, k.count, `${k.id}${variant} drill ids`);
        assert.equal(new Set(drill.ids).size, drill.ids.length, `${k.id} unique ids`);
        assert.equal(drill.rows.length, k.count);
        const csvRes = await call(base(`&kpi=${k.id}&format=csv${variant}`), auth(ADMIN));
        assert.equal(csvRes.status, 200);
        assert.match(csvRes.headers.get('content-type'), /text\/csv/);
        assert.equal(csvRows(await csvRes.text()), k.count, `${k.id}${variant} csv rows`);
        if (k.kind === 'rate') {
          const den = await (await call(base(`&kpi=${k.id}&rows=1&part=denominator${variant}`), auth(ADMIN))).json();
          assert.equal(den.count, k.denominator.count, `${k.id} denominator`);
        }
        for (const [by, groups] of Object.entries(k.breakdowns || {})) {
          for (const g of groups) {
            const gr = await (await call(base(`&kpi=${k.id}&rows=1&by=${by}&group=${encodeURIComponent(g.key)}${variant}`),
              auth(ADMIN))).json();
            assert.equal(gr.count, g.count, `${k.id} ${by}=${g.key}`);
          }
          assert.equal(groups.reduce((s, g) => s + g.count, 0), k.count, `${k.id} ${by} groups sum`);
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked > 300, `checked ${checked}`);
});

test('values: dealer-local day boundaries and the fixed defects', async (t) => {
  if (needDb(t)) return;
  const args = { dealerId: String(DEALER), from: DAY, to: DAY, tz: NY, spec: {} };
  const ctx = {};
  const v = async (kpi) => evaluateKpi(kpi, args, ctx);
  // 00:00:30 and 23:59:59 New York are in; 4 Nov 23:59:59 and 6 Nov 00:00:00 are out; other dealer is out.
  assert.deepEqual((await v('exec.leads_received')).ids.sort(), [L.a, L.b, L.c].map(String).sort());
  // In UTC the day would include Dan (4 Nov 23:59:59 NY = 5 Nov 04:59:59Z) and miss Ben.
  const utc = await evaluateKpi('exec.leads_received', { ...args, tz: 'UTC' }, {});
  assert.ok(utc.ids.includes(String(L.d)) && !utc.ids.includes(String(L.b)));
  assert.equal((await v('exec.unique_customers')).count, 2);
  // Appointments: one counted booking per duplicate pair; cancelled counts on the day it was set.
  const set = await v('exec.appointments_set');
  assert.deepEqual(set.ids.sort(), [B.ai, B.staff, B.cancelled, B.service].map(String).sort());
  assert.deepEqual((await v('appointments.ai_assisted')).ids, [String(B.staff)]);
  assert.deepEqual((await v('appointments.unknown_creator')).ids, [String(B.service)]);
  assert.deepEqual((await v('dq.duplicate_bookings')).ids, [String(B.dup)]);
  // Scheduled for 5 Nov: ai (showed), staff (no-show), noOutcome. Show rate = 1 / 2.
  assert.equal((await v('appointments.scheduled')).count, 3);
  const rate = await v('appointments.show_rate');
  assert.equal(rate.value, 50);
  assert.equal(rate.denominator.count, 2);
  // 'visited' (lower case) counts as a visit; 'Sold' (legacy) before the range doesn't make Old's first sale today.
  assert.deepEqual((await v('sales.proxy_visits')).ids, [String(L.b)]);
  assert.deepEqual((await v('exec.crm_sold')).ids, [String(L.a)]);
  // Messages are dated by timestamp; notes and the 6 Nov message are out.
  assert.deepEqual((await v('bdc.staff_texts')).ids.length, 1);
  assert.equal((await v('dq.failed_sends')).count, 1);
  assert.equal((await v('ai.messages_sent')).count, 2);
  assert.equal((await v('ai.messages_delivered')).count, 2);
  const rt = await v('ai.response_time');
  assert.equal(rt.count, 1);
  assert.equal(rt.value, 4);
  assert.equal((await v('ai.manager_escalations')).count, 1);
  assert.equal((await v('ai.handoffs')).count, 2);
  assert.equal((await v('exec.customers_replied')).count, 2);
  assert.equal((await v('bdc.meaningful_contacts')).count, 1);
  assert.equal((await v('bdc.call_tasks_missed')).count, 1);
  assert.equal((await v('dq.legacy_status')).count, 1);
  assert.equal((await v('dq.duplicate_customers')).count, 2);
  assert.equal((await v('source.vdp_clicks')).count, 1);
  assert.equal((await v('source.campaign_leads')).count, 1);
  assert.deepEqual((await v('exec.lead_to_appt')).value, 100);
  // Speed to lead: Ann at 00:00:30, AI at 00:10 -> 9.5 min; Ben's (failed) staff email the same second -> 0 min.
  const minutes = (r) => Object.fromEntries(r.rows.map((x) => [x.id, x.minutes]));
  const any = await v('bdc.speed_to_lead');
  assert.deepEqual(minutes(any), { [String(L.a)]: 9.5, [String(L.b)]: 0 });
  assert.equal(any.value, 4.75);
  const human = await v('bdc.speed_to_human');
  assert.deepEqual(minutes(human), { [String(L.a)]: 449.5, [String(L.b)]: 0 });
  assert.deepEqual((await v('bdc.no_response')).ids, [String(L.c)]);
  // The registry's older API works on the new KPIs too.
  const r = await runKpi('exec.leads_received', args);
  assert.equal(r.count, r.ids.length);
  assert.equal(r.rows, undefined);
});

test('filters: a KPI says which requested filters it cannot apply', async (t) => {
  if (needDb(t)) return;
  const body = await (await call(base('&dashboard=executive&channel=sms'), auth(ADMIN))).json();
  const leads = body.kpis.find((k) => k.id === 'exec.leads_received');
  assert.deepEqual(leads.ignored_filters, ['channel']);
  const replied = body.kpis.find((k) => k.id === 'exec.customers_replied');
  assert.deepEqual(replied.ignored_filters, []);
  const bad = await call(base('&dashboard=executive&actor=robot'), auth(ADMIN));
  assert.equal(bad.status, 400);
  const unsupported = await (await call(base('&dashboard=executive&campaign=x'), auth(ADMIN))).json();
  assert.ok(unsupported.unsupported.some((u) => u.key === 'campaign'));
});

test('route: 401 / 403 / 404 / 200', async (t) => {
  if (needDb(t)) return;
  assert.equal((await call(base('&dashboard=executive'))).status, 401);
  assert.equal((await call(base('&dashboard=executive'), auth(OTHER))).status, 403);
  // The dealer and its staff: the page doesn't exist for them (feature not visible).
  assert.equal((await call(base('&dashboard=executive'), auth(DEALER))).status, 404);
  assert.equal((await call(base('&dashboard=executive'), auth(STAFF))).status, 404);
  assert.equal((await call(base('&kpi=exec.leads_received&rows=1'), auth(DEALER))).status, 404);
  assert.equal((await call(`dealer_id=${DEALER}&check=1`, auth(STAFF))).status, 404);
  // A forged impersonation claim from a non-admin doesn't count.
  assert.equal((await call(base('&dashboard=executive'), auth(DEALER, { impersonated_by: String(OTHER) }))).status, 404);
  // Super admin, directly or inside the dealer account through "login as".
  assert.equal((await call(base('&dashboard=executive'), auth(ADMIN))).status, 200);
  const as = auth(DEALER, { impersonated_by: String(ADMIN), impersonator_type: 'admin' });
  assert.equal((await call(base('&dashboard=executive'), as)).status, 200);
  assert.equal((await call(`dealer_id=${DEALER}&check=1`, as)).status, 200);
  // Same through the sign-in cookie.
  const cookie = { Cookie: `dealertoken=${token(DEALER, { impersonated_by: String(ADMIN) })}` };
  assert.equal((await call(base('&dashboard=executive'), cookie)).status, 200);
  // Bad input.
  assert.equal((await call(base('&dashboard=nope'), auth(ADMIN))).status, 400);
  assert.equal((await call(`dealer_id=${DEALER}&dashboard=executive`, auth(ADMIN))).status, 400);
  assert.equal((await call(base('&kpi=nope&rows=1'), auth(ADMIN))).status, 404);
  const defs = await (await call(`dealer_id=${DEALER}&definitions=1`, auth(ADMIN))).json();
  assert.equal(defs.kpis.length, listKpis().length);
  const opts = await (await call(`dealer_id=${DEALER}&options=1`, auth(ADMIN))).json();
  assert.ok(opts.lead_sources.includes('CarGurus'));
  assert.deepEqual(opts.staff.map((s) => s.name), ['Dealer', 'Pat Staff', 'Sam Staff']);
});

test('blocked and needs-data KPIs return a state, not a number', async (t) => {
  if (needDb(t)) return;
  const body = await (await call(base('&dashboard=sales'), auth(ADMIN))).json();
  const visits = body.kpis.find((k) => k.id === 'sales.showroom_visits');
  assert.equal(visits.state, 'blocked');
  assert.equal(visits.reason, 'Desk Log (Priority 3)');
  assert.equal(visits.value, null);
  assert.equal(visits.count, null);
  const proxy = body.kpis.find((k) => k.id === 'sales.proxy_visits');
  assert.equal(proxy.state, 'live');
  assert.equal(proxy.count, 1);
  for (const kpi of ['sales.showroom_visits', 'source.roi', 'appointments.moved']) {
    const res = await call(base(`&kpi=${kpi}&rows=1`), auth(ADMIN));
    assert.equal(res.status, 409, kpi);
    const b = await res.json();
    assert.ok(['blocked', 'needs_data'].includes(b.state));
    assert.equal(b.rows, undefined);
    assert.equal((await call(base(`&kpi=${kpi}&format=csv`), auth(ADMIN))).status, 409);
  }
  const r = await runKpi('source.roi', { dealerId: String(DEALER), from: DAY, tz: NY });
  assert.equal(r.state, 'needs_data');
  assert.equal(r.count, null);
  assert.equal(r.ids, null);
});

test('cache: totals cached five minutes per dealer + tab + range + filters; drill-downs never', async (t) => {
  if (needDb(t)) return;
  if (!redis) { t.skip('Redis not reachable'); return; }
  const first = await (await call(base('&dashboard=executive'), auth(ADMIN))).json();
  assert.equal(first.cached, false);
  const keys = await redis.keys(`${CACHE_PREFIX}:${DEALER}:executive:*`);
  assert.equal(keys.length, 1);
  const ttl = await redis.ttl(keys[0]);
  assert.ok(ttl > 290 && ttl <= 300, `ttl ${ttl}`);
  await mongoose.connection.db.collection('leads').insertOne({ dealer_id: String(DEALER), name: 'Late',
    createdAt: at(`${DAY} 20:00:00`) });
  const second = await (await call(base('&dashboard=executive'), auth(ADMIN))).json();
  assert.equal(second.cached, true);
  assert.equal(second.last_updated, first.last_updated);
  const leads = (b) => b.kpis.find((k) => k.id === 'exec.leads_received').count;
  assert.equal(leads(second), 3);
  // Drill-down / CSV are live.
  const drill = await (await call(base('&kpi=exec.leads_received&rows=1'), auth(ADMIN))).json();
  assert.equal(drill.count, 4);
  assert.equal(csvRows(await (await call(base('&kpi=exec.leads_received&format=csv'), auth(ADMIN))).text()), 4);
  // Different filters -> a different entry.
  const filtered = await (await call(base('&dashboard=executive&lead_source=CarGurus'), auth(ADMIN))).json();
  assert.equal(filtered.cached, false);
  assert.equal(leads(filtered), 1);
});

test('legacy-status script: dry run changes nothing; apply rewrites only clear fe_lead_status values', async (t) => {
  if (needDb(t)) return;
  const db = mongoose.connection.db;
  const snapshot = async () => JSON.stringify(await db.collection('leads').find({}).sort({ _id: 1 }).toArray());
  const before = await snapshot();
  const lines = [];
  const dry = await normalizeLegacyStatuses(db, { log: (l) => lines.push(l) });
  assert.equal(await snapshot(), before);
  assert.equal(dry.updated, 0);
  const byValue = Object.fromEntries(dry.values.map((v) => [v.value, v]));
  assert.equal(byValue.visited.leads, 2);
  assert.equal(byValue.visited.becomes, 'Visited');
  assert.equal(byValue.Contacted.becomes, 'Contacted - No Next Action');
  assert.equal(byValue.Sold.becomes, null);
  assert.equal(byValue.Sold.needs_review, true);
  assert.ok(lines[0].startsWith('DRY RUN'));

  // One dealer only, and only fe_lead_status changes.
  const applied = await normalizeLegacyStatuses(db, { apply: true, dealerId: String(DEALER) });
  assert.equal(applied.updated, 2);
  const after = await db.collection('leads').find({}).sort({ _id: 1 }).toArray();
  const was = new Map(JSON.parse(before).map((l) => [l._id, l]));
  for (const l of after) {
    const old = was.get(String(l._id));
    const { fe_lead_status: a, ...restNew } = JSON.parse(JSON.stringify(l));
    const { fe_lead_status: b, ...restOld } = old;
    assert.deepEqual(restNew, restOld, 'nothing but fe_lead_status changes');
    void a; void b;
  }
  const status = Object.fromEntries(after.map((l) => [String(l._id), l.fe_lead_status]));
  assert.equal(status[String(L.b)], 'Visited');
  assert.equal(status[String(L.old)], 'Contacted - No Next Action');
  assert.equal(status[String(L.d)], 'Sold', 'ambiguous: left for a person');
  assert.equal(status[String(L.other)], 'visited', 'other dealer untouched');
});
