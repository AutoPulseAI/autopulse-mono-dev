// One governed vocabulary for lead statuses and lead sources in reports (SOW 3 Deliverable A, G-003; P1 plan item 1:
// "Legacy status values: fix them in the data AND map them in reports"). Pure: no database access, so the reports,
// the Definitions page and scripts/normalize-legacy-statuses.js all use the same tables.
//
// Status vocabularies found in the code (Nov 2026):
//   stored, current   app/dealer/leads/components/LeadList.js statusOptions (the client's list, scope 16) plus
//                     'Opted Out' (written by the AI's opt-out, app/lib/ai/aiDnd.js AI_OPT_OUT_STATUSES, and offered in
//                     StatusModal.js). 'Opted Out' and 'DND' are both governed: a customer message moves 'Opted Out'
//                     back to a working status (aiDnd.js WORKING_FROM), 'DND' stays - so the data fix never merges them.
//   display labels    app/lib/statusLabels.js (e.g. 'Appointment Set', 'Sales Visit', 'Opt-Out'): display only, but a
//                     label typed into an import or an API call can end up stored.
//   legacy            'Contacted' (old workflow; app/api/leads/stats/route.js:251, reportGenerator.js:244), 'visited'
//                     (lower case; leads/stats/route.js:252, reportGenerator.js:248), 'Sold' (appointmentFunnel.js:13,
//                     aiDnd.js, aiStaff.js), 'New' (aiDnd.js WORKING_FROM), 'Closed Lost' (aiDnd.js
//                     CLOSED_LOST_STATUSES), 'Deal Close' (dealer/settings/components/FollowupSettings.js).
//   raw lead.status   'ADF Lead', 'converted' (api/vendors/admin-stats) - a different field; reports never use it.
//   AI stage          ai_lead_state.stage snake_case (agentic-upsell agent/lifecycle.py) - mapped by aiStageGroup().
//   booking status    bookings.booking_status pending / confirmed / cancelled / completed (models/Booking.js).

// The governed stored values (what the data fix converges on).
export const GOVERNED_STATUSES = Object.freeze([
  'Lead',
  'Lead Not Contacted',
  'Contacted - No Next Action',
  'Contacted - Specific Follow-up',
  'Appointment Booked',
  'No Show',
  'Visited',
  'DND',
  'Opted Out',
  'Managerial Review',
  'Sold Pending',
  'Sold Delivered',
  'Unsold',
  'Closed - Lost',
  'Closed - No Longer Owns',
]);

// Report groups (the normalised lifecycle, design note A-F 2.2).
export const STATUS_GROUPS = Object.freeze({
  NEW: 'New',
  WORKING: 'Working',
  APPT_SET: 'Appointment set',
  NO_SHOW: 'No show',
  VISITED: 'Visited',
  SOLD_PENDING: 'Sold pending',
  SOLD_DELIVERED: 'Sold delivered',
  SOLD_UNSPECIFIED: 'Sold (legacy, pending or delivered not recorded)',
  UNSOLD: 'Unsold',
  ESCALATED: 'Dealership action required',
  OPTED_OUT: 'Opted out',
  CLOSED_LOST: 'Closed lost',
  CLOSED_NLO: 'Closed - no longer owns',
  UNKNOWN: 'Unknown / missing',
});

const GROUP_OF_GOVERNED = Object.freeze({
  'Lead': 'NEW',
  'Lead Not Contacted': 'NEW',
  'Contacted - No Next Action': 'WORKING',
  'Contacted - Specific Follow-up': 'WORKING',
  'Appointment Booked': 'APPT_SET',
  'No Show': 'NO_SHOW',
  'Visited': 'VISITED',
  'DND': 'OPTED_OUT',
  'Opted Out': 'OPTED_OUT',
  'Managerial Review': 'ESCALATED',
  'Sold Pending': 'SOLD_PENDING',
  'Sold Delivered': 'SOLD_DELIVERED',
  'Unsold': 'UNSOLD',
  'Closed - Lost': 'CLOSED_LOST',
  'Closed - No Longer Owns': 'CLOSED_NLO',
});

// Legacy stored values -> the governed value the data fix writes, or null when a person must decide.
export const LEGACY_STATUS_MAP = Object.freeze({
  'Contacted': 'Contacted - No Next Action',
  'New': 'Lead',
  'Closed Lost': 'Closed - Lost',
  // Display labels (app/lib/statusLabels.js) stored as if they were values.
  'New Lead': 'Lead',
  'No Contact Made': 'Lead Not Contacted',
  'Contact Made - No Next Action': 'Contacted - No Next Action',
  'Contact Made - Follow Up Assigned': 'Contacted - Specific Follow-up',
  'Appointment Set': 'Appointment Booked',
  'Appointment No Show': 'No Show',
  'Sales Visit': 'Visited',
  'Sold - Delivered': 'Sold Delivered',
  'Opt-Out': 'DND',
  'Dealership Action Required': 'Managerial Review',
  'Customer Replied': 'Contacted - No Next Action',
  // Ambiguous: no rule says whether an old "Sold" was delivered, or what "Deal Close" meant.
  'Sold': null,
  'Deal Close': null,
});

// Report group for legacy values the data fix can't convert by itself.
const GROUP_OF_AMBIGUOUS = Object.freeze({ 'Sold': 'SOLD_UNSPECIFIED', 'Deal Close': 'UNKNOWN' });

const SOLD_GROUPS = new Set(['SOLD_PENDING', 'SOLD_DELIVERED', 'SOLD_UNSPECIFIED']);

const squash = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
const GOVERNED_BY_KEY = new Map(GOVERNED_STATUSES.map((s) => [squash(s), s]));
const LEGACY_BY_KEY = new Map(Object.keys(LEGACY_STATUS_MAP).map((s) => [squash(s), s]));

/**
 * Normalise one stored fe_lead_status.
 * @returns {{ raw, governed: string|null, group: string, label: string, legacy: boolean, fix: string|null,
 *   needs_review: boolean }}
 *   governed  the governed value it is (or becomes); null when unknown / ambiguous
 *   legacy    the stored value is not exactly a governed value
 *   fix       the value the data fix would write (null: no change, or a person must decide)
 */
export function normalizeStatus(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { raw: raw ?? null, governed: null, group: 'UNKNOWN', label: STATUS_GROUPS.UNKNOWN, legacy: false,
      fix: null, needs_review: true };
  }
  const value = String(raw);
  if (GOVERNED_STATUSES.includes(value)) {
    const group = GROUP_OF_GOVERNED[value];
    return { raw: value, governed: value, group, label: STATUS_GROUPS[group], legacy: false, fix: null,
      needs_review: false };
  }
  const key = squash(value);
  // A governed value with other spelling / case / spaces ('visited', 'sold pending ').
  if (GOVERNED_BY_KEY.has(key)) {
    const governed = GOVERNED_BY_KEY.get(key);
    const group = GROUP_OF_GOVERNED[governed];
    return { raw: value, governed, group, label: STATUS_GROUPS[group], legacy: true, fix: governed,
      needs_review: false };
  }
  if (LEGACY_BY_KEY.has(key)) {
    const legacyKey = LEGACY_BY_KEY.get(key);
    const governed = LEGACY_STATUS_MAP[legacyKey];
    const group = governed ? GROUP_OF_GOVERNED[governed] : GROUP_OF_AMBIGUOUS[legacyKey] || 'UNKNOWN';
    return { raw: value, governed, group, label: STATUS_GROUPS[group], legacy: true, fix: governed,
      needs_review: !governed };
  }
  return { raw: value, governed: null, group: 'UNKNOWN', label: STATUS_GROUPS.UNKNOWN, legacy: true, fix: null,
    needs_review: true };
}

export function statusGroup(raw) {
  return normalizeStatus(raw).group;
}

export function isSoldGroup(group) {
  return SOLD_GROUPS.has(group);
}

// Every stored spelling that falls in one of `groups` (for Mongo $in queries), from the tables above. Case variants
// of governed values are matched separately with statusRegexFor().
export function storedValuesForGroups(groups) {
  const want = new Set(groups);
  const out = new Set();
  for (const s of GOVERNED_STATUSES) if (want.has(GROUP_OF_GOVERNED[s])) out.add(s);
  for (const [legacy, governed] of Object.entries(LEGACY_STATUS_MAP)) {
    const group = governed ? GROUP_OF_GOVERNED[governed] : GROUP_OF_AMBIGUOUS[legacy];
    if (want.has(group)) out.add(legacy);
  }
  return [...out];
}

// One case-insensitive anchored regex matching every stored spelling of `groups` (spaces collapsed).
export function statusRegexFor(groups) {
  const alts = storedValuesForGroups(groups)
    .map((v) => v.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  return alts.length ? new RegExp(`^\\s*(?:${alts.join('|')})\\s*$`, 'i') : /$^/;
}

// ai_lead_state.stage (snake_case) -> report group. Unknown stages -> UNKNOWN.
const AI_STAGE_GROUP = Object.freeze({
  new_lead: 'NEW', new: 'NEW', lead_not_contacted: 'NEW', no_contact_made: 'NEW',
  contact_made_no_next_action: 'WORKING', contacted_no_next_action: 'WORKING', contact_made: 'WORKING',
  specific_followup: 'WORKING', contact_made_follow_up_assigned: 'WORKING',
  appointment_set: 'APPT_SET', appointment_booked: 'APPT_SET',
  appointment_no_show: 'NO_SHOW', no_show: 'NO_SHOW',
  sales_visit: 'VISITED', visited: 'VISITED',
  sold_pending: 'SOLD_PENDING', sold_delivered: 'SOLD_DELIVERED', unsold: 'UNSOLD',
  managerial_review: 'ESCALATED', dealership_action_required: 'ESCALATED',
  opted_out: 'OPTED_OUT', dnd: 'OPTED_OUT',
  closed_lost: 'CLOSED_LOST', closed_no_longer_owns: 'CLOSED_NLO',
});

export function aiStageGroup(stage) {
  if (!stage) return 'UNKNOWN';
  return AI_STAGE_GROUP[squash(stage).replace(/[\s-]+/g, '_')] || 'UNKNOWN';
}

// ---- sources ----------------------------------------------------------------------------------------------------
// Lead.source is a mix of channel ('email', 'sms', 'campaign', 'csv_import', 'csv_import_auto', 'website') and
// provider (ADF leads put the provider in both source and lead_source, worker/emailWorker.js:231). Lead.lead_source is
// the provider ('CarGurus', 'Cars.com', ...) or 'campaign_<name>' (worker/campaignWorker.js:114,222).

// Provider aliases: case-insensitive pattern -> one provider name. First match wins.
export const PROVIDER_ALIASES = Object.freeze([
  [/car\s*gurus/i, 'CarGurus'],
  [/cars\.?com/i, 'Cars.com'],
  [/auto\s*trader/i, 'Autotrader'],
  [/true\s*car/i, 'TrueCar'],
  [/edmunds/i, 'Edmunds'],
  [/kbb|kelley\s*blue\s*book/i, 'KBB'],
  [/carfax/i, 'Carfax'],
  [/carvana/i, 'Carvana'],
  [/capital\s*one/i, 'Capital One Auto Navigator'],
  [/facebook|fb\s*marketplace/i, 'Facebook'],
  [/dealer\s*inspire/i, 'Dealer Inspire'],
  [/dealeron/i, 'DealerOn'],
  [/dealer\.com/i, 'Dealer.com'],
  [/cars\s*for\s*sale/i, 'CarsForSale'],
  [/autolist/i, 'Autolist'],
  [/craigslist/i, 'Craigslist'],
  [/dealer\s*website|^website$/i, 'Dealer Website'],
]);

export const UNKNOWN_SOURCE = 'Unknown';

const CHANNEL_OF_SOURCE = Object.freeze({
  email: 'email', sms: 'sms', text: 'sms', campaign: 'campaign', csv_import: 'csv_import',
  csv_import_auto: 'csv_import', website: 'internet', manual: 'manual', walk_in: 'walk_in', phone: 'phone',
  'adf/xml': 'internet',
});

/** Provider name of a lead (from lead_source, else source). 'Unknown' when empty / 'unknown'. */
export function normalizeProvider(leadSource, source) {
  const pick = [leadSource, source].map((v) => (v == null ? '' : String(v).trim()))
    .find((v) => v && !/^unknown$/i.test(v) && !CHANNEL_OF_SOURCE[v.toLowerCase()]);
  if (!pick) {
    const ls = leadSource == null ? '' : String(leadSource).trim();
    return ls && !/^unknown$/i.test(ls) ? ls : UNKNOWN_SOURCE;
  }
  if (/^campaign_/i.test(pick)) return 'Campaign';
  for (const [re, name] of PROVIDER_ALIASES) if (re.test(pick)) return name;
  return pick;
}

/** How the lead arrived: internet / phone / walk_in / sms / email / campaign / csv_import / manual / unknown. */
export function normalizeChannel(lead = {}) {
  if (lead.contact_type) return String(lead.contact_type);
  if (/^campaign_/i.test(String(lead.lead_source || ''))) return 'campaign';
  const s = String(lead.source || '').trim().toLowerCase();
  if (CHANNEL_OF_SOURCE[s]) return CHANNEL_OF_SOURCE[s];
  // ADF leads carry the provider in `source` - an internet lead.
  if (s && normalizeProvider(lead.lead_source, lead.source) !== UNKNOWN_SOURCE) return 'internet';
  return 'unknown';
}

export function isUnmappedSource(leadSource) {
  return leadSource == null || String(leadSource).trim() === '' || /^unknown$/i.test(String(leadSource).trim());
}
