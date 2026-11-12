// Each lead's funnel times (SOW Deliverable B b4, gap G-009): received, first response, customer's first reply,
// appointment set, showroom visit, sold, closed-lost. Read only, from the records that already hold each event - the
// same records the reports count (contactedLeads.js, Booking, DeskLogEntry, ActivityLog, the AI's stage history):
//   received        Lead.createdAt
//   first_response  our first text / email to the customer (AI, staff or automatic; not notes, not the lead file)
//   first_reply     the customer's first message (not the lead's own arrival email / ADF file)
//   appointment     the first booking made for the lead (Booking.createdAt)
//   visit           the first Desk Log check-in, else the booking marked "showed"
//   sold / lost     the first change to a Sold / Closed - Lost status, by staff (ActivityLog) or the AI (stage history)
import mongoose from 'mongoose';
import Email from '../models/Email.js';
import Lead from '../models/Lead.js';
import Booking from '../models/Booking.js';
import DeskLogEntry from '../models/DeskLogEntry.js';
import ActivityLog from '../models/ActivityLog.js';
import { leadArrivalRowIds } from './contactedLeads.js';
import { AI_LEAD_STATE_COLLECTION } from './ai/aiStage.js';

const INBOUND = ['received', 'incoming'];
const ADF = /<\?adf|<adf[\s>]/i;
const SOLD = /sold/i;
const LOST = /closed\s*-?\s*lost/i;
const AI_SOLD = new Set(['sold_pending', 'sold_delivered']);

const earliest = (map, id, at) => {
  if (!at) return;
  const key = String(id);
  const d = new Date(at);
  if (!map.has(key) || d < map.get(key)) map.set(key, d);
};

export async function leadMilestones(leadIds, {
  states = mongoose.connection.collection(AI_LEAD_STATE_COLLECTION),
} = {}) {
  const ids = [...new Set(leadIds.map(String))].filter((id) => mongoose.isValidObjectId(id));
  const out = {};
  if (!ids.length) return out;
  const oids = ids.map((id) => new mongoose.Types.ObjectId(id));
  const anyId = { $in: [...oids, ...ids] };

  const [leads, sent, inbound, bookings, visits, logs, aiStates] = await Promise.all([
    Lead.find({ _id: { $in: oids } }).select('_id createdAt').lean(),
    Email.find({ lead_id: anyId, status: { $nin: [...INBOUND, 'note'] }, is_note: { $ne: true },
      is_lead_email: { $ne: true } }).select('lead_id timestamp mail_content').sort({ timestamp: 1 }).lean(),
    Email.find({ lead_id: anyId, status: { $in: INBOUND }, is_note: { $ne: true }, is_lead_email: { $ne: true } })
      .select('_id lead_id timestamp mail_content message_id').sort({ timestamp: 1 }).lean(),
    Booking.find({ lead_id: { $in: ids } }).select('lead_id createdAt showed showed_at').lean(),
    DeskLogEntry.find({ lead_id: { $in: oids } }).select('lead_id checked_in_at').lean(),
    ActivityLog.find({ lead_id: { $in: oids }, action: 'status_changed', to: { $in: [SOLD, LOST] } })
      .select('lead_id to at').lean(),
    states.find({ lead_id: { $in: ids } }).project({ lead_id: 1, stage_history: 1 }).toArray(),
  ]);
  const arrivals = new Set((await leadArrivalRowIds({ lead_id: anyId, is_note: { $ne: true } })).map(String));

  const m = { first_response: new Map(), first_reply: new Map(), appointment: new Map(), visit: new Map(),
    shown: new Map(), sold: new Map(), lost: new Map() };
  for (const e of sent) if (!ADF.test(String(e.mail_content || ''))) earliest(m.first_response, e.lead_id, e.timestamp);
  for (const e of inbound) {
    if (arrivals.has(String(e._id)) || ADF.test(String(e.mail_content || '')) || /^lead-/.test(String(e.message_id || ''))) continue;
    earliest(m.first_reply, e.lead_id, e.timestamp);
  }
  for (const b of bookings) {
    earliest(m.appointment, b.lead_id, b.createdAt);
    if (b.showed === true) earliest(m.shown, b.lead_id, b.showed_at);
  }
  for (const v of visits) earliest(m.visit, v.lead_id, v.checked_in_at);
  for (const l of logs) earliest(LOST.test(l.to) ? m.lost : m.sold, l.lead_id, l.at);
  for (const s of aiStates) {
    for (const h of s.stage_history || []) {
      if (AI_SOLD.has(h?.to)) earliest(m.sold, s.lead_id, h.at);
      else if (h?.to === 'closed_lost') earliest(m.lost, s.lead_id, h.at);
    }
  }
  for (const lead of leads) {
    const id = String(lead._id);
    out[id] = {
      received: lead.createdAt || null,
      first_response: m.first_response.get(id) || null,
      first_reply: m.first_reply.get(id) || null,
      appointment: m.appointment.get(id) || null,
      visit: m.visit.get(id) || m.shown.get(id) || null,
      sold: m.sold.get(id) || null,
      lost: m.lost.get(id) || null,
    };
  }
  return out;
}
