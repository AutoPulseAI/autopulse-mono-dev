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
