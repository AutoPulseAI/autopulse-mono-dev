// Gross from DealerVault, per lead (Betsy's source / sub-source report: Front / Back / Total Gross). The DMS sales file
// (Deal, DealerVault "SL") is matched to the lead that brought the buyer in, by the rule in planning/PARALLEL-AGENTS.md:
// the same VIN, phone number (last 10 digits) or email as the lead, and the lead is the latest one received on or
// before the deal's date (within 365 days). A deal with no such lead is not in the report (no lead source) and is
// counted as "not matched".
//   date   "Contract Date" (else "Delivery Date"); DealerVault sends text: YYYYMMDD, MM/DD/YYYY or ISO
//   gross  "Front Gross" and "Back Gross"; total = front + back ("Gross Profit" when neither is sent)
import moment from 'moment-timezone';
import { collection, dealerForms } from './kpis/common.js';

const MATCH_DAYS = 365;
const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const email = (v) => String(v || '').trim().toLowerCase();
const vinOf = (v) => String(v || '').trim().toUpperCase();

/** A DealerVault date (text) as a Date at the start of that day in the dealer's time zone, or null. */
export function dealDate(value, tz) {
  const s = String(value || '').trim();
  if (!s) return null;
  const formats = ['YYYYMMDD', 'MM/DD/YYYY', 'M/D/YYYY', 'MM/DD/YY', 'M/D/YY', 'YYYY-MM-DD', moment.ISO_8601];
  const m = moment.tz(s, formats, true, tz);
  return m.isValid() ? m.startOf('day').toDate() : null;
}

/** A DealerVault money value as a number, or null: "1234.56", "-12", "$1,234.00", "(123.45)". */
export function money(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = Number(s.replace(/[()$,\s-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function dealGrossValues(deal) {
  const front = money(deal['Front Gross']);
  const back = money(deal['Back Gross']);
  const total = front != null || back != null ? (front || 0) + (back || 0) : money(deal['Gross Profit']);
  return { front, back, total };
}

/**
 * Deals dated in [from, to] (dealer-local days, w = windowFor(args)) matched to their leads.
 * @returns {{available: boolean, deals: number, matched: Array<{lead_id, deal_number, date, front, back, total}>,
 *   unmatched: number}}  available = the dealer has any DealerVault deal at all
 */
export async function matchedDealGross(dealerId, w, { Deals = collection('deals'), Leads = collection('leads') } = {}) {
  const forms = dealerForms(dealerId);
  const available = Boolean(await Deals.findOne({ dealer_id: { $in: forms } }, { projection: { _id: 1 } }));
  if (!available) return { available, deals: 0, matched: [], unmatched: 0 };
  const fields = { deal_number: 1, VIN: 1, vin: 1, 'Contract Date': 1, 'Delivery Date': 1, 'Front Gross': 1,
    'Back Gross': 1, 'Gross Profit': 1, 'Home Phone': 1, 'Cell Phone': 1, 'Work Phone': 1, 'Email 1': 1, 'Email 2': 1,
    'Email 3': 1 };
  const all = await Deals.find({ dealer_id: { $in: forms } }, { projection: fields }).toArray();
  const deals = all.map((d) => ({ d, at: dealDate(d['Contract Date'], w.tz) || dealDate(d['Delivery Date'], w.tz) }))
    .filter(({ at }) => at && at >= w.start && at <= w.end);
  if (!deals.length) return { available, deals: 0, matched: [], unmatched: 0 };

  const earliest = new Date(Math.min(...deals.map(({ at }) => at.getTime())) - MATCH_DAYS * 864e5);
  const leads = await Leads.find({ dealer_id: { $in: forms }, createdAt: { $gte: earliest, $lte: new Date(w.end.getTime() + 864e5) } },
    { projection: { phone: 1, email: 1, vin: 1, createdAt: 1 } }).toArray();
  const index = new Map();
  const put = (key, lead) => { if (!key) return; if (!index.has(key)) index.set(key, []); index.get(key).push(lead); };
  for (const l of leads) {
    if (digits(l.phone).length === 10) put(`p:${digits(l.phone)}`, l);
    if (email(l.email).includes('@')) put(`e:${email(l.email)}`, l);
    if (vinOf(l.vin).length >= 11) put(`v:${vinOf(l.vin)}`, l);
  }

  const matched = [];
  let unmatched = 0;
  for (const { d, at } of deals) {
    const keys = [
      vinOf(d.vin || d.VIN).length >= 11 ? `v:${vinOf(d.vin || d.VIN)}` : null,
      ...['Cell Phone', 'Home Phone', 'Work Phone'].map((f) => (digits(d[f]).length === 10 ? `p:${digits(d[f])}` : null)),
      ...['Email 1', 'Email 2', 'Email 3'].map((f) => (email(d[f]).includes('@') ? `e:${email(d[f])}` : null)),
    ].filter(Boolean);
    const latestBy = at.getTime() + 864e5; // the deal's whole day
    const candidates = keys.flatMap((k) => index.get(k) || [])
      .filter((l) => l.createdAt && l.createdAt.getTime() <= latestBy && l.createdAt.getTime() >= at.getTime() - MATCH_DAYS * 864e5);
    if (!candidates.length) { unmatched += 1; continue; }
    const lead = candidates.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    matched.push({ lead_id: String(lead._id), deal_number: d.deal_number || null, date: at, ...dealGrossValues(d) });
  }
  return { available, deals: deals.length, matched, unmatched };
}

/** DealerVault records of one dealer whose text date (first of `dateFields` that parses) falls in [w.start, w.end]. */
export async function dmsRecordsInRange(name, dealerId, w, dateFields, projection = {}, { db = null } = {}) {
  const coll = db ? db.collection(name) : collection(name);
  const fields = { ...projection, ...Object.fromEntries(dateFields.map((f) => [f, 1])) };
  const all = await coll.find({ dealer_id: { $in: dealerForms(dealerId) } }, { projection: fields }).toArray();
  const out = [];
  for (const r of all) {
    const at = dateFields.map((f) => dealDate(r[f], w.tz)).find(Boolean);
    if (at && at >= w.start && at <= w.end) out.push({ ...r, _at: at });
  }
  return out;
}
