// The Desk Log list: visits checked in during the picked dealer-local days, with their lead, people and latest note,
// filtered as the design's filter row does (department, lead type, lead source, salesperson, sales manager, BDC agent,
// search by name / phone / email / VIN / stock number) and by a manager view.
import mongoose from 'mongoose';
import DeskLogEntry from '../../models/DeskLogEntry.js';
import Lead from '../../models/Lead.js';
import { normalizeProvider } from '../reporting/normalize.js';
import { upType } from '../reporting/sourcePerformance.js';
import { localDayRange } from '../reporting/time.js';
import { staffNames, dealerForms } from '../reporting/kpis/common.js';
import { STALLED_MINUTES, UNSOLD_REASONS, isOpen, minutesInStage } from './deskLog.js';
import { dealDate } from '../reporting/dealGross.js';

export const VIEWS = Object.freeze({
  all: 'All visits',
  open: 'Still in the showroom (no outcome yet)',
  stalled: `Stalled (same stage for ${STALLED_MINUTES} minutes or more)`,
  no_next_step: 'No next step set',
  unsold_follow_up: 'Unsold - to follow up',
});

export const MAX_ROWS = 500;

const digits = (s) => String(s || '').replace(/\D/g, '');

function matchesSearch(row, q) {
  if (!q) return true;
  const text = q.toLowerCase();
  const d = digits(q);
  const hay = [row.customer, row.email, row.stock_number, row.vehicle?.vin, row.trade?.vin]
    .filter(Boolean).map((s) => String(s).toLowerCase());
  return hay.some((s) => s.includes(text)) || (d.length >= 4 && digits(row.phone).includes(d));
}

function inView(row, view, now) {
  if (view === 'open') return isOpen(row);
  if (view === 'stalled') return isOpen(row) && minutesInStage(row, now) >= STALLED_MINUTES;
  if (view === 'no_next_step') return (isOpen(row) || row.outcome === 'UNSOLD') && !row.next_step_at;
  if (view === 'unsold_follow_up') return row.outcome === 'UNSOLD' && row.unsold_reason !== UNSOLD_REASONS.DND;
  return true;
}

/**
 * @param {{dealerId: string, tz: string, from: string, to: string, view?: string, q?: string, filters?: object,
 *   now?: Date}} args  filters: { department, lead_type, source, salesperson_id, sales_manager_id, bdc_agent_id,
 *   stage, outcome }
 */
export async function deskLogList({ dealerId, tz, from, to, view = 'all', q = '', filters = {}, now = new Date() }) {
  const { start, end } = localDayRange(from, to, tz);
  const match = { dealer_id: String(dealerId), checked_in_at: { $gte: start, $lte: end } };
  if (filters.department) match.department = filters.department;
  for (const k of ['salesperson_id', 'sales_manager_id', 'bdc_agent_id']) {
    if (filters[k] && mongoose.isValidObjectId(filters[k])) match[k] = new mongoose.Types.ObjectId(filters[k]);
  }
  const entries = await DeskLogEntry.find(match).sort({ checked_in_at: -1, _id: -1 }).limit(MAX_ROWS * 2).lean();
  const leads = new Map((await Lead.find({ _id: { $in: entries.map((e) => e.lead_id) },
    dealer_id: { $in: dealerForms(dealerId) } })
    .select('name email phone contact_type lead_source source sub_source fe_lead_status customer_id vin')
    .lean()).map((l) => [String(l._id), l]));
  const names = await staffNames(entries.flatMap((e) => [e.salesperson_id, e.sales_manager_id, e.bdc_agent_id,
    ...(e.notes || []).map((n) => n.by)]).filter(Boolean).map(String), {});
  const name = (id) => (id ? names.get(String(id)) || null : null);

  const rows = [];
  const sources = new Set();
  for (const e of entries) {
    const lead = leads.get(String(e.lead_id));
    if (!lead) continue;
    const source = normalizeProvider(lead.lead_source, lead.source);
    sources.add(source);
    const latest = (e.notes || []).at(-1) || null;
    const row = {
      id: String(e._id), lead_id: String(e.lead_id), customer_id: lead.customer_id ? String(lead.customer_id) : null,
      customer: lead.name || '', phone: lead.phone || '', email: lead.email || '',
      lead_type: upType(lead), source, sub_source: lead.sub_source || null, lead_status: lead.fe_lead_status || null,
      department: e.department, checked_in_at: e.checked_in_at, stock_number: e.stock_number || null,
      vehicle: e.vehicle || {}, trade: e.trade || {},
      salesperson_id: e.salesperson_id ? String(e.salesperson_id) : null, salesperson: name(e.salesperson_id),
      sales_manager_id: e.sales_manager_id ? String(e.sales_manager_id) : null, sales_manager: name(e.sales_manager_id),
      bdc_agent_id: e.bdc_agent_id ? String(e.bdc_agent_id) : null, bdc_agent: name(e.bdc_agent_id),
      stage: e.stage || null, stage_at: e.stage_at || null, outcome: e.outcome || null,
      unsold_reason: e.unsold_reason || null, next_step_at: e.next_step_at || null,
      latest_note: latest ? { text: latest.text, at: latest.at, by: latest.by_name || name(latest.by) } : null,
      notes_count: (e.notes || []).length,
    };
    row.minutes_in_stage = isOpen(row) ? minutesInStage(row, now) : null;
    if (filters.lead_type && row.lead_type !== filters.lead_type) continue;
    if (filters.source && row.source !== filters.source) continue;
    // Stage and outcome filters (user, 13 Nov 2026). stage 'none' = no stage yet; outcome 'none' = still open.
    if (filters.stage && (filters.stage === 'none' ? row.stage : row.stage !== filters.stage)) continue;
    if (filters.outcome && (filters.outcome === 'none' ? row.outcome : row.outcome !== filters.outcome)) continue;
    if (!inView(row, view, now) || !matchesSearch(row, q)) continue;
    rows.push(row);
    if (rows.length >= MAX_ROWS) break;
  }
  await checkSoldAgainstDms(dealerId, rows, leads, tz);
  return { rows, sources: [...sources].sort((a, b) => a.localeCompare(b)), truncated: rows.length >= MAX_ROWS };
}

// G-016 "DMS-backed delivered verification; DMS discrepancies flagged": each SOLD visit is looked up in the dealer's
// DealerVault sales file (deals) - same VIN (the visit's vehicle or the lead's), phone (last 10 digits) or email, dated
// from 3 days before the check-in to 60 days after. row.dms = { found, delivered, date, deal_number, flag } where flag
// is 'not_in_dms' (SOLD DELIVERED but no deal yet) or 'dms_delivered' (still SOLD PENDING but the DMS shows it
// delivered). No DealerVault feed for the dealer: row.dms stays unset (nothing to compare with).
const last10 = (v) => digits(v).slice(-10);
const lower = (v) => String(v || '').trim().toLowerCase();
const upper = (v) => String(v || '').trim().toUpperCase();
export async function checkSoldAgainstDms(dealerId, rows, leads, tz, { Deals = mongoose.connection.db?.collection('deals') } = {}) {
  const sold = rows.filter((r) => r.outcome === 'SOLD PENDING' || r.outcome === 'SOLD DELIVERED');
  if (!sold.length || !Deals) return;
  const deals = await Deals.find({ dealer_id: { $in: dealerForms(dealerId) } }, { projection: { deal_number: 1, VIN: 1,
    vin: 1, 'Contract Date': 1, 'Delivery Date': 1, 'Cell Phone': 1, 'Home Phone': 1, 'Work Phone': 1, 'Email 1': 1,
    'Email 2': 1 } }).toArray();
  if (!deals.length) return;
  const index = new Map();
  const put = (k, d) => { if (!index.has(k)) index.set(k, []); index.get(k).push(d); };
  for (const d of deals) {
    d._delivered = dealDate(d['Delivery Date'], tz);
    d._at = d._delivered || dealDate(d['Contract Date'], tz);
    if (!d._at) continue;
    if (upper(d.VIN || d.vin).length >= 11) put(`v:${upper(d.VIN || d.vin)}`, d);
    for (const f of ['Cell Phone', 'Home Phone', 'Work Phone']) if (last10(d[f]).length === 10) put(`p:${last10(d[f])}`, d);
    for (const f of ['Email 1', 'Email 2']) if (lower(d[f]).includes('@')) put(`e:${lower(d[f])}`, d);
  }
  for (const r of sold) {
    const lead = leads.get(r.lead_id) || {};
    const keys = [upper(r.vehicle?.vin), upper(lead.vin)].filter((v) => v.length >= 11).map((v) => `v:${v}`);
    if (last10(r.phone).length === 10) keys.push(`p:${last10(r.phone)}`);
    if (lower(r.email).includes('@')) keys.push(`e:${lower(r.email)}`);
    const from = new Date(r.checked_in_at).getTime() - 3 * 864e5;
    const to = new Date(r.checked_in_at).getTime() + 60 * 864e5;
    const found = keys.flatMap((k) => index.get(k) || []).filter((d) => d._at.getTime() >= from && d._at.getTime() <= to)
      .sort((a, b) => b._at - a._at)[0];
    r.dms = found ? { found: true, delivered: Boolean(found._delivered), date: found._at, deal_number: found.deal_number || null }
      : { found: false };
    r.dms.flag = !found && r.outcome === 'SOLD DELIVERED' ? 'not_in_dms'
      : found?._delivered && r.outcome === 'SOLD PENDING' ? 'dms_delivered' : null;
  }
}

/** One entry with its full history and notes, people named. */
export async function deskLogDetail(entry) {
  const ids = [entry.salesperson_id, entry.sales_manager_id, entry.bdc_agent_id,
    ...(entry.history || []).map((h) => h.by), ...(entry.notes || []).map((n) => n.by)].filter(Boolean).map(String);
  const names = await staffNames(ids, {});
  const name = (id) => (id ? names.get(String(id)) || null : null);
  return {
    history: (entry.history || []).map((h) => ({ ...h, by: h.by_name || name(h.by) })).reverse(),
    notes: (entry.notes || []).map((n) => ({ text: n.text, at: n.at, by: n.by_name || name(n.by) })).reverse(),
  };
}
