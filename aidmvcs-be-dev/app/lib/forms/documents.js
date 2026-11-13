// Filled forms (SOW v6 Deliverable K, gap G-066): which data keys a form has, the CRM values that start it, what is
// missing, and what a person without finance rights may see. Server side.
import { dataKey, fillables } from './schema.js';
import { isSensitive } from './sources.js';

// Every field and blank of the form with its data key; a section repeated per trade-in has one copy per trade-in.
export function slots(schema, trades) {
  const out = [];
  for (const f of fillables(schema)) {
    const copies = f.section.repeat === 'trade_in' ? Math.max(1, trades) : 1;
    for (let n = 0; n < copies; n += 1) {
      out.push({ key: dataKey(f.id, f.section.repeat === 'trade_in' ? n : null), field: f, section: f.section, copy: n });
    }
  }
  return out;
}

/** The CRM values a new copy starts with: { data, prefilled } (empty values are left out - nothing made up). */
export function prefill(schema, { values, trades }) {
  const data = {}; const prefilled = [];
  for (const { key, field, section, copy } of slots(schema, trades.length)) {
    if (!field.source) continue;
    const v = section.repeat === 'trade_in' && field.source.startsWith('trade.') ? trades[copy]?.[field.source] : values[field.source];
    if (v == null || v === '') continue;
    data[key] = field.type === 'checkbox' ? /^(yes|true|x|1)$/i.test(String(v)) : String(v);
    prefilled.push(key);
  }
  return { data, prefilled };
}

const hiddenFor = (schema, trades, finance) => (finance ? new Set()
  : new Set(slots(schema, trades).filter((s) => isSensitive(s.field.source)).map((s) => s.key)));

/** Values sent by the screen, kept only for the form's own keys; payoff / lienholder only from managers. */
export function cleanData(schema, trades, input, { finance, previous = {} }) {
  const hidden = hiddenFor(schema, trades, finance);
  const out = { ...previous };
  for (const { key, field } of slots(schema, trades)) {
    if (hidden.has(key) || !(key in (input || {}))) continue;
    const v = input[key];
    out[key] = field.type === 'checkbox' ? Boolean(v) : v == null ? '' : String(v).slice(0, 2000);
  }
  return out;
}

export function missingRequired(schema, trades, data) {
  return slots(schema, trades).filter(({ key, field }) => field.required && field.type !== 'checkbox'
    && !String(data[key] ?? '').trim()).map(({ field, section, copy }) => (section.repeat === 'trade_in' && trades > 1
    ? `${field.label} (trade-in ${copy + 1})` : field.label));
}

/** The values a person may see: payoff / lienholder blanked for anyone without finance rights. */
export function visibleData(schema, trades, data, finance) {
  const hidden = hiddenFor(schema, trades, finance);
  return { data: Object.fromEntries(Object.entries(data || {}).filter(([k]) => !hidden.has(k))), hidden: [...hidden] };
}

// One filled form as a customer's list shows it.
export function docRow(d) {
  return { id: String(d._id), template_id: String(d.template_id), name: d.template_name, version: d.template_version,
    lead_id: d.lead_id ? String(d.lead_id) : null, trade_ins: (d.trade_in_ids || []).length, status: d.status,
    created_at: d.created_at, created_by: d.created_by_name, completed_at: d.completed_at,
    completed_by: d.completed_by_name, retain_until: d.retain_until, removed: Boolean(d.removed_at) };
}
