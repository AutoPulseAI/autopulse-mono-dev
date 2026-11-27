// "What we know" at the top of a conversation (the user, 27 Nov 2026 - idea 3, at no AI cost): what the AI has already
// learned about this customer and lead (agent-side slots, qualification_facts, current values only) as short chips,
// plus the AI's rolling summary when a long conversation has one (ai_lead_state.summary). Nothing new is asked of the
// model; this only reads what is stored.
import mongoose from 'mongoose';

const money = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? `$${Math.round(Number(v)).toLocaleString('en-US')}` : String(v));
const yes = (v) => v === true || /^(yes|true)$/i.test(String(v));

/** facts: { path: value } -> [{ key, label, text }] in reading order. */
export function glanceChips(f) {
  const out = [];
  // Stored slot values can be codes (this_week, pre_owned): shown as words.
  const add = (key, label, text) => { if (text) out.push({ key, label, text: String(text).replace(/_/g, ' ') }); };
  add('lead_type', 'Here for', { sales: 'Buying', trade_in: 'Trading in', service: 'Service' }[f['interest.lead_type']] || f['interest.lead_type']);
  add('want', 'Wants', [f['interest.new_or_used'], f['interest.model'], f['interest.body_type'], f['interest.color']].filter(Boolean).join(' '));
  if (f['interest.monthly_payment']) add('monthly', 'Monthly', `${money(f['interest.monthly_payment'])}/mo`);
  if (f['interest.budget']) add('budget', 'Budget', money(f['interest.budget']));
  add('timeline', 'Timeline', f['interest.timeline'] || f['interest.needed_by']);
  add('service', 'Service', f['interest.service_needed']);
  const trade = [f['trade_in.year'], f['trade_in.make'], f['trade_in.model']].filter(Boolean).join(' ');
  if (trade) add('trade', 'Trade-in', `${trade}${f['trade_in.mileage'] ? `, ${Number(f['trade_in.mileage']).toLocaleString('en-US')} mi` : ''}`);
  else if (yes(f['trade_in.has_trade'])) add('trade', 'Trade-in', 'Has one');
  if (f['trade_in.payoff']) add('payoff', 'Payoff', money(f['trade_in.payoff']));
  add('owns', 'Drives', [f['vehicle.year'], f['vehicle.make'], f['vehicle.model'], f['vehicle.trim']].filter(Boolean).join(' '));
  add('appt', 'Appointment', f['appointment.next_date']);
  add('best_time', 'Best time', f['contact.best_time']);
  add('channel', 'Prefers', f['contact.preferred_channel']);
  return out;
}

export async function leadGlance(lead, { db = mongoose.connection.db } = {}) {
  if (!lead?._id || !db) return { chips: [], summary: null };
  const cid = lead.customer_id ? String(lead.customer_id) : null;
  const lid = String(lead._id);
  const who = cid ? [cid, ...(mongoose.isValidObjectId(cid) ? [new mongoose.Types.ObjectId(cid)] : [])] : [];
  // Same filter as the lead card (app/lib/actionQueues.js leadCardFacts): this dealership, current, not pending.
  const facts = who.length ? await db.collection('qualification_facts').find({ dealer_id: String(lead.dealer_id),
    customer_id: { $in: who }, valid_to: null, lead_id: { $in: [null, lid] }, pending: { $ne: true } },
  { projection: { path: 1, value: 1, lead_id: 1 } }).toArray() : [];
  const f = {};
  // A lead's own value wins over the customer-wide one.
  for (const x of facts.sort((a, b) => (a.lead_id ? 1 : 0) - (b.lead_id ? 1 : 0))) f[x.path] = x.value;
  const state = await db.collection('ai_lead_state').findOne({ lead_id: lid }, { projection: { summary: 1 } });
  const summary = typeof state?.summary === 'string' ? state.summary
    : typeof state?.summary?.text === 'string' ? state.summary.text : null;
  return { chips: glanceChips(f), summary: summary ? summary.slice(0, 400) : null };
}
