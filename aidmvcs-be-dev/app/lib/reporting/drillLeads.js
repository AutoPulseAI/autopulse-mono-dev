// The leads behind the dashboard's "Customer replies by lead age" cards and the "Appointments made" split, for
// /dealer/leads?reply_cohort=... / ?appt_attribution=... (the cards open the list, like every other dashboard card).
//
// reply_cohort  one lead per counted customer-day unit of replyCohorts() (./replyCohorts.js): the lead the unit's
//               latest reply that day was attributed to. A customer who replied on several days of the range is one
//               unit per day on the card but one lead in the list. Needs-review units (no lead, or no single lead) are
//               counted on "Total Customers Replied" but not listed - the list says how many.
// appt_attribution  the leads of the bookings attributeAppointments() (./appointmentAttribution.js, basis 'created')
//               puts in that category. Several bookings on one lead are one lead; a booking whose lead is gone is
//               counted but not listed.
// report_kpi   the leads behind a Reports-page number (app/lib/reporting/registry.js evaluateKpi rows): a lead row is
//               its lead; a booking / message / task row is its lead; a customer row is its leads (lead_ids). Several
//               records on one lead are one lead in the list.
// Pure: the routes run the reports and pass them in.

export const REPLY_COHORTS = Object.freeze({
  today: { buckets: ['d0'], label: "Replied — today's leads" },
  past: { buckets: ['d1_6', 'd7_14', 'd15_29', 'd30_59', 'd60_plus'], label: 'Replied — past leads' },
  all: { buckets: ['d0', 'd1_6', 'd7_14', 'd15_29', 'd30_59', 'd60_plus', 'needs_review'], label: 'Customers replied' },
  d7: { buckets: ['d7_14', 'd15_29', 'd30_59', 'd60_plus'], label: 'Replied — lead 7+ days old' },
  d15: { buckets: ['d15_29', 'd30_59', 'd60_plus'], label: 'Replied — lead 15+ days old' },
  d30: { buckets: ['d30_59', 'd60_plus'], label: 'Replied — lead 30+ days old' },
  d60: { buckets: ['d60_plus'], label: 'Replied — lead 60+ days old' },
  b0: { buckets: ['d0'], label: 'Replied — lead 0 days old (today)' },
  b1_6: { buckets: ['d1_6'], label: 'Replied — lead 1-6 days old' },
  b7_14: { buckets: ['d7_14'], label: 'Replied — lead 7-14 days old' },
  b15_29: { buckets: ['d15_29'], label: 'Replied — lead 15-29 days old' },
  b30_59: { buckets: ['d30_59'], label: 'Replied — lead 30-59 days old' },
  b60: { buckets: ['d60_plus'], label: 'Replied — lead 60+ days old' },
});

export const APPT_ATTRIBUTION = Object.freeze({
  ai: 'Appointments made by AI',
  ai_assisted: 'Appointments made AI-assisted',
  human_only: 'Appointments made human-only',
  unknown: 'Appointments made, unknown',
});

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {{units: Array, rows: Array}} report  replyCohorts() result (units and rows included)
 * @param {string} key  a key of REPLY_COHORTS
 * @returns {{card_count: number, lead_ids: string[], needs_review: number, repeat_days: number} | null}
 */
export function replyCohortLeads(report, key) {
  const def = REPLY_COHORTS[key];
  if (!Object.hasOwn(REPLY_COHORTS, key)) return null;
  const wanted = new Set(def.buckets);
  // Latest attributed reply per unit.
  const latest = new Map();
  for (const row of report.rows || []) {
    if (!row.lead_id) continue;
    const cur = latest.get(row.unit_key);
    if (!cur || new Date(row.reply_at) > new Date(cur.reply_at)) latest.set(row.unit_key, row);
  }
  let card = 0;
  let needsReview = 0;
  let listedUnits = 0;
  const ids = new Set();
  for (const u of report.units || []) {
    if (!wanted.has(u.bucket)) continue;
    card += 1;
    if (u.bucket === 'needs_review') { needsReview += 1; continue; }
    const row = latest.get(u.unit_key);
    if (!row) { needsReview += 1; continue; }
    listedUnits += 1;
    ids.add(String(row.lead_id));
  }
  return { card_count: card, lead_ids: [...ids], needs_review: needsReview, repeat_days: listedUnits - ids.size };
}

/**
 * @param {{rows: Array}} report  attributeAppointments() result
 * @param {string} key  a key of APPT_ATTRIBUTION
 * @returns {{card_count: number, lead_ids: string[]} | null}
 */
export function apptAttributionLeads(report, key) {
  if (!Object.hasOwn(APPT_ATTRIBUTION, key)) return null;
  const rows = (report.rows || []).filter((r) => r.category === key);
  return { card_count: rows.length, lead_ids: [...new Set(rows.map((r) => String(r.lead_id)))] };
}

// The small note under the list's filter chip: why the list can be shorter than the card.
export function replyDrillNote({ needs_review: review, repeat_days: repeat }) {
  const parts = [];
  if (review) parts.push(`${plural(review, 'customer needs', 'customers need')} review (no single lead) and ${review === 1 ? 'is' : 'are'} not listed`);
  if (repeat) parts.push(`${plural(repeat, 'repeat day', 'repeat days')} of the same lead ${repeat === 1 ? 'is' : 'are'} listed once`);
  return parts.join('; ');
}

// card_count bookings; `listed` distinct leads found in the dealer's list; `missing` bookings whose lead is not there.
export function apptDrillNote({ card_count: card, listed, missing }) {
  const parts = [];
  if (missing) parts.push(`${plural(missing, 'booking has', 'bookings have')} no lead in the list`);
  const shared = card - missing - listed;
  if (shared > 0) parts.push(`${plural(shared, 'more booking is', 'more bookings are')} on a lead already listed`);
  return parts.join('; ');
}

// What one record of a Reports KPI is called, for the list's note.
const GRAIN_NOUNS = { lead: ['lead', 'leads'], booking: ['appointment', 'appointments'], message: ['message', 'messages'],
  customer: ['customer', 'customers'], call_task: ['call task', 'call tasks'], ai_touch: ['AI message', 'AI messages'],
  activity: ['takeover', 'takeovers'], service_event: ['reminder', 'reminders'], consent_event: ['opt-out', 'opt-outs'],
  send_check: ['blocked send', 'blocked sends'], campaign_recipient: ['campaign recipient', 'campaign recipients'] };

/**
 * @param {Array<{lead_id?: string, lead_ids?: string}>} rows  a KPI's rows (numerator or denominator)
 * @returns {{card_count: number, lead_ids: string[], no_lead: number}}
 */
export function reportKpiLeads(rows) {
  const ids = new Set();
  let noLead = 0;
  for (const r of rows || []) {
    const own = r.lead_id ? [String(r.lead_id)] : String(r.lead_ids || '').split(/\s+/).filter(Boolean);
    if (!own.length) noLead += 1;
    for (const id of own) ids.add(id);
  }
  return { card_count: (rows || []).length, lead_ids: [...ids], no_lead: noLead };
}

// card_count records; `listed` leads in the dealer's list; `missing` records none of whose leads is there.
export function reportDrillNote({ grain, card_count: card, listed, missing }) {
  const [one, many] = GRAIN_NOUNS[grain] || ['record', 'records'];
  const parts = [];
  if (missing) parts.push(`${plural(missing, `${one} has`, `${many} have`)} no lead in the list`);
  if (grain !== 'lead' && grain !== 'customer') {
    const shared = card - missing - listed;
    if (shared > 0) parts.push(`${plural(shared, `more ${one} is`, `more ${many} are`)} on a lead already listed`);
  }
  if (grain === 'customer' && listed > card - missing) parts.push('a customer with several leads shows each lead');
  return parts.join('; ');
}
