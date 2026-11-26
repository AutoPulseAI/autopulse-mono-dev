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
import { leadStatusLabel } from '../statusLabels.js';
import TradeIn from '../../models/TradeIn.js';
import { latestLeadNotes, outcomeForLeadStatus } from './sync.js';

export const VIEWS = Object.freeze({
  all: 'All visits',
  open: 'Still in the showroom (no outcome yet)',
  stalled: `Stalled (same stage for ${STALLED_MINUTES} minutes or more)`,
  no_next_step: 'No next step set',
  unsold_follow_up: 'Unsold - to follow up',
  handoff: 'Handed to a manager',
});

// Visits read for one list (18 Nov 2026: paged - the page shows PAGE_SIZES rows at a time, newest first). A range with
// more visits than this says so (truncated) and asks for fewer days.
export const MAX_ROWS = 5000;
export const PAGE_SIZES = Object.freeze([25, 50, 100]);

const digits = (s) => String(s || '').replace(/\D/g, '');

function matchesSearch(row, q) {
  if (!q) return true;
  const text = q.toLowerCase();
  const d = digits(q);
  const hay = [row.customer, row.email, row.stock_number, row.vehicle?.vin, row.trade?.vin, row.lead_id,
    [row.vehicle?.year, row.vehicle?.make, row.vehicle?.model].filter(Boolean).join(' ')]
    .filter(Boolean).map((s) => String(s).toLowerCase());
  return hay.some((s) => s.includes(text)) || (d.length >= 4 && digits(row.phone).includes(d));
}

function inView(row, view, now) {
  if (view === 'open') return isOpen(row);
  if (view === 'stalled') return isOpen(row) && minutesInStage(row, now) >= STALLED_MINUTES;
  if (view === 'no_next_step') return (isOpen(row) || row.outcome === 'UNSOLD') && !row.next_step_at;
  if (view === 'unsold_follow_up') return row.outcome === 'UNSOLD' && row.unsold_reason !== UNSOLD_REASONS.DND;
  if (view === 'handoff') return Boolean(row.handoff);
  return true;
}

/**
 * @param {{dealerId: string, tz: string, from: string, to: string, view?: string, q?: string, filters?: object,
 *   now?: Date}} args  filters: { department, lead_type, source, salesperson_id, sales_manager_id, bdc_agent_id,
 *   stage, outcome }
 */
export async function deskLogList({ dealerId, tz, from, to, view = 'all', q = '', filters = {}, now = new Date(),
  page = 1, limit = PAGE_SIZES[0] }) {
  const { start, end } = localDayRange(from, to, tz);
  const match = { dealer_id: String(dealerId), checked_in_at: { $gte: start, $lte: end } };
  if (filters.department) match.department = filters.department;
  // The BDC agent is the lead's owner (filtered below, on the lead).
  for (const k of ['salesperson_id', 'sales_manager_id']) {
    if (filters[k] && mongoose.isValidObjectId(filters[k])) match[k] = new mongoose.Types.ObjectId(filters[k]);
  }
  const entries = await DeskLogEntry.find(match).sort({ checked_in_at: -1, _id: -1 }).limit(MAX_ROWS).lean();
  const leads = new Map((await Lead.find({ _id: { $in: entries.map((e) => e.lead_id) },
    dealer_id: { $in: dealerForms(dealerId) } })
    .select('name email phone contact_type lead_source source sub_source fe_lead_status customer_id vin appointment_showed_at booking.booking_at '
      + 'assigned_to vehicle_year vehicle_make vehicle_model statusChangedAt unsold_reason')
    .lean()).map((l) => [String(l._id), l]));
  // 18 Nov 2026 - one value everywhere, read where it lives:
  //   trade: the lead's / customer's open trade-in now (unless it was changed on this visit);
  //   notes: the newest of the visit's notes and the staff notes on the lead's conversation.
  const leadIdList = [...leads.keys()];
  const customerIds = [...leads.values()].map((l) => l.customer_id).filter(Boolean);
  const trades = await TradeIn.find({ dealer_id: String(dealerId), status: 'open',
    $or: [{ lead_id: { $in: leadIdList } }, ...(customerIds.length ? [{ customer_id: { $in: customerIds } }] : [])] })
    .sort({ updatedAt: -1 }).select('lead_id customer_id year make model trim vin').lean().catch(() => []);
  // The trade the customer told the AI about in the conversation (agentic-upsell slots: qualification_facts
  // trade_in.year / make / model / mileage, current values only), when nobody has added a trade-in record yet
  // (Betsy, 25 Nov 2026: "she traded in her GMC - I saw that in the conversation" but the Trade column was empty).
  const convTrades = await conversationTrades(customerIds, leadIdList).catch(() => new Map());
  const tradeOf = (lead) => trades.find((t) => String(t.lead_id) === String(lead._id))
    || trades.find((t) => lead.customer_id && String(t.customer_id) === String(lead.customer_id))
    || (lead.customer_id && convTrades.get(String(lead.customer_id))) || null;
  const leadNotes = await latestLeadNotes(leadIdList);
  const latestVisitOfLead = new Set();
  // Handoffs (SOW Deliverable C manager view): the lead is waiting for a manager - Managerial Review, or the AI handed
  // it over and nobody has picked it up yet (ai_lead_state, the same as AI Assistant > Dealer Action Required).
  const handed = new Map((await mongoose.connection.db.collection('ai_lead_state').find(
    { lead_id: { $in: entries.map((e) => String(e.lead_id)) }, status: 'handoff' },
    { projection: { lead_id: 1, status_reason: 1, status_at: 1 } }).toArray()).map((s) => [String(s.lead_id), s]));
  const names = await staffNames([...entries.flatMap((e) => [e.salesperson_id, e.sales_manager_id,
    ...(e.notes || []).map((n) => n.by)]), ...[...leads.values()].map((l) => l.assigned_to)].filter(Boolean).map(String), {});
  const name = (id) => (id ? names.get(String(id)) || null : null);

  const rows = [];
  const sources = new Set();
  for (const e of entries) {
    const lead = leads.get(String(e.lead_id));
    if (!lead) continue;
    const source = normalizeProvider(lead.lead_source, lead.source);
    sources.add(source);
    const visitNote = (e.notes || []).at(-1) || null;
    const leadNote = leadNotes.get(String(e.lead_id)) || null;
    const latest = leadNote && (!visitNote || new Date(leadNote.at) > new Date(visitNote.at))
      ? { text: leadNote.text, at: leadNote.at, by_name: leadNote.by, from_lead: true } : visitNote;
    const edited = (prefix) => (e.history || []).some((h) => String(h.field || '').startsWith(`${prefix}.`));
    // Year / Make / Model: the car on the deal (picked by stock #, or changed on this visit), else the lead's vehicle
    // of interest as it is now.
    const leadCar = { year: lead.vehicle_year || null, make: lead.vehicle_make || null, model: lead.vehicle_model || null,
      vin: lead.vin || null };
    const vehicle = e.stock_number || edited('vehicle') || !(leadCar.year || leadCar.make || leadCar.model)
      ? e.vehicle || {} : leadCar;
    const t = edited('trade') ? null : tradeOf(lead);
    const trade = t ? { year: t.year ?? null, make: t.make ?? null, model: t.model ?? null, trim: t.trim ?? null, vin: t.vin ?? null,
      ...(t.from_conversation ? { from_conversation: true, mileage: t.mileage ?? null } : {}) }
      : e.trade || {};
    // The outcome set on the Leads page after this visit (before 18 Nov 2026 it wasn't written to the visit): the
    // lead's newest visit shows it.
    const firstOfLead = !latestVisitOfLead.has(String(e.lead_id));
    latestVisitOfLead.add(String(e.lead_id));
    const fromLead = !e.outcome && firstOfLead && lead.statusChangedAt && new Date(lead.statusChangedAt) >= new Date(e.checked_in_at)
      ? outcomeForLeadStatus(lead.fe_lead_status, lead.unsold_reason) : null;
    const row = {
      id: String(e._id), lead_id: String(e.lead_id), customer_id: lead.customer_id ? String(lead.customer_id) : null,
      customer: lead.name || '', phone: lead.phone || '', email: lead.email || '',
      lead_type: upType(lead), source, sub_source: lead.sub_source || null, lead_status: lead.fe_lead_status || null,
      lead_status_label: leadStatusLabel(lead) || null,
      department: e.department, checked_in_at: e.checked_in_at, stock_number: e.stock_number || null,
      vehicle, trade, created_via: e.created_via || 'desk_log',
      salesperson_id: e.salesperson_id ? String(e.salesperson_id) : null, salesperson: name(e.salesperson_id),
      sales_manager_id: e.sales_manager_id ? String(e.sales_manager_id) : null, sales_manager: name(e.sales_manager_id),
      bdc_agent_id: lead.assigned_to ? String(lead.assigned_to) : null, bdc_agent: name(lead.assigned_to),
      stage: e.stage || null, stage_at: e.stage_at || null, outcome: e.outcome || fromLead?.outcome || null,
      unsold_reason: e.unsold_reason || fromLead?.unsold_reason || null, outcome_from_lead: Boolean(fromLead),
      next_step_at: e.next_step_at || null,
      latest_note: latest ? { text: latest.text, at: latest.at, by: latest.by_name || name(latest.by),
        from_lead: Boolean(latest.from_lead) } : null,
      notes_count: (e.notes || []).length,
      updated_at: e.updatedAt || null,
      checklist: (e.checklist || []).length ? { done: e.checklist.filter((c) => c.done).length, total: e.checklist.length } : null,
      car_finder_matches: (e.car_finder_matches || []).length,
      handoff: lead.fe_lead_status === 'Managerial Review' || handed.has(String(e.lead_id))
        ? { reason: handed.get(String(e.lead_id))?.status_reason || 'Managerial Review',
          at: handed.get(String(e.lead_id))?.status_at || null } : null,
    };
    row.minutes_in_stage = isOpen(row) ? minutesInStage(row, now) : null;
    if (filters.lead_type && row.lead_type !== filters.lead_type) continue;
    if (filters.bdc_agent_id && row.bdc_agent_id !== String(filters.bdc_agent_id)) continue;
    if (filters.source && row.source !== filters.source) continue;
    // Stage and outcome filters (user, 13 Nov 2026). stage 'none' = no stage yet; outcome 'none' = still open.
    if (filters.stage && (filters.stage === 'none' ? row.stage : row.stage !== filters.stage)) continue;
    if (filters.outcome) {
      const [outcome, reason] = filters.outcome.split('|');
      if (outcome === 'none' ? row.outcome : (row.outcome !== outcome || (reason && row.unsold_reason !== reason))) continue;
    }
    // DND customers only / hidden (Betsy's filter row, 13 Nov 2026 meeting).
    const isDnd = row.lead_status === 'DND' || row.unsold_reason === UNSOLD_REASONS.DND;
    if (filters.dnd === 'only' && !isDnd) continue;
    if (filters.dnd === 'exclude' && isDnd) continue;
    if (!inView(row, view, now) || !matchesSearch(row, q)) continue;
    rows.push(row);
  }
  // One page of the matching visits; the DMS check runs for the rows shown.
  const size = PAGE_SIZES.includes(Number(limit)) ? Number(limit) : PAGE_SIZES[0];
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  const shown = rows.slice((at - 1) * size, at * size);
  await checkSoldAgainstDms(dealerId, shown, leads, tz);
  return { rows: shown, total: rows.length, page: at, pages, limit: size,
    sources: [...sources].sort((a, b) => a.localeCompare(b)), truncated: entries.length >= MAX_ROWS };
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

// customer id -> { year, make, model, mileage, from_conversation } from the AI's current trade-in facts.
export async function conversationTrades(customerIds, leadIds = [], { db = mongoose.connection.db } = {}) {
  const ids = [...new Set(customerIds.map(String))];
  if (!ids.length || !db) return new Map();
  const facts = await db.collection('qualification_facts').find({
    customer_id: { $in: [...ids, ...ids.filter((i) => mongoose.isValidObjectId(i)).map((i) => new mongoose.Types.ObjectId(i))] },
    path: { $in: ['trade_in.year', 'trade_in.make', 'trade_in.model', 'trade_in.mileage'] }, valid_to: null,
    lead_id: { $in: [null, ...leadIds.map(String)] },
  }, { projection: { customer_id: 1, path: 1, value: 1 } }).toArray();
  const out = new Map();
  for (const f of facts) {
    const k = String(f.customer_id);
    if (!out.has(k)) out.set(k, { from_conversation: true });
    out.get(k)[f.path.slice('trade_in.'.length)] = f.value ?? null;
  }
  for (const [k, t] of out) if (!(t.year || t.make || t.model)) out.delete(k);
  return out;
}
