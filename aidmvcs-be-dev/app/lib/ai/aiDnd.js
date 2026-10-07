// DND both ways (agentic-upsell MASTER_PLAN_4 stream C1).
//
// AI -> CRM: the customer opted out of every channel in a conversation with
// the AI (STOP, "don't contact me", ...). The AI service calls
// POST /api/internal/ai/leads/dnd and the lead shows DND in the CRM, with an
// internal note saying why; the platform's own follow-ups and reminders for
// the lead stop. The AI is NOT told back (it already knows), so there is no loop.
//
// CRM -> AI: staff picking DND in the status modal is a staff-owned status
// (aiStaff.js STAFF_OWNED_STATUSES): the AI gets lead-paused with
// 'Staff moved the lead to "DND"' and records the opt-out
// (agentic-upsell lifecycle.STAFF_STATUS_EVENTS["DND"] = "opted_out").
//
// Dependencies injected so it is tested against MongoDB directly.

import mongoose from 'mongoose';

const isObjectId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

export function validateDndPayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return { errors: ['body must be a JSON object'] };
  if (!isObjectId(body.dealer_id)) errors.push('dealer_id must be an ObjectId string');
  if (!isObjectId(body.lead_id)) errors.push('lead_id must be an ObjectId string');
  if (body.reason != null && typeof body.reason !== 'string') errors.push('reason must be a string');
  return { errors };
}

// An internal note on the lead, written by the AI service (a service request
// with the customer's preferred day/time, a handoff summary, ...): shown in
// the lead's notes like a staff note, marked internal and AI-written.
// POST /api/internal/ai/leads/notes {dealer_id, lead_id, text, kind?}
export function validateNotePayload(body) {
  const { errors } = validateDndPayload({ ...body, reason: undefined });
  if (typeof body?.text !== 'string' || !body.text.trim()) errors.push('text is required');
  if (body?.kind != null && typeof body.kind !== 'string') errors.push('kind must be a string');
  if (body?.idempotency_key != null && (typeof body.idempotency_key !== 'string' || body.idempotency_key.length > 200)) {
    errors.push('idempotency_key must be a string (max 200)');
  }
  return { errors };
}

export async function addAiLeadNote(body, { Lead, Email, now = () => new Date() }) {
  const lead = await Lead.findOne({ _id: body.lead_id, dealer_id: body.dealer_id }).select('_id').lean();
  if (!lead) return { found: false };
  const at = now();
  // MASTER_PLAN_4 (stream R): one note per AI notice - a retried call with the same idempotency_key returns
  // the note already written instead of a second one.
  const messageId = body.idempotency_key
    ? `note_ai_${body.lead_id}_${body.idempotency_key}` : `note_ai_${body.lead_id}_${at.getTime()}`;
  if (body.idempotency_key) {
    const existing = await Email.findOne({ message_id: messageId, dealer_id: String(body.dealer_id) }).select('_id').lean();
    if (existing) return { found: true, id: String(existing._id), created: false };
  }
  const note = await Email.create({
    sender: 'AutoPulse AI', recipient: 'staff', subject: 'Lead Note', mail_content: body.text.trim().slice(0, 5000),
    dealer_id: String(body.dealer_id), lead_id: lead._id, status: 'sent', communication_type: 'note', is_note: true,
    internal_use: true, message_id: messageId, timestamp: at, date: at,
    ai_generated: true, ai_note_kind: body.kind || null,
  });
  return { found: true, id: String(note._id), created: true };
}

export async function markLeadDndFromAi(body, {
  Lead, Email, clearPendingJobs = async () => {}, cancelAllRemindersForLead = async () => {}, now = () => new Date(),
}) {
  const lead = await Lead.findOne({ _id: body.lead_id, dealer_id: body.dealer_id }).select('_id fe_lead_status').lean();
  if (!lead) return { found: false, updated: false };
  const already = lead.fe_lead_status === 'DND';
  const at = now();
  if (!already) {
    await Lead.updateOne({ _id: lead._id }, { $set: {
      status: 'DND', lead_status: 'DND', fe_lead_status: 'DND', statusChangedAt: at,
      dnd_source: 'ai_opt_out', dnd_reason: body.reason || null,
    } });
    await Email.create({
      sender: 'AutoPulse AI', recipient: 'staff', subject: 'Lead Note',
      mail_content: `Set to DND by the AI: ${body.reason || 'the customer opted out of every channel.'}`,
      dealer_id: String(body.dealer_id), lead_id: new mongoose.Types.ObjectId(body.lead_id),
      status: 'sent', communication_type: 'note', is_note: true, internal_use: true,
      message_id: `note_ai_dnd_${body.lead_id}_${at.getTime()}`, timestamp: at, date: at, ai_generated: true,
    });
  }
  await clearPendingJobs(lead._id);
  await cancelAllRemindersForLead(lead._id);
  return { found: true, updated: true, already_dnd: already };
}

// The AI's own closings shown as the lead's status (agentic-upsell PLAN_4 stream S, agent/crm_status.py):
// Day 91 with no response -> "Closed - Lost"; the customer no longer owns the vehicle sold on this lead
// (ownership anniversary "NO") -> "Closed - No Longer Owns" (read only in the CRM: only the AI sets it).
// POST /api/internal/ai/leads/status {dealer_id, lead_id, status, reason?, closed_at?}
//
// Staff always win: a status changed after the AI closed the lead (`closed_at`) is kept, and so is a staff
// status the AI could not have been working from (a Sold / Visited / DND lead is never "lost" by the AI).
export const AI_CLOSED_STATUSES = Object.freeze(['Closed - Lost', 'Closed - No Longer Owns']);
// Statuses only the AI sets: shown in the CRM's lists and filters, not offered in the status picker.
export const READ_ONLY_STATUSES = Object.freeze(['Closed - No Longer Owns']);

// PLAN_4 stream X2 (SOLD-DELIVERED PDF §1-§2; SOLD PENDING PDF §2): "Closed - Lost" is for a transaction that won't
// complete. A delivered car's opportunity stays active until the customer no longer owns it, and it leaves only as
// "Closed - No Longer Owns" (the AI's ownership check). The AI refuses Closed Lost on it; the CRM refuses it too.
export const CLOSED_LOST_STATUSES = Object.freeze(['Closed - Lost', 'Closed Lost']);
export const DELIVERED_CLOSE_ERROR = 'A Sold Delivered opportunity can\'t be closed as "Closed - Lost": the sale is '
  + 'complete. It closes as "Closed - No Longer Owns" once the customer no longer owns the vehicle (the AI asks at '
  + 'each ownership anniversary).';

// The error for a status change the CRM refuses because the AI's lifecycle can't follow it, or null.
export function statusChangeError(previousStatus, status) {
  if (previousStatus === 'Sold Delivered' && CLOSED_LOST_STATUSES.includes(status)) return DELIVERED_CLOSE_ERROR;
  return null;
}
// Staff statuses a Day 91 "Closed - Lost" never replaces.
const KEEP_FOR_CLOSED_LOST = Object.freeze(['Visited', 'Sold', 'DND', 'Managerial Review', 'Sold Pending',
  'Sold Delivered', 'Closed - No Longer Owns']);
// The only statuses "Closed - No Longer Owns" replaces: the vehicle was sold on this lead.
const FROM_FOR_NO_LONGER_OWNS = Object.freeze(['Sold Delivered', 'Sold']);

export function validateClosedStatusPayload(body) {
  const { errors } = validateDndPayload(body);
  if (!AI_CLOSED_STATUSES.includes(body?.status)) errors.push(`status must be one of ${AI_CLOSED_STATUSES.join(', ')}`);
  if (body?.closed_at != null && Number.isNaN(Date.parse(body.closed_at))) errors.push('closed_at must be a date');
  return { errors };
}

// Why the AI's closing is not applied to a lead now showing `current` (changed at `changedAt`), or null.
export function closedStatusConflict({ status, current, changedAt, closedAt }) {
  if (current === status) return 'already';
  if (changedAt && closedAt && new Date(changedAt) > new Date(closedAt)) return 'staff_changed_it_after';
  if (status === 'Closed - Lost' && KEEP_FOR_CLOSED_LOST.includes(current)) return 'staff_status_kept';
  if (status === 'Closed - No Longer Owns' && !FROM_FOR_NO_LONGER_OWNS.includes(current)) return 'not_a_sold_lead';
  return null;
}

export async function markLeadClosedFromAi(body, {
  Lead, Email, clearPendingJobs = async () => {}, cancelAllRemindersForLead = async () => {}, now = () => new Date(),
}) {
  const lead = await Lead.findOne({ _id: body.lead_id, dealer_id: body.dealer_id })
    .select('_id fe_lead_status lead_status status statusChangedAt').lean();
  if (!lead) return { found: false, updated: false };
  const current = lead.fe_lead_status || lead.lead_status || lead.status || null;
  const conflict = closedStatusConflict({ status: body.status, current, changedAt: lead.statusChangedAt,
    closedAt: body.closed_at });
  if (conflict) return { found: true, updated: false, reason: conflict, current };
  const at = now();
  // Only if nobody changed it in the meantime: a staff save between the read and this write wins.
  const changed = await Lead.updateOne({ _id: lead._id, statusChangedAt: lead.statusChangedAt ?? null }, { $set: {
    status: body.status, lead_status: body.status, fe_lead_status: body.status, statusChangedAt: at,
    status_source: 'ai', status_reason: body.reason || null,
  } });
  if (!changed.modifiedCount) return { found: true, updated: false, reason: 'staff_changed_it_after', current };
  await Email.create({
    sender: 'AutoPulse AI', recipient: 'staff', subject: 'Lead Note',
    mail_content: `Set to ${body.status} by the AI${body.reason ? `: ${body.reason}` : ''}`,
    dealer_id: String(body.dealer_id), lead_id: new mongoose.Types.ObjectId(body.lead_id),
    status: 'sent', communication_type: 'note', is_note: true, internal_use: true,
    message_id: `note_ai_status_${body.lead_id}_${at.getTime()}`, timestamp: at, date: at, ai_generated: true,
  });
  await clearPendingJobs(lead._id);
  await cancelAllRemindersForLead(lead._id);
  return { found: true, updated: true, previous: current };
}
