// The Desk Log's outcome -> follow-up rules (SOW v6 Deliverable J matrix), per dealer, with the SOW's default behaviour.
// For each outcome (SOLD PENDING, SOLD DELIVERED, each UNSOLD reason):
//   who            ai_and_staff | staff | ai | nobody - who follows up. staff / nobody turn the AI off for that lead
//                  (staff take it over); ai / ai_and_staff leave the AI's follow-up on (its wording: AI Studio)
//   owner          salesperson | sales_manager | bdc_agent - whose next step it is
//   next_step_hours  the visit's next step is set this many hours after the outcome, unless one is already set
//   alert_managers   the dealership's managers get an email / text right away
//   report_group   a group name for reports (empty = the outcome / reason itself)
// DND is fixed: nobody follows up (it blocks outreach; the SOW: "DND is not a generic nurturing cadence").
// Future Follow-Up always needs its date (deskLog.js). SOLD PENDING copies the dealer's delivery checklist to the visit.
import { UNSOLD_REASONS } from './constants.js';

export const WHO = Object.freeze({ ai_and_staff: 'AI and staff', staff: 'Staff only (AI off for the lead)',
  ai: 'AI only', nobody: 'Nobody (AI off for the lead)' });
export const OWNERS = Object.freeze({ salesperson: 'Salesperson', sales_manager: 'Sales manager', bdc_agent: 'BDC agent' });

export const OUTCOME_KEYS = Object.freeze([
  ['SOLD PENDING', 'Sold Pending'], ['SOLD DELIVERED', 'Sold Delivered'],
  ...Object.values(UNSOLD_REASONS).map((r) => [`UNSOLD|${r}`, `Unsold - ${r}`]),
]);
export const outcomeKey = (outcome, reason) => (outcome === 'UNSOLD' ? `UNSOLD|${reason}` : outcome);

const base = { who: 'ai_and_staff', owner: 'salesperson', next_step_hours: null, alert_managers: false, report_group: null };
// The SOW's "required default disposition behavior", as settings the dealer can change.
export const DEFAULT_RULES = Object.freeze({
  'SOLD PENDING': { ...base, next_step_hours: 24 },          // pending-deal follow-up + delivery checklist
  'SOLD DELIVERED': { ...base, who: 'ai' },                  // delivered; the AI's owner lifecycle, no prospecting
  [`UNSOLD|${UNSOLD_REASONS.NEGATIVE_EQUITY}`]: { ...base },
  [`UNSOLD|${UNSOLD_REASONS.PRICE_PAYMENT}`]: { ...base },
  [`UNSOLD|${UNSOLD_REASONS.CREDIT}`]: { ...base },
  [`UNSOLD|${UNSOLD_REASONS.HOT}`]: { ...base, alert_managers: true }, // urgent owner task + manager visibility
  [`UNSOLD|${UNSOLD_REASONS.FUTURE_FOLLOW_UP}`]: { ...base },          // the date is required on the visit
  [`UNSOLD|${UNSOLD_REASONS.CAR_FINDER}`]: { ...base },                // + the Car Finder inventory watch
  [`UNSOLD|${UNSOLD_REASONS.DND}`]: { ...base, who: 'nobody' },
});
const LOCKED = new Set([`UNSOLD|${UNSOLD_REASONS.DND}`]);
export const isLocked = (key) => LOCKED.has(key);

/** The rules as sent, cleaned (unknown keys dropped); throws with a plain message. */
export function normalizeRules(input = {}) {
  const out = {};
  for (const [key, label] of OUTCOME_KEYS) {
    const r = { ...DEFAULT_RULES[key], ...(input[key] || {}) };
    if (!WHO[r.who]) throw new Error(`${label}: who follows up?`);
    if (!OWNERS[r.owner]) throw new Error(`${label}: whose step is it?`);
    const h = r.next_step_hours === '' || r.next_step_hours == null ? null : Number(r.next_step_hours);
    if (h !== null && !(Number.isInteger(h) && h >= 1 && h <= 720)) throw new Error(`${label}: next step 1 to 720 hours, or empty`);
    out[key] = isLocked(key) ? { ...DEFAULT_RULES[key] } : { who: r.who, owner: r.owner, next_step_hours: h,
      alert_managers: Boolean(r.alert_managers), report_group: String(r.report_group || '').trim().slice(0, 40) || null };
  }
  return out;
}

export function normalizeChecklist(items = []) {
  return [...new Set((Array.isArray(items) ? items : []).map((s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120))
    .filter(Boolean))].slice(0, 30);
}

/** A dealer's rules (its saved ones over the defaults) and delivery checklist. */
export async function rulesFor(dealerId, { Model } = {}) {
  const M = Model || (await import('../../models/DeskLogRules.js')).default;
  const doc = await M.findOne({ dealer_id: String(dealerId) }).lean();
  const rules = {};
  for (const [key] of OUTCOME_KEYS) rules[key] = { ...DEFAULT_RULES[key], ...((doc?.rules || {})[key] || {}) };
  for (const key of LOCKED) rules[key] = { ...DEFAULT_RULES[key] };
  return { rules, checklist: doc?.checklist || [], version: doc?.version || 0, history: doc?.history || [] };
}
