// Dealer Intelligence & Business Rules (SOW v6 Appendix A section 02, previously contracted; the user, 13 Nov 2026:
// "give the options today, Betsy decides which to keep"). Each rooftop's own policies, as Yes / No / Not Configured
// toggles with the details a Yes needs. "Not Configured" is never read as No. Links the AI shares (trade estimator,
// prequalification, credit application, service scheduler...) stay where they are: Settings > AI > Links.
// Shared by the server and the screen - no server imports.

export const TRI = Object.freeze({ yes: 'Yes', no: 'No', not_configured: 'Not configured' });
export const FEE_POLICIES = Object.freeze({ free: 'Free', fixed: 'Fixed amount', quote: 'Quote required' });

// type: tri | text | textarea | money | number | url | list (one per line) | select | fees (rows) | date
// when: shown / required only when that tri field is 'yes'. required: needed when shown.
export const SECTIONS = Object.freeze([
  { key: 'pricing', title: 'Pricing, fees and disclosures', fields: [
    { key: 'price_includes_fees', label: 'Advertised price includes documentation and dealer fees?', type: 'tri' },
    { key: 'doc_fee', label: 'Documentation fee', type: 'money' },
    { key: 'mandatory_fees', label: 'Other mandatory dealer fees', type: 'fees',
      help: 'Each fee with its amount, what it applies to and from when.' },
    { key: 'optional_products', label: 'Optional products / add-ons (never treated as mandatory)', type: 'list' },
    { key: 'taxes_in_price', label: 'Government taxes, title and registration included in the displayed price?', type: 'tri' },
    { key: 'price_disclaimer', label: 'Approved price explanation / disclaimer', type: 'textarea' },
    { key: 'otd_needs_manager', label: 'An out-the-door quote needs a manager to confirm?', type: 'tri' },
  ] },
  { key: 'inventory', title: 'New / used inventory', fields: [
    { key: 'sells_new', label: 'Sells new vehicles?', type: 'tri' },
    { key: 'new_makes', label: 'Makes / brands sold new', type: 'list', when: 'sells_new', required: true },
    { key: 'sells_used', label: 'Sells used vehicles?', type: 'tri' },
    { key: 'cpo', label: 'Certified Pre-Owned program?', type: 'tri', when: 'sells_used' },
  ] },
  { key: 'service', title: 'Service and parts', fields: [
    { key: 'has_service', label: 'Has a service department?', type: 'tri' },
    { key: 'service_phone', label: 'Service phone', type: 'text', when: 'has_service', required: true },
    { key: 'service_url', label: 'Service page', type: 'url', when: 'has_service' },
    { key: 'service_address', label: 'Service address (if different)', type: 'text', when: 'has_service' },
    { key: 'service_hours', label: 'Service hours', type: 'textarea', when: 'has_service' },
    { key: 'has_parts', label: 'Has a parts department?', type: 'tri' },
    { key: 'parts_phone', label: 'Parts phone', type: 'text', when: 'has_parts', required: true },
    { key: 'parts_url', label: 'Parts page', type: 'url', when: 'has_parts' },
    { key: 'parts_hours', label: 'Parts hours', type: 'textarea', when: 'has_parts' },
  ] },
  { key: 'online_tools', title: 'Online trade estimator, prequalification and calculators', note: 'The links themselves are in Settings > AI > Links.', fields: [
    { key: 'trade_estimator', label: 'Online trade estimator?', type: 'tri' },
    { key: 'prequal', label: 'Online prequalification application?', type: 'tri' },
    { key: 'prequal_no_score_impact', label: 'Prequalification has no impact on the credit score (verified)?', type: 'tri', when: 'prequal' },
    { key: 'prequal_verified_by', label: 'Verified by (name) and source', type: 'text', when: 'prequal_no_score_impact', required: true },
    { key: 'prequal_verified_on', label: 'Verified on', type: 'date', when: 'prequal_no_score_impact', required: true },
    { key: 'vdp_calculator', label: 'Payment calculator on the website vehicle pages?', type: 'tri' },
    { key: 'other_calculator', label: 'Another payment calculator?', type: 'tri' },
    { key: 'other_calculator_url', label: 'Payment calculator link', type: 'url', when: 'other_calculator', required: true },
  ] },
  { key: 'shipping', title: 'Out-of-state shipping', fields: [
    { key: 'ships_out_of_state', label: 'Ships vehicles out of state?', type: 'tri' },
    { key: 'ship_states', label: 'States / regions it ships to', type: 'list', when: 'ships_out_of_state', required: true },
    { key: 'ship_arranged_by', label: 'Arranged by', type: 'select', options: { dealer: 'The dealership', third_party: 'A third party' }, when: 'ships_out_of_state' },
    { key: 'ship_fee_policy', label: 'Fee', type: 'select', options: FEE_POLICIES, when: 'ships_out_of_state', required: true },
    { key: 'ship_fee_amount', label: 'Fee amount', type: 'money', when: 'ships_out_of_state' },
    { key: 'ship_approval_owner', label: 'Who approves', type: 'text', when: 'ships_out_of_state' },
    { key: 'ship_disclaimer', label: 'Customer-facing disclaimer', type: 'textarea', when: 'ships_out_of_state' },
  ] },
  { key: 'delivery', title: 'Local delivery', fields: [
    { key: 'local_delivery', label: 'Delivers vehicles locally?', type: 'tri' },
    { key: 'delivery_miles', label: 'Delivery area: miles from the dealership', type: 'number', when: 'local_delivery' },
    { key: 'delivery_distance_method', label: 'Miles measured as', type: 'select', options: { driving: 'Driving distance', straight: 'Straight line' }, when: 'local_delivery' },
    { key: 'delivery_zips', label: 'Delivery area: ZIP codes / regions', type: 'list', when: 'local_delivery' },
    { key: 'delivery_rule', label: 'When both are set', type: 'select', options: { either: 'Either qualifies', both: 'Both must match' }, when: 'local_delivery' },
    { key: 'delivery_fee_policy', label: 'Fee', type: 'select', options: FEE_POLICIES, when: 'local_delivery', required: true },
    { key: 'delivery_fee_amount', label: 'Fee amount', type: 'money', when: 'local_delivery' },
    { key: 'delivery_needs_manager', label: 'Needs a manager to approve?', type: 'tri', when: 'local_delivery' },
    { key: 'delivery_restrictions', label: 'Restrictions / vehicle exclusions', type: 'textarea', when: 'local_delivery' },
    { key: 'delivery_disclaimer', label: 'Customer-facing disclaimer', type: 'textarea', when: 'local_delivery' },
  ] },
]);

export const FIELDS = Object.freeze(SECTIONS.flatMap((s) => s.fields.map((f) => ({ ...f, section: s.key }))));
const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

const shown = (f, values) => !f.when || (values[f.when] === 'yes' && shown(BY_KEY.get(f.when), values));
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

/** The values as sent, cleaned and checked; throws an Error listing what's wrong. */
export function normalizeValues(input = {}) {
  const out = {}; const errors = [];
  for (const f of FIELDS) {
    let v = input[f.key];
    if (f.type === 'tri') v = TRI[v] ? v : 'not_configured';
    else if (f.type === 'list') v = [...new Set((Array.isArray(v) ? v : String(v || '').split('\n'))
      .map((x) => String(x).trim()).filter(Boolean))].slice(0, 100);
    else if (f.type === 'money' || f.type === 'number') v = v === '' || v == null ? null : Number(v);
    else if (f.type === 'fees') {
      v = (Array.isArray(v) ? v : []).map((r) => ({ label: String(r?.label || '').trim().slice(0, 80),
        amount: r?.amount === '' || r?.amount == null ? null : Number(r.amount),
        applies_to: String(r?.applies_to || '').trim().slice(0, 120), effective: String(r?.effective || '').slice(0, 10) }))
        .filter((r) => r.label || r.amount != null).slice(0, 30);
      v.forEach((r, i) => { if (!r.label || r.amount == null || !Number.isFinite(r.amount) || r.amount < 0) errors.push(`${f.label}, row ${i + 1}: label and amount`); });
    } else if (f.type === 'select') v = f.options[v] ? v : null;
    else v = v == null ? null : String(v).trim().slice(0, f.type === 'textarea' ? 2000 : 300) || null;
    if ((f.type === 'money' || f.type === 'number') && v != null && !(Number.isFinite(v) && v >= 0)) errors.push(`${f.label}: a number`);
    if (f.type === 'url' && v && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v)) errors.push(`${f.label}: a full link (https://...)`);
    if (f.type === 'date' && v && Number.isNaN(Date.parse(v))) errors.push(`${f.label}: a date`);
    out[f.key] = v;
  }
  for (const f of FIELDS) if (f.required && shown(f, out) && empty(out[f.key])) errors.push(`${f.label} is needed when "${BY_KEY.get(f.when).label}" is Yes`);
  if (out.ship_fee_policy === 'fixed' && shown(BY_KEY.get('ship_fee_amount'), out) && out.ship_fee_amount == null) errors.push('Shipping: the fixed fee amount');
  if (out.delivery_fee_policy === 'fixed' && shown(BY_KEY.get('delivery_fee_amount'), out) && out.delivery_fee_amount == null) errors.push('Local delivery: the fixed fee amount');
  if (out.local_delivery === 'yes' && out.delivery_miles == null && !out.delivery_zips.length) errors.push('Local delivery: the area (miles or ZIP codes)');
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { errors });
  return out;
}

export const isShown = shown;
