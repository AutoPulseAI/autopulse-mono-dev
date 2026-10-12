// The leads that share one conversation (client, 12 Oct 2026: "the AI conversation isn't showing in the customer
// profile or the lead, only in AI Messages"). When a customer sends a second lead, the AI keeps one conversation
// on their first open lead (agentic-upsell agent/duplicates.py: ai_lead_state.duplicate_of / linked_leads), so the
// new lead looked empty. Opening either lead shows the whole conversation.
import mongoose from 'mongoose';

export async function conversationLeadIds(leadId, { db = mongoose.connection.db } = {}) {
  const id = String(leadId);
  const ids = new Set([id]);
  try {
    const states = db.collection('ai_lead_state');
    const own = await states.findOne({ lead_id: id }, { projection: { duplicate_of: 1, linked_leads: 1 } });
    const primary = own?.duplicate_of ? String(own.duplicate_of) : id;
    ids.add(primary);
    const head = primary === id ? own : await states.findOne({ lead_id: primary }, { projection: { linked_leads: 1 } });
    for (const linked of head?.linked_leads || []) if (linked?.lead_id) ids.add(String(linked.lead_id));
  } catch {
    // The AI's state is optional here: without it the lead shows its own messages, as before.
  }
  return [...ids].filter((x) => mongoose.isValidObjectId(x)).map((x) => new mongoose.Types.ObjectId(x));
}
