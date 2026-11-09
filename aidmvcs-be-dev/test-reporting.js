// The shared reporting library (app/lib/reporting/): dealer-local days, the filter model, customer reply cohorts
// (SOW 8B), appointment attribution (SOW 8A), the KPI registry and the feature-visibility switch.
//
// Pure tests always run; the MongoDB ones use their own local database (reporting_test, wiped before each test and
// dropped at the end; override with REPORTING_TEST_MONGODB_URI - local hosts only) and are skipped when no MongoDB
// is reachable.   Run: node --test test-reporting.js
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import moment from 'moment-timezone';

import Booking from './app/models/Booking.js';
import Customer from './app/models/Customer.js';
import Email from './app/models/Email.js';
import Lead from './app/models/Lead.js';
import User from './app/models/User.js';
import { repliedLeadIds } from './app/lib/contactedLeads.js';
import { appointmentFunnel, appointmentPassed, bookingShowed } from './app/lib/appointmentFunnel.js';
import {
  calendarDayDiff, getDealerTimezone, isValidLocalDate, localDate, localDayRange, toLocalDate,
} from './app/lib/reporting/time.js';
import {
  KNOWN_UNSUPPORTED, REPORTS, bookingMatch, leadMatch, parseFilterSpec, replyMatch,
} from './app/lib/reporting/filters.js';
import {
  BUCKETS, bucketForAge, classifyReplies, cumulativeFromBuckets, handlersFor, replyCohorts,
} from './app/lib/reporting/replyCohorts.js';
import {
  attributeAppointments, classifyBooking, findDuplicates, outcomes, summarize,
} from './app/lib/reporting/appointmentAttribution.js';
import { getKpi, listKpis, runKpi, runKpis } from './app/lib/reporting/registry.js';
import { FEATURES, LEVELS, callerDealerId, isFeatureVisible } from './app/lib/reporting/featureFlags.js';

const URI = process.env.REPORTING_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/reporting_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) throw new Error(`refusing non-local test DB ${URI}`);

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
const DAY = '2026-11-05';
const { ObjectId } = mongoose.Types;
const oid = () => new ObjectId();
const at = (local, tz = NY) => moment.tz(local, 'YYYY-MM-DD HH:mm', tz).toDate();
const sum = (o) => Object.values(o).reduce((s, n) => s + n, 0);

// --- pure: time ------------------------------------------------------------------------------------------------

test('localDayRange: dealer-local midnight to 23:59:59.999, in UTC', () => {
  const { start, end } = localDayRange(DAY, DAY, NY);
  assert.equal(start.toISOString(), '2026-11-05T05:00:00.000Z');
  assert.equal(end.toISOString(), '2026-11-06T04:59:59.999Z');
  const la = localDayRange(DAY, '2026-11-06', LA);
  assert.equal(la.start.toISOString(), '2026-11-05T08:00:00.000Z');
  assert.equal(la.end.toISOString(), '2026-11-07T07:59:59.999Z');
  assert.throws(() => localDayRange('2026-11-06', DAY, NY));
  assert.throws(() => localDayRange('5 Nov', DAY, NY));
});

test('localDayRange: DST change day is one 25-hour day', () => {
  const { start, end } = localDayRange('2026-11-01', '2026-11-01', NY);
  assert.equal((end - start + 1) / 3600000, 25);
});

test('calendarDayDiff counts calendar days in the dealer zone, not 24-hour periods', () => {
  assert.equal(calendarDayDiff(at('2026-11-04 23:50'), at('2026-11-05 00:10'), NY), 1);
  assert.equal(calendarDayDiff(at('2026-11-05 00:01'), at('2026-11-05 23:59'), NY), 0);
  assert.equal(calendarDayDiff(at('2026-09-06 12:00'), at('2026-11-05 12:00'), NY), 60);
  assert.equal(calendarDayDiff(at('2026-11-06 09:00'), at('2026-11-05 09:00'), NY), -1);
  // 04:30Z on 6 Nov is still 5 Nov in New York, 6 Nov in UTC.
  assert.equal(localDate(new Date('2026-11-06T04:30:00Z'), NY), DAY);
  assert.equal(localDate(new Date('2026-11-06T04:30:00Z'), 'UTC'), '2026-11-06');
});

test('toLocalDate / isValidLocalDate', () => {
  assert.equal(toLocalDate(DAY, NY), DAY);
  assert.equal(toLocalDate(new Date('2026-11-06T03:00:00Z'), NY), DAY);
  assert.equal(toLocalDate('2026-02-30', NY), null);
  assert.equal(toLocalDate('', NY), null);
  assert.equal(isValidLocalDate('2026-13-01'), false);
});

// --- pure: filters ---------------------------------------------------------------------------------------------

test('parseFilterSpec: dates, defaults and validation', () => {
  const r = parseFilterSpec({ from: DAY }, { report: REPORTS.REPLY_COHORTS, tz: NY });
  assert.equal(r.ok, true);
  assert.equal(r.spec.to, DAY);
  assert.equal(r.spec.basis, 'reply');
  const a = parseFilterSpec({ from: DAY, to: '2026-11-07', basis: 'scheduled' },
    { report: REPORTS.APPOINTMENT_ATTRIBUTION, tz: NY });
  assert.equal(a.ok, true);
  assert.equal(a.spec.basis, 'scheduled');
  assert.equal(parseFilterSpec({ from: DAY, basis: 'sold' }, { report: REPORTS.APPOINTMENT_ATTRIBUTION }).ok, false);
  assert.equal(parseFilterSpec({ from: '2026-11-07', to: DAY }, { report: REPORTS.REPLY_COHORTS }).ok, false);
  assert.equal(parseFilterSpec({}, { report: REPORTS.REPLY_COHORTS }).ok, false);
  assert.equal(parseFilterSpec({ from: DAY }, { report: 'nope' }).ok, false);
  assert.equal(parseFilterSpec({ from: DAY, assigned_to: 'x' }, { report: REPORTS.REPLY_COHORTS }).ok, false);
  assert.equal(parseFilterSpec({ from: DAY, channel: 'fax' }, { report: REPORTS.REPLY_COHORTS }).ok, false);
});

test('parseFilterSpec: filters the data cannot support come back flagged, never dropped silently', () => {
  const r = parseFilterSpec({ from: DAY, campaign: 'Fall', condition: 'new', appointment_type: 'service',
    channel: 'sms' }, { report: REPORTS.REPLY_COHORTS, tz: NY });
  assert.equal(r.ok, true);
  const keys = r.unsupported.map((u) => u.key).sort();
  assert.deepEqual(keys, ['appointment_type', 'campaign', 'condition']);
  assert.ok(r.unsupported.every((u) => u.reason));
  assert.equal(r.spec.channel, 'sms');
  assert.equal(r.spec.appointment_type, undefined);
  const a = parseFilterSpec({ from: DAY, channel: 'sms', ai_agent: 'x' }, { report: REPORTS.APPOINTMENT_ATTRIBUTION });
  assert.deepEqual(a.unsupported.map((u) => u.key).sort(), ['ai_agent', 'channel']);
  assert.ok(KNOWN_UNSUPPORTED.campaign);
});

test('parseFilterSpec reads URLSearchParams; fragments map to real fields', () => {
  const staff = String(oid());
  const r = parseFilterSpec(new URLSearchParams(`from=${DAY}&source=email,sms&lead_source=CarGurus&assigned_to=${staff}`
    + '&actor=ai&appointment_type=sales'), { report: REPORTS.APPOINTMENT_ATTRIBUTION, tz: NY });
  assert.equal(r.ok, true);
  const lm = leadMatch(r.spec);
  assert.deepEqual(lm.source, { $in: ['email', 'sms'] });
  assert.deepEqual(lm.lead_source, { $in: ['CarGurus'] });
  assert.equal(String(lm.assigned_to.$in[0]), staff);
  assert.deepEqual(bookingMatch(r.spec), { appointment_type: { $nin: ['service'] }, created_by: 'ai' });
  assert.deepEqual(bookingMatch({ appointment_type: 'service', actor: 'human' }),
    { appointment_type: 'service', created_by: 'staff' });
  assert.deepEqual(replyMatch({ channel: 'email' }), { communication_type: 'email' });
  assert.deepEqual(leadMatch({}), {});
});

// --- pure: reply cohorts ---------------------------------------------------------------------------------------

test('bucketForAge: the SOW 8B ages', () => {
  const ages = [0, 6, 7, 14, 15, 29, 30, 59, 60, 61];
  assert.deepEqual(ages.map(bucketForAge),
    ['d0', 'd1_6', 'd7_14', 'd7_14', 'd15_29', 'd15_29', 'd30_59', 'd30_59', 'd60_plus', 'd60_plus']);
  assert.equal(bucketForAge(-1), 'needs_review');
  assert.equal(bucketForAge(null), 'needs_review');
});

test('classifyReplies: buckets always sum to customers, over random fixtures', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let run = 0; run < 25; run += 1) {
    const leads = Array.from({ length: 8 }, (_, i) => ({ _id: `l${i}`, dealer_ok: rnd(10) > 0,
      createdAt: new Date(at('2026-11-05 12:00') - rnd(90) * 86400000), customer_key: `c${rnd(5)}` }));
    const replies = Array.from({ length: 20 }, (_, i) => {
      const pick = rnd(10);
      const lead = pick === 0 ? null : leads[rnd(8)];
      return { email_id: `e${i}`, lead_id: pick === 0 ? null : (pick === 1 ? 'gone' : lead._id),
        lead: pick <= 1 ? null : lead, reply_at: at(`2026-11-0${4 + rnd(3)} ${10 + rnd(10)}:00`),
        channel: 'sms', sender: `+1555000${rnd(3)}` };
    });
    const r = classifyReplies(replies, { tz: NY });
    assert.equal(sum(r.buckets), r.totals.customers_replied);
    assert.equal(r.totals.inbound_messages, 20);
    assert.equal(r.totals.todays_leads_replied + r.totals.past_leads_replied + r.totals.needs_review,
      r.totals.customers_replied);
    for (const row of r.rows) assert.ok(BUCKETS.includes(row.bucket));
  }
});

test('cumulativeFromBuckets overlaps and leaves needs_review out', () => {
  const c = cumulativeFromBuckets({ d0: 1, d1_6: 1, d7_14: 2, d15_29: 2, d30_59: 2, d60_plus: 2, needs_review: 5 });
  assert.deepEqual(c, { d7: 8, d15: 6, d30: 4, d60: 2 });
});

test('handlersFor: first outbound after the reply, before the next inbound, within day + 24 h', () => {
  const L = 'lead1';
  const r = (id, local) => ({ email_id: id, lead_id: L, reply_at: at(local) });
  const m = (id, local, extra) => ({ _id: id, lead_id: L, timestamp: at(local), ...extra });
  const msgs = [
    m('r1', '2026-11-05 09:00', { status: 'received' }),
    m('n1', '2026-11-05 09:01', { status: 'sent', is_note: true, ai_generated: true }),
    m('a1', '2026-11-05 09:02', { status: 'delivered', ai_generated: true }),
    m('r2', '2026-11-05 10:00', { status: 'received' }),
    m('s1', '2026-11-05 10:05', { status: 'sent', message_by: 'u1' }),
    m('r3', '2026-11-05 11:00', { status: 'received' }),
    m('r4', '2026-11-05 11:30', { status: 'received' }),
    m('x1', '2026-11-05 11:40', { status: 'sent' }),
    m('r5', '2026-11-05 12:00', { status: 'received' }),
    m('late', '2026-11-07 09:00', { status: 'sent', ai_generated: true }),
  ];
  const h = handlersFor([r('r1', '2026-11-05 09:00'), r('r2', '2026-11-05 10:00'), r('r3', '2026-11-05 11:00'),
    r('r4', '2026-11-05 11:30'), r('r5', '2026-11-05 12:00'), { email_id: 'r6', lead_id: null, reply_at: new Date() }],
  msgs, { tz: NY });
  assert.equal(h.get('r1'), 'ai');
  assert.equal(h.get('r2'), 'staff');
  assert.equal(h.get('r3'), 'unanswered'); // the next message is the customer again
  assert.equal(h.get('r4'), 'automatic'); // no AI flag, no staff author (n8n / template) - never AI
  assert.equal(h.get('r5'), 'unanswered'); // the AI answer came after day end + 24 h
  assert.equal(h.get('r6'), 'unknown');
});

// --- pure: attribution -----------------------------------------------------------------------------------------

test('classifyBooking: the four categories in order', () => {
  const created = at('2026-11-05 12:00');
  const before = { id: 'e1', at: at('2026-11-05 11:00') };
  const afterSend = { id: 'e2', at: at('2026-11-05 13:00') };
  assert.equal(classifyBooking({ created_by: 'ai', createdAt: created }, { leadFound: false }).category, 'ai');
  assert.equal(classifyBooking({ createdAt: created }, { leadFound: true, firstAiSend: before }).category, 'unknown');
  assert.equal(classifyBooking({ created_by: 'customer', createdAt: created }, { leadFound: true, firstAiSend: before })
    .category, 'unknown');
  assert.equal(classifyBooking({ created_by: 'staff', createdAt: created }, { leadFound: false, firstAiSend: before })
    .reason, 'lead_missing');
  const assisted = classifyBooking({ created_by: 'staff', createdAt: created }, { leadFound: true, firstAiSend: before });
  assert.equal(assisted.category, 'ai_assisted');
  assert.equal(assisted.evidence.id, 'e1');
  assert.equal(classifyBooking({ created_by: 'staff', createdAt: created }, { leadFound: true, firstAiSend: afterSend })
    .category, 'human_only');
  assert.equal(classifyBooking({ created_by: 'staff', createdAt: created }, { leadFound: true, firstAiSend: null })
    .category, 'human_only');
});

test('summarize: total = sum of categories; AI influence only with a denominator', () => {
  const t = summarize([{ category: 'ai' }, { category: 'ai_assisted' }, { category: 'human_only' },
    { category: 'unknown' }]);
  assert.deepEqual(t, { total: 4, ai: 1, ai_assisted: 1, human_only: 1, unknown: 1, ai_influenced: 2,
    ai_influence_pct: 50 });
  assert.equal(summarize([]).ai_influence_pct, null);
});

test('findDuplicates / outcomes', () => {
  const d = new Date('2026-11-06T05:00:00Z');
  const dup = findDuplicates([
    { _id: 'b2', dealer_id: 'D', lead_id: 'L', bookingDate: d, bookingTime: '10:00' },
    { _id: 'b1', dealer_id: 'D', lead_id: 'L', bookingDate: d, bookingTime: '10:00' },
    { _id: 'b3', dealer_id: 'D', lead_id: 'L', bookingDate: d, bookingTime: '11:00' },
    { _id: 'b0', dealer_id: 'D', lead_id: 'L', bookingDate: d, bookingTime: '10:00', booking_status: 'cancelled' },
  ]);
  assert.deepEqual([...dup.entries()], [['b2', 'b1']]);
  // Show rate = shown / past appointments (dealer time zone); future and cancelled ones are not in the denominator.
  const now = at('2026-11-06 12:00');
  const day = (local) => moment.tz(local, 'YYYY-MM-DD', NY).startOf('day').toDate();
  const b = (o) => ({ lead_id: 'L0', bookingDate: day('2026-11-06'), bookingTime: '09:00', booking_status: 'pending',
    showed: null, ...o });
  const leadStatus = new Map([['L-visited', 'Visited'], ['L-sold', 'Sold Delivered']]);
  const o = outcomes([
    b({ showed: true }), b({ booking_status: 'completed' }), b({ lead_id: 'L-visited' }), // shown x3
    b({ showed: false }), b({ bookingTime: '11:59' }), b({ bookingDate: day('2026-11-01') }), // past, not shown x3
    b({ bookingTime: '12:30' }), b({ bookingDate: day('2026-11-09') }), // still ahead x2
    b({ lead_id: 'L-sold', bookingDate: day('2026-11-10') }), // ahead but the lead is sold: shown (counts as past)
    b({ booking_status: 'cancelled', showed: true }), b({ booking_status: 'cancelled', bookingDate: day('2026-11-01') }),
  ], { leadStatus, now, tz: NY });
  assert.equal(o.shown, 4);
  assert.equal(o.no_show, 3);
  assert.equal(o.upcoming, 2);
  assert.equal(o.cancelled, 2);
  assert.equal(o.completed, 1);
  assert.deepEqual([o.show_rate.numerator, o.show_rate.denominator, o.show_rate.value], [4, 7, 57.14]);
  // Nothing past yet: no rate (never 0%).
  assert.equal(outcomes([b({ bookingDate: day('2026-11-09') })], { now, tz: NY }).show_rate.value, null);
});

test('appointmentPassed: the appointment\'s date and time in the dealer\'s time zone', () => {
  const booking = { bookingDate: moment.tz('2026-11-06', 'YYYY-MM-DD', LA).startOf('day').toDate(), bookingTime: '09:00' };
  // 09:00 Los Angeles = 12:00 New York.
  assert.equal(appointmentPassed(booking, { now: at('2026-11-06 11:59'), tz: LA }), false);
  assert.equal(appointmentPassed(booking, { now: at('2026-11-06 12:00'), tz: LA }), true);
  // A time that can't be read: passed once the day is over.
  const odd = { ...booking, bookingTime: 'soon' };
  assert.equal(appointmentPassed(odd, { now: at('2026-11-07 02:59'), tz: LA }), false);
  assert.equal(appointmentPassed(odd, { now: at('2026-11-07 03:00'), tz: LA }), true);
  assert.equal(bookingShowed({ showed: false }, 'Unsold'), true);
  assert.equal(bookingShowed({ showed: false }, 'visited'), false, 'exact statuses, as the Dashboard card');
});

// --- pure: feature flags and registry definitions --------------------------------------------------------------

test('isFeatureVisible: admin / test / all levels', () => {
  const dealerA = String(oid());
  const dealerB = String(oid());
  const env = { FEATURE_TEST_DEALERS: ` ${dealerA} , x` };
  const config = { f_admin: 'admin', f_test: 'test', f_all: 'all' };
  const admin = { user: { _id: oid(), type: 'admin' }, superAdmin: true };
  const loginAs = { user: { _id: new ObjectId(dealerA), type: 'dealer' }, superAdmin: true };
  const dealer = { user: { _id: new ObjectId(dealerA), type: 'dealer', parent_id: null }, superAdmin: false };
  const staffOfA = { user: { _id: oid(), type: 'dealer', parent_id: new ObjectId(dealerA) }, superAdmin: false };
  const otherDealer = { user: { _id: new ObjectId(dealerB), type: 'dealer' }, superAdmin: false };
  const opts = { env, config };
  for (const f of ['f_admin', 'f_test', 'f_all']) {
    assert.equal(isFeatureVisible(f, admin, opts), true);
    assert.equal(isFeatureVisible(f, loginAs, opts), true);
  }
  assert.equal(isFeatureVisible('f_admin', dealer, opts), false);
  assert.equal(isFeatureVisible('f_test', dealer, opts), true);
  assert.equal(isFeatureVisible('f_test', staffOfA, opts), true);
  assert.equal(isFeatureVisible('f_test', otherDealer, opts), false);
  assert.equal(isFeatureVisible('f_all', otherDealer, opts), true);
  assert.equal(isFeatureVisible('f_all', null, opts), false);
  assert.equal(isFeatureVisible('f_all', { user: null, superAdmin: false }, opts), false);
  assert.equal(isFeatureVisible('unknown_feature', dealer, opts), false);
  assert.equal(callerDealerId(staffOfA), dealerA);
  assert.equal(callerDealerId({ ...otherDealer, dealerId: dealerA }), dealerA);
  for (const level of Object.values(FEATURES)) assert.equal(level, 'admin');
  assert.deepEqual(LEVELS, ['admin', 'test', 'all']);
});

test('registry: every KPI has a full written definition', () => {
  const list = listKpis();
  assert.ok(list.length >= 15);
  for (const k of list) {
    for (const field of ['id', 'label', 'grain', 'dateBasis', 'numerator', 'exclusions', 'timezone', 'status']) {
      assert.ok(k[field], `${k.id} ${field}`);
    }
    assert.equal(k.evaluate, undefined);
  }
  assert.equal(new Set(list.map((k) => k.id)).size, list.length);
  for (const id of ['leads.received', 'replies.leads_replied', 'appt.made', 'appt.scheduled', 'appt.shown',
    'replies.customers', 'appt.attr.ai_assisted']) assert.ok(getKpi(id), id);
  assert.equal(getKpi('nope'), null);
});

// --- MongoDB ---------------------------------------------------------------------------------------------------

let connected = false;
before(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 2_000 });
    connected = true;
  } catch {
    connected = false;
  }
});
after(async () => {
  if (connected) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
beforeEach(async () => {
  if (connected) await mongoose.connection.dropDatabase();
});
const maybe = (name, fn) => test(name, async (t) => {
  if (!connected) return t.skip(`MongoDB not reachable at ${URI}`);
  return fn(t);
});

async function seedDealer(tz = NY) {
  const _id = oid();
  await User.collection.insertOne({ _id, type: 'dealer', name: 'Test Motors', email: `${_id}@example.test`,
    password: 'x', dealer_account_information: { time_zone: tz } });
  return String(_id);
}
async function seedCustomer(dealerId, extra = {}) {
  const _id = oid();
  await Customer.collection.insertOne({ _id, dealer_id: dealerId, name: 'C', ...extra });
  return _id;
}
async function seedLead(dealerId, createdAt, extra = {}) {
  const _id = oid();
  await Lead.collection.insertOne({ _id, dealer_id: dealerId, name: 'L', createdAt, updatedAt: createdAt,
    customer_id: null, ...extra });
  return _id;
}
async function seedEmail(dealerId, leadId, timestamp, extra = {}) {
  const _id = oid();
  await Email.collection.insertOne({ _id, dealer_id: dealerId, lead_id: leadId, timestamp, date: timestamp,
    sender: '+15550001111', status: 'received', communication_type: 'sms', mail_content: 'hi', is_note: false,
    message_id: `SM${_id}`, ...extra });
  return _id;
}
const reply = (dealerId, leadId, local, extra = {}, tz = NY) => seedEmail(dealerId, leadId, at(local, tz), extra);
async function seedBooking(dealerId, leadId, extra = {}) {
  const _id = extra._id || oid();
  const createdAt = extra.createdAt || at('2026-11-05 12:00');
  await Booking.collection.insertOne({ dealer_id: dealerId, lead_id: String(leadId), customerName: 'C',
    bookingDate: moment.tz('2026-11-07', NY).startOf('day').toDate(), bookingTime: '10:00', booking_status: 'pending',
    showed: null, appointment_type: 'sales', createdAt, updatedAt: createdAt, ...extra, _id });
  return _id;
}

maybe('replyCohorts: SOW 8B lead ages 0, 6, 7, 14, 15, 29, 30, 59, 60, 61', async () => {
  const dealer = await seedDealer();
  const ages = [0, 6, 7, 14, 15, 29, 30, 59, 60, 61];
  for (const age of ages) {
    const customer = await seedCustomer(dealer);
    const lead = await seedLead(dealer, moment.tz('2026-11-05 08:00', 'YYYY-MM-DD HH:mm', NY).subtract(age, 'days')
      .toDate(), { customer_id: customer });
    await reply(dealer, lead, '2026-11-05 10:00');
  }
  const r = await replyCohorts({ dealerId: dealer, from: DAY });
  assert.equal(r.tz, NY);
  assert.deepEqual(r.buckets, { d0: 1, d1_6: 1, d7_14: 2, d15_29: 2, d30_59: 2, d60_plus: 2, needs_review: 0 });
  assert.deepEqual(r.cumulative, { d7: 8, d15: 6, d30: 4, d60: 2 });
  assert.equal(r.totals.customers_replied, 10);
  assert.equal(r.totals.todays_leads_replied, 1);
  assert.equal(r.totals.past_leads_replied, 9);
  assert.equal(r.totals.inbound_messages, 10);
  assert.equal(r.totals.new_leads, 1);
  assert.equal(sum(r.buckets), r.totals.customers_replied);
  assert.deepEqual(r.rows.map((x) => x.age_days).sort((a, b) => a - b), ages);
});

maybe('replyCohorts: several replies from one customer on one day = 1 customer, every message counted', async () => {
  const dealer = await seedDealer();
  const customer = await seedCustomer(dealer);
  const lead = await seedLead(dealer, at('2026-10-20 09:00'), { customer_id: customer });
  await reply(dealer, lead, '2026-11-05 09:00', { mail_content: 'STOP' });
  await reply(dealer, lead, '2026-11-05 12:00', { communication_type: 'email', status: 'incoming' });
  await reply(dealer, lead, '2026-11-05 18:00');
  const r = await replyCohorts({ dealerId: dealer, from: DAY });
  assert.equal(r.totals.customers_replied, 1);
  assert.equal(r.totals.inbound_messages, 3);
  assert.equal(r.buckets.d15_29, 1);
  assert.deepEqual(r.rows.map((x) => x.channel).sort(), ['email', 'sms', 'sms']);
});

maybe('replyCohorts: two leads of one customer', async () => {
  const dealer = await seedDealer();
  // a) replies on both leads the same day, ages 3 and 20 -> ambiguous -> needs review, counted once
  const c1 = await seedCustomer(dealer);
  const l1a = await seedLead(dealer, at('2026-11-02 09:00'), { customer_id: c1 });
  const l1b = await seedLead(dealer, at('2026-10-16 09:00'), { customer_id: c1 });
  await reply(dealer, l1a, '2026-11-05 10:00');
  await reply(dealer, l1b, '2026-11-05 11:00');
  // b) a new lead today, but the customer replied on the old conversation lead -> the old lead's age
  const c2 = await seedCustomer(dealer);
  await seedLead(dealer, at('2026-11-05 08:00'), { customer_id: c2 });
  const l2old = await seedLead(dealer, at('2026-09-01 09:00'), { customer_id: c2 });
  await reply(dealer, l2old, '2026-11-05 10:00');
  // c) replies on both leads, both 1-6 days old -> that bucket, counted once
  const c3 = await seedCustomer(dealer);
  const l3a = await seedLead(dealer, at('2026-11-03 09:00'), { customer_id: c3 });
  const l3b = await seedLead(dealer, at('2026-11-01 09:00'), { customer_id: c3 });
  await reply(dealer, l3a, '2026-11-05 10:00');
  await reply(dealer, l3b, '2026-11-05 10:30');

  const r = await replyCohorts({ dealerId: dealer, from: DAY });
  assert.equal(r.totals.customers_replied, 3);
  assert.equal(r.totals.inbound_messages, 5);
  assert.equal(r.buckets.needs_review, 1);
  assert.equal(r.buckets.d60_plus, 1);
  assert.equal(r.buckets.d1_6, 1);
  assert.equal(r.totals.new_leads, 1);
  const review = r.units.find((u) => u.bucket === 'needs_review');
  assert.equal(review.customer_key, String(c1));
  assert.equal(review.review_reason, 'multiple_opportunities_different_ages');
  assert.equal(sum(r.buckets), r.totals.customers_replied);
});

maybe('replyCohorts: a merged customer is one customer; a lead with no customer is keyed by the lead', async () => {
  const dealer = await seedDealer();
  const survivor = await seedCustomer(dealer);
  const merged = await seedCustomer(dealer, { merged_into: survivor });
  const la = await seedLead(dealer, at('2026-11-05 07:00'), { customer_id: survivor });
  const lb = await seedLead(dealer, at('2026-11-05 08:00'), { customer_id: merged });
  const orphan = await seedLead(dealer, at('2026-11-05 08:30'));
  await reply(dealer, la, '2026-11-05 10:00');
  await reply(dealer, lb, '2026-11-05 11:00');
  await reply(dealer, orphan, '2026-11-05 11:00');
  const r = await replyCohorts({ dealerId: dealer, from: DAY });
  assert.equal(r.totals.customers_replied, 2);
  assert.equal(r.buckets.d0, 2);
  assert.deepEqual(r.units.map((u) => u.customer_key).sort(), [String(survivor), `lead:${orphan}`].sort());
});

maybe('replyCohorts: dealer-timezone midnight decides the day (New York and Los Angeles)', async () => {
  const ny = await seedDealer(NY);
  const lead = await seedLead(ny, at('2026-11-04 23:50'));
  await seedEmail(ny, lead, new Date('2026-11-05T05:10:00Z')); // 00:10 local on 5 Nov -> age 1
  await seedEmail(ny, lead, new Date('2026-11-06T04:30:00Z')); // 23:30 local on 5 Nov -> in
  await seedEmail(ny, lead, new Date('2026-11-06T05:00:00Z')); // 00:00 local on 6 Nov -> out
  await seedEmail(ny, lead, new Date('2026-11-05T04:59:00Z')); // 23:59 local on 4 Nov -> out
  const r = await replyCohorts({ dealerId: ny, from: DAY });
  assert.equal(r.totals.inbound_messages, 2);
  assert.equal(r.totals.customers_replied, 1);
  assert.equal(r.buckets.d1_6, 1);
  assert.deepEqual(r.rows.map((x) => x.age_days), [1, 1]);

  const la = await seedDealer(LA);
  const laLead = await seedLead(la, new Date('2026-11-05T07:30:00Z')); // 23:30 on 4 Nov in LA
  await seedEmail(la, laLead, new Date('2026-11-06T06:00:00Z')); // 22:00 on 5 Nov in LA (6 Nov in New York)
  const rl = await replyCohorts({ dealerId: la, from: DAY });
  assert.equal(rl.tz, LA);
  assert.equal(rl.totals.customers_replied, 1);
  assert.equal(rl.rows[0].age_days, 1);
  assert.equal(rl.rows[0].local_day, DAY);
  // a range of two days counts customer-day pairs
  await seedEmail(ny, lead, new Date('2026-11-06T15:00:00Z'));
  const range = await replyCohorts({ dealerId: ny, from: DAY, to: '2026-11-06' });
  assert.equal(range.totals.customers_replied, 2);
  assert.equal(range.totals.distinct_customers, 1);
  assert.equal(range.basis, 'customer_day');
});

maybe('replyCohorts: staff messages, AI outbound, receipts and notes are not replies', async () => {
  const dealer = await seedDealer();
  const lead = await seedLead(dealer, at('2026-11-01 09:00'));
  const staff = oid();
  await reply(dealer, lead, '2026-11-05 09:00', { status: 'sent', message_by: staff });
  await reply(dealer, lead, '2026-11-05 09:10', { status: 'delivered', message_by: staff });
  await reply(dealer, lead, '2026-11-05 09:20', { status: 'sent', ai_generated: true });
  await reply(dealer, lead, '2026-11-05 09:30', { status: 'delivered', ai_generated: true });
  await reply(dealer, lead, '2026-11-05 09:40', { status: 'undelivered', ai_generated: true });
  await reply(dealer, lead, '2026-11-05 09:50', { status: 'failed' });
  await reply(dealer, lead, '2026-11-05 10:00', { status: 'note', communication_type: 'note', is_note: true });
  await reply(dealer, lead, '2026-11-05 10:10', { status: 'received', is_note: true });
  await reply(dealer, lead, '2026-11-05 10:20', { status: 'draft' });
  const r = await replyCohorts({ dealerId: dealer, from: DAY });
  assert.equal(r.totals.inbound_messages, 0);
  assert.equal(r.totals.customers_replied, 0);
  assert.equal(sum(r.buckets), 0);
});

maybe('replyCohorts: the lead\'s own arrival / ADF / portal email is not a reply', async () => {
  const dealer = await seedDealer();
  const lead = await seedLead(dealer, at('2026-11-05 08:00'));
  await reply(dealer, lead, '2026-11-05 08:00', { status: 'incoming', message_id: `lead-${lead}`,
    communication_type: 'email' });
  await reply(dealer, lead, '2026-11-05 08:01', { status: 'incoming', communication_type: 'email',
    mail_content: '<?xml version="1.0"?><?adf version="1.0"?><adf><prospect></prospect></adf>' });
  await reply(dealer, lead, '2026-11-05 08:02', { status: 'incoming', communication_type: 'email',
    is_lead_email: true, mail_content: 'New lead from CarGurus' });
  let r = await replyCohorts({ dealerId: dealer, from: DAY });
  assert.equal(r.totals.inbound_messages, 0);
  assert.equal(r.totals.new_leads, 1);
  await reply(dealer, lead, '2026-11-05 09:00');
  r = await replyCohorts({ dealerId: dealer, from: DAY });
  assert.equal(r.totals.inbound_messages, 1);
  assert.equal(r.totals.todays_leads_replied, 1);
});

maybe('replyCohorts: same qualifying leads as the existing repliedLeadIds (contactedLeads.js)', async () => {
  const dealer = await seedDealer();
  const leads = [];
  for (let i = 0; i < 6; i += 1) leads.push(await seedLead(dealer, at(`2026-10-2${i} 09:00`)));
  await reply(dealer, leads[0], '2026-11-05 09:00');
  await reply(dealer, leads[1], '2026-11-05 09:00', { status: 'incoming', communication_type: 'email' });
  await reply(dealer, leads[2], '2026-11-05 09:00', { message_id: `lead-${leads[2]}`, status: 'incoming' });
  await reply(dealer, leads[3], '2026-11-05 09:00', { is_lead_email: true, status: 'incoming' });
  await reply(dealer, leads[4], '2026-11-05 09:00', { mail_content: '<adf><prospect/></adf>', status: 'incoming' });
  await reply(dealer, leads[5], '2026-11-04 09:00');
  const { start, end } = localDayRange(DAY, DAY, NY);
  const existing = (await repliedLeadIds(leads, start, end)).map((x) => String(x._id)).sort();
  const r = await replyCohorts({ dealerId: dealer, from: DAY });
  assert.deepEqual([...new Set(r.rows.map((x) => x.lead_id))].sort(), existing);
  assert.equal(existing.length, 2);
});

maybe('replyCohorts: unresolvable replies go to needs review; other dealers never leak in', async () => {
  const dealer = await seedDealer();
  const other = await seedDealer();
  const otherLead = await seedLead(other, at('2026-11-01 09:00'));
  await reply(other, otherLead, '2026-11-05 09:00'); // other dealer's row: never seen
  await reply(dealer, null, '2026-11-05 09:00', { sender: '+1 (555) 222-3333' }); // no lead link
  await reply(dealer, null, '2026-11-05 10:00', { sender: '5552223333' }); // same sender, same day
  await reply(dealer, oid(), '2026-11-05 09:00'); // lead deleted
  await reply(dealer, otherLead, '2026-11-05 09:00'); // points at another dealer's lead
  const future = await seedLead(dealer, at('2026-11-06 08:00'));
  await reply(dealer, future, '2026-11-05 09:00'); // lead received on a later day than the reply
  // dealer_id stored as an ObjectId by a raw insert still counts
  const okLead = await seedLead(dealer, at('2026-11-05 07:00'));
  await reply(new ObjectId(dealer), okLead, '2026-11-05 09:00');
  const r = await replyCohorts({ dealerId: dealer, from: DAY });
  assert.equal(r.totals.inbound_messages, 6);
  assert.equal(r.buckets.needs_review, 4);
  assert.equal(r.buckets.d0, 1);
  assert.equal(r.totals.customers_replied, 5);
  assert.equal(sum(r.buckets), r.totals.customers_replied);
  const reasons = r.units.filter((u) => u.bucket === 'needs_review').map((u) => u.review_reason).sort();
  assert.deepEqual(reasons, ['lead_not_found', 'lead_other_dealer', 'lead_received_after_reply', 'no_lead_link']);
  assert.equal(r.rows.find((x) => !x.lead_id).handler, 'unknown');
});

maybe('replyCohorts: handler per reply, appointment flag, and lead filters', async () => {
  const dealer = await seedDealer();
  const staffA = oid();
  const la = await seedLead(dealer, at('2026-11-01 09:00'), { assigned_to: staffA, lead_source: 'CarGurus' });
  const lb = await seedLead(dealer, at('2026-11-01 09:00'), { lead_source: 'Cars.com' });
  const lc = await seedLead(dealer, at('2026-11-01 09:00'));
  await reply(dealer, la, '2026-11-05 09:00');
  await reply(dealer, la, '2026-11-05 09:01', { status: 'sent', ai_generated: true });
  await reply(dealer, lb, '2026-11-05 09:00', { communication_type: 'email', status: 'incoming' });
  await reply(dealer, lb, '2026-11-05 09:30', { status: 'sent', message_by: staffA, communication_type: 'email' });
  await reply(dealer, lc, '2026-11-05 09:00');
  await seedBooking(dealer, la, { createdAt: at('2026-11-05 09:05') });
  const r = await replyCohorts({ dealerId: dealer, from: DAY });
  const byLead = new Map(r.rows.map((x) => [x.lead_id, x]));
  assert.equal(byLead.get(String(la)).handler, 'ai');
  assert.equal(byLead.get(String(la)).has_appointment, true);
  assert.equal(byLead.get(String(la)).booked_after_reply, true);
  assert.equal(byLead.get(String(lb)).handler, 'staff');
  assert.equal(byLead.get(String(lc)).handler, 'unanswered');
  assert.equal(byLead.get(String(lc)).has_appointment, false);
  assert.deepEqual(r.handlers, { ai: 1, staff: 1, automatic: 0, unanswered: 1, unknown: 0 });

  const f = await replyCohorts({ dealerId: dealer, from: DAY, filters: { assigned_to: String(staffA),
    campaign: 'x' } });
  assert.equal(f.totals.customers_replied, 1);
  assert.equal(f.rows[0].lead_id, String(la));
  assert.deepEqual(f.unsupported.map((u) => u.key), ['campaign']);
  const s = await replyCohorts({ dealerId: dealer, from: DAY, filters: { lead_source: 'Cars.com', channel: 'email' } });
  assert.equal(s.totals.inbound_messages, 1);
  const none = await replyCohorts({ dealerId: dealer, from: DAY, filters: { channel: 'sms', lead_source: 'Cars.com' } });
  assert.equal(none.totals.customers_replied, 0);
  await assert.rejects(replyCohorts({ dealerId: dealer, from: 'bad' }), /invalid filters/);
});

maybe('attributeAppointments: every category, duplicates, totals = sum', async () => {
  const dealer = await seedDealer();
  const created = at('2026-11-05 12:00');
  const lead = async () => seedLead(dealer, at('2026-11-01 09:00'));
  const L = { ai: await lead(), assisted: await lead(), noteOnly: await lead(), after: await lead(),
    failed: await lead(), human: await lead(), noActor: await lead(), customer: await lead(), dup: await lead(),
    delivered: await lead(), legacy: await lead() };
  const aiMsg = (l, local, extra = {}) => reply(dealer, l, local, { status: 'sent', ai_generated: true, ...extra });
  const evidence = await aiMsg(L.assisted, '2026-11-05 11:00');
  await aiMsg(L.assisted, '2026-11-05 11:30');
  await aiMsg(L.noteOnly, '2026-11-05 11:00', { is_note: true, communication_type: 'note', status: 'note' });
  await aiMsg(L.noteOnly, '2026-11-05 11:01', { is_note: true });
  await aiMsg(L.after, '2026-11-05 12:30');
  await aiMsg(L.failed, '2026-11-05 11:00', { status: 'failed' });
  await aiMsg(L.failed, '2026-11-05 11:05', { status: 'undelivered' });
  await aiMsg(L.delivered, '2026-11-05 11:00', { status: 'delivered' });
  await reply(dealer, L.legacy, '2026-11-05 11:00', { status: 'sent' }); // n8n / template reply: not AI
  await reply(dealer, L.human, '2026-11-05 11:00', { status: 'sent', message_by: oid() });

  const ids = {};
  ids.ai = await seedBooking(dealer, L.ai, { created_by: 'ai', createdAt: created });
  ids.assisted = await seedBooking(dealer, L.assisted, { created_by: 'staff', createdAt: created });
  ids.noteOnly = await seedBooking(dealer, L.noteOnly, { created_by: 'staff', createdAt: created });
  ids.after = await seedBooking(dealer, L.after, { created_by: 'staff', createdAt: created });
  ids.failed = await seedBooking(dealer, L.failed, { created_by: 'staff', createdAt: created });
  ids.human = await seedBooking(dealer, L.human, { created_by: 'staff', createdAt: created });
  ids.legacy = await seedBooking(dealer, L.legacy, { created_by: 'staff', createdAt: created });
  ids.delivered = await seedBooking(dealer, L.delivered, { created_by: 'staff', createdAt: created });
  ids.noActor = await seedBooking(dealer, L.noActor, { createdAt: created });
  ids.customer = await seedBooking(dealer, L.customer, { created_by: 'customer', createdAt: created });
  ids.leadGone = await seedBooking(dealer, oid(), { created_by: 'staff', createdAt: created });
  ids.dupKeep = await seedBooking(dealer, L.dup, { created_by: 'ai', createdAt: created });
  ids.dupDrop1 = await seedBooking(dealer, L.dup, { created_by: 'ai', createdAt: at('2026-11-05 12:01') });
  ids.dupDrop2 = await seedBooking(dealer, L.dup, { created_by: 'ai', createdAt: at('2026-11-05 12:02') });
  // a cancelled twin is not a duplicate
  ids.dupCancelled = await seedBooking(dealer, L.dup, { created_by: 'ai', createdAt: at('2026-11-05 12:03'),
    booking_status: 'cancelled' });
  // other dealer and other day never count
  const other = await seedDealer();
  await seedBooking(other, await seedLead(other, at('2026-11-01 09:00')), { created_by: 'ai', createdAt: created });
  await seedBooking(dealer, L.ai, { created_by: 'ai', createdAt: at('2026-11-04 12:00'), bookingTime: '15:00' });

  const r = await attributeAppointments({ dealerId: dealer, from: DAY });
  const cat = new Map(r.rows.map((x) => [x.booking_id, x]));
  const expect = {
    ai: 'ai', assisted: 'ai_assisted', delivered: 'ai_assisted', noteOnly: 'human_only', after: 'human_only',
    failed: 'human_only', human: 'human_only', legacy: 'human_only', noActor: 'unknown', customer: 'unknown',
    leadGone: 'unknown', dupKeep: 'ai', dupCancelled: 'ai',
  };
  for (const [k, c] of Object.entries(expect)) assert.equal(cat.get(String(ids[k]))?.category, c, k);
  assert.equal(cat.get(String(ids.assisted)).evidence_email_id, String(evidence));
  assert.equal(cat.get(String(ids.noActor)).reason, 'no_actor');
  assert.equal(cat.get(String(ids.customer)).reason, 'customer_booking_page');
  assert.equal(cat.get(String(ids.leadGone)).reason, 'lead_missing');
  assert.ok(!cat.has(String(ids.dupDrop1)) && !cat.has(String(ids.dupDrop2)));
  assert.deepEqual(r.excluded.duplicates.map((d) => [d.booking_id, d.duplicate_of]).sort(),
    [[String(ids.dupDrop1), String(ids.dupKeep)], [String(ids.dupDrop2), String(ids.dupKeep)]].sort());
  assert.deepEqual(r.totals, { total: 13, ai: 3, ai_assisted: 2, human_only: 5, unknown: 3, ai_influenced: 5,
    ai_influence_pct: 38.46 });
  assert.equal(r.totals.ai + r.totals.ai_assisted + r.totals.human_only + r.totals.unknown, r.totals.total);
  assert.equal(new Set(r.rows.map((x) => x.booking_id)).size, r.rows.length);
  assert.equal(r.outcomes.cancelled, 1);
});

maybe('attributeAppointments: scheduled basis, outcomes, filters', async () => {
  const dealer = await seedDealer();
  const staff = oid();
  const l1 = await seedLead(dealer, at('2026-11-01 09:00'), { assigned_to: staff });
  const l2 = await seedLead(dealer, at('2026-11-01 09:00'));
  const day = (d) => moment.tz(d, NY).startOf('day').toDate();
  await seedBooking(dealer, l1, { created_by: 'ai', bookingDate: day(DAY), showed: true, createdAt: at('2026-11-01 10:00') });
  await seedBooking(dealer, l2, { created_by: 'staff', bookingDate: day(DAY), showed: false, bookingTime: '11:00',
    createdAt: at('2026-11-02 10:00') });
  await seedBooking(dealer, l2, { created_by: 'staff', bookingDate: day(DAY), booking_status: 'completed',
    bookingTime: '12:00', appointment_type: 'service', createdAt: at('2026-11-02 11:00') });
  await seedBooking(dealer, l2, { created_by: 'staff', bookingDate: day(DAY), booking_status: 'cancelled',
    bookingTime: '13:00', createdAt: at('2026-11-02 12:00') });
  await seedBooking(dealer, l1, { created_by: 'ai', bookingDate: day('2026-11-06'), bookingTime: '09:00',
    createdAt: at('2026-11-02 12:00') });

  const r = await attributeAppointments({ dealerId: dealer, from: DAY, basis: 'scheduled' });
  assert.equal(r.basis, 'scheduled');
  assert.equal(r.totals.total, 3);
  assert.deepEqual([r.outcomes.shown, r.outcomes.no_show, r.outcomes.completed, r.outcomes.cancelled],
    [2, 1, 1, 0]);
  assert.deepEqual([r.outcomes.show_rate.numerator, r.outcomes.show_rate.denominator], [2, 3]);
  const service = await attributeAppointments({ dealerId: dealer, from: DAY, basis: 'scheduled',
    filters: { appointment_type: 'service' } });
  assert.equal(service.totals.total, 1);
  const sales = await attributeAppointments({ dealerId: dealer, from: DAY, basis: 'scheduled',
    filters: { appointment_type: 'sales' } });
  assert.equal(sales.totals.total, 2);
  const mine = await attributeAppointments({ dealerId: dealer, from: DAY, basis: 'scheduled',
    filters: { assigned_to: String(staff) } });
  assert.equal(mine.totals.total, 1);
  assert.equal(mine.totals.ai, 1);
  const created = await attributeAppointments({ dealerId: dealer, from: '2026-11-02' });
  assert.equal(created.totals.total, 4);
  assert.equal(created.outcomes.cancelled, 1);
});

maybe('registry: drill-down ids match the count and the existing dashboard numbers', async () => {
  const dealer = await seedDealer();
  const day = moment.tz(DAY, NY).startOf('day').toDate();
  const leads = [];
  for (let i = 0; i < 3; i += 1) leads.push(await seedLead(dealer, at('2026-11-05 08:00'), { fe_lead_status: 'Lead' }));
  leads.push(await seedLead(dealer, at('2026-10-01 08:00'), { fe_lead_status: 'Visited' }));
  await reply(dealer, leads[0], '2026-11-05 10:00');
  await reply(dealer, leads[3], '2026-11-05 10:00');
  await seedBooking(dealer, leads[0], { created_by: 'ai', bookingDate: day, createdAt: at('2026-11-05 10:30') });
  await seedBooking(dealer, leads[3], { created_by: 'staff', bookingDate: day, bookingTime: '15:00',
    createdAt: at('2026-11-05 11:00') });
  await seedBooking(dealer, leads[1], { created_by: 'customer', bookingDate: day, booking_status: 'cancelled',
    createdAt: at('2026-11-05 11:00') });

  const args = { dealerId: dealer, from: DAY };
  const k = await runKpis(['leads.received', 'replies.leads_replied', 'appt.made', 'appt.scheduled', 'appt.shown',
    'replies.customers', 'replies.todays_leads', 'replies.past_leads', 'replies.age_30_plus',
    'replies.inbound_messages', 'appt.attr.total', 'appt.attr.ai', 'appt.attr.human_only', 'appt.attr.unknown',
    'appt.attr.ai_influenced'], args);
  for (const v of Object.values(k)) assert.equal(v.count, v.ids.length);
  assert.equal(k['leads.received'].count, 3);
  assert.equal(k['replies.leads_replied'].count, 2);
  const { start, end } = localDayRange(DAY, DAY, NY);
  const funnel = await appointmentFunnel({ dealerId: dealer, start, end });
  assert.equal(k['appt.made'].count, funnel.made.total);
  assert.equal(k['appt.scheduled'].count, funnel.scheduled.total);
  assert.equal(k['appt.shown'].count, funnel.showed.total);
  assert.equal(k['appt.shown'].count, 1);
  const rc = await replyCohorts(args);
  assert.equal(k['replies.customers'].count, rc.totals.customers_replied);
  assert.equal(k['replies.todays_leads'].count, 1);
  assert.equal(k['replies.past_leads'].count, 1);
  assert.equal(k['replies.age_30_plus'].count, 1);
  assert.equal(k['replies.inbound_messages'].count, 2);
  assert.equal(k['appt.attr.total'].count, 3);
  assert.equal(k['appt.attr.ai_influenced'].count, k['appt.attr.ai'].count);
  assert.equal(k['appt.attr.total'].count, k['appt.attr.ai'].count + k['appt.attr.human_only'].count
    + k['appt.attr.unknown'].count);
  const one = await runKpi('appt.attr.unknown', args);
  assert.deepEqual(one.ids, k['appt.attr.unknown'].ids);
  await assert.rejects(runKpi('nope', args), /unknown KPI/);
});

maybe('getDealerTimezone: the dealer setting, else New York', async () => {
  const la = await seedDealer(LA);
  assert.equal(await getDealerTimezone(la), LA);
  const bad = await seedDealer('Mars/Base');
  assert.equal(await getDealerTimezone(bad), NY);
  assert.equal(await getDealerTimezone(String(oid())), NY);
  assert.equal(await getDealerTimezone('not-an-id'), NY);
});
