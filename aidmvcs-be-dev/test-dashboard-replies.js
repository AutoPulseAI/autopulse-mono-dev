// Dashboard "Customer replies by lead age" (P1 plan item 2, G-043..G-047) and the appointment split (item 3):
// the reply-handler and lead-arrival fixes, and the two guarded, feature-gated routes. MongoDB tests use their own
// local database (dashreplies_test, wiped before each test and dropped at the end; skipped when MongoDB is not
// reachable). No email, SMS or AI-service call is made.   Run: node --test test-dashboard-replies.js
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Next.js resolves "@lib/x", "@models/x" and extensionless imports; plain Node needs this small resolver.
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

process.env.MONGODB_URI = process.env.DASHREPLIES_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/dashreplies_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.MONGODB_URI)) {
  throw new Error(`refusing non-local test DB ${process.env.MONGODB_URI}`);
}
process.env.JWT_SECRET = 'dashreplies-test-jwt-secret';
delete process.env.FEATURE_TEST_DEALERS;
delete process.env.CRM_LIVE_DB;

const { default: mongoose } = await import('mongoose');
const { default: jwt } = await import('jsonwebtoken');
const { default: moment } = await import('moment-timezone');
const { default: User } = await import('./app/models/User.js');
const { default: Lead } = await import('./app/models/Lead.js');
const { default: Email } = await import('./app/models/Email.js');
const { default: Booking } = await import('./app/models/Booking.js');
const { contactedLeadIds, isLeadArrivalRow, repliedLeadIds, repliedSplit } = await import('./app/lib/contactedLeads.js');
const { handlersFor, replyCohorts } = await import('./app/lib/reporting/replyCohorts.js');
const { localDayRange } = await import('./app/lib/reporting/time.js');
const replyRoute = await import('./app/api/reports/reply-cohorts/route.js');
const splitRoute = await import('./app/api/reports/appointment-split/route.js');

const NY = 'America/New_York';
const DAY = '2026-11-05';
const at = (local) => moment.tz(local, 'YYYY-MM-DD HH:mm', NY).toDate();
const id = (n) => new mongoose.Types.ObjectId(`66f0000000000000000d${String(n).padStart(4, '0')}`);
const ADMIN = id(1), DEALER_A = id(2), DEALER_B = id(3), STAFF_A = id(4);
const tokenFor = (userId, extra = {}) => jwt.sign({ userId: String(userId), ...extra }, process.env.JWT_SECRET);
const bearer = (userId, extra) => ({ Authorization: `Bearer ${tokenFor(userId, extra)}` });
const range = (from = DAY, to = from) => {
  const { start, end } = localDayRange(from, to, NY);
  return `start_date=${start.toISOString()}&end_date=${end.toISOString()}`;
};
const get = (route, path, headers = {}) => route.GET(new Request(`http://localhost:3000${path}`, { headers }));

// --- pure ------------------------------------------------------------------------------------------------------

test('handler: a failed / undelivered / bounced / pending answer is not a response; the next one sent is', () => {
  const L = 'lead1';
  const m = (mid, local, extra) => ({ _id: mid, lead_id: L, timestamp: at(local), ...extra });
  const r = (rid, local) => ({ email_id: rid, lead_id: L, reply_at: at(local) });
  const msgs = [
    m('r1', '2026-11-05 09:00', { status: 'received' }),
    m('f1', '2026-11-05 09:01', { status: 'failed', ai_generated: true }),
    m('s1', '2026-11-05 09:05', { status: 'sent', message_by: 'u1' }),
    m('r2', '2026-11-05 10:00', { status: 'received' }),
    m('u1', '2026-11-05 10:01', { status: 'undelivered', ai_generated: true }),
    m('b1', '2026-11-05 10:02', { status: 'bounced', message_by: 'u1' }),
    m('p1', '2026-11-05 10:03', { status: 'pending', message_by: 'u1' }),
    m('e1', '2026-11-05 10:04', { status: 'error' }),
    m('r3', '2026-11-05 11:00', { status: 'received' }),
    m('d1', '2026-11-05 11:02', { status: 'delivered', ai_generated: true }),
  ];
  const h = handlersFor([r('r1', '2026-11-05 09:00'), r('r2', '2026-11-05 10:00'), r('r3', '2026-11-05 11:00')], msgs,
    { tz: NY });
  assert.equal(h.get('r1'), 'staff'); // the failed AI text is skipped; staff's sent message answered
  assert.equal(h.get('r2'), 'unanswered'); // nothing reached the customer before they wrote again
  assert.equal(h.get('r3'), 'ai');
});

test('isLeadArrivalRow: leadworker shape and timing only', () => {
  const created = at('2026-11-05 09:00');
  const row = { status: 'incoming', parent_message_id: null, parent_conversation: null,
    timestamp: new Date(created.getTime() + 300) };
  assert.equal(isLeadArrivalRow(row, created), true);
  assert.equal(isLeadArrivalRow({ ...row, timestamp: new Date(created.getTime() + 60_000) }, created), false);
  assert.equal(isLeadArrivalRow({ ...row, status: 'received' }, created), false);
  assert.equal(isLeadArrivalRow({ ...row, parent_conversation: '' }, created), false);
  const { parent_message_id: _drop, ...noField } = row;
  assert.equal(isLeadArrivalRow(noField, created), false);
  assert.equal(isLeadArrivalRow(row, null), false);
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
  await mongoose.connection.dropDatabase();
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
  await Lead.collection.insertOne({ _id, dealer_id: String(DEALER_A), name: 'Pat Lee', createdAt, updatedAt: createdAt,
    ...extra });
  return _id;
}
async function seedEmail(leadId, timestamp, extra = {}) {
  const _id = new mongoose.Types.ObjectId();
  await Email.collection.insertOne({ _id, dealer_id: String(DEALER_A), lead_id: leadId, timestamp, date: timestamp,
    sender: '+15550001111', status: 'received', communication_type: 'sms', mail_content: 'hi', is_note: false,
    message_id: `SM${_id}`, ...extra });
  return _id;
}
// Exactly what app/worker/leadworker.js writes for a dealer without the live AI (the lead form's comments), a moment
// after the lead is saved.
const arrivalRow = (leadId, createdAt, extra = {}) => seedEmail(leadId, new Date(createdAt.getTime() + 250), {
  message_id: `msg-${createdAt.getTime() + 240}`, recipient: '+15559990000', parent_message_id: null,
  parent_conversation: null, subject: '', mail_content: 'Is the truck still available?', status: 'incoming',
  user_language: 'english', ...extra });

maybe('arrival: the non-AI lead arrival row is not a reply (card, Contacted filter and the new section)', async () => {
  const created = at('2026-11-05 09:00');
  const textLead = await seedLead(created);
  const emailLead = await seedLead(created);
  await arrivalRow(textLead, created);
  await arrivalRow(emailLead, created, { communication_type: 'email', message_id: '<abc@mail.example>' });
  // The outbound row leadworker saves next to it (same message id), as a draft.
  await seedEmail(textLead, new Date(created.getTime() + 1300), { message_id: `msg-${created.getTime() + 240}`,
    status: 'draft', parent_message_id: `msg-${created.getTime() + 240}` });
  const { start, end } = localDayRange(DAY, DAY, NY);
  assert.deepEqual(await repliedLeadIds([textLead, emailLead], start, end), []);
  assert.deepEqual(await contactedLeadIds([textLead, emailLead], { rule: { customer_texts: 1, customer_emails: 1 } }), []);
  const split = await repliedSplit([{ _id: textLead, createdAt: created }, { _id: emailLead, createdAt: created }],
    start, end);
  assert.equal(split.new_leads, 0);
  const r = await replyCohorts({ dealerId: String(DEALER_A), from: DAY, tz: NY });
  assert.equal(r.totals.customers_replied, 0);
  assert.equal(r.totals.inbound_messages, 0);
});

maybe('arrival: a real customer reply one minute later still counts', async () => {
  const created = at('2026-11-05 09:00');
  const textLead = await seedLead(created);
  const emailLead = await seedLead(created);
  const oddLead = await seedLead(created);
  await arrivalRow(textLead, created);
  await arrivalRow(emailLead, created, { communication_type: 'email' });
  await arrivalRow(oddLead, created);
  const minute = new Date(created.getTime() + 60_000);
  await seedEmail(textLead, minute); // a text: saved 'received' (api/system/sms)
  await seedEmail(emailLead, minute, { status: 'incoming', communication_type: 'email', message_id: '<r1@mail.example>',
    parent_conversation: '<abc@mail.example>', parent_message_id: '<abc@mail.example>' }); // an email reply
  // Even a row shaped like the arrival row counts once it is outside the arrival moment.
  await arrivalRow(oddLead, minute, { timestamp: minute, message_id: 'msg-2' });
  const { start, end } = localDayRange(DAY, DAY, NY);
  const got = (await repliedLeadIds([textLead, emailLead, oddLead], start, end)).map((x) => String(x._id)).sort();
  assert.deepEqual(got, [textLead, emailLead, oddLead].map(String).sort());
  assert.equal((await contactedLeadIds([textLead, emailLead, oddLead], { rule: { customer_texts: 1, customer_emails: 1 } }))
    .length, 3);
  const r = await replyCohorts({ dealerId: String(DEALER_A), from: DAY, tz: NY });
  assert.equal(r.totals.inbound_messages, 3);
  assert.equal(r.totals.todays_leads_replied, 3);
});

maybe('arrival: an older lead whose arrival row is old is unaffected; the AI "lead-" row stays excluded', async () => {
  const old = at('2026-10-01 09:00');
  const lead = await seedLead(old);
  await arrivalRow(lead, old);
  await seedEmail(lead, at('2026-11-05 10:00'));
  const aiLead = await seedLead(at('2026-11-05 09:30'));
  await seedEmail(aiLead, new Date(at('2026-11-05 09:30').getTime() + 100), { message_id: `lead-${aiLead}`,
    status: 'incoming' });
  const r = await replyCohorts({ dealerId: String(DEALER_A), from: DAY, tz: NY });
  assert.equal(r.totals.inbound_messages, 1);
  assert.equal(r.buckets.d30_59, 1);
});

maybe('reply-cohorts route: 401 without sign-in, 403 for another dealer, 404 while the feature is hidden', async () => {
  const path = `/api/reports/reply-cohorts?dealer_id=${DEALER_A}&${range()}`;
  assert.equal((await get(replyRoute, path)).status, 401);
  assert.equal((await get(replyRoute, path, bearer(DEALER_B))).status, 403);
  assert.equal((await get(replyRoute, path, bearer(DEALER_A))).status, 404); // 'admin' level: dealers don't see it
  assert.equal((await get(replyRoute, path, bearer(STAFF_A))).status, 404);
  assert.equal((await get(splitRoute, path.replace('reply-cohorts', 'appointment-split'))).status, 401);
  assert.equal((await get(splitRoute, path.replace('reply-cohorts', 'appointment-split'), bearer(DEALER_B))).status, 403);
  assert.equal((await get(splitRoute, path.replace('reply-cohorts', 'appointment-split'), bearer(DEALER_A))).status, 404);
});

maybe('reply-cohorts route: super admin (direct or "login as") gets the counts; rows only with rows=1', async () => {
  const lead = await seedLead(at('2026-10-20 09:00'), { name: 'Jordan Fox' });
  await seedEmail(lead, at('2026-11-05 10:00'));
  await seedEmail(lead, at('2026-11-05 10:05'), { status: 'sent', message_by: STAFF_A });
  const path = `/api/reports/reply-cohorts?dealer_id=${DEALER_A}&${range()}`;
  let res = await get(replyRoute, path, bearer(ADMIN));
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.range.from, DAY);
  assert.equal(body.totals.customers_replied, 1);
  assert.equal(body.totals.past_leads_replied, 1);
  assert.equal(body.buckets.d15_29, 1);
  assert.equal(body.rows, undefined);
  assert.equal(body.units, undefined);
  // "Login as": the dealer's token stamped impersonated_by the admin.
  res = await get(replyRoute, `${path}&rows=1`, bearer(DEALER_A, { impersonated_by: String(ADMIN),
    impersonator_type: 'admin' }));
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].customer_name, 'Jordan Fox');
  assert.equal(body.rows[0].age_days, 16);
  assert.equal(body.rows[0].handler, 'staff');
  assert.equal(body.rows[0].channel, 'sms');
  // All time (no dates): 400 for a caller who can see it.
  assert.equal((await get(replyRoute, `/api/reports/reply-cohorts?dealer_id=${DEALER_A}`, bearer(ADMIN))).status, 400);
});

maybe('appointment-split route: AI / AI-assisted / human-only / unknown for the admin', async () => {
  const lead = await seedLead(at('2026-10-20 09:00'));
  await seedEmail(lead, at('2026-11-04 09:00'), { status: 'delivered', ai_generated: true });
  const booking = (createdBy, extra = {}) => Booking.collection.insertOne({ dealer_id: String(DEALER_A),
    lead_id: String(lead), customerName: 'C', bookingDate: at('2026-11-07 00:00'), bookingTime: '10:00',
    booking_status: 'pending', createdAt: at('2026-11-05 12:00'), updatedAt: at('2026-11-05 12:00'),
    ...(createdBy ? { created_by: createdBy } : {}), ...extra });
  await booking('ai', { bookingTime: '09:00' });
  await booking('staff', { bookingTime: '10:00' });
  await booking('customer', { bookingTime: '11:00' });
  await booking(null, { bookingTime: '12:00' });
  const res = await get(splitRoute, `/api/reports/appointment-split?dealer_id=${DEALER_A}&${range()}`, bearer(ADMIN));
  assert.equal(res.status, 200);
  const { totals } = await res.json();
  assert.deepEqual({ ai: totals.ai, ai_assisted: totals.ai_assisted, human_only: totals.human_only,
    unknown: totals.unknown, total: totals.total }, { ai: 1, ai_assisted: 1, human_only: 0, unknown: 2, total: 4 });
});
