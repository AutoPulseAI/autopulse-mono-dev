// Which source wins, per field (SOW Appendix B 3: "Source precedence must be configurable by field/data type, not one
// hard-coded hierarchy for the entire customer record"; 23 Nov 2026). The defaults are what the import does today;
// a super admin can change a field for all dealers or one dealer (Admin > DMS feed > Source precedence), saved in
// `reconciliation_policies` (dealer_id '*' = all dealers). Pure apart from loadPolicy. Imports are relative so the
// DealerVault worker can load this module.
//
// Sources: DEALER_USER (staff typed it), CUSTOMER (the customer said it), DMS (DealerVault), LEAD (the lead provider),
// GUESS (split from a one-line name). The first in `precedence` wins over the ones after it.
//   kind 'undated'  profile data without a reliable date: a source may replace a value only from a source ranked
//                   the same or lower; a blank never replaces anything (Appendix B 2B)
//   kind 'event'    a reading tied to a dated event (an RO's mileage): the newest valid event wins, whatever its
//                   source; a suspicious change goes to REVIEW (Appendix B 2A, 4)
//   dms_contacts    phone / email from the DMS for a customer already on file: 'history' = kept as history only
//                   (APPEND; today's behaviour - the AI texts the profile's numbers, so a DMS number never starts
//                   texts by itself); 'fill_missing' = also added when the profile has none of that kind
import mongoose from 'mongoose';

export const SOURCES = Object.freeze(['DEALER_USER', 'CUSTOMER', 'DMS', 'LEAD', 'GUESS']);
export const SOURCE_NAMES = Object.freeze({ DEALER_USER: 'Staff', CUSTOMER: 'Customer', DMS: 'DealerVault (DMS)',
  LEAD: 'Lead provider', GUESS: 'Split from a one-line name', AI: 'AI' });

export const DEFAULT_POLICY = Object.freeze({
  name: { label: 'Name (first / middle / last)', kind: 'undated', precedence: ['DEALER_USER', 'CUSTOMER', 'DMS', 'LEAD', 'GUESS'] },
  phone: { label: 'Phone numbers', kind: 'undated', precedence: ['DEALER_USER', 'CUSTOMER', 'LEAD', 'DMS'], dms_contacts: 'history' },
  email: { label: 'Email addresses', kind: 'undated', precedence: ['DEALER_USER', 'CUSTOMER', 'LEAD', 'DMS'], dms_contacts: 'history' },
  mileage: { label: 'Vehicle mileage', kind: 'event', precedence: ['DMS', 'DEALER_USER', 'CUSTOMER'],
    review_drop_miles: 1000, review_jump_miles_per_year: 100000 },
});

const valid = (field, p) => {
  const base = DEFAULT_POLICY[field];
  if (!base || !p || typeof p !== 'object') return null;
  const out = {};
  if (Array.isArray(p.precedence)) {
    const order = [...new Set(p.precedence.map(String).filter((s) => SOURCES.includes(s)))];
    // Every default source stays ranked: a missing one goes last, in its default order.
    for (const s of base.precedence) if (!order.includes(s)) order.push(s);
    out.precedence = order;
  }
  if (base.dms_contacts && ['history', 'fill_missing'].includes(p.dms_contacts)) out.dms_contacts = p.dms_contacts;
  for (const k of ['review_drop_miles', 'review_jump_miles_per_year']) {
    if (base[k] != null && Number.isFinite(Number(p[k])) && Number(p[k]) > 0) out[k] = Math.round(Number(p[k]));
  }
  return out;
};

/** Merge stored overrides (all dealers, then the dealer's own) over the defaults. */
export function mergePolicy(...overrides) {
  const out = {};
  for (const [field, base] of Object.entries(DEFAULT_POLICY)) {
    out[field] = { ...base, precedence: [...base.precedence] };
    for (const o of overrides) Object.assign(out[field], valid(field, o?.fields?.[field]) || {});
  }
  return out;
}

/** Validated override fields from a request body ({ fields: { name: {...}, ... } }); unknown keys dropped. */
export function cleanOverride(fields = {}) {
  const out = {};
  for (const field of Object.keys(DEFAULT_POLICY)) {
    const v = valid(field, fields?.[field]);
    if (v && Object.keys(v).length) out[field] = v;
  }
  return out;
}

/** Rank of a source in a field's precedence (lower = stronger); unknown sources rank last. */
export function rank(policyField, source) {
  const i = policyField.precedence.indexOf(source);
  return i === -1 ? policyField.precedence.length : i;
}

const cache = new Map();
const TTL_MS = 60 * 1000;

/** The policy for one dealer (cached a minute). */
export async function loadPolicy(dealerId) {
  const key = String(dealerId || '*');
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - TTL_MS) return hit.policy;
  let docs = [];
  try {
    docs = await mongoose.connection.collection('reconciliation_policies')
      .find({ dealer_id: { $in: ['*', key] } }).toArray();
  } catch { /* no stored policy: the defaults */ }
  const policy = mergePolicy(docs.find((d) => d.dealer_id === '*'), docs.find((d) => d.dealer_id === key && key !== '*'));
  cache.set(key, { at: Date.now(), policy });
  return policy;
}

export function clearPolicyCache() { cache.clear(); }
