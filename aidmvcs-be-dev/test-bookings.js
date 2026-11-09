// Bookings (P1 item 3): a rebooking moves the lead's active booking instead of adding a second one, every writer
// records history (who / how / when) without ever failing the booking for it, and the dedupe / backfill / index
// scripts. The route handlers are called with fake Requests against their own MongoDB database (bookings_test,
// wiped before each test, dropped at the end; local hosts only; skipped when MongoDB is not reachable). No email,
// SMS or AI-service call is made: the dealer's AI is off, reminders are off and the leads have no email / phone.
//   Run: node --test test-bookings.js
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

process.env.MONGODB_URI = process.env.BOOKINGS_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/bookings_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.MONGODB_URI)) {
  throw new Error(`refusing non-local test DB ${process.env.MONGODB_URI}`);
}
process.env.JWT_SECRET = 'bookings-test-jwt-secret';
process.env.UPSELL_SERVICE_SHARED_SECRET = 'bookings-test-ai-secret';
delete process.env.CRM_LIVE_DB;

const { default: mongoose } = await import('mongoose');
const { default: jwt } = await import('jsonwebtoken');
const { default: User } = await import('./app/models/User.js');
const { default: Lead } = await import('./app/models/Lead.js');
const { default: Email } = await import('./app/models/Email.js');
const { default: Booking } = await import('./app/models/Booking.js');
const bookingRoute = await import('./app/api/booking/route.js');
const { markLeadBookingShowed, upsertLeadBooking, writeWithHistory, mergeUpdates } = await import('./app/lib/bookingService.js');
const { cancelBookingsForStatusChange } = await import('./app/lib/ai/aiStaff.js');
const { attributeAppointments, historyChanges } = await import('./app/lib/reporting/appointmentAttribution.js');
const { dedupeActiveBookings, duplicateGroups, isLocalMongoUri, parseArgs } = await import('./scripts/dedupe-active-bookings.js');
const { backfillBookingHistory } = await import('./scripts/backfill-booking-history.js');
const { ensureReportIndexes, REPORT_INDEXES } = await import('./scripts/ensure-report-indexes.js');

const { ObjectId } = mongoose.Types;
const id = (n) => new ObjectId(`66f00000000000000000${String(n).padStart(4, '0')}`);
const DEALER = id(1), STAFF = id(2), OTHER_DEALER = id(3);
const NY = 'America/New_York';
const MONDAY = '2031-03-03';
const TUESDAY = '2031-03-04';
const AI = { Authorization: `Bearer ${process.env.UPSELL_SERVICE_SHARED_SECRET}` };
const bearer = (userId) => ({ Authorization: `Bearer ${jwt.sign({ userId: String(userId) }, process.env.JWT_SECRET)}` });
const quiet = { log() {}, error() {} };

function req(method, body, headers = {}) {
  return new Request('http://localhost:3000/api/booking', {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}
async function call(method, body, headers) {
  const fn = method === 'POST' ? bookingRoute.POST : bookingRoute.PUT;
  const res = await fn(req(method, body, headers));
  return { status: res.status, body: await res.json() };
}
const post = (lead, date, time, extra = {}, headers = {}) => call('POST', {
  dealer_id: String(DEALER), lead_id: String(lead._id), customerName: 'Pat', bookingDate: date, bookingTime: time,
  ...extra }, headers);
const active = (leadId) => Booking.find({ lead_id: String(leadId), booking_status: { $in: ['pending', 'confirmed'] } }).lean();

let connected = false;
const origError = console.error;
const origLog = console.log;
before(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    connected = true;
  } catch { connected = false; }
  // The route logs every step; keep the test output readable.
  console.log = () => {};
});
after(async () => {
  console.log = origLog;
  console.error = origError;
  if (connected) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});
beforeEach(async () => {
  if (!connected) return;
  await mongoose.connection.dropDatabase();
  await User.create([
    { _id: DEALER, email: 'd@t.test', name: 'Dealer', password: 'x', type: 'dealer',
      dealer_account_information: { time_zone: NY } },
    { _id: STAFF, email: 's@t.test', name: 'Sam Staff', password: 'x', type: 'dealer', parent_id: DEALER },
    { _id: OTHER_DEALER, email: 'o@t.test', name: 'Other', password: 'x', type: 'dealer' },
  ]);
});
const maybe = (name, fn) => test(name, async (t) => {
  if (!connected) { t.skip('MongoDB not reachable'); return; }
  await fn(t);
});
const newLead = (extra = {}) => Lead.create({ dealer_id: String(DEALER), name: 'Pat', ...extra });

// --- POST: rebooking ---------------------------------------------------------------------------------------------

maybe('a second POST for the same lead and type at another time moves the booking (one active booking)', async () => {
  const lead = await newLead();
  const first = await post(lead, MONDAY, '10:00', {}, bearer(STAFF));
  assert.equal(first.status, 201);
  assert.equal(first.body.moved, undefined);
  const second = await post(lead, TUESDAY, '2 PM', {}, bearer(STAFF));
  assert.equal(second.status, 200);
  assert.equal(second.body.success, true);
  assert.equal(second.body.moved, true);
  assert.equal(second.body.bookingId, first.body.bookingId);
  assert.equal(String(second.body.booking._id), first.body.bookingId);
  assert.equal(second.body.booking.bookingTime, '14:00');
  assert.equal(second.body.previous.bookingTime, '10:00');

  const rows = await active(lead._id);
  assert.equal(rows.length, 1);
  assert.equal(await Booking.countDocuments({ lead_id: String(lead._id) }), 1);
  const b = rows[0];
  assert.equal(b.bookingTime, '14:00');
  assert.equal(b.created_by, 'staff');
  assert.equal(b.created_via, 'booking_api');
  assert.equal(String(b.created_by_user_id), String(STAFF));
  assert.equal(b.created_by_name, 'Sam Staff');
  assert.equal(b.reschedule_count, 1);
  assert.ok(b.last_rescheduled_at);
  assert.deepEqual(b.history.map((h) => h.action), ['created', 'rescheduled']);
  const moved = b.history[1];
  assert.deepEqual([moved.actor_type, String(moved.actor_id), moved.actor_name, moved.via],
    ['staff', String(STAFF), 'Sam Staff', 'booking_api']);
  assert.deepEqual(moved.from, { date: MONDAY, time: '10:00' });
  assert.deepEqual(moved.to, { date: TUESDAY, time: '14:00' });

  const updatedLead = await Lead.findById(lead._id).lean();
  assert.equal(String(updatedLead.data.bookingId), first.body.bookingId);
  assert.equal(updatedLead.data.booking.booking_time, '14:00');
  const notes = await Email.find({ lead_id: lead._id, is_note: true }).sort({ timestamp: 1 }).lean();
  assert.equal(notes.length, 2);
  assert.match(notes[1].message_id, /^note_booking_moved_/);
  assert.match(notes[1].mail_content, /^Appointment moved by Sam Staff: from Monday, March 3 at 10:00 AM to Tuesday, March 4 at 2:00 PM/);
});

maybe('the same lead booking the same time again gets the booking it has (idempotent)', async () => {
  const lead = await newLead();
  const first = await post(lead, MONDAY, '10:00', {}, AI);
  const again = await post(lead, MONDAY, '10:00', {}, AI);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.bookingId, first.body.bookingId);
  const rows = await active(lead._id);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].history.map((h) => h.action), ['created']);
});

maybe('a different appointment type (service vs sales) is a separate booking', async () => {
  const lead = await newLead();
  const sales = await post(lead, MONDAY, '10:00', { appointment_type: 'sales' }, bearer(STAFF));
  const service = await post(lead, TUESDAY, '11:00', { appointment_type: 'service' }, bearer(STAFF));
  assert.equal(sales.status, 201);
  assert.equal(service.status, 201);
  assert.notEqual(service.body.bookingId, sales.body.bookingId);
  const rows = await active(lead._id);
  assert.deepEqual(rows.map((r) => r.appointment_type).sort(), ['sales', 'service']);
  // A third (sales) booking moves the sales one only.
  const moved = await post(lead, TUESDAY, '15:00', { appointment_type: 'sales' }, bearer(STAFF));
  assert.equal(moved.body.moved, true);
  assert.equal(moved.body.bookingId, sales.body.bookingId);
  assert.equal((await Booking.findById(service.body.bookingId).lean()).bookingTime, '11:00');
});

maybe('an older booking without a type counts as sales and is moved', async () => {
  const lead = await newLead();
  const raw = await Booking.collection.insertOne({ dealer_id: String(DEALER), lead_id: String(lead._id),
    customerName: 'Pat', bookingDate: new Date('2031-03-03T05:00:00Z'), bookingTime: '10:00', booking_status: 'confirmed',
    createdAt: new Date('2026-10-01T12:00:00Z'), updatedAt: new Date('2026-10-01T12:00:00Z') });
  const res = await post(lead, TUESDAY, '12:00', {}, AI);
  assert.equal(res.body.moved, true);
  assert.equal(res.body.bookingId, String(raw.insertedId));
  const b = await Booking.findById(raw.insertedId).lean();
  assert.equal(b.booking_status, 'confirmed', 'a move keeps the status');
  assert.equal(b.created_by, undefined, 'created_by is never written on a move');
  assert.deepEqual(b.history.map((h) => [h.action, h.actor_type, h.via]), [['rescheduled', 'ai', 'ai_service']]);
});

maybe('a cancelled booking is not moved: a new one is created', async () => {
  const lead = await newLead();
  const first = await post(lead, MONDAY, '10:00', {}, bearer(STAFF));
  await call('PUT', { bookingId: first.body.bookingId, booking_status: 'cancelled' }, bearer(STAFF));
  const second = await post(lead, TUESDAY, '10:00', {}, bearer(STAFF));
  assert.equal(second.status, 201);
  assert.notEqual(second.body.bookingId, first.body.bookingId);
});

maybe('a move into a full slot is refused like a move (409 + next slot) and the booking keeps its time', async () => {
  const lead = await newLead();
  const other = await newLead();
  await post(other, TUESDAY, '11:00', { appointment_type: 'service' }, bearer(STAFF)); // service: 1 per slot
  const mine = await post(lead, MONDAY, '10:00', { appointment_type: 'service' }, bearer(STAFF));
  const res = await post(lead, TUESDAY, '11:00', { appointment_type: 'service' }, bearer(STAFF));
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'slot_taken');
  assert.equal(res.body.next_available.time, '12:00');
  const b = await Booking.findById(mine.body.bookingId).lean();
  assert.deepEqual([b.bookingTime, b.history.length, b.reschedule_count], ['10:00', 1, undefined]);
  // A bad date never reaches the booking, even when staff overbook.
  const bad = await post(lead, '03/04/2031', '11:00', { appointment_type: 'service', allow_overbook: true }, bearer(STAFF));
  assert.equal(bad.status, 422);
  assert.equal((await Booking.findById(mine.body.bookingId).lean()).bookingTime, '10:00');
  // Staff may still overbook on purpose.
  const forced = await post(lead, TUESDAY, '11:00', { appointment_type: 'service', allow_overbook: true }, bearer(STAFF));
  assert.equal(forced.body.moved, true);
});

// --- POST: callers ----------------------------------------------------------------------------------------------

maybe('the AI service token still books (created_by ai, created_via ai_service) and gets bookingId back', async () => {
  const lead = await newLead();
  // The AI's own body (agentic-upsell LivePlatformClient.create_booking): no appointment_type, no source.
  const res = await call('POST', { dealer_id: String(DEALER), lead_id: String(lead._id), customerName: 'Pat',
    email: null, phone: null, bookingDate: MONDAY, bookingTime: '10:00', notes: 'wants a test drive' }, AI);
  assert.equal(res.status, 201);
  assert.ok(res.body.bookingId);
  assert.equal(res.body.booking.booking_status, 'pending');
  const b = await Booking.findById(res.body.bookingId).lean();
  assert.deepEqual([b.created_by, b.created_via, b.created_by_user_id], ['ai', 'ai_service', undefined]);
  assert.deepEqual(b.history.map((h) => [h.action, h.actor_type, h.via]), [['created', 'ai', 'ai_service']]);
  assert.deepEqual(b.history[0].to, { date: MONDAY, time: '10:00', booking_status: 'pending', appointment_type: 'sales' });
  // A second AI booking at another time (the AI's ensure_booking only reuses an exact match) moves it: the AI
  // reads bookingId / booking.booking_status as before.
  const again = await call('POST', { dealer_id: String(DEALER), lead_id: String(lead._id), customerName: 'Pat',
    bookingDate: TUESDAY, bookingTime: '09:00' }, AI);
  assert.equal(again.status, 200);
  assert.equal(again.body.bookingId, res.body.bookingId);
  assert.equal(again.body.booking.booking_status, 'pending');
  assert.equal((await active(lead._id)).length, 1);
});

maybe('the public booking page posts without a token: created_by customer, created_via booking_page', async () => {
  const lead = await newLead();
  const res = await post(lead, MONDAY, '10:00', { email: 'pat@x.test', phone: '5550001111', notes: '',
    source: 'booking_page' });
  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  const b = await Booking.findById(res.body.bookingId).lean();
  assert.deepEqual([b.created_by, b.created_via], ['customer', 'booking_page']);
  assert.deepEqual([b.history[0].actor_type, b.history[0].via], ['customer', 'booking_page']);
  // Without the page's marker an anonymous call is 'unknown'.
  const lead2 = await newLead();
  const anon = await post(lead2, MONDAY, '11:00');
  assert.equal((await Booking.findById(anon.body.bookingId).lean()).created_via, 'unknown');
  // An unknown lead is still 404.
  assert.equal((await call('POST', { dealer_id: String(DEALER), lead_id: String(id(77)), bookingDate: MONDAY,
    bookingTime: '10:00' })).status, 404);
});

// --- PUT --------------------------------------------------------------------------------------------------------

maybe('PUT cancel writes cancelled_at / cancelled_by, statusChangedAt and a history entry', async () => {
  const lead = await newLead();
  const { body } = await post(lead, MONDAY, '10:00', {}, AI);
  const res = await call('PUT', { bookingId: body.bookingId, booking_status: 'cancelled' }, bearer(STAFF));
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.booking_status, 'cancelled');
  const b = await Booking.findById(body.bookingId).lean();
  assert.equal(b.cancelled_by, 'staff');
  assert.ok(b.cancelled_at instanceof Date);
  assert.ok(b.statusChangedAt instanceof Date);
  const last = b.history.at(-1);
  assert.deepEqual([last.action, last.actor_type, String(last.actor_id), last.via],
    ['cancelled', 'staff', String(STAFF), 'booking_api']);
  assert.deepEqual([last.from, last.to], [{ booking_status: 'pending' }, { booking_status: 'cancelled' }]);
});

maybe('PUT by the AI: move, confirm and showed are recorded with the AI as actor', async () => {
  const lead = await newLead();
  const { body } = await post(lead, MONDAY, '10:00', {}, AI);
  // As agentic-upsell move_booking sends it: booking_status always, plus the new date / time.
  let res = await call('PUT', { dealer_id: String(DEALER), bookingId: body.bookingId, booking_status: 'pending',
    booking_date: TUESDAY, booking_time: '12:00' }, AI);
  assert.equal(res.status, 200);
  // Same time again: not a reschedule.
  await call('PUT', { dealer_id: String(DEALER), bookingId: body.bookingId, booking_status: 'pending',
    booking_date: TUESDAY, booking_time: '12:00' }, AI);
  res = await call('PUT', { dealer_id: String(DEALER), bookingId: body.bookingId, booking_status: 'confirmed' }, AI);
  res = await call('PUT', { dealer_id: String(DEALER), bookingId: body.bookingId, booking_status: 'completed',
    showed: true }, AI);
  const b = await Booking.findById(body.bookingId).lean();
  assert.deepEqual(b.history.map((h) => [h.action, h.actor_type]), [['created', 'ai'], ['rescheduled', 'ai'],
    ['status_changed', 'ai'], ['status_changed', 'ai'], ['showed', 'ai']]);
  assert.equal(b.reschedule_count, 1);
  assert.deepEqual([b.booking_status, b.showed, b.cancelled_at], ['completed', true, undefined]);
});

// --- history never fails the booking ----------------------------------------------------------------------------

maybe('a history write failure does not fail the booking (POST move, PUT cancel, status-screen cancel)', async () => {
  const errors = [];
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const lead = await newLead();
    const { body } = await post(lead, MONDAY, '10:00', {}, bearer(STAFF));
    // A `history` that isn't an array: every $push to it is rejected by the server.
    await Booking.collection.updateOne({ _id: new ObjectId(body.bookingId) }, { $set: { history: 'broken' } });
    const moved = await post(lead, TUESDAY, '13:00', {}, bearer(STAFF));
    assert.equal(moved.status, 200);
    assert.equal(moved.body.moved, true);
    let raw = await Booking.collection.findOne({ _id: new ObjectId(body.bookingId) });
    assert.deepEqual([raw.bookingTime, raw.history, raw.reschedule_count], ['13:00', 'broken', undefined]);

    const cancelled = await call('PUT', { bookingId: body.bookingId, booking_status: 'cancelled' }, bearer(STAFF));
    assert.equal(cancelled.status, 200);
    raw = await Booking.collection.findOne({ _id: new ObjectId(body.bookingId) });
    assert.deepEqual([raw.booking_status, raw.cancelled_by], ['cancelled', undefined]);
    assert.ok(raw.statusChangedAt, 'the base change (status + statusChangedAt) is kept');

    const lead2 = await newLead();
    const b2 = await post(lead2, MONDAY, '11:00', {}, bearer(STAFF));
    await Booking.collection.updateOne({ _id: new ObjectId(b2.body.bookingId) }, { $set: { history: 7 } });
    const r = await cancelBookingsForStatusChange({ Booking, leadId: lead2._id, dealerId: DEALER,
      previousStatus: 'Appointment Booked', status: 'Contacted', notify: async () => ({ status: 'off' }), logger: quiet });
    assert.equal(r.cancelled, 1);
    assert.equal((await Booking.collection.findOne({ _id: new ObjectId(b2.body.bookingId) })).booking_status, 'cancelled');
    assert.ok(errors.some((e) => /history not recorded/.test(e)));
  } finally {
    console.error = origError;
  }
});

test('writeWithHistory: retries without the history part when it is rejected, never on a network error', async () => {
  const seen = [];
  const reject = Object.assign(new Error('bad'), { name: 'MongoServerError' });
  const r = await writeWithHistory(async (u) => { seen.push(u); if (seen.length === 1) throw reject; return 'ok'; },
    { $set: { a: 1 } }, { $set: { b: 2 }, $push: { history: { $each: [] } } }, { logger: quiet });
  assert.deepEqual(r, { result: 'ok', history: false });
  assert.deepEqual(seen, [{ $set: { a: 1, b: 2 }, $push: { history: { $each: [] } } }, { $set: { a: 1 } }]);
  const net = Object.assign(new Error('down'), { name: 'MongoNetworkError' });
  let calls = 0;
  await assert.rejects(writeWithHistory(async () => { calls += 1; throw net; }, { $set: {} }, { $set: { b: 1 } },
    { logger: quiet }), /down/);
  assert.equal(calls, 1);
  assert.deepEqual(mergeUpdates({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
});

// --- status-screen writers (W3 / W4 / W5) -----------------------------------------------------------------------

maybe('status screen: create / move / showed / cancel write history (lead_status)', async () => {
  const dealer = await User.findById(DEALER).lean();
  const lead = await newLead();
  const actor = { type: 'staff', id: STAFF, name: 'Sam Staff' };
  const created = await upsertLeadBooking(Booking, { lead, dealer, date: '2024-05-06', time: '2 PM', actor });
  assert.equal(created.created, true);
  const moved = await upsertLeadBooking(Booking, { lead, dealer, date: '2024-05-07', time: '15:00' });
  assert.deepEqual([moved.created, moved.moved], [false, true]);
  const same = await upsertLeadBooking(Booking, { lead, dealer, date: '2024-05-07', time: '3 PM' });
  assert.equal(same.moved, false);
  await markLeadBookingShowed(Booking, { leadId: lead._id, dealer, showed: true });
  let b = await Booking.findById(created._id).lean();
  assert.deepEqual([b.created_by, b.created_via, String(b.created_by_user_id), b.reschedule_count],
    ['staff', 'lead_status', String(STAFF), 1]);
  assert.deepEqual(b.history.map((h) => [h.action, h.actor_type, h.via]), [['created', 'staff', 'lead_status'],
    ['rescheduled', 'staff', 'lead_status'], ['showed', 'staff', 'lead_status']]);
  assert.deepEqual(b.history[1].from, { date: '2024-05-06', time: '14:00' });
  assert.equal(b.booking_status, 'completed');
  assert.ok(b.statusChangedAt);

  const lead2 = await newLead();
  const c2 = await upsertLeadBooking(Booking, { lead: lead2, dealer, date: '2031-03-03', time: '10:00' });
  await cancelBookingsForStatusChange({ Booking, leadId: lead2._id, dealerId: DEALER, previousStatus: 'Appointment Booked',
    status: 'Contacted', notify: async () => ({ status: 'off' }), logger: quiet });
  b = await Booking.findById(c2._id).lean();
  assert.deepEqual([b.booking_status, b.cancelled_by, b.history.at(-1).action, b.history.at(-1).to.lead_status],
    ['cancelled', 'staff', 'cancelled', 'Contacted']);
  assert.ok(b.cancelled_at);
});

maybe('history is capped at the last 100 entries', async () => {
  const lead = await newLead();
  const { body } = await post(lead, MONDAY, '10:00', {}, AI);
  const filler = Array.from({ length: 120 }, (_, i) => ({ at: new Date(i), action: 'status_changed', actor_type: 'ai' }));
  await Booking.collection.updateOne({ _id: new ObjectId(body.bookingId) }, { $push: { history: { $each: filler } } });
  await call('PUT', { dealer_id: String(DEALER), bookingId: body.bookingId, booking_status: 'confirmed' }, AI);
  const b = await Booking.findById(body.bookingId).lean();
  assert.equal(b.history.length, 100);
  assert.equal(b.history.at(-1).to.booking_status, 'confirmed');
});

// --- attribution: changes from history ----------------------------------------------------------------------------

maybe('attributeAppointments reports rescheduled / cancelled by actor from the history', async () => {
  const leadA = await newLead();
  const leadB = await newLead();
  const leadC = await newLead();
  const a = await post(leadA, MONDAY, '10:00', {}, AI);
  await post(leadA, TUESDAY, '10:00', {}, AI); // moved by the AI
  await post(leadA, TUESDAY, '11:00', {}, bearer(STAFF)); // moved again, by staff: counted once, as staff
  const b = await post(leadB, MONDAY, '12:00', {}, AI);
  await call('PUT', { bookingId: b.body.bookingId, booking_status: 'cancelled' }, bearer(STAFF));
  const c = await post(leadC, MONDAY, '13:00', {}, bearer(STAFF));
  await call('PUT', { dealer_id: String(DEALER), bookingId: c.body.bookingId, booking_status: 'cancelled' }, AI);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: NY });
  const r = await attributeAppointments({ dealerId: String(DEALER), from: today, tz: NY });
  assert.equal(r.totals.total, 3, 'existing results unchanged: 3 bookings, the moves added none');
  assert.equal(r.changes.rescheduled.total, 1);
  assert.equal(r.changes.rescheduled.by_actor.staff, 1);
  assert.deepEqual(r.changes.rescheduled.booking_ids, [a.body.bookingId]);
  assert.equal(r.changes.cancelled.total, 2);
  assert.deepEqual([r.changes.cancelled.by_actor.staff, r.changes.cancelled.by_actor.ai], [1, 1]);
  const yesterday = await attributeAppointments({ dealerId: String(DEALER), from: '2026-01-01', tz: NY });
  assert.equal(yesterday.changes.rescheduled.total + yesterday.changes.cancelled.total, 0);
});

test('historyChanges: latest in-range actor; cancelled_at fallback; outside the range ignored', () => {
  const start = new Date('2026-11-05T05:00:00Z');
  const end = new Date('2026-11-06T04:59:59.999Z');
  const r = historyChanges([
    { _id: 'a', history: [{ action: 'rescheduled', at: new Date('2026-11-05T10:00Z'), actor_type: 'ai' },
      { action: 'rescheduled', at: new Date('2026-11-05T12:00Z'), actor_type: 'customer' }] },
    { _id: 'b', booking_status: 'cancelled', cancelled_at: new Date('2026-11-05T12:00Z'), cancelled_by: 'staff' },
    { _id: 'c', history: [{ action: 'deduplicated', at: new Date('2026-11-05T12:00Z'), actor_type: 'system' }] },
    { _id: 'd', history: [{ action: 'rescheduled', at: new Date('2026-11-04T12:00Z'), actor_type: 'ai' }] },
    { _id: 'e', history: 'broken' },
  ], { start, end });
  assert.deepEqual([r.rescheduled.total, r.rescheduled.by_actor.customer], [1, 1]);
  assert.deepEqual([r.cancelled.total, r.cancelled.by_actor.staff, r.cancelled.by_actor.system], [2, 1, 1]);
});

// --- scripts ----------------------------------------------------------------------------------------------------

maybe('dedupe script: dry run changes nothing; --apply cancels only the extras, never deletes', async () => {
  const lead = await newLead();
  const lead2 = await newLead();
  const day = new Date('2031-03-03T05:00:00Z');
  const ins = (leadId, time, updatedAt, extra = {}) => Booking.collection.insertOne({ dealer_id: String(DEALER),
    lead_id: String(leadId), customerName: 'Pat', bookingDate: day, bookingTime: time, booking_status: 'pending',
    appointment_type: 'sales', createdAt: updatedAt, updatedAt, ...extra }).then((r) => r.insertedId);
  const old = await ins(lead._id, '10:00', new Date('2026-10-20T10:00:00Z'));
  const newest = await ins(lead._id, '11:00', new Date('2026-10-22T10:00:00Z'), { booking_status: 'confirmed' });
  const mid = await ins(lead._id, '12:00', new Date('2026-10-21T10:00:00Z'), { appointment_type: undefined });
  const service = await ins(lead._id, '13:00', new Date('2026-10-19T10:00:00Z'), { appointment_type: 'service' });
  const gone = await ins(lead._id, '14:00', new Date('2026-10-23T10:00:00Z'), { booking_status: 'cancelled' });
  const single = await ins(lead2._id, '10:00', new Date('2026-10-20T10:00:00Z'));
  const before = await Booking.collection.find({}).sort({ _id: 1 }).toArray();

  const dry = await dedupeActiveBookings(mongoose.connection.db, { logger: quiet });
  assert.deepEqual([dry.groups, dry.extras, dry.cancelled], [1, 2, 0]);
  assert.deepEqual(dry.plan[0].keep, String(newest));
  assert.deepEqual(dry.plan[0].cancel.sort(), [String(old), String(mid)].sort());
  assert.deepEqual(await Booking.collection.find({}).sort({ _id: 1 }).toArray(), before, 'dry run wrote nothing');

  const applied = await dedupeActiveBookings(mongoose.connection.db, { apply: true, logger: quiet });
  assert.equal(applied.cancelled, 2);
  assert.equal(await Booking.countDocuments({}), 6, 'nothing deleted');
  const get = (oidv) => Booking.collection.findOne({ _id: oidv });
  for (const x of [old, mid]) {
    const b = await get(x);
    assert.deepEqual([b.booking_status, b.cancelled_by, b.history.at(-1).action, b.history.at(-1).to.kept_booking_id],
      ['cancelled', 'system', 'deduplicated', String(newest)]);
  }
  for (const x of [newest, service, single]) assert.notEqual((await get(x)).booking_status, 'cancelled');
  assert.equal((await get(gone)).history, undefined, 'an already-cancelled booking is untouched');
  assert.equal((await dedupeActiveBookings(mongoose.connection.db, { apply: true, logger: quiet })).cancelled, 0);
});

test('dedupe script: pure grouping and argument guards (local only unless --allow-remote)', () => {
  const g = duplicateGroups([
    { _id: '1', dealer_id: 'd', lead_id: 'l', booking_status: 'pending', updatedAt: new Date(1) },
    { _id: '2', dealer_id: 'd', lead_id: 'l', booking_status: 'confirmed', updatedAt: new Date(1) },
    { _id: '3', dealer_id: 'd', lead_id: 'l', booking_status: 'completed', updatedAt: new Date(9) },
  ]);
  assert.deepEqual([g.length, g[0].keep._id, g[0].cancel.map((b) => b._id)], [1, '2', ['1']]);
  assert.equal(isLocalMongoUri('mongodb://127.0.0.1:27018/x'), true);
  assert.equal(isLocalMongoUri('mongodb://user:pw@localhost/x'), true);
  assert.equal(isLocalMongoUri('mongodb+srv://c.example.net/x'), false);
  assert.equal(isLocalMongoUri('mongodb://127.0.0.1,db.example.net/x'), false);
  assert.match(parseArgs(['--uri=mongodb://db.example.net/x'], {}).errors.join(), /non-local/);
  assert.deepEqual(parseArgs(['--uri=mongodb://db.example.net/x', '--allow-remote', '--apply'], {}).errors, []);
  assert.match(parseArgs([], {}).errors.join(), /no database/);
  assert.match(parseArgs(['--uri=mongodb://127.0.0.1/x', '--bogus'], {}).errors.join(), /unknown argument/);
});

maybe('backfill script: adds a created entry first where missing, never touches created_by', async () => {
  const at = new Date('2026-10-01T12:00:00Z');
  const base = { dealer_id: String(DEALER), customerName: 'P', bookingDate: at, bookingTime: '10:00',
    booking_status: 'pending', createdAt: at };
  const noActor = (await Booking.collection.insertOne({ ...base, lead_id: 'a' })).insertedId;
  const ai = (await Booking.collection.insertOne({ ...base, lead_id: 'b', created_by: 'ai' })).insertedId;
  const movedLater = (await Booking.collection.insertOne({ ...base, lead_id: 'c', created_by: 'staff',
    history: [{ at: new Date(), action: 'rescheduled', actor_type: 'staff' }] })).insertedId;
  const done = (await Booking.collection.insertOne({ ...base, lead_id: 'd', created_by: 'staff',
    history: [{ at, action: 'created', actor_type: 'staff', via: 'booking_api' }] })).insertedId;
  const before = await Booking.collection.find({}).sort({ _id: 1 }).toArray();

  const dry = await backfillBookingHistory(mongoose.connection.db, { logger: quiet });
  assert.deepEqual([dry.total, dry.written, dry.byActor], [3, 0, { unknown: 1, ai: 1, staff: 1 }]);
  assert.deepEqual(await Booking.collection.find({}).sort({ _id: 1 }).toArray(), before);

  const applied = await backfillBookingHistory(mongoose.connection.db, { apply: true, logger: quiet });
  assert.equal(applied.written, 3);
  const get = (x) => Booking.collection.findOne({ _id: x });
  const a = await get(noActor);
  assert.equal(a.created_by, undefined, 'created_by is never written');
  assert.deepEqual(a.history, [{ at, action: 'created', actor_type: 'unknown', via: 'backfill' }]);
  assert.equal((await get(ai)).history[0].actor_type, 'ai');
  assert.deepEqual((await get(movedLater)).history.map((h) => h.action), ['created', 'rescheduled']);
  assert.equal((await get(done)).history.length, 1);
  assert.equal((await backfillBookingHistory(mongoose.connection.db, { apply: true, logger: quiet })).written, 0);
});

maybe('index script: dry run lists the plan and builds nothing; --apply creates; Mongoose never auto-builds them', async () => {
  await Booking.init(); // what a deploy's first use does
  const names = async (c) => (await mongoose.connection.db.collection(c).listIndexes().toArray().catch(() => []))
    .map((i) => i.name);
  assert.deepEqual(await names('bookings'), ['_id_']);
  await mongoose.connection.db.collection('leads').createIndex({ dealer_id: 1, createdAt: -1 }, { name: 'already_there' });
  const dry = await ensureReportIndexes(mongoose.connection.db, { logger: quiet });
  assert.equal(dry.present.length, 1);
  assert.equal(dry.missing.length, REPORT_INDEXES.length - 1);
  assert.deepEqual(await names('bookings'), ['_id_']);
  const applied = await ensureReportIndexes(mongoose.connection.db, { apply: true, logger: quiet });
  assert.equal(applied.created.length, REPORT_INDEXES.length - 1);
  assert.deepEqual((await names('bookings')).sort(), ['_id_', 'dealer_id_1_bookingDate_1', 'dealer_id_1_createdAt_-1',
    'lead_id_1']);
  assert.ok((await names('activitylogs')).includes('dealer_id_1_at_-1'));
  assert.ok((await names('emails')).includes('dealer_id_1_status_1_timestamp_-1'));
  const again = await ensureReportIndexes(mongoose.connection.db, { apply: true, logger: quiet });
  assert.deepEqual([again.missing.length, again.created.length], [0, 0]);
});
