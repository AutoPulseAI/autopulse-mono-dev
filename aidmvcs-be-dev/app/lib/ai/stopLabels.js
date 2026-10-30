// What a customer stopped, shown on the lead (the user, 31 Oct 2026: "otherwise the tracking becomes very difficult").
// A label beside the status, never a status: a lead can be Appointment Booked and Text stopped.
//   Text stopped / Email stopped  that channel       (the other continues)
//   All stopped                   both, on this lead (a new inquiry starts fresh)
// DND stays the status for a customer who stopped everything. Read from the AI's records: inquiry_opt_out on the lead
// state, and the latest opt-out entry per channel in ai_consent.
import mongoose from 'mongoose';

export function stopLabel({ sms = false, email = false } = {}) {
  if (sms && email) return 'All stopped';
  if (sms) return 'Text stopped';
  if (email) return 'Email stopped';
  return null;
}

// { leadId: { sms, email } } for these leads.
export async function stopsForLeads(leadIds, db = mongoose.connection.db) {
  const ids = (leadIds || []).map(String);
  const out = Object.fromEntries(ids.map((id) => [id, { sms: false, email: false }]));
  if (!ids.length) return out;
  const states = await db.collection('ai_lead_state').find({ lead_id: { $in: ids } })
    .project({ lead_id: 1, customer_id: 1, inquiry_opt_out: 1 }).toArray();
  const byCustomer = new Map();
  for (const s of states) {
    if (s.inquiry_opt_out?.sms) out[s.lead_id].sms = true;
    if (s.inquiry_opt_out?.email) out[s.lead_id].email = true;
    if (s.customer_id) byCustomer.set(s.customer_id, [...(byCustomer.get(s.customer_id) || []), s.lead_id]);
  }
  const rows = await db.collection('ai_consent').find({ consent_type: 'opt_out', $or: [{ lead_id: { $in: ids } },
    { customer_id: { $in: [...byCustomer.keys()] } }] }).sort({ _id: -1 }).toArray();
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.customer_id || row.lead_id}:${row.channel}`;
    if (seen.has(key) || !['sms', 'email'].includes(row.channel)) continue;
    seen.add(key);
    if (row.consent_status !== 'opted_out') continue;
    for (const id of new Set([...(byCustomer.get(row.customer_id) || []), ...(ids.includes(row.lead_id) ? [row.lead_id] : [])])) {
      out[id][row.channel] = true;
    }
  }
  return out;
}

// The leads of this dealer with any stop, for the "Stopped" filter.
export async function stoppedLeadIds(dealerId, db = mongoose.connection.db) {
  const dealer = String(dealerId);
  const states = await db.collection('ai_lead_state').find({ dealer_id: dealer, inquiry_opt_out: { $exists: true, $ne: null } })
    .project({ lead_id: 1 }).toArray();
  const opted = await db.collection('ai_consent').find({ dealer_id: dealer, consent_type: 'opt_out', consent_status: 'opted_out' })
    .project({ lead_id: 1 }).toArray();
  const ids = new Set([...states, ...opted].map((r) => r.lead_id).filter(Boolean).map(String));
  const stops = await stopsForLeads([...ids], db);
  return [...ids].filter((id) => stops[id]?.sms || stops[id]?.email);
}
