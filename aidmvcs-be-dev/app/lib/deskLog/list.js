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
    .select('name email phone contact_type lead_source source sub_source fe_lead_status customer_id')
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
  return { rows, sources: [...sources].sort((a, b) => a.localeCompare(b)), truncated: rows.length >= MAX_ROWS };
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
