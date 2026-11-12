// Sales / Desk Log report (SOW 8 Deliverable F, gap G-036; KPI dictionary A-F 3.3). Counted from the Desk Log
// (app/models/DeskLogEntry.js, Priority 3): one row per showroom visit, dated by its check-in. Follow-up compliance is
// still blocked (it needs the unsold follow-up tasks). The CRM status proxies stay until
// the Desk Log is in daily use.
import { statusRegexFor } from '../normalize.js';
import { minutesInStage } from '../../deskLog/deskLog.js';
import { KIND, LEAD_COLUMNS, LEAD_FILTERS, STATE, collection, dealerForms, firstStatusChangeLeads, leadRows,
  leadsByIds, localDateTime, memo, notYet, passingLeads, windowFor } from './common.js';

const D = 'sales';
const DESK = 'Desk Log (Priority 3)';

const blocked = (id, label, numerator, denominator = null) => notYet(STATE.BLOCKED, {
  id, label, dashboard: D, grain: 'desk_visit', dateBasis: 'DeskVisit.arrived_at', numerator, denominator,
  exclusions: 'n/a', source: ['desk_visits (not built)'], requires: ['desk_visit'], reason: DESK,
});

const proxy = (id, label, groups, what) => ({
  id, label, dashboard: D, grain: 'lead', kind: KIND.COUNT, proxy: true,
  dateBasis: 'ActivityLog.at of the first status change to that status',
  numerator: `Leads first set to ${what} in the range (staff status changes, ActivityLog status_changed). `
    + 'Interim proxy until the Desk Log exists.',
  denominator: null, inclusions: 'Any spelling of the status (app/lib/reporting/normalize.js).',
  exclusions: 'A lead set to it again later is counted once.', source: ['activitylogs', 'leads'],
  filters: LEAD_FILTERS, breakdowns: ['staff', 'lead_source'], columns: [...LEAD_COLUMNS, ['changed_at', 'Changed on']],
  evaluate: async (args, ctx) => ({ rows: await firstStatusChangeLeads(args, ctx, `sales:${id}`, statusRegexFor(groups)) }),
});

// Desk Log visits checked in during the range (lead filters apply to the visit's lead), one row per visit: id = the
// visit, lead_id = its lead (the Leads drill-down lists the leads).
export async function deskVisits(args, ctx) {
  return memo(ctx, 'desk_visits', async () => {
    const w = await windowFor(args);
    const visits = await collection('desklogentries').find({ dealer_id: { $in: dealerForms(args.dealerId) },
      checked_in_at: { $gte: w.start, $lte: w.end } }).sort({ checked_in_at: 1, _id: 1 }).toArray();
    const pass = await passingLeads(args, visits.map((v) => String(v.lead_id)));
    const kept = visits.filter((v) => !pass || pass.has(String(v.lead_id)));
    const leads = await leadsByIds(kept.map((v) => String(v.lead_id)), ctx);
    const withLead = kept.filter((v) => leads.get(String(v.lead_id)));
    const rows = await leadRows(withLead.map((v) => leads.get(String(v.lead_id))), args, ctx);
    return rows.map((r, i) => {
      const v = withLead[i];
      return { ...r, id: String(v._id), checked_in: localDateTime(v.checked_in_at, w.tz), stage: v.stage || '',
        outcome: v.outcome || '', unsold_reason: v.unsold_reason || '', _open_minutes: v.outcome ? null
          : minutesInStage(v, ctx.now || new Date()),
        _reached: Object.fromEntries([...stageTimes(v)].map(([stage, d]) => [stage, d.getTime()])),
        _g: { ...r._g, outcome: v.outcome || 'Open', reason: v.unsold_reason || 'None', stage: v.stage || 'No stage' } };
    });
  });
}

// When a visit first reached each stage: its stage changes, else its current stage.
export function stageTimes(v) {
  const at = new Map();
  for (const h of v.history || []) {
    if (h.field === 'stage' && h.to && !at.has(h.to)) at.set(h.to, new Date(h.at));
  }
  if (v.stage && !at.has(v.stage)) at.set(v.stage, new Date(v.stage_at || v.checked_in_at));
  return at;
}

// Stage aging buckets. 60 minutes is the Desk Log's "stalled" line (app/lib/deskLog/constants.js STALLED_MINUTES).
export function agingBucket(minutes) {
  if (minutes == null) return 'Unknown';
  if (minutes < 30) return 'Under 30 min';
  if (minutes < 60) return '30-60 min';
  if (minutes < 120) return '1-2 hours';
  if (minutes < 1440) return '2-24 hours';
  return '1 day or more';
}

const VISIT_COLUMNS = Object.freeze([...LEAD_COLUMNS, ['checked_in', 'Checked in'], ['stage', 'Stage'],
  ['outcome', 'Outcome'], ['unsold_reason', 'Unsold reason']]);
const visitKpi = (id, label, numerator, extra) => ({
  id, label, dashboard: D, grain: 'desk_visit', kind: KIND.COUNT, dateBasis: 'DeskLogEntry.checked_in_at',
  numerator, denominator: null, inclusions: 'Every Desk Log visit.', exclusions: 'Visits of deleted leads.',
  source: ['desklogentries', 'leads'], filters: LEAD_FILTERS, breakdowns: ['lead_source', 'staff'],
  columns: VISIT_COLUMNS, ...extra,
});

export const SALES_KPIS = [
  visitKpi('sales.showroom_visits', 'Showroom visits', 'Desk Log visits checked in during the range.', {
    breakdowns: ['lead_source', 'staff', 'stage', 'outcome'],
    evaluate: async (args, ctx) => ({ rows: await deskVisits(args, ctx) }) }),
  visitKpi('sales.to_rate', 'T.O. rate', 'Visits (checked in during the range) that reached T.O.', {
    kind: KIND.RATE, unit: '%', denominator: 'Visits checked in during the range.',
    evaluate: async (args, ctx) => {
      const all = await deskVisits(args, ctx);
      return { rows: all.filter((r) => 'T.O.' in r._reached), denominatorRows: all };
    } }),
  visitKpi('sales.appraisals', 'Appraisals', 'Visits (checked in during the range) that reached APPRAISAL.', {
    evaluate: async (args, ctx) => ({ rows: (await deskVisits(args, ctx))
      .filter((r) => 'APPRAISAL' in r._reached) }) }),
  visitKpi('sales.appraisal_to_proposal', 'Appraisal to proposal', 'Visits that reached PROPOSAL after APPRAISAL.', {
    kind: KIND.RATE, unit: '%', denominator: 'Visits (checked in during the range) that reached APPRAISAL.',
    evaluate: async (args, ctx) => {
      const appraised = (await deskVisits(args, ctx)).filter((r) => 'APPRAISAL' in r._reached);
      const rows = appraised.filter((r) => 'PROPOSAL' in r._reached && r._reached.PROPOSAL >= r._reached.APPRAISAL);
      return { rows, denominatorRows: appraised };
    } }),
  visitKpi('sales.unsold_reasons', 'Unsold', 'Visits (checked in during the range) whose outcome is UNSOLD, by '
    + 'reason.', { breakdowns: ['reason', 'lead_source', 'staff'],
    evaluate: async (args, ctx) => ({ rows: (await deskVisits(args, ctx)).filter((r) => r.outcome === 'UNSOLD') }) }),
  visitKpi('sales.pending_delivered', 'Sold pending / delivered', 'Visits (checked in during the range) whose '
    + 'outcome is SOLD PENDING or SOLD DELIVERED.', { breakdowns: ['outcome', 'lead_source', 'staff'],
    evaluate: async (args, ctx) => ({ rows: (await deskVisits(args, ctx))
      .filter((r) => ['SOLD PENDING', 'SOLD DELIVERED'].includes(r.outcome)) }) }),
  visitKpi('sales.stage_aging', 'Stage aging', 'Visits (checked in during the range) still open now (no outcome), by '
    + 'time in their current stage (since the last stage change, else the check-in).', {
    breakdowns: ['aging', 'stage', 'staff'], columns: [...VISIT_COLUMNS, ['in_stage', 'Time in stage']],
    inclusions: 'Visits with no outcome yet. Measured when the report runs.',
    evaluate: async (args, ctx) => ({ rows: (await deskVisits(args, ctx)).filter((r) => !r.outcome).map((r) => ({
      ...r, in_stage: r._open_minutes == null ? '' : `${Math.floor(r._open_minutes / 60)}h ${r._open_minutes % 60}m`,
      _g: { ...r._g, aging: agingBucket(r._open_minutes) } })) }) }),
  blocked('sales.followup_compliance', 'Follow-up compliance', 'Unsold visits followed up within N hours.',
    'Unsold visits.'),
  proxy('sales.proxy_visits', 'CRM Sales Visit (proxy)', ['VISITED'], 'Visited (Sales Visit)'),
  proxy('sales.proxy_unsold', 'Unsold (proxy, no reason)', ['UNSOLD'], 'Unsold'),
  proxy('sales.proxy_sold_pending', 'Sold pending (proxy)', ['SOLD_PENDING'], 'Sold Pending'),
  proxy('sales.proxy_sold_delivered', 'Sold delivered (proxy)', ['SOLD_DELIVERED'], 'Sold Delivered'),
  proxy('sales.proxy_action_required', 'Dealership Action Required (proxy)', ['ESCALATED'],
    'Dealership Action Required'),
  proxy('sales.proxy_closed_lost', 'Closed lost (proxy)', ['CLOSED_LOST'], 'Closed - Lost'),
];
