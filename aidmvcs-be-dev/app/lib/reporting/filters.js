// One filter model (FilterSpec) for every report (P1 plan items 1 and 5; SOW 8 "consistent filters"). A report
// parses the request once, gets the dealer-local date range plus Mongo match fragments, and is told plainly which
// requested filters it can't apply yet (the data isn't there) - it never silently ignores one.
//
// Fields used (all exist today):
//   source           Lead.source        (strict:false model; free text, e.g. 'email', 'sms', 'csv_import', provider)
//   lead_source      Lead.lead_source   (provider name, 'campaign_<name>')
//   assigned_to      Lead.assigned_to   (ObjectId User; the CURRENT owner, not the owner at the time of the event)
//   actor            Booking.created_by (ai | staff) - appointment reports only
//   appointment_type Booking.appointment_type (sales | service; missing = sales, app/models/Booking.js)
//   channel          Email.communication_type (sms | email) - reply reports only
import mongoose from 'mongoose';
import { DEFAULT_TIMEZONE, isValidLocalDate, toLocalDate } from './time.js';

export const REPORTS = Object.freeze({
  REPLY_COHORTS: 'reply_cohorts',
  APPOINTMENT_ATTRIBUTION: 'appointment_attribution',
  // The Reports page (app/dealer/reports): one filter bar for every tab. Each KPI says which of these filters it can
  // apply (app/lib/reporting/kpis); the others are reported back for that KPI, never silently ignored.
  KPI_REPORTS: 'kpi_reports',
});

// Date basis each report accepts (first = default).
export const DATE_BASES = Object.freeze({
  [REPORTS.REPLY_COHORTS]: ['reply'],
  [REPORTS.APPOINTMENT_ATTRIBUTION]: ['created', 'scheduled'],
  // Each KPI has its own fixed date basis (its definition); the range is the only date input.
  [REPORTS.KPI_REPORTS]: ['kpi'],
});

// Which filters each report can apply. A filter listed in KNOWN_UNSUPPORTED, or not supported by the report, comes
// back in `unsupported` with the reason.
const SUPPORTED = Object.freeze({
  [REPORTS.REPLY_COHORTS]: ['source', 'lead_source', 'assigned_to', 'channel'],
  [REPORTS.APPOINTMENT_ATTRIBUTION]: ['source', 'lead_source', 'assigned_to', 'actor', 'appointment_type'],
  [REPORTS.KPI_REPORTS]: ['source', 'lead_source', 'assigned_to', 'actor', 'appointment_type', 'channel'],
});

const NOT_FOR_REPORT = Object.freeze({
  [REPORTS.REPLY_COHORTS]: {
    appointment_type: 'Sales/Service exists only on bookings (Booking.appointment_type); leads have no department field',
    actor: 'a reply has no AI/human author; its handler is derived per message (see replyCohorts handler rule)',
  },
  [REPORTS.APPOINTMENT_ATTRIBUTION]: {
    channel: 'bookings have no channel',
  },
});

export const KNOWN_UNSUPPORTED = Object.freeze({
  campaign: 'no campaign id on the lead; campaign leads are only named in lead_source ("campaign_<name>")',
  condition: 'no reliable new/used field on the lead (inventory join drops sold vehicles)',
  new_used: 'no reliable new/used field on the lead (inventory join drops sold vehicles)',
  ai_agent: 'the AI agent is only in ai_lead_state (AI service data), not on every lead',
  rooftop: 'reports are per dealer (one dealer = one rooftop); pass dealerId instead',
  dealer_ids: 'no cross-rooftop reports (decision 9 Nov)',
  department: 'use appointment_type (bookings only); leads have no department field',
});

const ACTORS = ['ai', 'human'];
const APPOINTMENT_TYPES = ['sales', 'service'];
const CHANNELS = ['sms', 'email'];

function list(value) {
  if (value == null || value === '') return [];
  const arr = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(arr.map((v) => String(v).trim()).filter(Boolean))];
}

/**
 * Parse and validate a FilterSpec (an object, or URLSearchParams from a request).
 * @param {object|URLSearchParams} input  { from, to, basis, source, lead_source, assigned_to, actor,
 *                                          appointment_type, channel, ...unsupported keys }
 * @param {{report: string, tz?: string}} opts
 * @returns {{ ok: boolean, errors: string[], spec: object, unsupported: {key: string, reason: string}[] }}
 */
export function parseFilterSpec(input = {}, { report, tz = DEFAULT_TIMEZONE } = {}) {
  const raw = input instanceof URLSearchParams
    ? Object.fromEntries([...new Set(input.keys())].map((k) => [k, input.getAll(k).join(',')]))
    : { ...(input || {}) };
  const errors = [];
  const unsupported = [];
  if (!SUPPORTED[report]) errors.push(`unknown report "${report}"`);
  const supported = SUPPORTED[report] || [];

  const from = toLocalDate(raw.from ?? raw.start ?? raw.date, tz);
  const to = toLocalDate(raw.to ?? raw.end ?? raw.from ?? raw.start ?? raw.date, tz);
  if (!from) errors.push('from must be a date (YYYY-MM-DD)');
  if (!to) errors.push('to must be a date (YYYY-MM-DD)');
  if (from && to && to < from) errors.push('to is before from');

  const bases = DATE_BASES[report] || [];
  const basis = raw.basis == null || raw.basis === '' ? bases[0] : String(raw.basis);
  if (bases.length && !bases.includes(basis)) errors.push(`basis must be one of: ${bases.join(', ')}`);

  const spec = { report, from, to, basis, tz };

  const take = (key, values) => {
    if (!values.length) return;
    if (!supported.includes(key)) {
      unsupported.push({ key, reason: NOT_FOR_REPORT[report]?.[key] || 'not supported by this report' });
      return;
    }
    spec[key] = values;
  };

  take('source', list(raw.source));
  take('lead_source', list(raw.lead_source));
  const staff = list(raw.assigned_to ?? raw.staff_id);
  const badStaff = staff.filter((id) => !mongoose.isValidObjectId(id));
  if (badStaff.length) errors.push(`assigned_to has invalid ids: ${badStaff.join(', ')}`);
  else take('assigned_to', staff);

  const one = (key, allowed) => {
    const v = list(raw[key]);
    if (!v.length) return;
    if (v.length > 1 || !allowed.includes(v[0].toLowerCase())) {
      errors.push(`${key} must be one of: ${allowed.join(', ')}`);
      return;
    }
    take(key, [v[0].toLowerCase()]);
    if (spec[key]) spec[key] = spec[key][0];
  };
  one('actor', ACTORS);
  one('appointment_type', APPOINTMENT_TYPES);
  one('channel', CHANNELS);

  for (const [key, reason] of Object.entries(KNOWN_UNSUPPORTED)) {
    if (list(raw[key]).length) unsupported.push({ key, reason });
  }

  return { ok: errors.length === 0, errors, spec, unsupported };
}

// Lead attributes -> a Lead query fragment ({} when none). Rows whose lead can't be found never match a lead filter.
export function leadMatch(spec = {}) {
  const m = {};
  if (spec.source?.length) m.source = { $in: spec.source };
  if (spec.lead_source?.length) m.lead_source = { $in: spec.lead_source };
  if (spec.assigned_to?.length) {
    m.assigned_to = { $in: spec.assigned_to.map((id) => new mongoose.Types.ObjectId(String(id))) };
  }
  return m;
}

export function hasLeadFilter(spec = {}) {
  return Object.keys(leadMatch(spec)).length > 0;
}

// Booking attributes -> a Booking query fragment.
export function bookingMatch(spec = {}) {
  const m = {};
  if (spec.appointment_type === 'service') m.appointment_type = 'service';
  // Booking.js: "Older bookings without a type count as sales."
  if (spec.appointment_type === 'sales') m.appointment_type = { $nin: ['service'] };
  if (spec.actor === 'ai') m.created_by = 'ai';
  if (spec.actor === 'human') m.created_by = 'staff';
  return m;
}

// Message attributes -> an Email query fragment.
export function replyMatch(spec = {}) {
  if (spec.channel === 'sms') return { communication_type: 'sms' };
  if (spec.channel === 'email') return { communication_type: 'email' };
  return {};
}

// The validated spec as plain, echo-able JSON (for "filters applied" lines and CSV footers).
export function describeSpec(spec = {}) {
  const out = {};
  for (const key of ['from', 'to', 'basis', 'tz', 'source', 'lead_source', 'assigned_to', 'actor',
    'appointment_type', 'channel']) {
    if (spec[key] != null && !(Array.isArray(spec[key]) && !spec[key].length)) out[key] = spec[key];
  }
  return out;
}

export { isValidLocalDate };
