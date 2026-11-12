// The Dashboard's full report download (app/lib/reporting/fullReport.js, GET /api/reports/full) and Betsy's
// source and sub-source report (app/lib/reporting/sourcePerformance.js, GET /api/reports/source-performance):
// the sub-source read from the lead email (the live samples of 11 Nov 2026), the report's rows and both ways of
// counting, its "All Types" row equal to the Lead sources numbers, the CSV, who may download it, and the backfill
// script (dry run writes nothing; --apply fills only empty sub-sources).
//
// Uses its own local MongoDB database (sourceperf_test, cleared before each test, dropped at the end; DB tests are
// skipped when MongoDB is not reachable).
//   Run: node --test test-source-performance.js
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

const URI = process.env.SOURCE_PERF_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/sourceperf_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) throw new Error(`refusing non-local test DB ${URI}`);
process.env.MONGODB_URI = URI;
process.env.JWT_SECRET = 'source-perf-test-secret';
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
delete process.env.FEATURE_TEST_DEALERS;
delete process.env.CRM_LIVE_DB;

const { default: mongoose } = await import('mongoose');
const { default: jwt } = await import('jsonwebtoken');
const { default: moment } = await import('moment-timezone');
const { default: User } = await import('./app/models/User.js');
const { adfSubSource, parseAdfLeadEmail } = await import('./app/lib/adfLeadParser.js');
const { evaluateKpi } = await import('./app/lib/reporting/registry.js');
const { sourcePerformance, sourcePerformanceCsv, upType } = await import('./app/lib/reporting/sourcePerformance.js');
const route = await import('./app/api/reports/source-performance/route.js');
const fullRoute = await import('./app/api/reports/full/route.js');
const { fullReport, fullReportCsv } = await import('./app/lib/reporting/fullReport.js');
const { backfillSubSource } = await import('./scripts/backfill-sub-source.js');

const { ObjectId } = mongoose.Types;
const id = (n) => new ObjectId(`66f0000000000000000c${String(n).padStart(4, '0')}`);
const ADMIN = id(1), DEALER = id(2);
const L = { reeng: id(11), plain: id(12), cars: id(13), phone: id(14), old: id(15) };
const NY = 'America/New_York';
const DAY = '2026-11-05';
const NOW = '2026-11-06T17:00:00Z';
const at = (local) => moment.tz(local, 'YYYY-MM-DD HH:mm:ss', NY).toDate();
const sign = (claims) => jwt.sign(claims, process.env.JWT_SECRET);
const args = { dealerId: String(DEALER), from: DAY, to: DAY, tz: NY, now: NOW };

// The provider part of the live lead emails (11 Nov 2026), in an ADF envelope.
const adf = (provider, phone = '5550001234') => `<?xml version="1.0"?><adf><prospect><id sequence="1" source="x">1</id>
<customer><contact><name part="full">Test Person</name><phone>${phone}</phone></contact></customer>
<vehicle interest="buy"><year>2024</year><make>Ford</make><model>F-150</model></vehicle>${provider}</prospect></adf>`;
const CARGURUS_REENGAGEMENT = '<provider><id sequence="1" source="CarGurus">1</id><name part="full" type="business">'
  + 'CarGurus Reengagement</name><service>CarGurus Reengagement</service></provider>';
const CARS_LEADS = '<provider> =20 <name part="full">Cars.com</name> =20 <service>Cars.com Leads</service></provider>';
const CARS_PLAIN = '<provider><name part="full">Cars.com</name><service>Cars.com</service></provider>';

test('sub-source: the live lead emails', () => {
  const cases = [
    [{ name: 'Cars.com', service: 'Cars.com' }, null],
    [{ name: 'Cars.com', service: 'Cars.com Leads' }, 'Leads'],
    [{ name: 'CarGurus', service: 'CarGurus' }, null],
    [{ name: 'CarGurus Reengagement', service: 'CarGurus Reengagement' }, 'Reengagement'],
    [{ name: 'Edmunds', service: 'Edmunds Direct' }, 'Direct'],
    [{ name: 'Dealer Inspire/Get E-Price' }, 'Get E-Price'],
    [{ name: 'Capital One Auto Navigator' }, 'Auto Navigator'],
    [{ name: 'Victory Cars Central' }, null],
    [{ name: 'CARFAX.com' }, null],
    [{ name: 'CARFAX.com', service: 'CARFAX Car Listings' }, 'Car Listings'],
    [{}, null],
  ];
  for (const [input, want] of cases) assert.equal(adfSubSource(input), want, JSON.stringify(input));
});

test('sub-source: a new ADF lead carries it; the source is unchanged', () => {
  const lead = parseAdfLeadEmail(adf(CARGURUS_REENGAGEMENT));
  assert.equal(lead.source, 'CarGurus Reengagement');
  assert.equal(lead.subSource, 'Reengagement');
  assert.equal(parseAdfLeadEmail(adf(CARS_LEADS)).subSource, 'Leads');
  assert.equal(parseAdfLeadEmail(adf(CARS_PLAIN)).subSource, null);
});

test('up type: internet, phone, walk-in, campaign, else other', () => {
  assert.equal(upType({ contact_type: 'internet' }), 'Internet');
  assert.equal(upType({ contact_type: 'phone' }), 'Phone');
  assert.equal(upType({ contact_type: 'walk_in' }), 'Walk-in');
  assert.equal(upType({ lead_source: 'campaign_Spring' }), 'Campaign');
  assert.equal(upType({ source: 'CarGurus', lead_source: 'CarGurus' }), 'Internet');
  assert.equal(upType({ source: 'sms' }), 'Other');
  assert.equal(upType(null), 'Other');
});

test('CSV: never a spreadsheet formula, commas and quotes kept', () => {
  const csv = sourcePerformanceCsv({ basis: 'timeframe', rows: [
    { level: 'total', up_type: 'All Types', source: 'All Sources', sub_source: 'All Sub-Sources', leads: 1, visits: null,
      appts_set: 0, appts_shown: 0, sold: 0, closing_ratio: 0, front_gross: null, back_gross: null, total_gross: null },
    { level: 'source', up_type: 'Internet', source: 'Cars.com', sub_source: '=HYPERLINK("x")', leads: 1, visits: null,
      appts_set: 0, appts_shown: 0, sold: 0, closing_ratio: 0, front_gross: null, back_gross: null, total_gross: null },
  ] }, { company: 'Victory, Inc.', from: '11/1/2026', to: '11/9/2026', generated: 'now' });
  assert.match(csv, /^Source and Sub Source Performance\r\n"Victory, Inc\."\r\n/);
  assert.match(csv, /Company,Up Type,Source,Sub-Source,Leads,Visits,Appts Set,Appts Shown,Sold,Closing Ratio,Front Gross,Back Gross,Total Gross/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv));
});

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
beforeEach(async () => {
  if (!connected) return;
  const db = mongoose.connection.db;
  for (const c of await db.collections()) await c.deleteMany({});
  await User.create([
    { _id: ADMIN, email: 'a@sp.test', name: 'Admin', password: 'x', type: 'admin' },
    { _id: DEALER, email: 'd@sp.test', name: 'Dealer', password: 'x', type: 'dealer',
      dealer_account_information: { time_zone: NY, store_name: 'Victory Cars Central' } },
  ]);
  const d = String(DEALER);
  const lead = (o) => ({ dealer_id: d, fe_lead_status: 'Lead', contact_type: 'internet', ...o });
  await db.collection('leads').insertMany([
    lead({ _id: L.reeng, name: 'A', source: 'CarGurus Reengagement', lead_source: 'CarGurus Reengagement',
      sub_source: 'Reengagement', fe_lead_status: 'Sold Pending', createdAt: at(`${DAY} 09:00:00`) }),
    lead({ _id: L.plain, name: 'B', source: 'CarGurus', lead_source: 'CarGurus', createdAt: at(`${DAY} 10:00:00`) }),
    lead({ _id: L.cars, name: 'C', source: 'Cars.com', lead_source: 'Cars.com', sub_source: 'Leads',
      createdAt: at(`${DAY} 11:00:00`) }),
    lead({ _id: L.phone, name: 'D', source: 'phone', lead_source: 'Phone', contact_type: 'phone',
      createdAt: at(`${DAY} 12:00:00`) }),
    // Came in last month; booked and sold on 5 Nov: in the timeframe, not a current lead.
    lead({ _id: L.old, name: 'E', source: 'CarGurus', lead_source: 'CarGurus', sub_source: 'Digital Deal',
      fe_lead_status: 'Sold Pending', createdAt: at('2026-10-01 09:00:00') }),
  ]);
  const bk = (o) => ({ dealer_id: d, customerName: 'x', bookingTime: '10:00', appointment_type: 'sales',
    created_by: 'staff', booking_status: 'confirmed', bookingDate: at(`${DAY} 00:00:00`), ...o });
  await db.collection('bookings').insertMany([
    bk({ lead_id: String(L.reeng), showed: true, createdAt: at(`${DAY} 08:00:00`), bookingTime: '09:30' }),
    bk({ lead_id: String(L.old), showed: true, createdAt: at(`${DAY} 08:30:00`), bookingTime: '11:00' }),
  ]);
  await db.collection('activitylogs').insertMany([
    { dealer_id: d, lead_id: L.reeng, actor_type: 'staff', action: 'status_changed', from: 'Lead', to: 'Sold Pending',
      at: at(`${DAY} 15:00:00`) },
    { dealer_id: d, lead_id: L.old, actor_type: 'staff', action: 'status_changed', from: 'Lead', to: 'Sold Pending',
      at: at(`${DAY} 16:00:00`) },
  ]);
});

const pick = (rows, up, source, sub) => rows.find((r) => r.up_type === up && r.source === source
  && r.sub_source === sub);

test('report: "All Types" equals the Lead sources numbers; type -> source -> sub-source', async (t) => {
  if (needDb(t)) return;
  const { rows } = await sourcePerformance(args, { basis: 'timeframe' });
  const total = rows[0];
  for (const [key, kpi] of [['leads', 'source.leads'], ['appts_set', 'source.appointments'],
    ['appts_shown', 'source.shown'], ['sold', 'source.crm_sold']]) {
    assert.equal(total[key], (await evaluateKpi(kpi, args)).count, key);
  }
  assert.deepEqual([total.leads, total.appts_set, total.sold], [4, 2, 2]);
  assert.equal(total.closing_ratio, 50);
  assert.equal(total.visits, 0); // no Desk Log check-ins in this data
  assert.equal(total.total_gross, null);
  // Types in name order, with their own totals.
  assert.deepEqual(rows.filter((r) => r.level === 'type').map((r) => [r.up_type, r.leads]),
    [['Internet', 3], ['Phone', 1]]);
  // CarGurus: its total, then each sub-source (the old lead's sale shows under "Digital Deal").
  const cg = pick(rows, 'Internet', 'CarGurus', 'All Sub-Sources');
  assert.deepEqual([cg.leads, cg.appts_set, cg.sold], [2, 2, 2]);
  assert.deepEqual([pick(rows, 'Internet', 'CarGurus', 'Reengagement').leads,
    pick(rows, 'Internet', 'CarGurus', 'No Sub-Source').leads,
    pick(rows, 'Internet', 'CarGurus', 'Digital Deal').sold], [1, 1, 1]);
  // Cars.com has one sub-source: a single row naming it.
  assert.equal(rows.filter((r) => r.source === 'Cars.com').length, 1);
  assert.equal(pick(rows, 'Internet', 'Cars.com', 'Leads').leads, 1);
});

test('report: "From current leads" leaves out the older lead\'s appointment and sale', async (t) => {
  if (needDb(t)) return;
  const { rows } = await sourcePerformance(args, { basis: 'current' });
  assert.deepEqual([rows[0].leads, rows[0].appts_set, rows[0].sold], [4, 1, 1]);
  assert.equal(rows[0].closing_ratio, 25);
  assert.equal(pick(rows, 'Internet', 'CarGurus', 'Digital Deal'), undefined);
  await assert.rejects(sourcePerformance(args, { basis: 'nope' }), RangeError);
});

const call = (qs, token) => route.GET(new Request(`http://localhost/api/reports/source-performance?${qs}`,
  { headers: token ? { Authorization: `Bearer ${token}` } : {} }));

test('download: admins (also through "login as") get the CSV; the dealer gets 404', async (t) => {
  if (needDb(t)) return;
  const qs = `dealer_id=${DEALER}&start_date=${DAY}&end_date=${DAY}`;
  assert.equal((await call(qs, sign({ userId: String(DEALER), type: 'dealer' }))).status, 404);
  const loginAs = sign({ userId: String(DEALER), type: 'dealer', impersonated_by: String(ADMIN),
    impersonator_type: 'admin' });
  const res = await call(`${qs}&format=csv&basis=current`, loginAs);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /^text\/csv/);
  assert.match(res.headers.get('Content-Disposition'), /attachment; filename="source-sub-source_2026-11-05_2026-11-05_current\.csv"/);
  const csv = await res.text();
  assert.match(csv, /^Source and Sub Source Performance\r\nVictory Cars Central\r\n/);
  assert.match(csv, /Report Period: 11\/5\/2026 - 11\/5\/2026/);
  assert.match(csv, /Counted: From current leads/);
  assert.match(csv, /\r\nVictory Cars Central,All Types,All Sources,All Sub-Sources,4,0,1,1,1,25\.00%,,,\r\n/);
  assert.equal((await call(`${qs}&basis=nope`, loginAs)).status, 400);
  const body = await (await call(qs, sign({ userId: String(ADMIN), type: 'admin' }))).json();
  assert.equal(body.basis, 'timeframe');
  assert.equal(body.rows[0].leads, 4);
});

test('backfill: dry run writes nothing; --apply fills only empty sub-sources', async (t) => {
  if (needDb(t)) return;
  const db = mongoose.connection.db;
  const d = String(DEALER);
  const NEW = id(21), SET = id(22), NONE = id(23), VIA_EMAIL = id(24);
  await db.collection('leads').insertMany([
    { _id: NEW, dealer_id: d, source: 'CarGurus Reengagement', sourcemail: 'm1', createdAt: at(`${DAY} 09:00:00`) },
    { _id: SET, dealer_id: d, source: 'Cars.com', sub_source: 'Kept', sourcemail: 'm2', createdAt: at(`${DAY} 09:00:00`) },
    { _id: NONE, dealer_id: d, source: 'Cars.com', sourcemail: 'm3', createdAt: at(`${DAY} 09:00:00`) },
    { _id: VIA_EMAIL, dealer_id: d, source: 'Cars.com', createdAt: at(`${DAY} 09:00:00`) },
  ]);
  await db.collection('emails').insertOne({ dealer_id: d, message_id: 'm4', lead_id: VIA_EMAIL });
  const p = (message_id, provider, source = 'body') => ({ dealer_id: d, message_id, source,
    attachment_filename: null, raw_xml: adf(provider) });
  await db.collection('rawadfpayloads').insertMany([
    p('m1', CARGURUS_REENGAGEMENT), p('m1', CARGURUS_REENGAGEMENT, 'attachment'), p('m2', CARS_LEADS),
    p('m3', CARS_PLAIN), p('m4', CARS_LEADS), p('m5', CARS_LEADS), p('m6', '<provider>'),
  ]);
  const dry = await backfillSubSource(db);
  assert.equal(dry.would_update, 2);
  assert.equal(dry.emails, 6);
  assert.deepEqual([dry.already_set, dry.no_sub_source, dry.no_lead, dry.unreadable], [1, 1, 1, 1]);
  assert.equal(await db.collection('leads').countDocuments({ _id: { $in: [NEW, VIA_EMAIL] }, sub_source: { $ne: null } }),
    0, 'dry run wrote nothing');
  const applied = await backfillSubSource(db, { apply: true });
  assert.equal(applied.updated, 2);
  const subs = Object.fromEntries((await db.collection('leads').find({ _id: { $in: [NEW, SET, NONE, VIA_EMAIL] } })
    .toArray()).map((l) => [String(l._id), l.sub_source ?? null]));
  assert.deepEqual(subs, { [NEW]: 'Reengagement', [SET]: 'Kept', [NONE]: null, [VIA_EMAIL]: 'Leads' });
});

test('full report: Executive first, then the source table both ways, then the other reports', async (t) => {
  if (needDb(t)) return;
  const report = await fullReport(args);
  assert.deepEqual(report.sections.map((x) => x.id),
    ['executive', 'appointments', 'ai', 'lead_source', 'bdc', 'service', 'data_quality', 'sales']);
  const exec = report.sections[0];
  const leads = exec.rows.find((r) => r.id === 'exec.leads_received');
  assert.equal(leads.value, (await evaluateKpi('exec.leads_received', args)).count);
  // A number that can't be counted yet says so - never a zero.
  for (const r of report.sections.flatMap((x) => x.rows).filter((x) => x.note.startsWith('Not available yet'))) {
    assert.equal(r.value, '', r.id);
  }
  assert.equal(report.sources.timeframe.rows[0].sold, 2);
  assert.equal(report.sources.current.rows[0].sold, 1);
  const csv = fullReportCsv(report, { company: 'Victory Cars Central', from: '11/5/2026', to: '11/5/2026',
    generated: 'now' });
  const at = (text) => csv.indexOf(text);
  assert.ok(at('EXECUTIVE') > 0);
  assert.ok(at('EXECUTIVE') < at('SOURCE AND SUB SOURCE PERFORMANCE - Within timeframe'));
  assert.ok(at('Within timeframe') < at('SOURCE AND SUB SOURCE PERFORMANCE - From current leads'));
  assert.ok(at('From current leads') < at('APPOINTMENTS'));
  assert.match(csv, /^Dealership Performance Report\r\nVictory Cars Central\r\n/);
});

test('full report download: follows the dates; admins only', async (t) => {
  if (needDb(t)) return;
  const get = (qs, token) => fullRoute.GET(new Request(`http://localhost/api/reports/full?${qs}`,
    { headers: { Authorization: `Bearer ${token}` } }));
  const qs = `dealer_id=${DEALER}&start_date=2026-11-01&end_date=2026-11-30`;
  assert.equal((await get(qs, sign({ userId: String(DEALER), type: 'dealer' }))).status, 404);
  const res = await get(qs, sign({ userId: String(ADMIN), type: 'admin' }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Disposition'), /filename="dealership-report_2026-11-01_2026-11-30\.csv"/);
  const csv = await res.text();
  assert.match(csv, /Report Period: 11\/1\/2026 - 11\/30\/2026/);
  assert.match(csv, /\r\nVictory Cars Central,All Types,All Sources,All Sub-Sources,4,0,2,/);
});
