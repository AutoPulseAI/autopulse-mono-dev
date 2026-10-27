import mongoose from "mongoose";
import ActivityLog from "../models/ActivityLog.js";
import Booking from "../models/Booking.js";
import Email from "../models/Email.js";

// Who made each lead's appointment (Betsy, 21 Oct 2026: every appointment tagged AI or staff): the latest booking's
// created_by. 'customer' (the public booking page, reached from the AI's link) counts as AI - nobody on staff made
// it. A lead with no booking record (set by hand before bookings were recorded) counts as staff.
export async function bookedByForLeads(leadIds) {
  const ids = leadIds.map(String);
  const byLead = new Map(ids.map((id) => [id, 'staff']));
  if (!ids.length) return byLead;
  const latest = await Booking.aggregate([
    { $match: { lead_id: { $in: ids } } },
    { $sort: { _id: -1 } },
    { $group: { _id: '$lead_id', created_by: { $first: '$created_by' } } },
  ]);
  for (const b of latest) {
    if (b.created_by === 'ai' || b.created_by === 'customer') byLead.set(String(b._id), 'ai');
  }
  return byLead;
}

export async function bookingCreatorSplit(leadIds) {
  const byLead = await bookedByForLeads(leadIds);
  const byAi = [...byLead.values()].filter((v) => v === 'ai').length;
  return { by_ai: byAi, by_staff: byLead.size - byAi };
}

// Betsy, 27 Oct 2026 ("he went through the so called 11 appts and saw they were not appts"): each row of the
// appointments list says who booked it - the AI, or staff by name - and, for a staff booking, whether the customer
// agreed. The same test as the AI's (agentic-upsell scheduler/followups.py _customer_agreed): the customer wrote to us
// and their last message isn't a cancel, or staff logged a call.
const CANCEL_ASK = /\bcancel\b|\bnot (?:coming|interested)\b|\bno longer\b/i;
// The lead itself (CarGurus, Cars.com... ADF XML) is stored as a received email: it is not the customer replying.
const LEAD_EMAIL = /<\?adf|<adf[\s>]|<prospect[\s>]/i;
const CALL_LOGGED = /spoke (?:with|to) (?:the )?c(?:u|o)stomer|\bcalled\b|\bcall was made\b/i;

export async function bookingDetailsForLeads(leadIds) {
  const ids = leadIds.map(String);
  const out = new Map();
  if (!ids.length) return out;
  const by = await bookedByForLeads(ids);
  const oids = ids.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));
  const logs = await ActivityLog.find({ lead_id: { $in: oids }, action: 'status_changed', to: /appointment/i })
    .sort({ at: -1 }).select('lead_id actor_type actor_name').lean();
  const staffName = new Map();
  for (const l of logs) {
    const id = String(l.lead_id);
    if (!staffName.has(id) && l.actor_type !== 'ai') staffName.set(id, l.actor_name || null);
  }
  const msgs = await Email.find({ lead_id: { $in: oids }, $or: [
    { status: { $in: ['received', 'incoming'] }, is_note: { $ne: true } }, { is_note: true }] })
    .sort({ date: -1 }).select('lead_id status is_note mail_content').lean();
  const lastIn = new Map(), called = new Set();
  for (const m of msgs) {
    const id = String(m.lead_id);
    if (m.is_note) { if (CALL_LOGGED.test(m.mail_content || '')) called.add(id); }
    else if (!lastIn.has(id) && !m.is_lead_email && !LEAD_EMAIL.test(m.mail_content || '')) lastIn.set(id, m.mail_content || '');
  }
  for (const id of ids) {
    const who = by.get(id);
    const agreed = who === 'ai' || called.has(id) || (lastIn.has(id) && !CANCEL_ASK.test(lastIn.get(id)));
    out.set(id, { booked_by: who, booked_by_name: who === 'staff' ? staffName.get(id) || null : null,
      customer_agreed: agreed });
  }
  return out;
}
