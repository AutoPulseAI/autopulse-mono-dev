// The saved numbers behind one dealer's daily email for one completed dealer-local day (P1 plan item 6).
// Every number comes from the shared reporting library, so the email and the dashboard agree:
//   appointments      attributeAppointments(basis 'created'): appointments SET that day, AI / AI-assisted / human-only
//                     / unknown, AI-influenced %, and what happened to them since (cancelled, ...)
//   appointments_due  attributeAppointments(basis 'scheduled'): appointments that were DUE that day - shown, no-show
//                     (past, not shown) and the show rate = shown / past appointments, the Reports page's definition
//   replies           replyCohorts: customers who replied that day - today's leads / past leads / total, and the
//                     overlapping 7+/15+/30+/60+ day groups; handlers.ai = customer messages the AI answered
//   leads             leads received that day (Lead.createdAt), from the same replyCohorts call
//   ai_activity       AI messages sent that day (Email.ai_generated, sent/delivered, sms|email, not a note) and the
//                     distinct leads they went to; appointments booked by the AI (= appointments.ai)
// A section whose query throws is saved as null and listed in stale_sources: the email shows "—", never 0. When the
// AI service has events for this dealer waiting in ai_event_outbox from before the day ended, AI activity may be
// incomplete: it is flagged stale too and shown as "—" with the warning.
// Rescheduled appointments are not recorded by the CRM (Booking has no reschedule field): listed in `unavailable`.
//
// Imports are relative so the BullMQ worker can load this module.
import mongoose from 'mongoose';
import DailyReportSnapshot from '../../models/DailyReportSnapshot.js';
import Email from '../../models/Email.js';
import User from '../../models/User.js';
import { AI_SENT_STATUSES, DEFINITIONS_VERSION as ATTR_VERSION, attributeAppointments }
  from '../reporting/appointmentAttribution.js';
import { DEFINITIONS_VERSION as REPLY_VERSION, replyCohorts } from '../reporting/replyCohorts.js';
import { dealerTimezone, isValidLocalDate, localDayRange } from '../reporting/time.js';
import { AI_OUTBOX_COLLECTION } from '../ai/aiOutbox.js';

// v2: show rate = shown / past appointments; v3: no_show = marked no-show only, not_recorded = past with no outcome
export const SNAPSHOT_DEFINITIONS = 'daily-email-v3';
export const UNAVAILABLE = Object.freeze(['appointments.rescheduled']);

const isOid = (id) => id != null && /^[0-9a-f]{24}$/i.test(String(id));
const dealerForms = (id) => (isOid(id) ? [String(id), new mongoose.Types.ObjectId(String(id))] : [String(id)]);

async function section(stale, source, affects, fn) {
  try {
    return await fn();
  } catch (error) {
    stale.push({ source, reason: String(error?.message || error).slice(0, 300), affects });
    return null;
  }
}

/** Compute (do not save) the snapshot document for one dealer-local day. */
export async function computeDailySnapshot({ dealerId, reportDate, now = new Date(), dealer = null,
  models = {} } = {}) {
  if (!isOid(dealerId)) throw new Error('dealerId must be an ObjectId');
  if (!isValidLocalDate(reportDate)) throw new Error('reportDate must be YYYY-MM-DD');
  const UserM = models.User || User;
  const EmailM = models.Email || Email;
  const d = dealer || await UserM.findById(String(dealerId)).select('dealer_account_information.time_zone').lean();
  if (!d) throw new Error('dealer not found');
  const tz = dealerTimezone(d);
  const { start, end } = localDayRange(reportDate, reportDate, tz);
  const stale = [];

  const created = await section(stale, 'appointments', ['appointments'], () =>
    attributeAppointments({ dealerId: String(dealerId), from: reportDate, to: reportDate, basis: 'created', tz, now }));
  const due = await section(stale, 'appointments_due', ['appointments_due'], () =>
    attributeAppointments({ dealerId: String(dealerId), from: reportDate, to: reportDate, basis: 'scheduled', tz, now }));
  const replies = await section(stale, 'replies', ['replies', 'leads'], () =>
    replyCohorts({ dealerId: String(dealerId), from: reportDate, to: reportDate, tz, now }));
  const aiSends = await section(stale, 'ai_messages', ['ai_activity'], async () => {
    const rows = await EmailM.collection.find({ dealer_id: { $in: dealerForms(dealerId) }, ai_generated: true,
      is_note: { $ne: true }, communication_type: { $in: ['sms', 'email'] }, status: { $in: AI_SENT_STATUSES },
      timestamp: { $gte: start, $lte: end } }, { projection: { lead_id: 1 } }).toArray();
    return { messages_sent: rows.length,
      leads_messaged: new Set(rows.map((r) => r.lead_id).filter(Boolean).map(String)).size };
  });
  // Events the AI service has not received yet, from before the day ended: AI activity may be incomplete.
  try {
    const waiting = await mongoose.connection.collection(AI_OUTBOX_COLLECTION).countDocuments({
      dealer_id: { $in: dealerForms(dealerId) }, status: 'pending', created_at: { $lte: end } });
    if (waiting > 0) {
      stale.push({ source: 'ai_service', reason: `${waiting} AI event(s) not yet delivered to the AI service`,
        affects: ['ai_activity'] });
    }
  } catch { /* the outbox check is advisory */ }

  const appointments = created ? {
    total: created.totals.total, ai: created.totals.ai, ai_assisted: created.totals.ai_assisted,
    human_only: created.totals.human_only, unknown: created.totals.unknown,
    ai_influenced: created.totals.ai_influenced, ai_influence_pct: created.totals.ai_influence_pct,
    cancelled: created.outcomes.cancelled, rescheduled: null, duplicates_excluded: created.excluded.duplicates.length,
  } : null;
  const appointmentsDue = due ? {
    total: due.totals.total, shown: due.outcomes.shown, no_show: due.outcomes.no_show,
    not_recorded: due.outcomes.not_recorded, upcoming: due.outcomes.upcoming, show_rate_pct: due.outcomes.show_rate.value,
    show_rate_of: due.outcomes.show_rate.denominator,
  } : null;
  const replyMetrics = replies ? {
    todays_leads: replies.totals.todays_leads_replied, past_leads: replies.totals.past_leads_replied,
    needs_review: replies.totals.needs_review, total: replies.totals.customers_replied,
    cumulative: { ...replies.cumulative }, overlapping: true, inbound_messages: replies.totals.inbound_messages,
  } : null;
  const leads = replies ? { received: replies.totals.new_leads } : null;
  const aiActivity = (aiSends || created || replies) ? {
    messages_sent: aiSends ? aiSends.messages_sent : null,
    leads_messaged: aiSends ? aiSends.leads_messaged : null,
    appointments_booked: created ? created.totals.ai : null,
    customer_messages_answered: replies ? replies.handlers.ai : null,
  } : null;

  return {
    dealer_id: new mongoose.Types.ObjectId(String(dealerId)),
    report_date: reportDate,
    tz,
    window: { start, end },
    generated_at: now,
    data_as_of: now,
    definitions: { snapshot: SNAPSHOT_DEFINITIONS, appointments: ATTR_VERSION, replies: REPLY_VERSION },
    metrics: { appointments, appointments_due: appointmentsDue, replies: replyMetrics, leads, ai_activity: aiActivity },
    unavailable: [...UNAVAILABLE],
    stale_sources: stale,
  };
}

/** The latest saved snapshot of that day, or null. */
export async function findSnapshot(dealerId, reportDate, { Model = DailyReportSnapshot } = {}) {
  return Model.findOne({ dealer_id: String(dealerId), report_date: reportDate }).sort({ version: -1 }).lean();
}

/**
 * The saved snapshot of that day; built and saved (version 1) the first time. Retries and resends reuse it, so
 * the same day always sends the same numbers. Two workers building at once: the unique index keeps one.
 */
export async function getOrBuildSnapshot({ dealerId, reportDate, now = new Date(), dealer = null,
  Model = DailyReportSnapshot } = {}) {
  const existing = await findSnapshot(dealerId, reportDate, { Model });
  if (existing) return existing;
  const doc = await computeDailySnapshot({ dealerId, reportDate, now, dealer });
  try {
    const saved = await Model.create({ ...doc, version: 1 });
    return saved.toObject();
  } catch (error) {
    if (error?.code === 11000) return findSnapshot(dealerId, reportDate, { Model });
    throw error;
  }
}
