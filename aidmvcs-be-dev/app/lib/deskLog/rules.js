// The Desk Log's per-dealer settings (the user, 13 Nov 2026: "the follow-up rules are already in AI Studio - on the
// Desk Log only whether to alert the managers"). Who follows up, when and with what message is the AI's, set in AI
// Studio (Cadences > Unsold has the message per reason) - never here, so a dealership can't steer the AI.
//   alert_managers  per outcome / unsold reason: the dealership's managers get an email / text when a visit gets it
//   checklist       the Sold Pending delivery checklist (SOW Deliverable J), copied to the visit and ticked off there
import { UNSOLD_REASONS } from './constants.js';

export const OUTCOME_KEYS = Object.freeze([
  ['SOLD PENDING', 'Sold Pending'], ['SOLD DELIVERED', 'Sold Delivered'],
  ...Object.values(UNSOLD_REASONS).map((r) => [`UNSOLD|${r}`, `Unsold - ${r}`]),
]);
export const outcomeKey = (outcome, reason) => (outcome === 'UNSOLD' ? `UNSOLD|${reason}` : outcome);

// SOW Deliverable J default: "Hot: urgent owner task and manager visibility".
export const DEFAULT_RULES = Object.freeze(Object.fromEntries(OUTCOME_KEYS.map(([key]) => [key,
  { alert_managers: key === `UNSOLD|${UNSOLD_REASONS.HOT}` }])));

/** The settings as sent, cleaned (unknown keys dropped). */
export function normalizeRules(input = {}) {
  return Object.fromEntries(OUTCOME_KEYS.map(([key]) => [key, {
    alert_managers: input[key] && 'alert_managers' in input[key] ? Boolean(input[key].alert_managers)
      : DEFAULT_RULES[key].alert_managers }]));
}

export function normalizeChecklist(items = []) {
  return [...new Set((Array.isArray(items) ? items : []).map((s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120))
    .filter(Boolean))].slice(0, 30);
}

/** A dealer's settings (its saved ones over the defaults) and delivery checklist. */
export async function rulesFor(dealerId, { Model } = {}) {
  const M = Model || (await import('../../models/DeskLogRules.js')).default;
  const doc = await M.findOne({ dealer_id: String(dealerId) }).lean();
  const rules = {};
  for (const [key] of OUTCOME_KEYS) {
    const saved = (doc?.rules || {})[key];
    rules[key] = { alert_managers: saved && 'alert_managers' in saved ? Boolean(saved.alert_managers)
      : DEFAULT_RULES[key].alert_managers };
  }
  return { rules, checklist: doc?.checklist || [], version: doc?.version || 0, history: doc?.history || [] };
}
