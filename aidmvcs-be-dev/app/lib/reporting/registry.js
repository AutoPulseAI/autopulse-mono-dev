// KPI registry (SOW 3 Deliverable A / SOW 8 "Define numerator, denominator, timestamp, status inclusion, source table,
// and exclusion logic for every KPI"; P1 plan item 1). Each KPI has a written definition and one evaluator that
// returns the exact record IDs behind the number, so a card, its drill-down list, a CSV and the daily email can't
// disagree: count = ids.length. The "Definitions" page is rendered from listKpis().
//
// 'existing' KPIs are today's dashboard numbers, computed with the same rules as the code that serves them now
// (that code is not changed). 'new' KPIs come from this folder.
import Booking from '../../models/Booking.js';
import Lead from '../../models/Lead.js';
import { repliedLeadIds } from '../contactedLeads.js';
import { bookingShowed, leadStatuses } from '../appointmentFunnel.js';
import { attributeAppointments } from './appointmentAttribution.js';
import { replyCohorts } from './replyCohorts.js';
import { getDealerTimezone, localDayRange, toLocalDate } from './time.js';
import { DASHBOARDS, KIND, REPORT_KPIS, STATE } from './kpis/index.js';
import { median, pct } from './kpis/common.js';

const TZ_NOTE = 'Dealer-local calendar days (User.dealer_account_information.time_zone, default America/New_York).';

async function windowFor(args) {
  const tz = args.tz || await getDealerTimezone(args.dealerId);
  const from = toLocalDate(args.from, tz);
  const to = toLocalDate(args.to ?? args.from, tz);
  return { tz, from, to, ...localDayRange(from, to, tz) };
}

// One report run per (report, args) inside one runKpis call.
async function cached(ctx, key, fn) {
  if (!ctx.cache) ctx.cache = new Map();
  if (!ctx.cache.has(key)) ctx.cache.set(key, fn());
  return ctx.cache.get(key);
}

const replies = (args, ctx) => cached(ctx, 'reply_cohorts', () => replyCohorts(args));
const attribution = (args, ctx) => cached(ctx, `attr:${args.basis || 'created'}`,
  () => attributeAppointments({ ...args, basis: args.basis || 'created' }));

const unitIds = (report, pred) => report.units.filter(pred).map((u) => u.unit_key);

const KPIS = [
  // ---- existing dashboard numbers ------------------------------------------------------------------------------
  {
    id: 'leads.received', label: 'Leads received', grain: 'lead', status: 'existing', version: 1,
    dateBasis: 'Lead.createdAt (CRM "Lead Date")',
    numerator: 'Leads of the dealer whose createdAt is in the range.', denominator: null,
    exclusions: 'None.', source: ['leads'], usedBy: 'Dashboard "Today\'s Leads" / Total Leads (api/leads/stats)',
    evaluate: async (args) => {
      const w = await windowFor(args);
      const rows = await Lead.find({ dealer_id: String(args.dealerId), createdAt: { $gte: w.start, $lte: w.end } })
        .select('_id').lean();
      return rows.map((r) => String(r._id));
    },
  },
  {
    id: 'replies.leads_replied', label: 'Customer Replied (leads)', grain: 'lead', status: 'existing', version: 1,
    dateBasis: 'emails.timestamp of the customer message',
    numerator: 'Leads of the dealer (any lead date) with at least one inbound customer message in the range.',
    denominator: null,
    exclusions: 'Notes, the portal/ADF lead email (is_lead_email, ADF body), message_id "lead-..." (lead arrival).',
    source: ['emails', 'leads'], usedBy: 'Dashboard "Customer Replied" card (lib/contactedLeads.js repliedLeadIds)',
    evaluate: async (args) => {
      const w = await windowFor(args);
      const ids = (await Lead.find({ dealer_id: String(args.dealerId) }).select('_id').lean()).map((l) => l._id);
      return (await repliedLeadIds(ids, w.start, w.end)).map((r) => String(r._id));
    },
  },
  {
    id: 'appt.made', label: 'Appointments made', grain: 'booking', status: 'existing', version: 1,
    dateBasis: 'Booking.createdAt',
    numerator: 'Bookings of the dealer created in the range (any status).', denominator: null,
    exclusions: 'None (duplicates are counted; see appt.attr.total for the de-duplicated count).',
    source: ['bookings'], usedBy: 'Dashboard "Appointments Made" (lib/appointmentFunnel.js made)',
    evaluate: async (args) => {
      const w = await windowFor(args);
      const rows = await Booking.find({ dealer_id: String(args.dealerId), createdAt: { $gte: w.start, $lte: w.end } })
        .select('_id').lean();
      return rows.map((r) => String(r._id));
    },
  },
  {
    id: 'appt.scheduled', label: 'Appointments for these dates', grain: 'booking', status: 'existing', version: 1,
    dateBasis: 'Booking.bookingDate (dealer-local appointment day)',
    numerator: 'Bookings of the dealer set for a day in the range, not cancelled.', denominator: null,
    exclusions: 'booking_status cancelled.', source: ['bookings'],
    usedBy: 'Dashboard "Appointments for these dates" (lib/appointmentFunnel.js scheduled)',
    evaluate: async (args) => {
      const w = await windowFor(args);
      const rows = await Booking.find({ dealer_id: String(args.dealerId), booking_status: { $ne: 'cancelled' },
        bookingDate: { $gte: w.start, $lte: w.end } }).select('_id').lean();
      return rows.map((r) => String(r._id));
    },
  },
  {
    id: 'appt.shown', label: 'Showed', grain: 'booking', status: 'existing', version: 1,
    dateBasis: 'Booking.bookingDate',
    numerator: 'Scheduled bookings (appt.scheduled) marked showed, or completed, or whose lead is now Visited / '
      + 'Unsold / Sold / Sold Pending / Sold Delivered.',
    denominator: null,
    exclusions: 'Cancelled bookings. Note: the lead-status part reads the lead\'s CURRENT status.',
    source: ['bookings', 'leads'], usedBy: 'Dashboard "Showed" (lib/appointmentFunnel.js showed)',
    evaluate: async (args) => {
      const w = await windowFor(args);
      const scheduled = await Booking.find({ dealer_id: String(args.dealerId), booking_status: { $ne: 'cancelled' },
        bookingDate: { $gte: w.start, $lte: w.end } }).select('_id lead_id showed booking_status').lean();
      const status = await leadStatuses(scheduled.map((b) => b.lead_id));
      return scheduled.filter((b) => bookingShowed(b, status.get(String(b.lead_id)))).map((b) => String(b._id));
    },
  },

  // ---- new: customer reply cohorts (SOW 8B) ---------------------------------------------------------------------
  ...[
    ['replies.customers', 'Total customers replied', 'All (customer, day) pairs with a qualifying reply.',
      () => true],
    ['replies.todays_leads', "Replied from today's leads", 'Customer-days whose reply lead was received the same local '
      + 'day (age 0).', (u) => u.bucket === 'd0'],
    ['replies.past_leads', 'Replied from past leads', 'Customer-days whose reply lead is 1+ days old.',
      (u) => !['d0', 'needs_review'].includes(u.bucket)],
    ['replies.needs_review', 'Replies needing review', 'Customer-days whose reply could not be tied to one lead age '
      + '(no / unknown / other-dealer lead, lead after reply, or two leads with different ages that day).',
    (u) => u.bucket === 'needs_review'],
    ['replies.age_7_plus', 'Replied, lead 7+ days old (overlapping)', 'Customer-days with lead age >= 7.',
      (u) => ['d7_14', 'd15_29', 'd30_59', 'd60_plus'].includes(u.bucket)],
    ['replies.age_15_plus', 'Replied, lead 15+ days old (overlapping)', 'Customer-days with lead age >= 15.',
      (u) => ['d15_29', 'd30_59', 'd60_plus'].includes(u.bucket)],
    ['replies.age_30_plus', 'Replied, lead 30+ days old (overlapping)', 'Customer-days with lead age >= 30.',
      (u) => ['d30_59', 'd60_plus'].includes(u.bucket)],
    ['replies.age_60_plus', 'Replied, lead 60+ days old (overlapping)', 'Customer-days with lead age >= 60.',
      (u) => u.bucket === 'd60_plus'],
  ].map(([id, label, numerator, pred]) => ({
    id, label, grain: 'customer_day', status: 'new', version: 1,
    dateBasis: 'emails.timestamp of the reply; lead age from Lead.createdAt, both as dealer-local dates',
    numerator, denominator: null,
    exclusions: 'Staff / AI / automatic outbound messages, notes, delivery receipts, the portal/ADF lead email, '
      + 'message_id "lead-...". Customer = Customer.merged_into ?? Lead.customer_id ?? lead. Buckets 0, 1-6, '
      + '7-14, 15-29, 30-59, 60+, needs review sum to the total; the 7+/15+/30+/60+ cohorts overlap.',
    source: ['emails', 'leads', 'customers'], usedBy: 'Dealer dashboard reply section; daily email',
    evaluate: async (args, ctx) => unitIds(await replies(args, ctx), pred),
  })),
  {
    id: 'replies.inbound_messages', label: 'Inbound reply messages', grain: 'message', status: 'new', version: 1,
    dateBasis: 'emails.timestamp', numerator: 'Every qualifying inbound customer message in the range (not '
      + 'de-duplicated).', denominator: null, exclusions: 'As replies.customers.', source: ['emails'],
    usedBy: 'Dealer dashboard reply section',
    evaluate: async (args, ctx) => (await replies(args, ctx)).rows.map((r) => r.email_id),
  },

  // ---- new: appointment attribution (SOW 8A) -------------------------------------------------------------------
  ...[
    ['appt.attr.total', 'Total appointments', 'Bookings in the range, each ID once, duplicates excluded.', null],
    ['appt.attr.ai', 'AI appointments', 'Booking.created_by = ai.', ['ai']],
    ['appt.attr.ai_assisted', 'AI-assisted appointments', 'created_by = staff and an AI message (sms/email, not a '
      + 'note, sent or delivered) went to the same lead before the booking was created.', ['ai_assisted']],
    ['appt.attr.human_only', 'Human-only appointments', 'created_by = staff with no such AI message.',
      ['human_only']],
    ['appt.attr.unknown', 'Unknown attribution', 'created_by missing or customer (public booking page), or the lead '
      + 'is gone.', ['unknown']],
    ['appt.attr.ai_influenced', 'AI-influenced appointments', 'AI + AI-assisted (a subtotal, not a category).',
      ['ai', 'ai_assisted']],
  ].map(([id, label, numerator, cats]) => ({
    id, label, grain: 'booking', status: 'new', version: 1,
    dateBasis: "Booking.createdAt (basis 'created', default) or Booking.bookingDate, not cancelled ('scheduled')",
    numerator, denominator: null,
    exclusions: 'Duplicate bookings: same lead + day + time, not cancelled - the lowest id counts. n8n / legacy '
      + 'auto replies never count as AI.',
    source: ['bookings', 'emails', 'leads'], usedBy: 'Appointments report; daily email',
    evaluate: async (args, ctx) => (await attribution(args, ctx)).rows
      .filter((r) => !cats || cats.includes(r.category)).map((r) => r.booking_id),
  })),
];

// ---- the Reports page KPIs (app/lib/reporting/kpis/*, one module per tab) ---------------------------------------
// state 'live' = computed now; 'blocked' (waits on other work, e.g. the Desk Log) and 'needs_data' (the data isn't
// recorded yet) are listed with their definitions and the reason, and never return a number.
for (const k of REPORT_KPIS) KPIS.push({ status: 'new', version: 1, state: STATE.LIVE, kind: KIND.COUNT, ...k });

// What the older (non-tab) KPIs' definitions come from.
for (const k of KPIS) {
  if (k.basedOn) continue;
  if (k.status === 'existing') k.basedOn = `Existing ${k.usedBy}.`;
  else if (k.id.startsWith('replies.')) k.basedOn = 'SOW §8B Deliverable F3: customer reply cohorts.';
  else if (k.id.startsWith('appt.attr.')) k.basedOn = 'SOW §8A Deliverable F2: appointment attribution.';
}

const BY_ID = new Map(KPIS.map((k) => [k.id, k]));

function definition(k) {
  const def = { ...k, timezone: TZ_NOTE };
  delete def.evaluate;
  if (!def.state) def.state = STATE.LIVE;
  return def;
}

export { DASHBOARDS, STATE, KIND };

export function listDashboards() {
  return DASHBOARDS.map((d) => ({ ...d }));
}

// The KPIs of one Reports tab, in registry order.
export function kpisForDashboard(dashboard) {
  return KPIS.filter((k) => k.dashboard === dashboard).map(definition);
}

const FILTER_KEYS = ['source', 'lead_source', 'assigned_to', 'actor', 'appointment_type', 'channel'];

// Filters the caller set that this KPI can't apply (shown next to its number; never silently dropped).
export function ignoredFilters(k, spec = {}) {
  return FILTER_KEYS.filter((f) => spec[f] != null && !(Array.isArray(spec[f]) && !spec[f].length)
    && !(k.filters || []).includes(f));
}

function groupCounts(rows, by) {
  const m = new Map();
  for (const r of rows) {
    const key = r._g?.[by] ?? 'Unknown';
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m.entries()].map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function dayCounts(rows) {
  const m = {};
  for (const r of rows) if (r._day) m[r._day] = (m[r._day] || 0) + 1;
  return m;
}

/**
 * Evaluate a Reports-page KPI with its rows. args: { dealerId, from, to, tz, spec, now }.
 * @returns {Promise<{id, state, reason?, kind, grain, unit, value, count, ids, numerator?, denominator?, rows,
 *   denominatorRows?, breakdowns, trend, ignored_filters}>}
 */
export async function evaluateKpi(id, args, ctx = {}) {
  const k = BY_ID.get(id);
  if (!k) throw new Error(`unknown KPI "${id}"`);
  const base = { id, state: k.state || STATE.LIVE, kind: k.kind || KIND.COUNT, grain: k.grain, unit: k.unit || null,
    ignored_filters: ignoredFilters(k, args.spec || {}) };
  if (base.state !== STATE.LIVE) {
    return { ...base, reason: k.reason, value: null, count: null, ids: null, rows: null, breakdowns: {}, trend: null };
  }
  const out = await k.evaluate({ ...args, spec: args.spec || {} }, ctx);
  const rows = Array.isArray(out) ? out.map((i) => ({ id: String(i), _g: {} })) : out.rows;
  const ids = rows.map((r) => String(r.id));
  if (new Set(ids).size !== ids.length) throw new Error(`${id}: duplicate row ids`);
  const res = { ...base, count: ids.length, ids, rows, breakdowns: {}, trend: k.trend ? dayCounts(rows) : null };
  if (res.kind === KIND.RATE) {
    const den = out.denominatorRows || [];
    const denIds = new Set(den.map((r) => String(r.id)));
    if (!ids.every((i) => denIds.has(i))) throw new Error(`${id}: numerator not inside denominator`);
    res.denominatorRows = den;
    res.numerator = { count: ids.length };
    res.denominator = { count: den.length, ids: den.map((r) => String(r.id)) };
    res.value = pct(ids.length, den.length);
  } else if (res.kind === KIND.MEDIAN) {
    res.value = median(rows.map((r) => Number(r.minutes)));
  } else {
    res.value = ids.length;
  }
  for (const by of k.breakdowns || []) res.breakdowns[by] = groupCounts(rows, by);
  return res;
}

// Whether a KPI's records are tied to leads (its rows carry lead_id, or lead_ids for customer rows): only those
// numbers open the Leads list (/dealer/leads?report_kpi=<id>). Import errors, clicks, campaign totals... are not.
export function isLeadLinked(def) {
  return Boolean(def && def.dashboard && (def.state || STATE.LIVE) === STATE.LIVE
    && (def.columns || []).some(([key]) => key === 'lead_id' || key === 'lead_ids'));
}

// Definitions only (no functions), for the Definitions page and CSV.
export function listKpis() {
  return KPIS.map(definition);
}

export function getKpi(id) {
  const k = BY_ID.get(id);
  return k ? definition(k) : null;
}

/**
 * @param {string} id
 * @param {{dealerId: string, from: string, to?: string, filters?: object, basis?: string, tz?: string}} args
 * @returns {Promise<{id: string, grain: string, ids: string[], count: number}>}
 */
export async function runKpi(id, args, ctx = {}) {
  const k = BY_ID.get(id);
  if (!k) throw new Error(`unknown KPI "${id}"`);
  if (k.dashboard) {
    const r = await evaluateKpi(id, args, ctx);
    const { rows, denominatorRows, ...rest } = r; // eslint-disable-line no-unused-vars
    return rest;
  }
  const ids = await k.evaluate(args, ctx);
  return { id, grain: k.grain, ids, count: ids.length };
}

export async function runKpis(ids, args) {
  const ctx = {};
  const out = {};
  for (const id of ids) out[id] = await runKpi(id, args, ctx);
  return out;
}

