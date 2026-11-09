// Sales / Desk Log report (SOW 8 Deliverable F, gap G-036; KPI dictionary A-F 3.3). The Desk Log (Deliverable C / J,
// Priority 3) is not built, so its KPIs are registered as blocked with their frozen definitions, and the interim CRM
// proxies the dictionary lists are live (labelled "proxy").
//
// Reporting contract the Desk Log must write (so these KPIs work from day one): visit_id, dealer_id, lead_id,
// customer_id, salesperson_id, manager_id, arrived_at, stage, stage_history[{stage, at, by}], to_manager (T.O.) + at,
// outcome (sold / unsold / pending / delivered), unsold_reason, next_followup_at, followup_completed_at, new_used.
import { statusRegexFor } from '../normalize.js';
import { KIND, LEAD_COLUMNS, LEAD_FILTERS, STATE, firstStatusChangeLeads, notYet } from './common.js';

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

export const SALES_KPIS = [
  blocked('sales.showroom_visits', 'Showroom visits', 'Desk Log visits that arrived in the range.'),
  blocked('sales.stage_aging', 'Stage aging', 'Open visits by time since their last stage change.'),
  blocked('sales.unsold_reasons', 'Unsold reasons', 'Unsold visits by reason.'),
  blocked('sales.to_rate', 'T.O. rate', 'Visits turned over to a manager.', 'Visits.'),
  blocked('sales.pending_delivered', 'Pending / delivered', 'Visits with outcome sold pending or delivered.'),
  blocked('sales.followup_compliance', 'Follow-up compliance', 'Unsold visits followed up within N hours.',
    'Unsold visits.'),
  proxy('sales.proxy_visits', 'CRM Sales Visit (proxy)', ['VISITED'], 'Visited (Sales Visit)'),
  proxy('sales.proxy_unsold', 'Unsold (proxy, no reason)', ['UNSOLD'], 'Unsold'),
  proxy('sales.proxy_sold_pending', 'Sold pending (proxy)', ['SOLD_PENDING'], 'Sold Pending'),
  proxy('sales.proxy_sold_delivered', 'Sold delivered (proxy)', ['SOLD_DELIVERED'], 'Sold Delivered'),
];
