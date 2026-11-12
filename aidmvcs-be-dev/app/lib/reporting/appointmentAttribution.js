// Appointment attribution: AI / AI-assisted / human-only / unknown (SOW 8A / Deliverable F2; P1 plan item 3).
// One booking ID is counted once, in exactly one category; total = ai + ai_assisted + human_only + unknown.
//
// Rules (project owner, 9 Nov 2026), evaluated in this order:
//   ai           Booking.created_by === 'ai'
//   unknown      created_by missing (bookings before ~7 Oct 2026) or not ai/staff/customer -> reason 'no_actor'
//   unknown      created_by === 'customer' (the public booking page; its link was only sent by the n8n flows, which
//                are dead and never count as AI) -> reason 'customer_booking_page'
//   unknown      created_by === 'staff' but the lead is gone / not this dealer's / lead_id not an id -> 'lead_missing'
//   ai_assisted  created_by === 'staff' and an AI message was sent to the customer on the same lead before the
//                booking was created: emails.lead_id = ObjectId(booking.lead_id), ai_generated:true, is_note != true,
//                communication_type sms|email, sent successfully (see AI_SENT_STATUSES), timestamp < createdAt
//   human_only   created_by === 'staff' with no such message
//   ai_influenced = ai + ai_assisted (derived, not a category); ai_influence_pct only when total > 0.
// Duplicates: bookings of one (dealer, lead, bookingDate, bookingTime) that are not cancelled - the lowest _id is the
// appointment, the others are left out of every count and listed in excluded.duplicates.
// Changes (from the booking history written since P1 item 3; older changes were never recorded, so they are not in
// it): bookings rescheduled / cancelled in the range, by the actor of their latest such change in the range
// (ai / staff / customer / system / unknown). A booking moved 3 times counts once. Cancelled also uses cancelled_at /
// cancelled_by where a booking has no cancel entry. Event basis, independent of `basis`; the filters apply.
// Date basis: 'created' = Booking.createdAt in the dealer-local range (cancelled bookings stay counted on the day
// they were set, SOW 8A); 'scheduled' = Booking.bookingDate in the range, not cancelled (as appointmentFunnel.js).
//
// Imports are relative so BullMQ workers (the daily email) can load this module too.
import mongoose from 'mongoose';
import Booking from '../../models/Booking.js';
import Email from '../../models/Email.js';
import Lead from '../../models/Lead.js';
import { REPORTS, bookingMatch, describeSpec, hasLeadFilter, leadMatch, parseFilterSpec } from './filters.js';
import { getDealerTimezone, localDayRange } from './time.js';
import { appointmentPassed, bookingShowed, leadStatuses } from '../appointmentFunnel.js';

// v2: show rate = shown / past appointments; v3: no-show = marked no-show only, past with no outcome = not_recorded
export const DEFINITIONS_VERSION = 'appt-attr-v3';
export const CATEGORY = Object.freeze({ AI: 'ai', AI_ASSISTED: 'ai_assisted', HUMAN_ONLY: 'human_only',
  UNKNOWN: 'unknown' });
export const CATEGORIES = Object.freeze(Object.values(CATEGORY));
export const REASON = Object.freeze({
  AI_CREATED: 'ai_created', NO_ACTOR: 'no_actor', CUSTOMER: 'customer_booking_page', LEAD_MISSING: 'lead_missing',
  STAFF_AFTER_AI: 'staff_after_ai', STAFF_NO_AI: 'staff_no_ai',
});
// An AI message row is written 'sent' (or 'failed', app/lib/ai/aiMessageRecord.js) and the delivery webhooks later
// overwrite the same row's status: Twilio -> delivered / undelivered / failed (app/api/webhooks/twilio/route.js),
// SES -> delivered / bounced (app/lib/ai/sesEvents.js). 'delivered' is therefore still "sent"; failed, undelivered
// and bounced are not.
export const AI_SENT_STATUSES = Object.freeze(['sent', 'delivered']);

const isOid = (id) => id != null && /^[0-9a-f]{24}$/i.test(String(id));
const oid = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * Pure. @param booking {created_by, createdAt}; @param leadFound boolean;
 * @param firstAiSend {id, at} | null - the lead's earliest qualifying AI send.
 */
export function classifyBooking(booking, { leadFound, firstAiSend }) {
  const by = booking.created_by;
  if (by === 'ai') return { category: CATEGORY.AI, reason: REASON.AI_CREATED, evidence: null };
  if (by === 'customer') return { category: CATEGORY.UNKNOWN, reason: REASON.CUSTOMER, evidence: null };
  if (by !== 'staff') return { category: CATEGORY.UNKNOWN, reason: REASON.NO_ACTOR, evidence: null };
  if (!leadFound) return { category: CATEGORY.UNKNOWN, reason: REASON.LEAD_MISSING, evidence: null };
  const created = booking.createdAt ? new Date(booking.createdAt) : null;
  if (firstAiSend && created && new Date(firstAiSend.at) < created) {
    return { category: CATEGORY.AI_ASSISTED, reason: REASON.STAFF_AFTER_AI, evidence: firstAiSend };
  }
  return { category: CATEGORY.HUMAN_ONLY, reason: REASON.STAFF_NO_AI, evidence: null };
}

export function summarize(rows) {
  const t = { total: rows.length, ai: 0, ai_assisted: 0, human_only: 0, unknown: 0 };
  for (const r of rows) t[r.category] += 1;
  if (t.ai + t.ai_assisted + t.human_only + t.unknown !== t.total) throw new Error('attribution categories != total');
  t.ai_influenced = t.ai + t.ai_assisted;
  t.ai_influence_pct = t.total > 0 ? Math.round((t.ai_influenced / t.total) * 10000) / 100 : null;
  return t;
}

// Pure. Outcomes of the counted bookings - the same definition as the Reports page and the Dashboard card
// "Appointments Showed" (app/lib/appointmentFunnel.js):
//   cancelled  booking_status cancelled (never shown, no-show or upcoming)
//   shown      not cancelled and bookingShowed(): marked shown, completed, or the lead is now Visited / Unsold / Sold*
//   no_show       not cancelled, not shown, and staff marked it a no-show (Booking.showed === false, written by
//                 lib/bookingService.js / api/booking with a 'no_show' history entry)
//   not_recorded  not cancelled, not shown, not marked a no-show, and its date and time have passed (dealer time zone):
//                 nobody recorded an outcome - NOT a no-show (owner, 10 Nov 2026)
//   upcoming      not cancelled, no outcome, still ahead
//   show_rate     shown / (shown + no_show + not_recorded): RECORDED shows out of the past (or already decided)
//                 appointments. Future ones are not counted. Labelled "(recorded)": an appointment the customer came to
//                 that nobody recorded is in the denominator only.
// leadStatus: Map lead id -> fe_lead_status; now / tz: when "past" is decided.
export function outcomes(bookings, { leadStatus = new Map(), now = new Date(), tz } = {}) {
  const o = { shown: 0, no_show: 0, not_recorded: 0, cancelled: 0, completed: 0, upcoming: 0 };
  for (const b of bookings) {
    if (b.booking_status === 'completed') o.completed += 1;
    if (b.booking_status === 'cancelled') { o.cancelled += 1; continue; }
    if (bookingShowed(b, leadStatus.get(String(b.lead_id)))) o.shown += 1;
    else if (b.showed === false) o.no_show += 1;
    else if (appointmentPassed(b, { now, tz })) o.not_recorded += 1;
    else o.upcoming += 1;
  }
  const denominator = o.shown + o.no_show + o.not_recorded;
  o.show_rate = { numerator: o.shown, denominator,
    value: denominator > 0 ? Math.round((o.shown / denominator) * 10000) / 100 : null,
    definition: 'recorded shows / past appointments (shown + no-show + no outcome recorded); cancelled and future '
      + 'appointments are not counted' };
  return o;
}

// Pure. Within (dealer, lead, bookingDate, bookingTime), not cancelled, the lowest _id counts. Returns
// Map<duplicateId, keptId>.
export function findDuplicates(bookings) {
  const groups = new Map();
  for (const b of bookings) {
    if (b.booking_status === 'cancelled') continue;
    const day = b.bookingDate ? new Date(b.bookingDate).toISOString() : '';
    const key = `${b.dealer_id}|${b.lead_id}|${day}|${b.bookingTime || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const dup = new Map();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => String(a._id).localeCompare(String(b._id)));
    for (const b of list.slice(1)) dup.set(String(b._id), String(list[0]._id));
  }
  return dup;
}

export const CHANGE_ACTORS = Object.freeze(['ai', 'staff', 'customer', 'system', 'unknown']);
const CANCEL_ACTIONS = new Set(['cancelled', 'deduplicated']);

// Pure. Rescheduled / cancelled bookings in [start, end] from their history, by actor (see the header).
export function historyChanges(bookings, { start, end }) {
  const empty = () => ({ total: 0, by_actor: Object.fromEntries(CHANGE_ACTORS.map((a) => [a, 0])), booking_ids: [],
    events: [] });
  const out = { rescheduled: empty(), cancelled: empty() };
  const inRange = (at) => at && new Date(at) >= start && new Date(at) <= end;
  const actorOf = (t) => (CHANGE_ACTORS.includes(t) ? t : 'unknown');
  // events: one per booking, its latest change of that kind in the range (who, when) - the report rows.
  const add = (bucket, id, actor, entry = null) => {
    bucket.total += 1;
    bucket.by_actor[actorOf(actor)] += 1;
    bucket.booking_ids.push(id);
    bucket.events.push({ booking_id: id, actor: actorOf(actor), actor_name: entry?.actor_name || null,
      at: entry?.at || null });
  };
  for (const b of bookings) {
    const history = Array.isArray(b.history) ? b.history : [];
    const latest = (pred) => history.filter((h) => h && pred(h.action) && inRange(h.at))
      .sort((x, y) => new Date(y.at) - new Date(x.at))[0];
    const moved = latest((a) => a === 'rescheduled');
    if (moved) add(out.rescheduled, String(b._id), moved.actor_type, moved);
    const cancel = latest((a) => CANCEL_ACTIONS.has(a));
    if (cancel) add(out.cancelled, String(b._id), cancel.actor_type, cancel);
    else if (b.booking_status === 'cancelled' && inRange(b.cancelled_at)) {
      add(out.cancelled, String(b._id), b.cancelled_by, { at: b.cancelled_at });
    }
  }
  for (const bucket of Object.values(out)) {
    bucket.booking_ids.sort();
    bucket.events.sort((x, y) => x.booking_id.localeCompare(y.booking_id));
  }
  return out;
}

/**
 * Appointment attribution for one dealer.
 * @param {{dealerId: string, from: string|Date, to?: string|Date, basis?: 'created'|'scheduled', filters?: object,
 *   tz?: string, now?: Date, models?: {Booking, Email, Lead}}} args  from/to: dealer-local dates (inclusive).
 */
export async function attributeAppointments({ dealerId, from, to, basis, filters = {}, tz, now = new Date(),
  models = {} } = {}) {
  if (!dealerId) throw new Error('dealerId is required');
  const BookingM = models.Booking || Booking;
  const EmailM = models.Email || Email;
  const LeadM = models.Lead || Lead;
  const zone = tz || await getDealerTimezone(dealerId);
  const parsed = parseFilterSpec({ ...filters, from: from ?? filters.from, to: to ?? filters.to ?? from ?? filters.from,
    basis: basis ?? filters.basis }, { report: REPORTS.APPOINTMENT_ATTRIBUTION, tz: zone });
  if (!parsed.ok) {
    const err = new Error(`invalid filters: ${parsed.errors.join('; ')}`);
    err.errors = parsed.errors;
    throw err;
  }
  const { spec } = parsed;
  const { start, end } = localDayRange(spec.from, spec.to, zone);
  const dealerStr = String(dealerId);
  const dealerForms = isOid(dealerStr) ? [dealerStr, oid(dealerStr)] : [dealerStr];

  const window = spec.basis === 'scheduled'
    ? { bookingDate: { $gte: start, $lte: end }, booking_status: { $ne: 'cancelled' } }
    : { createdAt: { $gte: start, $lte: end } };
  let population = await BookingM.collection.find({ dealer_id: { $in: dealerForms }, ...window,
    ...bookingMatch(spec) }).toArray();

  // Leads: found + this dealer's (and passing the lead filters, when any).
  const leadStrs = [...new Set(population.map((b) => b.lead_id).filter(isOid).map(String))];
  const leads = leadStrs.length ? await LeadM.collection.find({ _id: { $in: leadStrs.map(oid) },
    dealer_id: { $in: dealerForms } }, { projection: { _id: 1 } }).toArray() : [];
  const leadFound = new Set(leads.map((l) => String(l._id)));
  if (hasLeadFilter(spec)) {
    const pass = new Set((leadStrs.length ? await LeadM.collection.find({ _id: { $in: leadStrs.map(oid) },
      dealer_id: { $in: dealerForms }, ...leadMatch(spec) }, { projection: { _id: 1 } }).toArray() : [])
      .map((l) => String(l._id)));
    population = population.filter((b) => pass.has(String(b.lead_id)));
  }

  // Duplicates: compare against every active booking of the same leads, also ones outside the window.
  const siblings = population.length ? await BookingM.collection.find({ dealer_id: { $in: dealerForms },
    lead_id: { $in: [...new Set(population.map((b) => String(b.lead_id)))] }, booking_status: { $ne: 'cancelled' } },
  { projection: { _id: 1, dealer_id: 1, lead_id: 1, bookingDate: 1, bookingTime: 1, booking_status: 1 } }).toArray()
    : [];
  const dupOf = findDuplicates(siblings.map((b) => ({ ...b, dealer_id: String(b.dealer_id) })));
  const duplicates = [];
  const counted = [];
  for (const b of population) {
    const keptId = dupOf.get(String(b._id));
    if (keptId) {
      duplicates.push({ booking_id: String(b._id), duplicate_of: keptId, lead_id: String(b.lead_id),
        booking_date: b.bookingDate || null, booking_time: b.bookingTime || null, created_at: b.createdAt || null });
    } else counted.push(b);
  }

  // Evidence: the earliest qualifying AI send per lead, one query.
  const staffLeads = [...new Set(counted.filter((b) => b.created_by === 'staff' && leadFound.has(String(b.lead_id)))
    .map((b) => String(b.lead_id)))];
  const firstAi = new Map();
  if (staffLeads.length) {
    const rows = await EmailM.collection.aggregate([
      { $match: { lead_id: { $in: staffLeads.map(oid) }, ai_generated: true, is_note: { $ne: true },
        communication_type: { $in: ['sms', 'email'] }, status: { $in: AI_SENT_STATUSES } } },
      { $sort: { timestamp: 1, _id: 1 } },
      { $group: { _id: '$lead_id', at: { $first: '$timestamp' }, id: { $first: '$_id' } } },
    ]).toArray();
    for (const r of rows) firstAi.set(String(r._id), { id: String(r.id), at: r.at });
  }

  const rows = counted.map((b) => {
    const lead = String(b.lead_id);
    const c = classifyBooking(b, { leadFound: leadFound.has(lead), firstAiSend: firstAi.get(lead) || null });
    return {
      booking_id: String(b._id), lead_id: lead, category: c.category, reason: c.reason,
      evidence_email_id: c.evidence?.id || null, evidence_at: c.evidence?.at || null,
      created_by: b.created_by ?? null, created_at: b.createdAt || null, booking_date: b.bookingDate || null,
      booking_time: b.bookingTime || null, appointment_type: b.appointment_type === 'service' ? 'service' : 'sales',
      booking_status: b.booking_status || null, showed: b.showed ?? null,
      created_by_user_id: b.created_by_user_id ? String(b.created_by_user_id) : null,
      created_by_name: b.created_by_name || null,
    };
  }).sort((a, b) => a.booking_id.localeCompare(b.booking_id));

  // Changes in the range, from the booking history (one query; bookings with no history entry or cancel stamp in the
  // range never match).
  let changed = await BookingM.collection.find({ dealer_id: { $in: dealerForms }, ...bookingMatch(spec),
    $or: [{ history: { $elemMatch: { action: { $in: ['rescheduled', ...CANCEL_ACTIONS] }, at: { $gte: start, $lte: end } } } },
      { cancelled_at: { $gte: start, $lte: end } }] },
  { projection: { _id: 1, lead_id: 1, booking_status: 1, cancelled_at: 1, cancelled_by: 1, history: 1 } }).toArray();
  if (hasLeadFilter(spec) && changed.length) {
    const ids = [...new Set(changed.map((b) => b.lead_id).filter(isOid).map(String))];
    const pass = new Set((ids.length ? await LeadM.collection.find({ _id: { $in: ids.map(oid) },
      dealer_id: { $in: dealerForms }, ...leadMatch(spec) }, { projection: { _id: 1 } }).toArray() : [])
      .map((l) => String(l._id)));
    changed = changed.filter((b) => pass.has(String(b.lead_id)));
  }

  return {
    dealer_id: dealerStr,
    tz: zone,
    basis: spec.basis,
    range: { from: spec.from, to: spec.to, start, end },
    filters: describeSpec(spec),
    unsupported: parsed.unsupported,
    definitions_version: DEFINITIONS_VERSION,
    as_of: now,
    totals: summarize(rows),
    outcomes: outcomes(counted, { leadStatus: await leadStatuses(counted.map((b) => b.lead_id), { LeadModel: LeadM }),
      now, tz: zone }),
    rows,
    excluded: { duplicates },
    changes: { basis: 'event', source: 'booking history (recorded from P1 item 3 on)', ...historyChanges(changed, { start, end }) },
  };
}
