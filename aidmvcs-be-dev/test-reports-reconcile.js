// scripts/reports-reconcile.js: on a small seeded dealer it writes nothing (every collection's documents unchanged),
// Reports = Dashboard = raw for leads received and appointments made / scheduled / shown, a duplicate booking shows
// up as a DIFF with its reason, the summary counts add up, a remote database is refused, and on a rich dealer every
// live KPI's independent raw count equals Reports with the inbound difference explained item by item.
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
const COLLECTIONS = ['users', 'leads', 'bookings', 'emails', 'customers', 'activitylogs', 'ai_call_tasks',
  'ai_lead_state', 'ai_touches', 'ai_customer_status', 'ai_vehicle_ownership', 'ai_service_events', 'ai_consent',
  'ai_compliance_log', 'campaignleads', 'dealervaultimportbatches', 'vehicleclicks', 'dealerwebsiteclicks'];

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
    booking(L[1], '2026-11-02 10:30', '2026-11-02', '16:00', { created_by: 'staff', created_by_name: 'Sam Staff' }), // shown: lead is Visited
    booking(L[3], '2026-10-20 09:30', '2026-11-03', '15:00', { created_by: 'staff' }), // scheduled, no-show
    booking(L[2], '2026-11-03 23:40', '2026-11-05', '11:00', { created_by: 'staff', booking_status: 'cancelled',
      cancelled_at: at('2026-11-03 23:50'), cancelled_by: 'staff' }),
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

// A dealer with something in (nearly) every KPI, including the cases the definitions exclude: the independent raw
// count must equal Reports for every live KPI, and the Dashboard's inbound count must be explained item by item.
async function seedRich() {
  const d = String(DEALER);
  const OTHER = new ObjectId('66f0000000000000000bd0ff');
  const STAFF = new ObjectId('66f0000000000000000bd0aa');
  const id = (n) => new ObjectId(`66f0000000000000000bf${String(n).padStart(3, '0')}`);
  const C = [id(901), id(902), id(903), id(904)];
  await db.collection('customers').insertMany([
    { _id: C[0], dealer_id: d, name: 'Kept', phones: [{ value: '+1 (555) 100-0001' }], createdAt: at('2026-11-02 08:00'),
      merge_history: [{ merged_customer_id: C[1], merged_at: at('2026-11-03 09:00') }] },
    { _id: C[1], dealer_id: d, name: 'Merged', merged_into: C[0], createdAt: at('2026-10-01 08:00') },
    { _id: C[2], dealer_id: d, name: 'Dup', phones: [{ value: '5551000001' }], createdAt: at('2026-11-03 08:00') },
    { _id: C[3], dealer_id: d, name: 'Email', emails: [{ value: 'x@y.test' }], createdAt: at('2026-11-02 08:00') },
  ]);
  await db.collection('leads').insertMany([
    // Age 90 and 91 on 3 Nov, a merged customer, a legacy status, a campaign lead, an assigned lead.
    { _id: id(1), dealer_id: d, name: 'Ninety', fe_lead_status: 'Lead', createdAt: at('2026-08-05 09:00') },
    { _id: id(2), dealer_id: d, name: 'NinetyOne', fe_lead_status: 'visited', createdAt: at('2026-08-04 09:00') },
    { _id: id(3), dealer_id: d, name: 'Merged', customer_id: C[1], fe_lead_status: 'Sold', lead_source: 'campaign_fall',
      assigned_to: String(STAFF), createdAt: at('2026-11-02 07:00') },
    { _id: id(4), dealer_id: d, name: 'Arrival', fe_lead_status: 'Lead', lead_source: 'CarGurus',
      createdAt: at('2026-11-02 11:00') },
    { _id: id(5), dealer_id: String(OTHER), name: 'Elsewhere', createdAt: at('2026-10-01 09:00') },
  ]);
  const m = (o) => ({ dealer_id: d, communication_type: 'sms', status: 'received', mail_content: 'hi', ...o });
  await db.collection('emails').insertMany([
    m({ lead_id: id(1), timestamp: at('2026-11-03 10:00') }),
    m({ lead_id: id(1), timestamp: at('2026-11-03 10:05') }), // same customer-day
    m({ lead_id: id(1), status: 'sent', ai_generated: true, timestamp: at('2026-11-03 10:09') }), // AI answers in 9 min
    m({ lead_id: id(2), timestamp: at('2026-11-03 11:00') }),
    m({ lead_id: id(2), status: 'delivered', message_by: STAFF, timestamp: at('2026-11-03 11:30') }),
    m({ lead_id: id(3), communication_type: 'email', status: 'incoming', parent_message_id: 'x', parent_conversation: 'x',
      timestamp: at('2026-11-02 12:00') }),
    m({ lead_id: id(3), status: 'failed', message_by: STAFF, timestamp: at('2026-11-02 12:30') }),
    m({ lead_id: id(3), status: 'sent', message_by: STAFF, communication_type: 'email', timestamp: at('2026-11-02 12:40') }),
    // On the Dashboard only: the lead's own arrival (AI "lead-" id; non-AI arrival row), a note not flagged is_note,
    // a message on the dealer's lead filed under another dealer_id.
    m({ lead_id: id(4), communication_type: 'email', status: 'incoming', message_id: `lead-${id(4)}`,
      timestamp: at('2026-11-02 11:00') }),
    m({ lead_id: id(4), communication_type: 'email', status: 'incoming', parent_message_id: null,
      parent_conversation: null, timestamp: new Date(at('2026-11-02 11:00').getTime() + 5000) }),
    m({ lead_id: id(4), communication_type: 'note', timestamp: at('2026-11-02 11:10') }),
    m({ lead_id: id(4), dealer_id: String(OTHER), timestamp: at('2026-11-02 11:20') }),
    // On Reports only: lead_id stored as a string.
    m({ lead_id: String(id(4)), timestamp: at('2026-11-03 08:00') }),
    // Not on one of the dealer's leads: no lead, a deleted lead, another dealer's lead.
    m({ sender: '+15552220000', timestamp: at('2026-11-03 09:00') }),
    m({ lead_id: id(999), timestamp: at('2026-11-03 09:00') }),
    m({ lead_id: id(5), timestamp: at('2026-11-03 09:00') }),
    // Never replies: a note, the portal lead email, an ADF body.
    m({ lead_id: id(1), is_note: true, timestamp: at('2026-11-03 12:00') }),
    m({ lead_id: id(1), is_lead_email: true, communication_type: 'email', status: 'incoming', timestamp: at('2026-11-03 12:00') }),
    m({ lead_id: id(1), communication_type: 'email', status: 'incoming', mail_content: '<?adf version="1.0"?><adf></adf>',
      timestamp: at('2026-11-03 12:00') }),
  ]);
  const b = (lead, o) => ({ dealer_id: d, lead_id: String(lead), customerName: 'x', booking_status: 'confirmed',
    appointment_type: 'sales', bookingTime: '10:00', ...o });
  await db.collection('bookings').insertMany([
    b(id(1), { created_by: 'staff', createdAt: at('2026-11-03 10:30'), bookingDate: day('2026-11-03'), showed: false,
      created_by_user_id: STAFF, created_by_name: 'Pat Staff' }),
    b(id(2), { created_by: 'customer', createdAt: at('2026-11-02 10:30'), bookingDate: day('2026-11-03'),
      history: [{ action: 'rescheduled', at: at('2026-11-05 09:00'), actor_type: 'customer' }] }), // moved after the range // lead 'visited' (lower case): not a show
    b(id(3), { created_by: 'staff', appointment_type: 'service', createdAt: at('2026-11-02 13:00'),
      bookingDate: day('2026-11-04'), bookingTime: '9am' }),
    b(id(3), { created_by: 'staff', appointment_type: 'service', createdAt: at('2026-11-02 13:05'),
      bookingDate: day('2026-11-04'), bookingTime: '9am' }), // duplicate
    b(id(4), { created_by: 'ai', createdAt: at('2026-11-03 09:00'), bookingDate: day('2026-11-02'), booking_status: 'completed',
      history: [{ action: 'rescheduled', at: at('2026-11-03 09:30'), actor_type: 'ai' }] }),
  ]);
  await db.collection('activitylogs').insertMany([
    { dealer_id: d, lead_id: id(3), action: 'status_changed', to: 'Sold', at: at('2026-11-02 15:00') },
    { dealer_id: d, lead_id: id(2), action: 'status_changed', to: 'visited', at: at('2026-11-03 15:00') },
    { dealer_id: d, lead_id: id(2), action: 'status_changed', to: 'Visited', at: at('2026-10-01 15:00') }, // first: out
    { dealer_id: d, lead_id: id(1), action: 'ai_turned_off', at: at('2026-11-03 07:00') },
  ]);
  const task = (o) => ({ dealer_id: d, lead_id: String(id(1)), assigned_to: String(STAFF), ...o });
  await db.collection('ai_call_tasks').insertMany([
    task({ status: 'missed', missed_at: at('2026-11-02 12:00'), closed_at: at('2026-11-02 12:00'), source: 'daily' }),
    task({ status: 'missed', missed_at: at('2026-11-02 17:00'), closed_at: at('2026-11-02 17:00'), source: 'daily' }),
    task({ status: 'completed', outcome: 'connected', missed_at: at('2026-11-03 12:00'), closed_at: at('2026-11-03 14:00') }),
    task({ status: 'open', due_by: at('2026-11-03 18:00') }),
  ]);
  await db.collection('ai_lead_state').insertMany([
    { dealer_id: d, lead_id: String(id(1)), status: 'handoff', status_reason: 'Customer asked for a call: now',
      status_at: at('2026-11-03 10:10') },
    { dealer_id: d, lead_id: String(id(2)), status: 'handoff', status_reason: "AI couldn't write a safe reply",
      status_at: at('2026-11-03 10:10') },
  ]);
  await db.collection('ai_touches').insertMany([
    { dealer_id: d, lead_id: String(id(1)), touch_id: 't1', kind: 'followup', sent_at: at('2026-11-02 09:00'),
      replied_24h: true, replied_72h: true, meaningful_reply: true, appointment_7d: true },
    { dealer_id: d, lead_id: String(id(2)), touch_id: 't2', kind: 'followup', sent_at: at('2026-11-03 09:00'),
      opted_out_at: at('2026-11-03 10:00') },
  ]);
  await db.collection('ai_customer_status').insertMany([
    { dealer_id: d, customer_id: String(C[0]), customer_status: 'ACTIVE' },
    { dealer_id: d, customer_id: String(C[2]), customer_status: 'INACTIVE' }]);
  await db.collection('ai_vehicle_ownership').insertMany([
    { dealer_id: d, customer_id: String(C[0]), vin: 'V1', ownership_status: 'ACTIVE' },
    { dealer_id: d, customer_id: String(C[0]), vin: 'V2', ownership_status: 'ACTIVE' }]);
  await db.collection('ai_service_events').insertOne({ dealer_id: d, customer_facing: true, type: 'recall',
    created_at: at('2026-11-02 09:00') });
  await db.collection('ai_consent').insertOne({ dealer_id: d, lead_id: String(id(2)), consent_type: 'opt_out',
    consent_status: 'opted_out', channel: 'sms', recorded_at: at('2026-11-03 10:00') });
  await db.collection('ai_compliance_log').insertOne({ dealer_id: d, lead_id: String(id(2)), decision: 'BLOCK',
    at: at('2026-11-03 10:30') });
  await db.collection('campaignleads').insertOne({ dealer_id: d, status: 'blocked', updatedAt: at('2026-11-02 10:00') });
  await db.collection('dealervaultimportbatches').insertOne({ dealer_id: d, status: 'failed',
    createdAt: at('2026-11-02 10:00') });
  await db.collection('vehicleclicks').insertMany([{ dealer_id: d, clickedAt: at('2026-11-02 10:00') },
    { dealer_id: d, clickedAt: at('2026-11-02 10:01'), isBot: true }]);
  await db.collection('dealerwebsiteclicks').insertOne({ dealer_id: d, clickedAt: at('2026-11-03 10:00') });
}

// The known Dashboard differences, each with its reason (duplicates, public booking page, customers vs leads, the
// inbound selection).
const DASH_EXPLAINED = /duplicate bookings|public booking page|counts customers|Item by item/;

test('reconcile: every live KPI has an independent raw count equal to Reports; inbound explained item by item', async (t) => {
  if (!db) return t.skip(`MongoDB not reachable at ${URI}`);
  await seedRich();
  const before = await snapshot();
  const lines = [];
  const out = await main(ARGS, { log: (l) => lines.push(l), now: NOW });
  if (process.env.RECONCILE_TEST_PRINT) console.log(lines.join('\n'));
  assert.deepEqual(await snapshot(), before, 'the script changed the database');
  const r = byId(out);
  const live = out.results.filter((x) => x.status !== 'BLOCKED');
  assert.equal(out.summary['NO-COMPARE'], 0);
  for (const x of live) {
    assert.notEqual(x.raw, null, `${x.id} has a raw count`);
    if (x.status === 'DIFF') {
      assert.doesNotMatch(x.diff, /vs raw/, `${x.id}: ${x.diff}`);
      assert.ok(DASH_EXPLAINED.test(x.reason), `${x.id}: unexplained: ${x.reason}`);
    }
  }
  // The fixture really exercises the KPIs: most are non-zero.
  const nonZero = live.filter((x) => !/^(0|0 \/ 0|- \(n=0\))$/.test(String(x.raw))).length;
  assert.ok(nonZero >= 80, `only ${nonZero} non-zero raw counts`);
  assert.equal(r.get('replies.age_60_90').raw, 1);
  assert.equal(r.get('replies.age_over_90').raw, 1);
  assert.equal(r.get('appointments.no_show').raw, 1);
  // Base seed: Di's 15:00 appointment on 3 Nov; rich seed: NinetyOne's ('visited' in lower case is not a Dashboard
  // visit status). Both past with nothing recorded - not no-shows.
  assert.equal(r.get('appointments.not_recorded').raw, 2);
  assert.equal(r.get('bdc.call_tasks_missed').raw, 2);
  assert.equal(r.get('dq.duplicate_bookings').raw, 1);
  // Booking history: one move in the range (the AI), one cancel (staff); set by a staff member: Sam (shown), Pat.
  assert.deepEqual(['appointments.moved', 'appointments.cancelled_by', 'bdc.appointments_by_rep', 'bdc.shows_by_rep']
    .map((k) => [r.get(k).raw, r.get(k).status]), [[1, 'OK'], [1, 'OK'], [2, 'OK'], [1, 'OK']]);
  // Ninety's 10:00 reply is followed by another reply (10:05) before the AI answer: only the 10:05 one is AI-answered
  // (4 min); the base seed's 09:20 reply 5 min. Median 4.5.
  assert.equal(r.get('ai.response_time').raw, '4.5 (n=2)');

  // Inbound: the Dashboard's count (by the dealer's lead ids) vs Reports' (the dealer's messages on its own leads);
  // every difference named.
  const inbound = r.get('replies.inbound_messages');
  assert.equal(inbound.status, 'DIFF');
  assert.match(inbound.diff, /vs dashboard/);
  const why = inbound.why.join('\n');
  for (const reason of [/1 emails.dealer_id is not this dealer/, /1 message_id "lead-\.\.\."/,
    /1 the non-AI lead arrival row/, /1 communication_type "note"/, /\+ 1 lead_id stored as a string/,
    /Not in either number .*: 3/, /1 no lead_id/, /1 lead_id is not a lead/, /1 a lead of another dealer/,
    /not replies at all: 6/, /2 notes/]) assert.match(why, reason);
  const [, dashN, repN, onlyDash, onlyRep] = why.match(/received" (\d+) = Reports (\d+) \+ (\d+) .* - (\d+) /);
  assert.equal(Number(dashN), Number(repN) + Number(onlyDash) - Number(onlyRep));
  assert.equal(Number(dashN), inbound.dash);
  // Missed call tasks: the page's list (2), the old missed_at count (3: one completed later).
  assert.match(r.get('bdc.call_tasks_missed').why.join('\n'), /old count\): 3; 1 of them were completed/);
  assert.ok(lines.some((l) => /^Summary: .* \(raw count on (\d+) of \1 live\)$/.test(l)));
});
