// Daily performance email (P1 plan item 6): rollout modes, idempotent per-recipient delivery, retries, resend audit,
// snapshot parity with the reporting library, dealer-time-zone days, no customer details in the email, and the
// retired old report cron route.
//
// Uses its own local MongoDB database (dailyemail_test, wiped before each test, dropped at the end; override with
// DAILY_EMAIL_TEST_MONGODB_URI - local hosts only). No email leaves the machine: the job is given a recording stub
// sender, and the one test of the real sender path runs with PROVIDER_SEND_STUB=true. Tests needing MongoDB are
// skipped when it is not reachable.   Run: node --test test-daily-email.js
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Next.js resolves "@lib/x", "@models/x", "@utils/x" and extensionless imports; plain Node needs this resolver for
// the old cron route.
const ROOT = pathToFileURL(`${process.cwd()}/`).href;
const loader = `
const ROOT = ${JSON.stringify(ROOT)};
const ALIAS = { '@lib/': 'app/lib/', '@models/': 'app/models/', '@utils/': 'app/utils/' };
export async function resolve(spec, ctx, next) {
  for (const [a, dir] of Object.entries(ALIAS)) if (spec.startsWith(a)) spec = ROOT + dir + spec.slice(a.length);
  try { return await next(spec, ctx); } catch (e) {
    if (!['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(e.code)) throw e;
    for (const tail of ['.js', '/index.js']) { try { return await next(spec + tail, ctx); } catch {} }
    throw e;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

const URI = process.env.DAILY_EMAIL_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/dailyemail_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) throw new Error(`refusing non-local test DB ${URI}`);
process.env.MONGODB_URI = URI;
process.env.JWT_SECRET = 'daily-email-test-jwt';
process.env.NODE_ENV = 'test';
process.env.PROVIDER_SEND_STUB = 'true';
delete process.env.CRON_SECRET;
delete process.env.DAILY_REPORT_INTERNAL_RECIPIENTS;

const { default: mongoose } = await import('mongoose');
const { default: moment } = await import('moment-timezone');
const { default: jwt } = await import('jsonwebtoken');
const { default: User } = await import('./app/models/User.js');
const { default: ReportSchedule } = await import('./app/models/ReportSchedule.js');
const { default: DailyReportDelivery } = await import('./app/models/DailyReportDelivery.js');
const { default: DailyReportSnapshot } = await import('./app/models/DailyReportSnapshot.js');
const { attributeAppointments } = await import('./app/lib/reporting/appointmentAttribution.js');
const { replyCohorts } = await import('./app/lib/reporting/replyCohorts.js');
const settings = await import('./app/lib/reports/settings.js');
const { computeDailySnapshot, getOrBuildSnapshot } = await import('./app/lib/reports/dailySnapshot.js');
const { renderDailyEmail } = await import('./app/lib/reports/dailyEmail.js');
const report = await import('./app/lib/reports/dailyReport.js');
const { PROVIDER_OUTBOX_COLLECTION } = await import('./app/lib/providerStub.js');
const adminRoute = await import('./app/api/admin/daily-report/route.js');
const cronRoute = await import('./app/api/cron/report-service/route.js');

const { ObjectId } = mongoose.Types;
const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
const DAY = '2026-11-09';
// 10:00 on 10 Nov in New York: after the 09:00 default send time, "yesterday" = 9 Nov.
const NOW = moment.tz('2026-11-10 10:00', 'YYYY-MM-DD HH:mm', NY).toDate();
const at = (local, tz = NY) => moment.tz(local, 'YYYY-MM-DD HH:mm', tz).toDate();
const ADMIN = new ObjectId();
const DEALER = new ObjectId();
const DEALER_LA = new ObjectId();
const OTHER_DEALER = new ObjectId();
const INTERNAL_ENV = { DAILY_REPORT_INTERNAL_RECIPIENTS: 'qa@autopulse.test, Ops@AutoPulse.test',
  NEXT_PUBLIC_APP_URL: 'https://crm.example.test' };
const PII = { name: 'Zebulon Quartermaine', email: 'zebulon.q@customer.test', phone: '+15559871234' };

function recordingSender({ failFor = new Set() } = {}) {
  const calls = [];
  const send = async ({ to, subject, html }) => {
    calls.push({ to, subject, html });
    if (failFor.has(to)) throw new Error(`SES rejected ${to}`);
    return `<msg-${calls.length}@test>`;
  };
  return { calls, send };
}

const tokenFor = (id) => jwt.sign({ userId: String(id) }, process.env.JWT_SECRET);
function req(path, { method = 'GET', user = null, body } = {}) {
  const headers = {};
  if (user) headers.Authorization = `Bearer ${tokenFor(user)}`;
  if (body) headers['Content-Type'] = 'application/json';
  return new Request(`http://localhost:3000${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

async function seedDealer(_id, { tz = NY, mode = 'off', recipients = 'gm@dealer.test, owner@dealer.test',
  schedules = [] } = {}) {
  await User.collection.insertOne({ _id, type: 'dealer', name: `Dealer ${_id}`, email: `login-${_id}@dealer.test`,
    password: 'x', dealer_account_information: { time_zone: tz, store_name: 'Sunrise Motors' },
    branding_information: { primaryColor: '#aa3300', dealershipLogo: { url: 'https://cdn.example.test/logo.png' } },
    report_schedule_settings: { enabled: true, default_email: recipients, timezone: tz, schedules,
      ...(mode ? { daily_email_mode: mode } : {}) } });
}

// Activity on DAY (New York): 3 bookings set (AI, staff after an AI message, staff with no AI), one of them
// cancelled; one booking due that day that showed; replies from a new lead and a 40-day-old lead; a lead received.
async function seedActivity(dealerId = DEALER, tz = NY) {
  const d = String(dealerId);
  const leadNew = new ObjectId();
  const leadOld = new ObjectId();
  const leadStaff = new ObjectId();
  const leadPlain = new ObjectId();
  const db = mongoose.connection;
  await db.collection('leads').insertMany([
    { _id: leadNew, dealer_id: d, fname: PII.name, email: PII.email, phone: PII.phone, createdAt: at(`${DAY} 08:00`, tz) },
    { _id: leadOld, dealer_id: d, fname: 'Old', createdAt: at('2026-09-30 10:00', tz) },
    { _id: leadStaff, dealer_id: d, createdAt: at('2026-11-01 10:00', tz) },
    { _id: leadPlain, dealer_id: d, createdAt: at('2026-11-02 10:00', tz) },
  ]);
  await db.collection('emails').insertMany([
    { dealer_id: d, lead_id: leadNew, status: 'received', communication_type: 'sms', sender: PII.phone,
      mail_content: `hi this is ${PII.name}`, timestamp: at(`${DAY} 09:00`, tz) },
    { dealer_id: d, lead_id: leadOld, status: 'received', communication_type: 'email', sender: 'old@customer.test',
      timestamp: at(`${DAY} 11:00`, tz) },
    { dealer_id: d, lead_id: leadNew, status: 'sent', ai_generated: true, communication_type: 'sms',
      timestamp: at(`${DAY} 09:01`, tz) },
    { dealer_id: d, lead_id: leadStaff, status: 'delivered', ai_generated: true, communication_type: 'sms',
      timestamp: at(`${DAY} 07:00`, tz) },
  ]);
  const booking = (o) => ({ dealer_id: d, customerName: PII.name, email: PII.email, phone: PII.phone,
    bookingTime: '10:00', booking_status: 'confirmed', ...o });
  await db.collection('bookings').insertMany([
    booking({ lead_id: String(leadNew), created_by: 'ai', createdAt: at(`${DAY} 09:02`, tz), bookingDate: at('2026-11-12 10:00', tz) }),
    booking({ lead_id: String(leadStaff), created_by: 'staff', createdAt: at(`${DAY} 12:00`, tz), bookingDate: at('2026-11-13 10:00', tz) }),
    booking({ lead_id: String(leadPlain), created_by: 'staff', createdAt: at(`${DAY} 13:00`, tz), bookingDate: at('2026-11-14 10:00', tz), booking_status: 'cancelled' }),
    booking({ lead_id: String(leadOld), created_by: 'staff', createdAt: at('2026-11-05 13:00', tz), bookingDate: at(`${DAY} 10:00`, tz), showed: true }),
    // Due that day, set earlier, no outcome recorded: its time has passed, so it is a no-show.
    booking({ lead_id: String(leadPlain), created_by: 'staff', createdAt: at('2026-11-01 13:00', tz),
      bookingDate: at(`${DAY} 00:00`, tz), bookingTime: '15:00', booking_status: 'pending' }),
  ]);
}

let connected = false;
before(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 2_000 });
    connected = true;
  } catch (error) {
    console.error('MongoDB connect failed:', error?.message);
    connected = false;
  }
  if (!connected) return;
  // Create the database, collections and indexes ONCE and only empty them between tests. Dropping and recreating
  // the database before every test makes mongod open new files each time; the local container has a 1024 file
  // limit and aborted (WiredTiger EMFILE) under that churn.
  await mongoose.connection.dropDatabase();
  await DailyReportDelivery.createIndexes();
  await DailyReportSnapshot.createIndexes();
});
after(async () => {
  if (connected) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});
beforeEach(async () => {
  if (!connected) return;
  const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  await Promise.all(collections.map((c) => mongoose.connection.collection(c.name).deleteMany({})));
  await User.collection.insertOne({ _id: ADMIN, type: 'admin', name: 'Admin', email: 'admin@autopulse.test', password: 'x' });
});
const needDb = (t) => { if (!connected) { t.skip(`MongoDB not reachable at ${URI}`); return true; } return false; };

// --- pure -----------------------------------------------------------------------------------------------------

test('settings: every dealer is off unless set; recipients and send time', () => {
  assert.equal(settings.dailyEmailMode({}), 'off');
  assert.equal(settings.dailyEmailMode({ report_schedule_settings: { daily_email_mode: 'bogus' } }), 'off');
  const dealer = { email: 'login@d.test', report_schedule_settings: { default_email: 'A@d.test; b@d.test, bad, a@d.test',
    schedules: [{ frequency: 'weekly', time: '07:00', active: true }, { frequency: 'daily', time: '7:30', active: false },
      { frequency: 'daily', time: '08:15', active: true }] } };
  assert.deepEqual(settings.resolveRecipients(dealer, { mode: 'off' }), []);
  assert.deepEqual(settings.resolveRecipients(dealer, { mode: 'live' }), ['a@d.test', 'b@d.test']);
  assert.deepEqual(settings.resolveRecipients(dealer, { mode: 'internal', env: INTERNAL_ENV }),
    ['qa@autopulse.test', 'ops@autopulse.test']);
  assert.deepEqual(settings.resolveRecipients(dealer, { mode: 'internal', env: {} }), []);
  assert.equal(settings.sendTimeFor(dealer), '08:15');
  assert.equal(settings.sendTimeFor({}), '09:00');
  assert.deepEqual(settings.dealerRecipients({ email: 'login@d.test', report_schedule_settings: {} }), ['login@d.test']);
});

test('dealer time zone: yesterday and send time are read in the dealer zone', () => {
  // 02:30 UTC on 10 Nov is still 9 Nov 18:30 in Los Angeles.
  const t = new Date('2026-11-10T02:30:00Z');
  assert.equal(settings.yesterdayLocal(t, LA), '2026-11-08');
  assert.equal(settings.yesterdayLocal(t, 'UTC'), '2026-11-09');
  assert.equal(settings.sendTimePassed(at('2026-11-10 08:59', LA), LA, '09:00'), false);
  assert.equal(settings.sendTimePassed(at('2026-11-10 09:00', LA), LA, '09:00'), true);
});

test('render: stale sources show a warning and "—", not 0', () => {
  const snapshot = { report_date: DAY, tz: NY, data_as_of: NOW, unavailable: ['appointments.rescheduled'],
    metrics: { appointments: { total: 0, ai: 0, ai_assisted: 0, human_only: 0, unknown: 0, ai_influenced: 0,
      ai_influence_pct: null, cancelled: 0 }, appointments_due: null, replies: null, leads: null, ai_activity: null },
    stale_sources: [{ source: 'replies', reason: 'boom', affects: ['replies', 'leads'] }] };
  const { html, text } = renderDailyEmail({ snapshot, dashboardUrl: 'https://crm.example.test/dealer/dashboard' });
  assert.match(html, /Some data may be incomplete/);
  assert.match(html, /Customer replies/);
  assert.match(text, /today's leads — \| past leads — \| total —/);
  assert.match(text, /Leads received: —/);
  assert.match(html, /overlapping groups/i);
  assert.match(html, /href="https:\/\/crm\.example\.test\/dealer\/dashboard"/);
  // Appointments were computed (0 is a real 0 here) and show 0.
  assert.match(text, /Total appointments set: 0/);
});

test('render: store name and branding are escaped / validated', () => {
  const snapshot = { report_date: DAY, tz: NY, data_as_of: NOW, metrics: {}, stale_sources: [] };
  const { html } = renderDailyEmail({ snapshot, dealer: { name: '<script>x</script>',
    branding_information: { primaryColor: 'red;background:url(x)', dealershipLogo: { url: 'javascript:alert(1)' } } } });
  assert.ok(!html.includes('<script>x'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('#0272b4'));
});

// --- MongoDB ----------------------------------------------------------------------------------------------------

test('mode off (the default): the tick queues nothing and the job sends nothing', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER, { mode: null }); // no field at all, like every dealer today
  await seedDealer(OTHER_DEALER, { mode: 'off' });
  await seedActivity();
  const queued = [];
  const tick = await report.dailyReportTick({ now: NOW, env: INTERNAL_ENV, enqueue: async (d, id) => queued.push(id) });
  assert.equal(tick.checked, 0);
  assert.deepEqual(queued, []);
  const { calls, send } = recordingSender();
  const res = await report.runDailyReport({ dealerId: String(DEALER), reportDate: DAY, now: NOW, env: INTERNAL_ENV, send });
  assert.equal(res.reason, 'mode_off');
  assert.equal(calls.length, 0);
  assert.equal(await DailyReportDelivery.countDocuments(), 0);
  assert.equal(await DailyReportSnapshot.countDocuments(), 0);
  const fresh = await User.findById(DEALER);
  assert.equal(fresh.report_schedule_settings.daily_email_mode, 'off');
});

test('internal: sends only to the internal list, never to the dealer', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER, { mode: 'internal' });
  await seedActivity();
  const queued = [];
  await report.dailyReportTick({ now: NOW, env: INTERNAL_ENV, enqueue: async (d, id) => queued.push({ d, id }) });
  assert.deepEqual(queued.map((q) => q.id), [`daily:${DEALER}:${DAY}`]);
  const { calls, send } = recordingSender();
  await report.runDailyReport({ ...queued[0].d, now: NOW, env: INTERNAL_ENV, send });
  assert.deepEqual(calls.map((c) => c.to).sort(), ['ops@autopulse.test', 'qa@autopulse.test']);
  assert.ok(calls.every((c) => /^\[Internal test/.test(c.subject)));
  const rows = await DailyReportDelivery.find().lean();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.status === 'sent' && r.mode === 'internal' && r.provider_message_id && r.attempts === 1));
  // No internal list configured -> nothing at all.
  const none = recordingSender();
  await DailyReportDelivery.deleteMany({});
  const res = await report.runDailyReport({ dealerId: String(DEALER), reportDate: DAY, now: NOW, env: {}, send: none.send });
  assert.equal(res.reason, 'no_recipients');
  assert.equal(none.calls.length, 0);
});

test('same day twice: one send per recipient; the tick stops queuing once delivered', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER, { mode: 'live' });
  await seedActivity();
  const { calls, send } = recordingSender();
  const args = { dealerId: String(DEALER), reportDate: DAY, now: NOW, env: INTERNAL_ENV, send };
  await report.runDailyReport(args);
  const second = await report.runDailyReport(args);
  await Promise.all([report.runDailyReport(args), report.runDailyReport(args)]); // concurrent duplicates
  assert.deepEqual(calls.map((c) => c.to).sort(), ['gm@dealer.test', 'owner@dealer.test']);
  assert.ok(second.results.every((r) => r.skipped));
  assert.equal(await DailyReportDelivery.countDocuments(), 2);
  assert.equal(await DailyReportSnapshot.countDocuments(), 1);
  const queued = [];
  await report.dailyReportTick({ now: NOW, env: INTERNAL_ENV, enqueue: async (d, id) => queued.push(id) });
  assert.deepEqual(queued, []);
});

test('a failed recipient is retried without re-sending the others', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER, { mode: 'live' });
  await seedActivity();
  const first = recordingSender({ failFor: new Set(['owner@dealer.test']) });
  const args = { dealerId: String(DEALER), reportDate: DAY, now: NOW, env: INTERNAL_ENV };
  await assert.rejects(report.runDailyReport({ ...args, send: first.send }), /1 of 2 recipient\(s\) failed/);
  let owner = await DailyReportDelivery.findOne({ recipient: 'owner@dealer.test' }).lean();
  assert.equal(owner.status, 'failed');
  assert.match(owner.last_error, /SES rejected/);
  // The tick still sees the day as not delivered.
  const queued = [];
  await report.dailyReportTick({ now: NOW, env: INTERNAL_ENV, enqueue: async (d, id) => queued.push(id) });
  assert.equal(queued.length, 1);
  const retry = recordingSender();
  await report.runDailyReport({ ...args, send: retry.send });
  assert.deepEqual(retry.calls.map((c) => c.to), ['owner@dealer.test']);
  owner = await DailyReportDelivery.findOne({ recipient: 'owner@dealer.test' }).lean();
  assert.equal(owner.status, 'sent');
  assert.equal(owner.attempts, 2);
  const gm = await DailyReportDelivery.findOne({ recipient: 'gm@dealer.test' }).lean();
  assert.equal(gm.attempts, 1);
});

test('one dealer failing does not block another dealer in the tick', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER, { mode: 'live' });
  await seedDealer(OTHER_DEALER, { mode: 'live' });
  const queued = [];
  await report.dailyReportTick({ now: NOW, env: INTERNAL_ENV, logger: { error() {} }, enqueue: async (d, id) => {
    if (d.dealerId === String(DEALER)) throw new Error('redis hiccup');
    queued.push(id);
  } });
  assert.deepEqual(queued, [`daily:${OTHER_DEALER}:${DAY}`]);
});

test('snapshot numbers equal replyCohorts / attributeAppointments for that day', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER, { mode: 'live' });
  await seedActivity();
  const snap = await getOrBuildSnapshot({ dealerId: String(DEALER), reportDate: DAY, now: NOW });
  const created = await attributeAppointments({ dealerId: String(DEALER), from: DAY, to: DAY, basis: 'created', tz: NY });
  const due = await attributeAppointments({ dealerId: String(DEALER), from: DAY, to: DAY, basis: 'scheduled', tz: NY });
  const replies = await replyCohorts({ dealerId: String(DEALER), from: DAY, to: DAY, tz: NY });
  const m = snap.metrics;
  assert.deepEqual(snap.stale_sources, []);
  for (const k of ['total', 'ai', 'ai_assisted', 'human_only', 'unknown', 'ai_influenced', 'ai_influence_pct']) {
    assert.equal(m.appointments[k], created.totals[k], k);
  }
  assert.equal(m.appointments.cancelled, created.outcomes.cancelled);
  assert.equal(m.appointments_due.shown, due.outcomes.shown);
  assert.equal(m.appointments_due.no_show, due.outcomes.no_show);
  assert.equal(m.replies.todays_leads, replies.totals.todays_leads_replied);
  assert.equal(m.replies.past_leads, replies.totals.past_leads_replied);
  assert.equal(m.replies.total, replies.totals.customers_replied);
  assert.deepEqual(m.replies.cumulative, replies.cumulative);
  assert.equal(m.leads.received, replies.totals.new_leads);
  // And the seeded day itself, so the parity is not 0 == 0.
  assert.deepEqual([m.appointments.total, m.appointments.ai, m.appointments.ai_assisted, m.appointments.human_only],
    [3, 1, 1, 1]);
  assert.equal(m.appointments.cancelled, 1);
  assert.equal(m.appointments_due.shown, 1);
  // Show rate = shown / past appointments (the Reports page's definition): 1 of 2.
  assert.deepEqual([m.appointments_due.no_show, m.appointments_due.show_rate_pct, m.appointments_due.show_rate_of],
    [1, 50, 2]);
  assert.equal(m.appointments_due.show_rate_pct, due.outcomes.show_rate.value);
  const { html, text } = renderDailyEmail({ snapshot: snap, dashboardUrl: 'https://crm.example.test/dealer/dashboard' });
  assert.match(html, /Show rate/);
  assert.match(text, /show rate 50% \(1 of 2 past\)/);
  assert.deepEqual([m.replies.todays_leads, m.replies.past_leads, m.replies.total], [1, 1, 2]);
  assert.deepEqual(m.replies.cumulative, { d7: 1, d15: 1, d30: 1, d60: 0 });
  assert.equal(m.leads.received, 1);
  assert.equal(m.ai_activity.messages_sent, 2);
  assert.equal(m.ai_activity.appointments_booked, 1);
  // A second build returns the saved snapshot (retries and resends send the same numbers).
  const again = await getOrBuildSnapshot({ dealerId: String(DEALER), reportDate: DAY, now: new Date() });
  assert.equal(String(again._id), String(snap._id));
});

test('dealer-TZ day boundary: late evening in Los Angeles belongs to that LA day', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER_LA, { tz: LA, mode: 'live' });
  const db = mongoose.connection;
  const lead = new ObjectId();
  await db.collection('leads').insertOne({ _id: lead, dealer_id: String(DEALER_LA), createdAt: at(`${DAY} 23:30`, LA) });
  // 23:30 on 9 Nov in LA = 07:30 UTC on 10 Nov.
  await db.collection('bookings').insertOne({ dealer_id: String(DEALER_LA), lead_id: String(lead), customerName: 'x',
    bookingDate: at('2026-11-12 10:00', LA), bookingTime: '10:00', created_by: 'ai', createdAt: at(`${DAY} 23:30`, LA) });
  const day9 = await computeDailySnapshot({ dealerId: String(DEALER_LA), reportDate: DAY, now: NOW });
  const day10 = await computeDailySnapshot({ dealerId: String(DEALER_LA), reportDate: '2026-11-10', now: NOW });
  assert.equal(day9.tz, LA);
  assert.equal(day9.metrics.appointments.total, 1);
  assert.equal(day9.metrics.leads.received, 1);
  assert.equal(day10.metrics.appointments.total, 0);
  // Tick: 08:59 LA on 10 Nov is before the send time (nothing queued); 09:00 LA queues 9 Nov.
  const queued = [];
  const enqueue = async (d, id) => queued.push(id);
  await report.dailyReportTick({ now: at('2026-11-10 08:59', LA), env: INTERNAL_ENV, enqueue });
  assert.deepEqual(queued, []);
  await report.dailyReportTick({ now: at('2026-11-10 09:00', LA), env: INTERNAL_ENV, enqueue });
  assert.deepEqual(queued, [`daily:${DEALER_LA}:${DAY}`]);
  // The job refuses a day that has not finished in the dealer's zone.
  const { calls, send } = recordingSender();
  const res = await report.runDailyReport({ dealerId: String(DEALER_LA), reportDate: '2026-11-10',
    now: at('2026-11-10 09:00', LA), env: INTERNAL_ENV, send });
  assert.equal(res.reason, 'day_not_finished');
  assert.equal(calls.length, 0);
});

test('the email carries no customer names, phones or emails', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER, { mode: 'live' });
  await seedActivity();
  const { calls, send } = recordingSender();
  await report.runDailyReport({ dealerId: String(DEALER), reportDate: DAY, now: NOW, env: INTERNAL_ENV, send });
  assert.ok(calls.length > 0);
  for (const { html, subject } of calls) {
    for (const value of [PII.name, 'Zebulon', PII.email, PII.phone, '5559871234', 'old@customer.test']) {
      assert.ok(!html.includes(value), `html leaks ${value}`);
      assert.ok(!subject.includes(value), `subject leaks ${value}`);
    }
    assert.match(html, /Sunrise Motors/);
    assert.match(html, /#aa3300/);
    assert.match(html, /https:\/\/cdn\.example\.test\/logo\.png/);
    assert.match(html, /https:\/\/crm\.example\.test\/dealer\/dashboard/);
    assert.match(html, /max-width:600px/);
  }
});

test('resend: new audited delivery rows, same snapshot; refused when off', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER, { mode: 'live' });
  await seedActivity();
  const first = recordingSender();
  await report.runDailyReport({ dealerId: String(DEALER), reportDate: DAY, now: NOW, env: INTERNAL_ENV, send: first.send });
  const again = recordingSender();
  const r1 = await report.resendDailyReport({ dealerId: String(DEALER), reportDate: DAY, requestedBy: ADMIN, now: NOW,
    env: INTERNAL_ENV, send: again.send });
  const r2 = await report.resendDailyReport({ dealerId: String(DEALER), reportDate: DAY, requestedBy: ADMIN, now: NOW,
    env: INTERNAL_ENV, send: again.send });
  assert.ok(r1.ok && r2.ok);
  assert.notEqual(r1.request_id, r2.request_id);
  assert.equal(again.calls.length, 4);
  const resent = await DailyReportDelivery.find({ resend_of: { $ne: null } }).lean();
  assert.equal(resent.length, 4);
  const originals = await DailyReportDelivery.find({ resend_of: null }).lean();
  assert.equal(originals.length, 2);
  assert.ok(resent.every((r) => String(r.requested_by) === String(ADMIN) && r.status === 'sent'
    && String(r.snapshot_id) === String(originals[0].snapshot_id) && r.original_delivery_id));
  assert.equal(await DailyReportSnapshot.countDocuments(), 1);
  // Off -> resend refused, nothing sent.
  await User.updateOne({ _id: DEALER }, { $set: { 'report_schedule_settings.daily_email_mode': 'off' } });
  const off = recordingSender();
  const r3 = await report.resendDailyReport({ dealerId: String(DEALER), reportDate: DAY, requestedBy: ADMIN, now: NOW,
    env: INTERNAL_ENV, send: off.send });
  assert.equal(r3.ok, false);
  assert.equal(off.calls.length, 0);
});

test('switching a dealer off mid-job stops the remaining sends', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER, { mode: 'live' });
  const calls = [];
  const send = async ({ to }) => {
    calls.push(to);
    await User.updateOne({ _id: DEALER }, { $set: { 'report_schedule_settings.daily_email_mode': 'off' } });
    return 'id';
  };
  const res = await report.runDailyReport({ dealerId: String(DEALER), reportDate: DAY, now: NOW, env: INTERNAL_ENV, send });
  assert.equal(calls.length, 1);
  assert.equal(res.results[1].reason, 'mode_changed');
});

test('the real sender path is stubbed by PROVIDER_SEND_STUB (nothing leaves the machine)', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER, { mode: 'internal' });
  await report.runDailyReport({ dealerId: String(DEALER), reportDate: DAY, now: NOW, env: INTERNAL_ENV });
  const outbox = await mongoose.connection.collection(PROVIDER_OUTBOX_COLLECTION).find().toArray();
  assert.deepEqual(outbox.map((o) => o.to).sort(), ['ops@autopulse.test', 'qa@autopulse.test']);
  const rows = await DailyReportDelivery.find().lean();
  assert.ok(rows.every((r) => r.status === 'sent' && /stub-/.test(r.provider_message_id)));
});

test('admin API: super admin only; set mode, preview without sending, list deliveries', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER, { mode: null });
  await seedActivity();
  assert.equal((await adminRoute.GET(req('/api/admin/daily-report?action=dealers'))).status, 401);
  assert.equal((await adminRoute.GET(req('/api/admin/daily-report?action=dealers', { user: DEALER }))).status, 403);
  assert.equal((await adminRoute.POST(req('/api/admin/daily-report', { method: 'POST', user: DEALER,
    body: { action: 'set-mode', dealer_id: String(DEALER), mode: 'live' } }))).status, 403);
  const list = await (await adminRoute.GET(req('/api/admin/daily-report?action=dealers', { user: ADMIN }))).json();
  assert.equal(list.dealers.find((d) => d.dealer_id === String(DEALER)).mode, 'off');

  const bad = await adminRoute.POST(req('/api/admin/daily-report', { method: 'POST', user: ADMIN,
    body: { action: 'set-mode', dealer_id: String(DEALER), mode: 'everyone' } }));
  assert.equal(bad.status, 400);
  const set = await adminRoute.POST(req('/api/admin/daily-report', { method: 'POST', user: ADMIN,
    body: { action: 'set-mode', dealer_id: String(DEALER), mode: 'internal' } }));
  assert.equal(set.status, 200);
  const dealer = await User.findById(DEALER).lean();
  assert.equal(dealer.report_schedule_settings.daily_email_mode, 'internal');
  assert.equal(String(dealer.report_schedule_settings.daily_email_mode_updated_by), String(ADMIN));
  assert.equal(dealer.report_schedule_settings.default_email, 'gm@dealer.test, owner@dealer.test'); // untouched

  const preview = await adminRoute.GET(req(`/api/admin/daily-report?action=preview&dealer_id=${DEALER}&date=${DAY}`, { user: ADMIN }));
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /text\/html/);
  const html = await preview.text();
  assert.match(html, /Total appointments set/);
  assert.equal(await DailyReportDelivery.countDocuments(), 0);
  assert.equal(await DailyReportSnapshot.countDocuments(), 0);
  assert.equal(await mongoose.connection.collection(PROVIDER_OUTBOX_COLLECTION).countDocuments(), 0);

  const deliveries = await (await adminRoute.GET(req('/api/admin/daily-report?action=deliveries', { user: ADMIN }))).json();
  assert.deepEqual(deliveries.deliveries, []);
});

test('old report cron route: start / check / process-overdue send nothing and point to the daily email', async (t) => {
  if (needDb(t)) return;
  await seedDealer(DEALER, { mode: 'live' });
  // An overdue legacy row, exactly what the old loop would have emailed.
  const row = await ReportSchedule.create({ dealer_id: DEALER, schedule_id: 's1', frequency: 'daily',
    scheduledAt: new Date(Date.now() - 86400000), status: 'pending', report_data: { email: 'gm@dealer.test' } });
  for (const action of ['start', 'check', 'process-overdue']) {
    const res = await cronRoute.POST(req('/api/cron/report-service', { method: 'POST', user: ADMIN, body: { action } }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.disabled, true);
    assert.match(body.message, /daily-report/);
  }
  const status = await (await cronRoute.GET(req('/api/cron/report-service', { user: ADMIN }))).json();
  assert.equal(status.status.isRunning, false);
  assert.equal(status.status.disabled, true);
  const { getScheduledReports } = await import('./app/utils/reportScheduler.js');
  assert.deepEqual(await getScheduledReports(new Date()), []);
  assert.equal((await ReportSchedule.findById(row._id).lean()).status, 'pending');
  assert.equal(await mongoose.connection.collection(PROVIDER_OUTBOX_COLLECTION).countDocuments(), 0);
  assert.equal(await DailyReportDelivery.countDocuments(), 0);
  // Still guarded.
  assert.equal((await cronRoute.POST(req('/api/cron/report-service', { method: 'POST', body: { action: 'start' } }))).status, 401);
});
