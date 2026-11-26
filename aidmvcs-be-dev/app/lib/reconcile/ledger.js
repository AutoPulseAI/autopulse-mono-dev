// The customer field history (models/CustomerFieldHistory.js) and the DealerVault side of the field-by-field
// reconciliation (SOW Appendix B; 23 Nov 2026). Called by the DealerVault workers after a batch's customers are
// resolved: for every row it records what the row says about the customer's phones, emails and each vehicle's
// mileage, and what was decided. It only writes history - the profile's contacts stay as they are unless the
// dealer's policy says 'fill_missing' - and it never stops an import (a failure is logged and the import goes on).
// Imports are relative so the worker can load this module.
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Customer from '../../models/Customer.js';
import CustomerFieldHistory from '../../models/CustomerFieldHistory.js';
import { normalizeEmail, normalizePhone } from '../customerResolver.js';
import { loadPolicy } from './policy.js';
import { decideDmsContact, decideMileage, parseMiles } from './decide.js';

const last10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const uniq = (a) => [...new Set(a.filter(Boolean))];

export function dedupeKey(row) {
  return crypto.createHash('sha1').update(JSON.stringify([String(row.customer_id), row.field, row.source,
    row.source_record_id ?? null, row.value ?? null, row.source_event_date ? new Date(row.source_event_date).toISOString() : null,
    row.status ?? null])).digest('hex');
}

/** Store history rows once each (same observation again = no new row). Never throws. */
export async function recordHistory(rows, Model = CustomerFieldHistory) {
  if (!rows.length) return { written: 0 };
  try {
    const now = new Date();
    const res = await Model.collection.bulkWrite(rows.map((r) => {
      const doc = { imported_at: now, prior_value: null, precision: null, status: null, by: null, by_name: null,
        source_event_type: null, source_event_date: null, source_record_id: null, source_file: null, ...r,
        customer_id: new mongoose.Types.ObjectId(String(r.customer_id)) };
      doc.dedupe_key = dedupeKey(doc);
      return { updateOne: { filter: { dedupe_key: doc.dedupe_key }, update: { $setOnInsert: doc }, upsert: true } };
    }), { ordered: false });
    return { written: res.upsertedCount || 0 };
  } catch (error) {
    if (error?.code !== 11000 && !error?.writeErrors?.every?.((e) => e.code === 11000)) {
      console.error('[field-history] not recorded', { code: error?.code, message: error?.message?.slice(0, 200) });
    }
    return { written: 0 };
  }
}

/** A DealerVault date (YYYYMMDD, MM/DD/YYYY, M/D/YY, ISO) as a UTC day, or null. */
export function dmsDay(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) return new Date(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// What a row of each DMS file says about mileage, and the date it is true on (Appendix B 2A: RO mileage -> RO date;
// sale -> sale date). A service appointment row carries no reading.
export function mileageOf(fileType, doc) {
  const pick = (...keys) => { for (const k of keys) if (doc[k] != null && String(doc[k]).trim() !== '') return doc[k]; return null; };
  if (fileType === 'SV') {
    return { raw: pick('Mileage Out', 'RO Mileage'), at: dmsDay(pick('Close Date', 'Open Date')),
      type: 'repair_order', record: doc.ro_number || doc['RO Number'] || null };
  }
  if (fileType === 'SL') {
    return { raw: pick('Delivery Mileage', 'Mileage'), at: dmsDay(pick('Contract Date', 'Delivery Date')),
      type: 'sale', record: doc.deal_number || doc['Deal Number'] || null };
  }
  return null;
}

/** The current (latest accepted) reading per `${customer}|${vin}`. */
async function currentReadings(customerIds, Model) {
  const rows = await Model.collection.aggregate([
    { $match: { customer_id: { $in: customerIds }, decision: 'ACCEPT', field: /^mileage:/ } },
    { $sort: { source_event_date: -1, imported_at: -1 } },
    { $group: { _id: { c: '$customer_id', f: '$field' }, miles: { $first: '$value' }, at: { $first: '$source_event_date' } } },
  ]).toArray();
  return new Map(rows.map((r) => [`${r._id.c}|${r._id.f.slice(8)}`, { miles: r.miles, at: r.at }]));
}

async function disputedValues(customerIds, Model) {
  const rows = await Model.collection.find({ customer_id: { $in: customerIds }, status: 'CUSTOMER_DISPUTED' },
    { projection: { customer_id: 1, field: 1, value: 1 } }).toArray();
  const m = new Map();
  for (const r of rows) {
    const k = `${r.customer_id}|${r.field}`;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(typeof r.value === 'number' ? r.value : String(r.value).toLowerCase());
  }
  return m;
}

/**
 * Reconcile what one DealerVault batch says about its customers (the batch's `reconcile` step, after
 * resolveCustomers). entries[].document.customer_id is set by then.
 */
export async function reconcileDmsProfile(entries, context, { CustomerModel = Customer, Model = CustomerFieldHistory } = {}) {
  try {
    const fileType = context.fileType;
    const withCustomer = entries.filter((e) => e.document?.customer_id);
    if (!withCustomer.length) return { recorded: 0 };
    const policy = await loadPolicy(context.dealer_id);
    const ids = uniq(withCustomer.map((e) => String(e.document.customer_id))).map((id) => new mongoose.Types.ObjectId(id));
    const [customers, current, disputed] = await Promise.all([
      CustomerModel.collection.find({ _id: { $in: ids } },
        { projection: { phones: 1, emails: 1, removed_contacts: 1 } }).toArray(),
      currentReadings(ids, Model),
      disputedValues(ids, Model),
    ]);
    const byId = new Map(customers.map((c) => [String(c._id), c]));
    const rows = [];
    const fill = [];
    const base = (e) => ({ dealer_id: String(context.dealer_id), customer_id: String(e.document.customer_id), source: 'DMS',
      source_file: context.fileName || null });

    // Oldest event first, so a newer reading in the same file is compared with the older one.
    const ordered = withCustomer.map((e) => ({ e, mi: mileageOf(fileType, e.document) }))
      .sort((a, b) => (a.mi?.at?.getTime() || 0) - (b.mi?.at?.getTime() || 0));
    for (const { e, mi } of ordered) {
      const doc = e.document;
      const cid = String(doc.customer_id);
      const customer = byId.get(cid);
      if (!customer) continue;

      // Contacts (undated profile data).
      const removed = new Set((customer.removed_contacts || []).map((r) => (r.kind === 'phone' ? last10(r.value) : String(r.value || '').toLowerCase())));
      for (const [kind, cols, norm, onFileOf] of [
        ['phone', ['Cell Phone', 'Home Phone', 'Work Phone'], (v) => last10(normalizePhone(v)), (c) => (c.phones || []).map((p) => last10(p.value))],
        ['email', ['Email 1', 'Email 2', 'Email 3'], (v) => normalizeEmail(v), (c) => (c.emails || []).map((x) => String(x.value || '').toLowerCase())],
      ]) {
        const onFile = onFileOf(customer).filter(Boolean);
        for (const col of cols) {
          const value = norm(doc[col]);
          if (!value || (kind === 'phone' && value.length !== 10)) continue;
          const d = decideDmsContact(policy[kind], kind, value, { onFile, removed,
            disputed: disputed.get(`${cid}|${kind}`) || new Set() });
          if (!d) continue;
          rows.push({ ...base(e), field: kind, value, ...d, source_event_type: 'profile',
            source_record_id: doc.customer_number || null, precision: 'EXACT' });
          if (d.decision === 'ACCEPT') {
            onFile.push(value);
            fill.push({ id: customer._id, kind, value });
          }
        }
      }

      // Mileage (event-dated, per VIN).
      if (mi && doc.vin) {
        const key = `${cid}|${doc.vin}`;
        const miles = parseMiles(mi.raw);
        const d = decideMileage(policy.mileage, { miles, at: mi.at, raw: mi.raw }, current.get(key) || null,
          { disputed: disputed.get(`${cid}|mileage:${doc.vin}`) || new Set() });
        if (d) {
          rows.push({ ...base(e), field: `mileage:${doc.vin}`, value: miles ?? String(mi.raw), ...d,
            prior_value: current.get(key)?.miles ?? null, source_event_type: mi.type, source_event_date: mi.at,
            source_record_id: mi.record, precision: 'EXACT' });
          if (d.decision === 'ACCEPT') current.set(key, { miles, at: mi.at });
        }
      }
    }

    // 'fill_missing' policy only: a DMS contact goes on a profile that had none of that kind.
    for (const f of fill) {
      const path = f.kind === 'phone' ? 'phones' : 'emails';
      const value = f.kind === 'phone' ? `+1${f.value}` : f.value;
      await CustomerModel.collection.updateOne({ _id: f.id, [`${path}.0`]: { $exists: false } },
        { $push: { [path]: { value, is_primary: true, source: 'dealervault' } } }).catch(() => {});
    }
    const res = await recordHistory(rows, Model);
    return { recorded: res.written };
  } catch (error) {
    console.error('[field-history] DMS reconciliation skipped', { message: error?.message?.slice(0, 200) });
    return { recorded: 0 };
  }
}

/** The name the DMS put on (or tried to put on) a customer: one history row. Used by the DealerVault resolver. */
export function nameRow({ dealerId, customerId, value, prior, decision, reason, record, file }) {
  return { dealer_id: String(dealerId), customer_id: String(customerId), field: 'name', value, prior_value: prior || null,
    decision, reason, source: 'DMS', source_event_type: 'profile', source_record_id: record || null, source_file: file || null,
    precision: 'EXACT' };
}
