// The Desk Log follows what is recorded elsewhere in the CRM (18 Nov 2026: "if it's not a reflection of what actually
// is going on ... we will not be able to manage things"; showrooms will use this Desk Log instead of their own):
//   - a visit recorded on the Leads page (status Visited / Sold Pending / Sold Delivered / Unsold) or an appointment
//     marked showed on the Appointments page is a Desk Log visit: one is added when the lead has none that day
//     (or an open one from the last 7 days);
//   - a visit outcome set on the Leads page (Sold Pending / Sold Delivered / Unsold) is that visit's outcome - the
//     Sold Pending visit becomes Sold Delivered when the car is delivered;
//   - a note written on the Desk Log is a note on the lead too (its conversation), so both places show the same notes.
// Changes made on the Desk Log itself already go the other way (app/api/desk-log/[id]); those calls say
// from_desk_log, so nothing here runs twice. Never throws: the status change itself always stands.
import moment from 'moment-timezone';
import mongoose from 'mongoose';
import DeskLogEntry from '../../models/DeskLogEntry.js';
import Lead from '../../models/Lead.js';
import Email from '../../models/Email.js';
import { getDealerTimezone } from '../reporting/time.js';
import { rulesFor } from './rules.js';

const DAY = 864e5;
const OPEN_VISIT_DAYS = 7;   // an open visit this recent is still "the" visit
const LATEST_VISIT_DAYS = 60; // a Sold Pending visit this recent gets its delivery

/** The visit outcome a lead status is, or null. ('Unsold' keeps the lead's unsold reason.) */
export function outcomeForLeadStatus(status, unsoldReason = null) {
  if (status === 'Sold Pending') return { outcome: 'SOLD PENDING', unsold_reason: null };
  if (status === 'Sold Delivered') return { outcome: 'SOLD DELIVERED', unsold_reason: null };
  if (status === 'Unsold') return { outcome: 'UNSOLD', unsold_reason: unsoldReason || null };
  return null;
}

const VISIT_STATUSES = Object.freeze(['Visited', 'Sold Pending', 'Sold Delivered', 'Unsold']);

const visitDepartment = (lead) => (['service', 'parts'].includes(lead?.department) ? 'service' : 'sales');

async function newVisit({ lead, at, via, actorId, actorName, outcome = null }) {
  const by = actorId && mongoose.isValidObjectId(String(actorId)) ? new mongoose.Types.ObjectId(String(actorId)) : null;
  return DeskLogEntry.create({
    dealer_id: String(lead.dealer_id), lead_id: lead._id, customer_id: lead.customer_id || null,
    department: visitDepartment(lead), checked_in_at: at, created_by: by, created_via: via,
    bdc_agent_id: lead.assigned_to || null,
    ...(outcome ? { outcome: outcome.outcome, unsold_reason: outcome.unsold_reason, outcome_at: at } : {}),
    history: [{ field: 'checked_in', from: null, to: at, at, by, by_name: actorName || null },
      ...(outcome ? [{ field: 'outcome', from: null, to: outcome.outcome, at, by, by_name: actorName || null }] : [])],
  });
}

/**
 * A status set on the Leads page (or an appointment marked showed elsewhere): the Desk Log gets the visit and its
 * outcome. `status` is the lead's new status; `via` is 'leads_page' | 'appointments'.
 * @returns {Promise<null | { created: boolean, id: string, outcome: string|null }>}
 */
export async function syncDeskLogFromLead({ leadId, status, unsoldReason = null, via = 'leads_page', actorId = null,
  actorName = null, at = new Date(), logger = console }) {
  try {
    if (!VISIT_STATUSES.includes(status) && via !== 'appointments') return null;
    const lead = await Lead.findById(leadId).select('dealer_id customer_id department assigned_to').lean();
    if (!lead) return null;
    const tz = await getDealerTimezone(lead.dealer_id);
    const dayStart = moment(at).tz(tz).startOf('day').toDate();
    const latest = await DeskLogEntry.findOne({ lead_id: lead._id, checked_in_at: { $gte: new Date(at.getTime() - LATEST_VISIT_DAYS * DAY) } })
      .sort({ checked_in_at: -1, _id: -1 }).lean();
    const outcome = outcomeForLeadStatus(status, unsoldReason);
    const isCurrent = latest && (latest.checked_in_at >= dayStart
      || (!latest.outcome && latest.checked_in_at >= new Date(at.getTime() - OPEN_VISIT_DAYS * DAY))
      || (outcome?.outcome === 'SOLD DELIVERED' && latest.outcome === 'SOLD PENDING'));
    if (!isCurrent) {
      const entry = await newVisit({ lead, at, via, actorId, actorName, outcome });
      return { created: true, id: String(entry._id), outcome: outcome?.outcome || null };
    }
    if (!outcome || (latest.outcome === outcome.outcome && (latest.unsold_reason || null) === outcome.unsold_reason)) {
      return { created: false, id: String(latest._id), outcome: latest.outcome || null };
    }
    const by = actorId && mongoose.isValidObjectId(String(actorId)) ? new mongoose.Types.ObjectId(String(actorId)) : null;
    const set = { outcome: outcome.outcome, unsold_reason: outcome.unsold_reason, outcome_at: at };
    // The dealer's Sold Pending delivery checklist, as when the outcome is picked on the Desk Log.
    if (outcome.outcome === 'SOLD PENDING' && !(latest.checklist || []).length) {
      const { checklist } = await rulesFor(lead.dealer_id);
      if (checklist.length) set.checklist = checklist.map((item) => ({ item, done: false }));
    }
    await DeskLogEntry.updateOne({ _id: latest._id }, { $set: set, $push: { history: { $each: [
      { field: 'outcome', from: latest.outcome || null, to: outcome.outcome, at, by, by_name: actorName || null },
      ...(outcome.unsold_reason !== (latest.unsold_reason || null)
        ? [{ field: 'unsold_reason', from: latest.unsold_reason || null, to: outcome.unsold_reason, at, by, by_name: actorName || null }] : []),
    ] } } });
    return { created: false, id: String(latest._id), outcome: outcome.outcome };
  } catch (error) {
    logger.error?.('[desk-log] could not follow the lead status', { lead: String(leadId), error: error?.message });
    return null;
  }
}

/** A Desk Log note on the lead's conversation too (an internal note, as staff notes on the Leads page can be). */
export async function noteOnLead({ entry, text, at = new Date(), by = null, byName = null, logger = console }) {
  try {
    await Email.create({
      sender: byName || 'Staff', recipient: 'staff', subject: 'Lead Note', mail_content: `Desk Log note: ${text}`,
      dealer_id: String(entry.dealer_id), lead_id: entry.lead_id, status: 'sent', communication_type: 'note',
      is_note: true, internal_use: true, ...(by ? { message_by: by } : {}),
      message_id: `desk_note_${entry._id}_${at.getTime()}`, timestamp: at, date: at,
    });
  } catch (error) {
    logger.error?.('[desk-log] could not add the note to the lead', { entry: String(entry._id), error: error?.message });
  }
}

// Staff notes on the lead's conversation the Desk Log shows (Notes (Latest)): written by a person on the Leads page
// (message_id note_<time>) or with a contact status. Automatic notes (status changes, bookings, the AI) are left out,
// and the Desk Log's own notes come from the visit.
export const STAFF_NOTE_ID = /^note_(\d+$|staff_contact_)/;

/** The latest staff note of each lead: Map lead id -> { text, at, by }. */
export async function latestLeadNotes(leadIds) {
  const ids = [...new Set(leadIds.map(String))].filter((id) => mongoose.isValidObjectId(id));
  if (!ids.length) return new Map();
  const rows = await Email.collection.aggregate([
    { $match: { lead_id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) }, is_note: true, message_id: STAFF_NOTE_ID } },
    { $sort: { timestamp: -1, _id: -1 } },
    { $group: { _id: '$lead_id', text: { $first: '$mail_content' }, at: { $first: '$timestamp' }, by: { $first: '$sender' } } },
  ]).toArray();
  return new Map(rows.map((r) => [String(r._id), { text: String(r.text || '').replace(/<[^>]+>/g, ' ').trim(), at: r.at, by: r.by || null }]));
}
