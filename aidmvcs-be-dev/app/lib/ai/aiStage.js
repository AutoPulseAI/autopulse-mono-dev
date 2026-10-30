// The AI's own stage for each lead (agentic-upsell agent/lifecycle.py: "New
// Lead", "Contact Made - No Next Action", "Appointment Set", "Sold Pending",
// "Closed - Lost", ...), shown read only next to the CRM status in the lead
// list. The AI service owns the `ai_lead_state` collection; the platform only
// reads `stage`, `stage_label` and `status` from it, never writes.
//
// Imports are relative so the workers can use this module too.

import mongoose from 'mongoose';
import { stopLabel, stopsForLeads } from './stopLabels.js';

export const AI_LEAD_STATE_COLLECTION = 'ai_lead_state';

function defaultCollection() {
  return mongoose.connection.collection(AI_LEAD_STATE_COLLECTION);
}

// Adds ai_stage / ai_stage_label / ai_status to each lead that has AI state.
// Never throws: a lead list must load even if this read fails.
export async function attachAiStages(leads, { collection = defaultCollection() } = {}) {
  if (!Array.isArray(leads) || !leads.length) return leads;
  try {
    const ids = leads.map((lead) => String(lead._id));
    const states = await collection.find({ lead_id: { $in: ids } })
      .project({ lead_id: 1, dealer_id: 1, stage: 1, stage_label: 1, status: 1 }).toArray();
    const byLead = new Map(states.map((state) => [`${state.dealer_id}:${state.lead_id}`, state]));
    for (const lead of leads) {
      const state = byLead.get(`${lead.dealer_id}:${lead._id}`);
      if (!state) continue;
      lead.ai_stage = state.stage || null;
      lead.ai_stage_label = state.stage_label || null;
      lead.ai_status = state.status || null;
    }
    const stops = await stopsForLeads(ids);
    for (const lead of leads) lead.ai_stop_label = stopLabel(stops[String(lead._id)]);
  } catch (error) {
    console.warn('[ai] could not read AI stages for the lead list', error?.message);
  }
  return leads;
}

// Betsy and Bibi, 27 Oct 2026 meeting: "a status - it's under the sales agent, under this cadence - so we can trace it
// back ... only our view, not the dealer's" (another company could see our secret sauce). For AutoPulse super admins
// only (the caller checks): the AI's bucket and stage, and its next scheduled message (kind, step, when).
export async function attachAiAdminLabels(leads, {
  states = mongoose.connection.collection(AI_LEAD_STATE_COLLECTION),
  followups = mongoose.connection.collection('scheduled_followups'),
} = {}) {
  if (!Array.isArray(leads) || !leads.length) return leads;
  try {
    const ids = leads.map((lead) => String(lead._id));
    const [rows, next] = await Promise.all([
      states.find({ lead_id: { $in: ids } }).project({ lead_id: 1, bucket: 1, stage_label: 1, status: 1, specialist: 1 })
        .toArray(),
      followups.aggregate([
        { $match: { lead_id: { $in: ids }, status: 'pending' } },
        { $sort: { due_at: 1 } },
        { $group: { _id: '$lead_id', kind: { $first: '$kind' }, step: { $first: '$step' }, due_at: { $first: '$due_at' } } },
      ]).toArray(),
    ]);
    const state = new Map(rows.map((r) => [String(r.lead_id), r]));
    const upcoming = new Map(next.map((n) => [String(n._id), n]));
    for (const lead of leads) {
      const s = state.get(String(lead._id));
      const n = upcoming.get(String(lead._id));
      if (!s && !n) continue;
      lead.ai_admin = { bucket: s?.bucket || null, agent: s?.specialist?.name || null, stage: s?.stage_label || null,
        status: s?.status || null,
        next: n ? { kind: n.kind, step: n.step || null, due_at: n.due_at } : null };
    }
  } catch (error) {
    console.warn('[ai] could not read the AI admin labels', error?.message);
  }
  return leads;
}
