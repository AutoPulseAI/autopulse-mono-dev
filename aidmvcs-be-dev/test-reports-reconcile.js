// scripts/reports-reconcile.js: on a small seeded dealer it writes nothing (every collection's documents unchanged),
// Reports = Dashboard = raw for leads received and appointments made / scheduled / shown, a duplicate booking shows
// up as a DIFF with its reason, the summary counts add up, and a remote database is refused.
//
// Uses its own local MongoDB database (reportsreconcile_test; collections cleared before each test, the database is
// not dropped; skipped when MongoDB is not reachable).
//   Run: node --test test-reports-reconcile.js
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const URI = process.env.RECONCILE_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/reportsreconcile_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) throw new Error(`refusing non-local test DB ${URI}`);

const { default: mongoose } = await import('mongoose');
const { default: moment } = await import('moment-timezone');
const { main } = await import('./scripts/reports-reconcile.js');
const { listKpis } = await import('./app/lib/reporting/registry.js');

const { ObjectId } = mongoose.Types;
const TZ = 'America/Chicago';
const DEALER = new ObjectId('66f0000000000000000bd001');
const at = (local) => moment.tz(local, 'YYYY-MM-DD HH:mm', TZ).toDate();
const day = (d) => moment.tz(d, 'YYYY-MM-DD', TZ).startOf('day').toDate();
const NOW = at('2026-11-10 12:00');
const ARGS = ['--uri', URI, '--dealer', String(DEALER), '--from', '2026-11-02', '--to', '2026-11-03'];
const COLLECTIONS = ['users', 'leads', 'bookings', 'emails', 'customers', 'activitylogs'];

let client = null;
let db = null;

before(async () => {
  try {
    client = await new mongoose.mongo.MongoClient(URI, { serverSelectionTimeoutMS: 2000 }).connect();
    db = client.db();
  } catch {
    client = null;
  }
});

after(async () => {
  if (client) await client.close();
});

beforeEach(async () => {
  if (!db) return;
  for (const c of COLLECTIONS) await db.collection(c).deleteMany({});
  await seed();
});

const L = [1, 2, 3, 4].map((n) => new ObjectId(`66f0000000000000000be00${n}`));

async function seed() {
  const dealer_id = String(DEALER);
  await db.collection('users').insertOne({ _id: DEALER, role: 'dealer', dealer_account_information: { time_zone: TZ } });
  await db.collection('leads').insertMany([
    { _id: L[0], dealer_id, name: 'Ann', fe_lead_status: 'Appointment Booked', createdAt: at('2026-11-02 09:00') },
    { _id: L[1], dealer_id, name: 'Bob', fe_lead_status: 'Visited', createdAt: at('2026-11-02 10:00') },
    // 23:30 local on the 3rd is the 4th in UTC: still in range in the dealer's days.
    { _id: L[2], dealer_id, name: 'Cy', fe_lead_status: 'Lead', createdAt: at('2026-11-03 23:30') },
    { _id: L[3], dealer_id, name: 'Di', fe_lead_status: 'Appointment Booked', createdAt: at('2026-10-20 09:00') },
  ]);
  const booking = (lead, created, date, time, extra) => ({ dealer_id, lead_id: String(lead), customerName: 'x',
    createdAt: at(created), bookingDate: day(date), bookingTime: time, booking_status: 'confirmed',
    appointment_type: 'sales', ...extra });
  await db.collection('bookings').insertMany([
    booking(L[0], '2026-11-02 09:30', '2026-11-03', '10:00', { created_by: 'ai', showed: true }),
    booking(L[1], '2026-11-02 10:30', '2026-11-02', '16:00', { created_by: 'staff' }), // shown: lead is Visited
    booking(L[3], '2026-10-20 09:30', '2026-11-03', '15:00', { created_by: 'staff' }), // scheduled, no-show
    booking(L[2], '2026-11-03 23:40', '2026-11-05', '11:00', { created_by: 'staff', booking_status: 'cancelled' }),
  ]);
  await db.collection('emails').insertMany([
    { dealer_id, lead_id: L[0], status: 'received', communication_type: 'sms', mail_content: 'yes',
      timestamp: at('2026-11-02 09:20') },
    { dealer_id, lead_id: L[0], status: 'delivered', communication_type: 'sms', ai_generated: true,
      mail_content: 'Great, see you', timestamp: at('2026-11-02 09:25') },
  ]);
}

async function snapshot() {
  const out = { names: (await db.listCollections().toArray()).map((c) => c.name).sort() };
  for (const c of out.names) {
    const docs = await db.collection(c).find({}).sort({ _id: 1 }).toArray();
    out[c] = { count: docs.length, hash: createHash('sha256').update(JSON.stringify(docs)).digest('hex') };
  }
  return out;
}

const byId = (out) => new Map(out.results.map((r) => [r.id, r]));

test('reconcile: writes nothing; Reports = Dashboard = raw for leads and appointments; summary adds up', async (t) => {
  if (!db) return t.skip(`MongoDB not reachable at ${URI}`);
  const before = await snapshot();
  const lines = [];
  const out = await main(ARGS, { log: (l) => lines.push(l), now: NOW });
  assert.equal(out.error, undefined);
  assert.deepEqual(await snapshot(), before, 'the script changed the database');

  assert.equal(out.tz, TZ);
  const r = byId(out);
  const expect = { leads: 3, made: 3, scheduled: 3, shown: 2 };
  for (const [id, want] of [['leads.received', expect.leads], ['exec.leads_received', expect.leads],
    ['appt.made', expect.made], ['exec.appointments_set', expect.made], ['appointments.set', expect.made],
    ['appt.scheduled', expect.scheduled], ['exec.appointments_scheduled', expect.scheduled],
    ['appointments.scheduled', expect.scheduled], ['appt.shown', expect.shown], ['exec.shown', expect.shown],
    ['appointments.shown', expect.shown]]) {
    const row = r.get(id);
    assert.equal(row.reports, String(want), `${id} reports`);
    assert.equal(row.dash, want, `${id} dashboard`);
    assert.equal(row.raw, want, `${id} raw`);
    assert.equal(row.status, 'OK', id);
  }
  assert.equal(r.get('exec.leads_received').drill, 3);
  assert.equal(r.get('appointments.cancelled').raw, 1);
  assert.equal(r.get('appointments.cancelled').status, 'OK');
  assert.equal(r.get('appointments.show_rate').reports, '2 / 3 = 66.67%');
  assert.equal(r.get('appointments.by_ai').status, 'OK');
  assert.equal(r.get('ai.messages_sent').status, 'OK');

  const kpis = listKpis();
  assert.equal(out.results.length, kpis.length);
  assert.equal(out.summary.BLOCKED, kpis.filter((k) => k.state !== 'live').length);
  const tally = {};
  for (const row of out.results) tally[row.status] = (tally[row.status] || 0) + 1;
  for (const s of ['OK', 'DIFF', 'NO-COMPARE', 'BLOCKED']) assert.equal(out.summary[s], tally[s] || 0, s);
  assert.equal(out.summary.DIFF, 0);
  assert.ok(lines.some((l) => l.startsWith(`Summary: ${kpis.length} KPIs  OK ${out.summary.OK}  DIFF 0`)));
});

test('reconcile: a duplicate booking is a DIFF with its reason, listed again in the summary', async (t) => {
  if (!db) return t.skip(`MongoDB not reachable at ${URI}`);
  const first = await db.collection('bookings').findOne({ lead_id: String(L[0]) });
  const { _id, ...copy } = first; // eslint-disable-line no-unused-vars
  await db.collection('bookings').insertOne({ ...copy, createdAt: at('2026-11-02 09:31') });
  const lines = [];
  const out = await main(ARGS, { log: (l) => lines.push(l), now: NOW });
  const set = byId(out).get('appointments.set');
  assert.equal(set.status, 'DIFF');
  assert.equal(set.reports, '3');
  assert.equal(set.dash, 4);
  assert.match(set.diff, /reports 3 vs dashboard 4 \(-1\)/);
  assert.match(set.reason, /duplicate/i);
  assert.equal(byId(out).get('appt.made').status, 'OK'); // the old Dashboard rule counts duplicates too
  assert.equal(out.summary.DIFF, out.diffs.length);
  assert.ok(out.diffs.some((d) => d.id === 'appointments.set'));
  const tail = lines.slice(lines.findIndex((l) => l === 'Differences:'));
  assert.ok(tail.some((l) => l.startsWith('  appointments.set: reports 3 vs dashboard 4')));
});

test('reconcile: refuses a remote database and bad arguments without connecting', async () => {
  const remote = await main(['--uri', 'mongodb://db.example.com:27017/x', '--dealer', String(DEALER),
    '--from', '2026-11-02', '--to', '2026-11-03'], { log: () => {} });
  assert.match(remote.error, /non-local/);
  assert.match((await main(['--uri', URI, '--dealer', String(DEALER), '--from', '2026-11-03', '--to', '2026-11-02']))
    .error, /from <= to/);
  assert.match((await main([])).error, /Usage/);
  assert.equal(mongoose.connection.readyState, 0);
});
