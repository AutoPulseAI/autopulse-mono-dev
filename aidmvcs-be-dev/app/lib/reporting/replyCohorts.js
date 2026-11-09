// Customer replies by lead age (SOW 8B / Deliverable F3; P1 plan item 2). Distinct customers who wrote to the dealer
// on each dealer-local day, grouped by how old the lead their message belongs to was on that day.
//
// Definitions (project owner, 9 Nov 2026):
//   Reply            any qualifying inbound customer message - the inbound rules of app/lib/contactedLeads.js
//                    (repliedLeadIds): status received/incoming, not a note, not the portal/ADF lead email
//                    (is_lead_email, ADF body), message_id not "lead-..." (the lead's own arrival). STOP is a reply.
//   Lead received    Lead.createdAt ("Lead Date").
//   Lead age         calendar days from lead received to the reply, both as dealer-local dates.
//   Customer         Customer.merged_into ?? Lead.customer_id ?? 'lead:'+lead._id (merged_into followed one level).
//   Attribution      the lead the message's emails.lead_id points to. Lead not found / other dealer / no lead_id /
//                    lead received on a later local day than the reply (negative age) -> "needs_review". A customer whose same-day replies fall in
//                    different age buckets (two opportunities) -> "needs_review" (SOW 8B: "if ambiguous ... not
//                    arbitrary oldest or newest lead").
//   Unit             (customer, local day): a customer replying several times on one day is 1 customer; every
//                    message counts in inbound_messages. Over a multi-day range the cards count customer-day pairs
//                    (SOW 8B "daily activity" basis); totals.distinct_customers is the plain distinct count.
//   Buckets          exclusive d0, d1_6, d7_14, d15_29, d30_59, d60_plus, needs_review - they sum to
//                    customers_replied. Cumulative d7/d15/d30/d60 overlap, are built from the buckets, and leave
//                    needs_review out. Never add them up.
//   Handler          (F3 note 2.6) the first outbound message on the same lead after the reply, before the next
//                    inbound message and before the end of the reply's local day + 24 h: ai_generated -> 'ai';
//                    message_by set -> 'staff'; neither -> 'automatic' (n8n / platform templates; never AI);
//                    none -> 'unanswered'. A reply with no lead_id -> 'unknown'.
//
// Imports are relative so BullMQ workers (the daily email) can load this module too.
import mongoose from 'mongoose';
import Booking from '../../models/Booking.js';
import Customer from '../../models/Customer.js';
import Email from '../../models/Email.js';
import Lead from '../../models/Lead.js';
import { REPORTS, describeSpec, hasLeadFilter, leadMatch, parseFilterSpec, replyMatch } from './filters.js';
import { calendarDayDiff, endOfLocalDayPlus, getDealerTimezone, localDate, localDayRange } from './time.js';

export const DEFINITIONS_VERSION = 'reply-cohorts-v1';

// Same rules as app/lib/contactedLeads.js (INBOUND, ADF, "^lead-"); kept in step by test-reporting.js, which checks
// the qualifying leads against repliedLeadIds().
export const INBOUND = Object.freeze(['received', 'incoming']);
export const ADF = /<\?adf|<adf[\s>]/i;
export const LEAD_ARRIVAL_ID = /^lead-/;
// Not a message to the customer, for the handler rule.
const NOT_OUTBOUND = new Set([...INBOUND, 'note', 'draft']);
export const HANDLER_WINDOW_HOURS = 24;

export const BUCKETS = Object.freeze(['d0', 'd1_6', 'd7_14', 'd15_29', 'd30_59', 'd60_plus', 'needs_review']);
export const BUCKET_LABELS = Object.freeze({
  d0: "Today's leads (0 days)", d1_6: '1-6 days', d7_14: '7-14 days', d15_29: '15-29 days', d30_59: '30-59 days',
  d60_plus: '60+ days', needs_review: 'Needs review',
});
export const REVIEW_REASONS = Object.freeze({
  NO_LEAD_LINK: 'no_lead_link',
  LEAD_NOT_FOUND: 'lead_not_found',
  LEAD_OTHER_DEALER: 'lead_other_dealer',
  LEAD_AFTER_REPLY: 'lead_received_after_reply',
  MULTIPLE_OPPORTUNITIES: 'multiple_opportunities_different_ages',
});

export function bucketForAge(age) {
  if (!Number.isInteger(age) || age < 0) return 'needs_review';
  if (age === 0) return 'd0';
  if (age <= 6) return 'd1_6';
  if (age <= 14) return 'd7_14';
  if (age <= 29) return 'd15_29';
  if (age <= 59) return 'd30_59';
  return 'd60_plus';
}

export function emptyBuckets() {
  return Object.fromEntries(BUCKETS.map((b) => [b, 0]));
}

// Overlapping cards from the exclusive buckets, so they can't drift.
export function cumulativeFromBuckets(b) {
  return {
    d7: b.d7_14 + b.d15_29 + b.d30_59 + b.d60_plus,
    d15: b.d15_29 + b.d30_59 + b.d60_plus,
    d30: b.d30_59 + b.d60_plus,
    d60: b.d60_plus,
  };
}

export function customerKeyFor(lead, customer) {
  if (customer?.merged_into) return String(customer.merged_into);
  if (lead?.customer_id) return String(lead.customer_id);
  return lead?._id ? `lead:${lead._id}` : null;
}

function senderKey(sender) {
  const s = String(sender || '').trim().toLowerCase();
  if (!s) return 'sender:unknown';
  if (s.includes('@')) return `sender:${s}`;
  const digits = s.replace(/\D/g, '');
  return `sender:${digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits || s}`;
}

/**
 * Pure: classify resolved reply rows into customer-day units and buckets.
 * @param {Array<{email_id, lead_id, reply_at: Date, channel, sender?, handler?, has_appointment?,
 *   booked_after_reply?, lead: null | {_id, createdAt: Date, dealer_ok: boolean, customer_key: string}}>} replies
 * @param {{tz: string}} opts
 */
export function classifyReplies(replies, { tz }) {
  const rows = replies.map((r) => {
    const local_day = localDate(r.reply_at, tz);
    let review_reason = null;
    let age_days = null;
    let customer_key;
    if (!r.lead_id) {
      review_reason = REVIEW_REASONS.NO_LEAD_LINK;
      customer_key = senderKey(r.sender);
    } else if (!r.lead) {
      review_reason = REVIEW_REASONS.LEAD_NOT_FOUND;
      customer_key = `lead:${r.lead_id}`;
    } else {
      customer_key = r.lead.customer_key || `lead:${r.lead._id}`;
      if (!r.lead.dealer_ok) review_reason = REVIEW_REASONS.LEAD_OTHER_DEALER;
      else if (!r.lead.createdAt) review_reason = REVIEW_REASONS.LEAD_NOT_FOUND;
      else {
        age_days = calendarDayDiff(r.lead.createdAt, r.reply_at, tz);
        if (age_days < 0) review_reason = REVIEW_REASONS.LEAD_AFTER_REPLY;
      }
    }
    const row_bucket = review_reason ? 'needs_review' : bucketForAge(age_days);
    return {
      email_id: String(r.email_id),
      customer_key,
      customer_id: /^[0-9a-f]{24}$/i.test(customer_key) ? customer_key : null,
      lead_id: r.lead_id ? String(r.lead_id) : null,
      lead_received_at: r.lead?.createdAt || null,
      reply_at: r.reply_at,
      local_day,
      age_days,
      row_bucket,
      review_reason,
      channel: r.channel,
      handler: r.handler || null,
      has_appointment: Boolean(r.has_appointment),
      booked_after_reply: Boolean(r.booked_after_reply),
    };
  });

  const units = new Map();
  for (const row of rows) {
    const key = `${row.customer_key}|${row.local_day}`;
    row.unit_key = key;
    const u = units.get(key) || { unit_key: key, customer_key: row.customer_key, local_day: row.local_day,
      buckets: new Set(), reasons: new Set(), leads: new Set(), messages: 0 };
    u.buckets.add(row.row_bucket);
    if (row.review_reason) u.reasons.add(row.review_reason);
    if (row.lead_id) u.leads.add(row.lead_id);
    u.messages += 1;
    units.set(key, u);
  }

  const buckets = emptyBuckets();
  const unitList = [];
  for (const u of units.values()) {
    let bucket;
    let reason = null;
    if (u.buckets.size === 1) {
      [bucket] = u.buckets;
      if (bucket === 'needs_review') [reason] = u.reasons;
    } else {
      bucket = 'needs_review';
      reason = u.reasons.size ? [...u.reasons][0] : REVIEW_REASONS.MULTIPLE_OPPORTUNITIES;
      if (!u.buckets.has('needs_review')) reason = REVIEW_REASONS.MULTIPLE_OPPORTUNITIES;
    }
    buckets[bucket] += 1;
    unitList.push({ unit_key: u.unit_key, customer_key: u.customer_key, local_day: u.local_day, bucket,
      review_reason: reason, lead_ids: [...u.leads], messages: u.messages });
  }
  const unitBucket = new Map(unitList.map((u) => [u.unit_key, u]));
  for (const row of rows) {
    const u = unitBucket.get(row.unit_key);
    row.bucket = u.bucket;
    if (u.bucket === 'needs_review' && !row.review_reason) row.review_reason = u.review_reason;
  }

  const past = buckets.d1_6 + buckets.d7_14 + buckets.d15_29 + buckets.d30_59 + buckets.d60_plus;
  const customers_replied = unitList.length;
  const sum = BUCKETS.reduce((s, b) => s + buckets[b], 0);
  if (sum !== customers_replied) throw new Error(`reply buckets (${sum}) != customers (${customers_replied})`);

  const handlers = { ai: 0, staff: 0, automatic: 0, unanswered: 0, unknown: 0 };
  for (const row of rows) if (row.handler && handlers[row.handler] != null) handlers[row.handler] += 1;

  return {
    totals: {
      todays_leads_replied: buckets.d0,
      past_leads_replied: past,
      needs_review: buckets.needs_review,
      customers_replied,
      distinct_customers: new Set(unitList.map((u) => u.customer_key)).size,
      inbound_messages: rows.length,
    },
    buckets,
    cumulative: cumulativeFromBuckets(buckets),
    handlers,
    units: unitList,
    rows,
  };
}

/**
 * Pure: the handler of each reply (rule in the header). `messages` = every message on the replies' leads in the
 * window, any direction.
 */
export function handlersFor(replies, messages, { tz }) {
  const byLead = new Map();
  for (const m of messages) {
    const k = String(m.lead_id);
    if (!byLead.has(k)) byLead.set(k, []);
    byLead.get(k).push(m);
  }
  for (const list of byLead.values()) {
    list.sort((a, b) => (new Date(a.timestamp) - new Date(b.timestamp)) || String(a._id).localeCompare(String(b._id)));
  }
  const out = new Map();
  for (const r of replies) {
    if (!r.lead_id) { out.set(String(r.email_id), 'unknown'); continue; }
    const list = byLead.get(String(r.lead_id)) || [];
    const at = new Date(r.reply_at);
    const cap = endOfLocalDayPlus(at, HANDLER_WINDOW_HOURS, tz);
    let handler = 'unanswered';
    for (const m of list) {
      const t = new Date(m.timestamp);
      if (String(m._id) === String(r.email_id)) continue;
      if (t < at || (t.getTime() === at.getTime() && String(m._id) < String(r.email_id))) continue;
      if (t > cap) break;
      if (INBOUND.includes(m.status)) break;
      if (m.is_note === true || m.communication_type === 'note' || NOT_OUTBOUND.has(m.status)) continue;
      if (m.ai_generated === true) handler = 'ai';
      else if (m.message_by) handler = 'staff';
      else handler = 'automatic';
      break;
    }
    out.set(String(r.email_id), handler);
  }
  return out;
}

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isOid = (id) => id != null && mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(String(id));

// Email.dealer_id is a String in the schema, but raw inserts can hold an ObjectId: match both.
function dealerIdForms(dealerId) {
  const s = String(dealerId);
  return isOid(s) ? [s, oid(s)] : [s];
}

/**
 * Reply cohorts for one dealer.
 * @param {{dealerId: string, from: string|Date, to?: string|Date, filters?: object, tz?: string, now?: Date,
 *   models?: {Email, Lead, Customer, Booking}}} args  from/to: dealer-local dates "YYYY-MM-DD" (inclusive).
 */
export async function replyCohorts({ dealerId, from, to, filters = {}, tz, now = new Date(), models = {} } = {}) {
  if (!dealerId) throw new Error('dealerId is required');
  const EmailM = models.Email || Email;
  const LeadM = models.Lead || Lead;
  const CustomerM = models.Customer || Customer;
  const BookingM = models.Booking || Booking;
  const zone = tz || await getDealerTimezone(dealerId);
  const parsed = parseFilterSpec({ ...filters, from: from ?? filters.from, to: to ?? filters.to ?? from ?? filters.from },
    { report: REPORTS.REPLY_COHORTS, tz: zone });
  if (!parsed.ok) {
    const err = new Error(`invalid filters: ${parsed.errors.join('; ')}`);
    err.errors = parsed.errors;
    throw err;
  }
  const { spec } = parsed;
  const { start, end } = localDayRange(spec.from, spec.to, zone);
  const dealerStr = String(dealerId);
  const dealerForms = dealerIdForms(dealerStr);

  // 1. Qualifying inbound messages of this dealer in the window (no all-leads $in).
  const inbound = await EmailM.collection.find({
    dealer_id: { $in: dealerForms },
    status: { $in: INBOUND },
    timestamp: { $gte: start, $lte: end },
    is_note: { $ne: true },
    is_lead_email: { $ne: true },
    communication_type: { $ne: 'note' },
    message_id: { $not: LEAD_ARRIVAL_ID },
    mail_content: { $not: ADF },
    ...replyMatch(spec),
  }, { projection: { _id: 1, lead_id: 1, timestamp: 1, communication_type: 1, sender: 1 } }).toArray();

  // 2. Their leads and customers.
  const leadIdStrs = [...new Set(inbound.map((m) => m.lead_id).filter(isOid).map(String))];
  const leads = leadIdStrs.length ? await LeadM.collection.find({ _id: { $in: leadIdStrs.map(oid) } },
    { projection: { createdAt: 1, customer_id: 1, dealer_id: 1 } }).toArray() : [];
  const leadFilter = hasLeadFilter(spec);
  let passing = null;
  if (leadFilter) {
    passing = new Set((leadIdStrs.length ? await LeadM.collection.find({ _id: { $in: leadIdStrs.map(oid) },
      ...leadMatch(spec) }, { projection: { _id: 1 } }).toArray() : []).map((l) => String(l._id)));
  }
  const customerIds = [...new Set(leads.map((l) => l.customer_id).filter(isOid).map(String))];
  const customers = customerIds.length ? await CustomerM.collection.find({ _id: { $in: customerIds.map(oid) } },
    { projection: { merged_into: 1 } }).toArray() : [];
  const customerById = new Map(customers.map((c) => [String(c._id), c]));
  const leadById = new Map(leads.map((l) => [String(l._id), {
    _id: l._id,
    createdAt: l.createdAt ? new Date(l.createdAt) : null,
    dealer_ok: String(l.dealer_id) === dealerStr,
    customer_key: customerKeyFor(l, l.customer_id ? customerById.get(String(l.customer_id)) : null),
  }]));

  // A lead filter keeps only replies whose lead is found and matches it.
  const kept = leadFilter ? inbound.filter((m) => m.lead_id && passing.has(String(m.lead_id))) : inbound;

  // 3. Handlers: every message on those leads from the first reply to the last reply's day end + 24 h.
  const keptLeadOids = [...new Set(kept.map((m) => m.lead_id).filter(isOid).map(String))].map(oid);
  let handlerMap = new Map();
  if (kept.length) {
    const minAt = new Date(Math.min(...kept.map((m) => new Date(m.timestamp).getTime())));
    const maxCap = endOfLocalDayPlus(new Date(Math.max(...kept.map((m) => new Date(m.timestamp).getTime()))),
      HANDLER_WINDOW_HOURS, zone);
    const convo = keptLeadOids.length ? await EmailM.collection.find({ lead_id: { $in: keptLeadOids },
      timestamp: { $gte: minAt, $lte: maxCap } }, { projection: { lead_id: 1, timestamp: 1, status: 1,
      ai_generated: 1, message_by: 1, is_note: 1, communication_type: 1 } }).toArray() : [];
    handlerMap = handlersFor(kept.map((m) => ({ email_id: m._id, lead_id: m.lead_id, reply_at: m.timestamp })),
      convo, { tz: zone });
  }

  // 4. Appointments on those leads (Booking.lead_id is a String).
  const keptLeadStrs = keptLeadOids.map(String);
  const bookings = keptLeadStrs.length ? await BookingM.collection.find({ lead_id: { $in: keptLeadStrs } },
    { projection: { lead_id: 1, createdAt: 1, booking_status: 1 } }).toArray() : [];
  const bookingsByLead = new Map();
  for (const b of bookings) {
    const k = String(b.lead_id);
    if (!bookingsByLead.has(k)) bookingsByLead.set(k, []);
    bookingsByLead.get(k).push(b);
  }

  const classified = classifyReplies(kept.map((m) => {
    const leadKey = m.lead_id ? String(m.lead_id) : null;
    const lb = leadKey ? bookingsByLead.get(leadKey) || [] : [];
    return {
      email_id: m._id,
      lead_id: m.lead_id || null,
      reply_at: new Date(m.timestamp),
      channel: m.communication_type === 'sms' ? 'sms' : 'email',
      sender: m.sender,
      lead: leadKey ? leadById.get(leadKey) || null : null,
      handler: handlerMap.get(String(m._id)) || (m.lead_id ? 'unanswered' : 'unknown'),
      has_appointment: lb.some((b) => b.booking_status !== 'cancelled'),
      booked_after_reply: lb.some((b) => b.createdAt && new Date(b.createdAt) >= new Date(m.timestamp)),
    };
  }), { tz: zone });

  // 5. New leads received in the window (Lead.createdAt; same lead filters).
  const new_leads = await LeadM.collection.countDocuments({ dealer_id: { $in: dealerForms },
    createdAt: { $gte: start, $lte: end }, ...leadMatch(spec) });

  return {
    dealer_id: dealerStr,
    tz: zone,
    range: { from: spec.from, to: spec.to, start, end },
    basis: 'customer_day',
    filters: describeSpec(spec),
    unsupported: parsed.unsupported,
    definitions_version: DEFINITIONS_VERSION,
    as_of: now,
    totals: { ...classified.totals, new_leads },
    cumulative: classified.cumulative,
    buckets: classified.buckets,
    handlers: classified.handlers,
    units: classified.units,
    rows: classified.rows,
  };
}
