// The AI's own stage for each lead (agentic-upsell agent/lifecycle.py: "New
// Lead", "Contact Made - No Next Action", "Appointment Set", "Sold Pending",
// "Closed - Lost", ...), shown read only next to the CRM status in the lead
// list. The AI service owns the `ai_lead_state` collection; the platform only
// reads `stage`, `stage_label` and `status` from it, never writes.
//
// Imports are relative so the workers can use this module too.

import mongoose from 'mongoose';

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
  } catch (error) {
    console.warn('[ai] could not read AI stages for the lead list', error?.message);
  }
  return leads;
}
