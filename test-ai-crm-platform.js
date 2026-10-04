// The CRM side of agentic-upsell MASTER_PLAN_4 stream C1: the AI sends through
// the CRM (POST /api/internal/ai/messages/send), the booking slot / capacity
// check, DND from the AI, the read-only AI stage on the lead list, the local
// provider stub, and the AI-live gate on the platform's own reminders.
//
// Pure tests always run; the MongoDB ones use their own database
// (pulse_ai_crm_platform_test, wiped before each test) and are skipped when no
// MongoDB is reachable.   Run: node --test test-ai-crm-platform.js
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import Booking from './app/models/Booking.js';
import Email from './app/models/Email.js';
import EmailAccount from './app/models/EmailAccount.js';
import Lead from './app/models/Lead.js';
import User from './app/models/User.js';
import { AiSendError, classifyProviderError, sendAiMessage } from './app/lib/ai/aiSend.js';
import { aiEmailHtml, buildAiEmailDocument, mediaAttachments, validateAiSendPayload } from './app/lib/ai/aiMessageRecord.js';
import { addAiLeadNote, markLeadDndFromAi, validateDndPayload, validateNotePayload } from './app/lib/ai/aiDnd.js';
import { attachAiStages } from './app/lib/ai/aiStage.js';
import {
  appointmentTypeFor, capacitySettings, checkBookingSlot, checkSlot, nextAvailableSlot, normalizeAppointmentType, keepsPlaceInSlot, markLeadBookingShowed, normalizeBookingTime,
  openingHours, slotsForDay, upsertLeadBooking,
} from './app/lib/bookingService.js';
import { isProviderSendStubbed, recordStubSend, stubProviderId } from './app/lib/providerStub.js';
import { aiOwnsCustomerMessages } from './app/lib/appointmentReminderService.js';
import { BookingConflictError, bookingConflictFrom, slotLabel, throwIfStatusFailed } from './app/lib/bookingConflict.js';

const URI = process.env.AI_TEST_MONGODB_URI_CRM || 'mongodb://localhost:27018/pulse_ai_crm_platform_test';
const DEALER = '66f0000000000000000000d1';
const LEAD = '66f0000000000000000000e1';
const HOURS = {
  monday: { active: true, start: '9:00 AM', end: '7:00 PM' },
  tuesday: { active: true, start: '9:00 AM', end: '7:00 PM' },
  wednesday: { active: true, start: '9:00 AM', end: '7:00 PM' },
  thursday: { active: true, start: '9:00 AM', end: '7:00 PM' },
  friday: { active: true, start: '9:00 AM', end: '7:00 PM' },
  saturday: { active: true, start: '9:00 AM', end: '5:00 PM' },
  sunday: { active: false, start: '', end: '' },
};
const dealerDoc = (info = {}) => ({ _id: DEALER, dealer_account_information: {
  time_zone: 'America/New_York', weekly_availability: HOURS, sms_conversion_phone: '+15550001111', ...info } });
// A Monday well in the future, so "in the past" never interferes.
const MONDAY = '2031-03-03';
const SUNDAY = '2031-03-02';
const NOW = new Date('2031-03-01T12:00:00Z');

// --- Pure ----------------------------------------------------------------------------

test('booking times are normalized to HH:MM, whatever the caller sends', () => {
  assert.equal(normalizeBookingTime('2 PM'), '14:00');
  assert.equal(normalizeBookingTime('2:30 pm'), '14:30');
  assert.equal(normalizeBookingTime('09:05'), '09:05');
  assert.equal(normalizeBookingTime('12 AM'), '00:00');
  assert.equal(normalizeBookingTime('25:00'), null);
  assert.equal(normalizeBookingTime('soon'), null);
});

test('capacity: one-hour slots, 10 sales or 1 service per slot, dealer-configurable (client, 5 Oct 2026)', () => {
  assert.deepEqual(capacitySettings(dealerDoc()), { appointmentType: 'sales', maxPerSlot: 10, slotMinutes: 60 });
  assert.deepEqual(capacitySettings(dealerDoc(), 'service'), { appointmentType: 'service', maxPerSlot: 1, slotMinutes: 60 });
  // The older single setting applies to sales only; booking_capacity wins over it.
  assert.deepEqual(capacitySettings(dealerDoc({ booking_max_per_slot: '3', booking_slot_minutes: 30 })),
    { appointmentType: 'sales', maxPerSlot: 3, slotMinutes: 30 });
  assert.equal(capacitySettings(dealerDoc({ booking_max_per_slot: 3 }), 'service').maxPerSlot, 1);
  assert.deepEqual(capacitySettings(dealerDoc({ booking_capacity: { service: { max_per_slot: 2, slot_minutes: 30 } } }),
    'service'), { appointmentType: 'service', maxPerSlot: 2, slotMinutes: 30 });
  assert.deepEqual(capacitySettings(dealerDoc({ booking_max_per_slot: 0, booking_slot_minutes: 1 })),
    { appointmentType: 'sales', maxPerSlot: 10, slotMinutes: 60 });
});

test('the appointment type comes from the choice, the lead type, then the lead source', () => {
  assert.equal(appointmentTypeFor({ source: 'Service Department' }), 'service');
  assert.equal(appointmentTypeFor({ source: 'CarGurus' }), 'sales');
  assert.equal(appointmentTypeFor({ source: 'CarGurus', lead_type: 'service' }), 'service');
  assert.equal(appointmentTypeFor({ source: 'Service Department' }, 'sales'), 'sales');
  assert.equal(appointmentTypeFor({ source: 'CarGurus' }, 'bogus'), 'sales');
  assert.equal(normalizeAppointmentType(undefined), 'sales');
});

test('a sales slot takes 10, a service slot 1, and the two never share a count', () => {
  const dealer = dealerDoc();
  const at = (n, type) => Array.from({ length: n }, () => ({ bookingTime: '10:00', appointment_type: type }));
  assert.equal(checkSlot({ dealer, date: MONDAY, time: '10:30', now: NOW, sameDayBookings: at(9, 'sales') }).ok, true);
  const full = checkSlot({ dealer, date: MONDAY, time: '10:30', now: NOW, sameDayBookings: at(10, 'sales') });
  assert.equal(full.reason, 'slot_full');
  assert.equal(full.slot, '10:00');
  // Bookings saved before types existed count as sales.
  assert.equal(checkSlot({ dealer, date: MONDAY, time: '10:00', now: NOW,
    sameDayBookings: Array.from({ length: 10 }, () => ({ bookingTime: '10:00' })) }).reason, 'slot_full');
  // Ten sales bookings leave the service slot free; one service booking fills it.
  assert.equal(checkSlot({ dealer, date: MONDAY, time: '10:00', now: NOW, appointmentType: 'service',
    sameDayBookings: at(10, 'sales') }).ok, true);
  assert.equal(checkSlot({ dealer, date: MONDAY, time: '10:45', now: NOW, appointmentType: 'service',
    sameDayBookings: at(1, 'service') }).reason, 'slot_full');
  assert.equal(checkSlot({ dealer, date: MONDAY, time: '10:00', now: NOW, sameDayBookings: at(1, 'service') }).ok, true);
});

test('opening hours come from weekly_availability; none on record means Mon-Sat 9-18', () => {
  const { hours, fromRecord } = openingHours(dealerDoc());
  assert.equal(fromRecord, true);
  assert.deepEqual(hours[0], { open: 540, close: 1140 });
  assert.equal(hours[6], null);
  const fallback = openingHours({ dealer_account_information: {} });
  assert.equal(fallback.fromRecord, false);
  assert.deepEqual(fallback.hours[5], { open: 540, close: 1080 });
});

test('a slot is refused when closed, outside hours, in the past or full; free otherwise', () => {
  const dealer = dealerDoc();
  assert.equal(checkSlot({ dealer, date: MONDAY, time: '10:00', now: NOW }).ok, true);
  assert.equal(checkSlot({ dealer, date: SUNDAY, time: '10:00', now: NOW }).reason, 'closed_day');
  assert.equal(checkSlot({ dealer, date: MONDAY, time: '8:30 AM', now: NOW }).reason, 'outside_hours');
  assert.equal(checkSlot({ dealer, date: MONDAY, time: '19:00', now: NOW }).reason, 'outside_hours');
  assert.equal(checkSlot({ dealer, date: '2020-01-06', time: '10:00', now: NOW }).reason, 'in_past');
  assert.equal(checkSlot({ dealer, date: '2020-01-06', time: '10:00', now: NOW, allowPast: true }).ok, true);
  assert.equal(checkSlot({ dealer, date: 'next week', time: '10:00', now: NOW }).reason, 'invalid_date');
  // A service slot is one hour: 10:15 is in the 10:00 slot, which a 10:00 service booking already takes.
  const service = { appointmentType: 'service', sameDayBookings: [{ bookingTime: '10:00', appointment_type: 'service' }] };
  const full = checkSlot({ dealer, date: MONDAY, time: '10:15', now: NOW, ...service });
  assert.equal(full.reason, 'slot_full');
  assert.equal(full.slot, '10:00');
  assert.equal(checkSlot({ dealer, date: MONDAY, time: '11:00', now: NOW, ...service }).ok, true);
});

test('the day view lists every slot inside opening hours with what is taken', () => {
  const booked = [{ bookingTime: '09:00', appointment_type: 'service' }];
  const slots = slotsForDay({ dealer: dealerDoc(), date: MONDAY, now: NOW, sameDayBookings: booked, appointmentType: 'service' });
  assert.equal(slots.length, 10); // 09:00-19:00 in one-hour slots
  assert.deepEqual(slots[0], { time: '09:00', taken: 1, max: 1, available: false });
  assert.equal(slots[1].available, true);
  const sales = slotsForDay({ dealer: dealerDoc(), date: MONDAY, now: NOW, sameDayBookings: booked });
  assert.deepEqual(sales[0], { time: '09:00', taken: 0, max: 10, available: true });
  assert.equal(slotsForDay({ dealer: dealerDoc(), date: SUNDAY, now: NOW }).length, 0);
});

test('send payloads: media_urls are optional, http(s) only, at most 10', () => {
  const base = { dealer_id: DEALER, lead_id: LEAD, channel: 'sms', to: '+15557654321', text: 'Hi', idempotency_key: 'k1' };
  assert.deepEqual(validateAiSendPayload(base).errors, []);
  assert.deepEqual(validateAiSendPayload({ ...base, media_urls: ['https://x.test/a.jpg'] }).errors, []);
  assert.ok(validateAiSendPayload({ ...base, media_urls: ['ftp://x'] }).errors.length);
  assert.ok(validateAiSendPayload({ ...base, media_urls: Array(11).fill('https://x.test/a.jpg') }).errors.length);
  assert.ok(validateAiSendPayload({ ...base, channel: 'fax' }).errors.length);
});

test('media become conversation attachments and inline email images', () => {
  assert.deepEqual(mediaAttachments(['https://cdn.test/v/1.png?x=1']),
    [{ url: 'https://cdn.test/v/1.png?x=1', publicUrl: 'https://cdn.test/v/1.png?x=1', contentType: 'image/png', fileName: '1.png' }]);
  const html = aiEmailHtml('Hi <Ann>\n\nHere it is', ['https://cdn.test/a.jpg']);
  assert.match(html, /<p>Hi &lt;Ann&gt;<\/p>/);
  assert.match(html, /<img src="https:\/\/cdn.test\/a.jpg"/);
  const doc = buildAiEmailDocument({ payload: { dealer_id: DEALER, lead_id: LEAD, channel: 'sms', to: '+1555', text: 'x',
    idempotency_key: 'k', status: 'sent', media_urls: ['https://cdn.test/a.jpg'], sent_via_platform: true },
  dealer: dealerDoc(), emailAccount: null });
  assert.equal(doc.has_attachments, true);
  assert.equal(doc.attachments.length, 1);
  assert.equal(doc.ai_sent_via_platform, true);
});

test('provider errors: STOP is an opt-out, permanent errors are 422, the rest retryable', () => {
  const stop = classifyProviderError(Object.assign(new Error('unsubscribed'), { code: 21610, reason: 'unsubscribed' }));
  assert.deepEqual([stop.httpStatus, stop.retryable, stop.optedOut], [422, false, true]);
  const bad = classifyProviderError(Object.assign(new Error('bad number'), { retryable: false }));
  assert.deepEqual([bad.httpStatus, bad.retryable], [422, false]);
  const down = classifyProviderError(new Error('timeout'));
  assert.deepEqual([down.httpStatus, down.retryable], [502, true]);
});

test('the provider stub is on only when asked, and never in production', () => {
  assert.equal(isProviderSendStubbed({ PROVIDER_SEND_STUB: 'true' }), true);
  assert.equal(isProviderSendStubbed({}), false);
  assert.equal(isProviderSendStubbed({ PROVIDER_SEND_STUB: 'true', NODE_ENV: 'production' }), false);
  assert.match(stubProviderId('sms'), /^SMstub/);
  assert.match(stubProviderId('email'), /^<stub-.*@local-dev\.invalid>$/);
});

test('reminders, post-visit and review messages belong to the AI only for a live dealer', async () => {
  const mode = (m) => ({ getMode: async () => m });
  assert.equal(await aiOwnsCustomerMessages(DEALER, mode('live')), true);
  assert.equal(await aiOwnsCustomerMessages(DEALER, mode('shadow')), false);
  assert.equal(await aiOwnsCustomerMessages(DEALER, mode('off')), false);
  assert.equal(await aiOwnsCustomerMessages(null, mode('live')), false);
});

test('DND payloads need the dealer and lead ids', () => {
  assert.deepEqual(validateDndPayload({ dealer_id: DEALER, lead_id: LEAD, reason: 'STOP' }).errors, []);
  assert.ok(validateDndPayload({ dealer_id: 'x', lead_id: LEAD }).errors.length);
});

// --- MongoDB -------------------------------------------------------------------------

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

async function seedDealerAndLead() {
  await User.collection.insertOne({ ...dealerDoc(), _id: new mongoose.Types.ObjectId(DEALER), type: 'dealer',
    name: 'Test Motors', email: 'test-motors@example.test', password: 'x', ai_mms_enabled: true });
  await EmailAccount.collection.insertOne({ dealer_id: new mongoose.Types.ObjectId(DEALER), account_name: 'Sales',
    event_type: 'Sales', email_address: 'sales@test-motors.test', email_password: 'x', active: true });
  await Lead.collection.insertOne({ _id: new mongoose.Types.ObjectId(LEAD), dealer_id: DEALER, name: 'Ann Lee',
    phone: '+15557654321', email: 'ann@example.test' });
}

function providers() {
  const calls = [];
  return {
    calls,
    sendSMS: async (to, body, dealer, media) => { calls.push({ channel: 'sms', to, body, from: dealer.dealer_account_information.sms_conversion_phone, media }); return 'SM123'; },
    sendEmail: async (to, subject, html, from, parent) => { calls.push({ channel: 'email', to, subject, html, from, parent }); return '<m1@test>'; },
  };
}

maybe('the CRM sends an AI SMS from the dealer number, with photos, and records it once', async () => {
  await seedDealerAndLead();
  const p = providers();
  const body = { dealer_id: DEALER, lead_id: LEAD, customer_id: 'c1', channel: 'sms', to: '+15557654321',
    text: 'Here is the RAV4', idempotency_key: 'turn1:sms', media_urls: ['https://cdn.test/rav4.jpg'] };
  const first = await sendAiMessage(body, { Email, Lead, User, EmailAccount, ...p });
  assert.equal(first.provider_id, 'SM123');
  assert.equal(first.created, true);
  assert.deepEqual(p.calls[0].media, ['https://cdn.test/rav4.jpg']);
  assert.equal(p.calls[0].from, '+15550001111');
  const record = await Email.findById(first.id).lean();
  assert.equal(record.ai_generated, true);
  assert.equal(record.sender, '+15550001111');
  assert.equal(record.message_id, 'SM123');
  assert.equal(record.attachments[0].url, 'https://cdn.test/rav4.jpg');
  // A retried send is answered from the record and never sent twice.
  const again = await sendAiMessage(body, { Email, Lead, User, EmailAccount, ...p });
  assert.equal(again.duplicate, true);
  assert.equal(again.provider_id, 'SM123');
  assert.equal(p.calls.length, 1);
});

maybe('an AI email goes from the dealer mailbox, threaded under the lead\'s last email', async () => {
  await seedDealerAndLead();
  await Email.create({ sender: 'ann@example.test', recipient: 'sales@test-motors.test', message_id: '<prev@x>',
    communication_type: 'email', status: 'incoming', dealer_id: DEALER, lead_id: LEAD, timestamp: new Date() });
  const p = providers();
  const result = await sendAiMessage({ dealer_id: DEALER, lead_id: LEAD, channel: 'email', to: 'ann@example.test',
    text: 'Hello', subject: 'Your RAV4', idempotency_key: 't2:email' }, { Email, Lead, User, EmailAccount, ...p });
  assert.equal(p.calls[0].from, 'sales@test-motors.test');
  assert.equal(p.calls[0].parent, '<prev@x>');
  assert.equal((await Email.findById(result.id).lean()).subject, 'Your RAV4');
});

maybe('a send for another dealer\'s lead, or a STOP-ed number, is refused and not recorded', async () => {
  await seedDealerAndLead();
  const other = { dealer_id: '66f0000000000000000000d9', lead_id: LEAD, channel: 'sms', to: '+1555', text: 'x',
    idempotency_key: 'x1' };
  await assert.rejects(sendAiMessage(other, { Email, Lead, User, EmailAccount, ...providers() }),
    (e) => e instanceof AiSendError && e.httpStatus === 404);
  const stop = { ...providers(), sendSMS: async () => { throw Object.assign(new Error('21610'), { code: 21610 }); } };
  await assert.rejects(sendAiMessage({ ...other, dealer_id: DEALER, idempotency_key: 'x2' },
    { Email, Lead, User, EmailAccount, ...stop }), (e) => e.optedOut === true && e.retryable === false);
  assert.equal(await Email.countDocuments({}), 0);
});

maybe('a taken slot is refused (409 path) for everyone, and the next open slot is named', async () => {
  await seedDealerAndLead();
  const dealer = await User.findById(DEALER).lean();
  const service = { appointmentType: 'service' };
  await Booking.create({ dealer_id: DEALER, lead_id: 'other', customerName: 'Bo', bookingDate: new Date('2031-03-03T05:00:00Z'),
    bookingTime: '10:00', appointment_type: 'service' });
  const taken = await checkBookingSlot(Booking, { dealer, date: MONDAY, time: '10:10', now: NOW, ...service });
  assert.equal(taken.reason, 'slot_full');
  assert.equal((await checkBookingSlot(Booking, { dealer, date: MONDAY, time: '11:00', now: NOW, ...service })).ok, true);
  // The same hour still has room for sales.
  assert.equal((await checkBookingSlot(Booking, { dealer, date: MONDAY, time: '10:00', now: NOW })).ok, true);
  // "Guide the user about the next available slot" (client, 5 Oct 2026).
  assert.deepEqual(await nextAvailableSlot(Booking, { dealer, date: MONDAY, time: '10:10', now: NOW, ...service }),
    { date: MONDAY, time: '11:00', appointment_type: 'service' });
  // A cancelled booking frees its slot.
  await Booking.updateMany({}, { $set: { booking_status: 'cancelled' } });
  assert.equal((await checkBookingSlot(Booking, { dealer, date: MONDAY, time: '10:00', now: NOW, ...service })).ok, true);
});

maybe('two bookings racing for the last place: only the first keeps it', async () => {
  await seedDealerAndLead();
  const dealer = await User.findById(DEALER).lean();
  const day = new Date('2031-03-03T05:00:00Z');
  const service = { appointment_type: 'service' };
  const a = await Booking.create({ dealer_id: DEALER, lead_id: 'a', customerName: 'A', bookingDate: day, bookingTime: '11:00', ...service });
  const b = await Booking.create({ dealer_id: DEALER, lead_id: 'b', customerName: 'B', bookingDate: day, bookingTime: '11:15', ...service });
  assert.equal(await keepsPlaceInSlot(Booking, { dealer, date: MONDAY, time: '11:00', bookingId: a._id, appointmentType: 'service' }), true);
  assert.equal(await keepsPlaceInSlot(Booking, { dealer, date: MONDAY, time: '11:15', bookingId: b._id, appointmentType: 'service' }), false);
});

maybe('a staff booking becomes a Booking; Visited marks it showed and completed', async () => {
  await seedDealerAndLead();
  const dealer = await User.findById(DEALER).lean();
  const lead = await Lead.findById(LEAD).lean();
  const created = await upsertLeadBooking(Booking, { lead, dealer, date: '2024-05-06', time: '2 PM' });
  assert.equal(created.created, true);
  const moved = await upsertLeadBooking(Booking, { lead, dealer, date: '2024-05-07', time: '15:00' });
  assert.equal(moved.created, false);
  assert.equal(await Booking.countDocuments({ lead_id: LEAD }), 1);
  const showed = await markLeadBookingShowed(Booking, { leadId: LEAD, dealer, showed: true });
  assert.equal(showed.showed, true);
  const row = await Booking.findById(created._id).lean();
  assert.deepEqual([row.showed, row.booking_status, row.bookingTime], [true, 'completed', '15:00']);
});

maybe('the AI\'s opt-out sets the CRM lead to DND with a note, once', async () => {
  await seedDealerAndLead();
  const cleared = [];
  const deps = { Lead, Email, clearPendingJobs: async (id) => cleared.push(String(id)) };
  const first = await markLeadDndFromAi({ dealer_id: DEALER, lead_id: LEAD, reason: 'Replied STOP' }, deps);
  assert.deepEqual([first.updated, first.already_dnd], [true, false]);
  const lead = await Lead.findById(LEAD).lean();
  assert.deepEqual([lead.fe_lead_status, lead.dnd_source], ['DND', 'ai_opt_out']);
  const note = await Email.findOne({ lead_id: LEAD, is_note: true }).lean();
  assert.match(note.mail_content, /Replied STOP/);
  const second = await markLeadDndFromAi({ dealer_id: DEALER, lead_id: LEAD, reason: 'again' }, deps);
  assert.equal(second.already_dnd, true);
  assert.equal(await Email.countDocuments({ is_note: true }), 1);
  assert.deepEqual(cleared, [LEAD, LEAD]);
  assert.equal((await markLeadDndFromAi({ dealer_id: '66f0000000000000000000d9', lead_id: LEAD }, deps)).found, false);
});

maybe('photos go by text only for a dealer with ai_mms_enabled; the text still goes', async () => {
  await seedDealerAndLead();
  await User.collection.updateOne({}, { $set: { ai_mms_enabled: false } });
  const p = providers();
  const result = await sendAiMessage({ dealer_id: DEALER, lead_id: LEAD, channel: 'sms', to: '+15557654321',
    text: 'Here it is', idempotency_key: 'mms-off', media_urls: ['https://cdn.test/a.jpg'] },
  { Email, Lead, User, EmailAccount, ...p });
  assert.deepEqual(p.calls[0].media, []);
  assert.equal((await Email.findById(result.id).lean()).has_attachments, undefined);
});

maybe('the AI can leave an internal note on a lead of its dealer', async () => {
  await seedDealerAndLead();
  assert.ok(validateNotePayload({ dealer_id: DEALER, lead_id: LEAD, text: ' ' }).errors.length);
  const made = await addAiLeadNote({ dealer_id: DEALER, lead_id: LEAD, text: 'Service request: Tuesday morning',
    kind: 'service_request' }, { Lead, Email });
  const note = await Email.findById(made.id).lean();
  assert.deepEqual([note.is_note, note.internal_use, note.ai_note_kind], [true, true, 'service_request']);
  assert.equal((await addAiLeadNote({ dealer_id: '66f0000000000000000000d9', lead_id: LEAD, text: 'x' },
    { Lead, Email })).found, false);
});

maybe('an AI note with an idempotency key is written once', async () => {
  await seedDealerAndLead();
  const body = { dealer_id: DEALER, lead_id: LEAD, text: 'SOLD PENDING: the customer asks for a person',
    kind: 'sold_pending_escalation', idempotency_key: 'notice:abc' };
  const first = await addAiLeadNote(body, { Lead, Email });
  const again = await addAiLeadNote(body, { Lead, Email });
  assert.deepEqual([first.created, again.created, again.id], [true, false, first.id]);
  assert.equal(await Email.countDocuments({ lead_id: LEAD, is_note: true }), 1);
  assert.ok(validateNotePayload({ ...body, idempotency_key: 5 }).errors.length);
});

maybe('the lead list carries the AI stage, read only', async () => {
  await mongoose.connection.collection('ai_lead_state').insertOne({ dealer_id: DEALER, lead_id: LEAD,
    stage: 'sold_pending', stage_label: 'Sold Pending', status: 'paused' });
  const leads = [{ _id: new mongoose.Types.ObjectId(LEAD), dealer_id: DEALER }, { _id: new mongoose.Types.ObjectId(), dealer_id: DEALER }];
  await attachAiStages(leads);
  assert.equal(leads[0].ai_stage_label, 'Sold Pending');
  assert.equal(leads[1].ai_stage_label, undefined);
});

maybe('a stubbed send is written to the dev outbox, with its media', async () => {
  const id = await recordStubSend({ channel: 'sms', to: '+15557654321', text: 'hi', media_urls: ['https://cdn.test/a.jpg'] });
  const row = await mongoose.connection.collection('dev_provider_outbox').findOne({ provider_id: id });
  assert.deepEqual(row.media_urls, ['https://cdn.test/a.jpg']);
});

// Stream R: a full slot shows the same way in every staff booking screen, with a one-click next slot.
test('a 409 full slot becomes a conflict with the next available and the day\'s other times', async () => {
  const body = { error: 'slot_taken', message: 'The 10:00 slot on 2026-10-09 is full. The next available is Friday, Oct 9 at 11:00 AM.',
    next_available: { date: '2026-10-09', time: '11:00' }, alternatives: ['10:00', '11:00', '14:30', 'x'] };
  const conflict = bookingConflictFrom(409, body, { date: '2026-10-09', time: '10:00' });
  assert.equal(conflict.message, body.message);
  assert.deepEqual(conflict.nextAvailable, { date: '2026-10-09', time: '11:00' });
  assert.deepEqual(conflict.alternatives, ['11:00', '14:30']);
  assert.equal(bookingConflictFrom(500, body), null);
  assert.equal(bookingConflictFrom(422, { error: 'missing_field' }), null);
  assert.equal(slotLabel('2026-10-09', '14:30'), 'Friday, Oct 9 at 2:30 PM');
  assert.equal(slotLabel('2026-10-10', '00:15'), 'Saturday, Oct 10 at 12:15 AM');
  const response = { ok: false, status: 409, json: async () => body };
  await assert.rejects(throwIfStatusFailed(response, { booking_date: '2026-10-09', booking_time: '10:00' }),
    (err) => err instanceof BookingConflictError && err.slotConflict.nextAvailable.time === '11:00');
  await assert.rejects(throwIfStatusFailed({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }), /boom/);
  await throwIfStatusFailed({ ok: true });
});
