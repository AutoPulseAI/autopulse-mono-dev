// The Reports page KPIs, one module per tab (P1 plan item 4). Registered in app/lib/reporting/registry.js.
import { AI_KPIS } from './ai.js';
import { APPOINTMENT_KPIS } from './appointments.js';
import { BDC_KPIS } from './bdc.js';
import { DATA_QUALITY_KPIS } from './dataQuality.js';
import { EXECUTIVE_KPIS } from './executive.js';
import { LEAD_SOURCE_KPIS } from './leadSource.js';
import { SALES_KPIS } from './sales.js';
import { SERVICE_KPIS } from './service.js';

export { KIND, STATE } from './common.js';

// Tab order of the Reports page; `dashboard` is the API's ?dashboard= value.
export const DASHBOARDS = Object.freeze([
  { id: 'executive', label: 'Executive', gap: 'G-034' },
  { id: 'appointments', label: 'Appointments', gap: 'G-037' },
  { id: 'ai', label: 'AI performance', gap: 'G-039' },
  { id: 'lead_source', label: 'Lead source', gap: 'G-040' },
  { id: 'bdc', label: 'BDC', gap: 'G-035' },
  { id: 'service', label: 'Service', gap: 'G-038' },
  { id: 'data_quality', label: 'Data quality', gap: 'G-041' },
  { id: 'sales', label: 'Sales / Desk Log', gap: 'G-036' },
]);

// What each KPI's definition comes from (shown on the Definitions tab): the SOW section of its tab, unless the KPI says
// itself (an existing Dashboard rule it matches, or a more specific SOW section).
const SOW_F = 'SOW §8 Deliverable F';
export const TAB_BASIS = Object.freeze({
  executive: `${SOW_F}, Executive / store: "Leads, appointments, shows, sold/delivered, service visits, trends and `
    + 'conversion by rooftop".',
  appointments: `${SOW_F}, Appointments: "Set, confirmed, rescheduled, cancelled, shown, no-show, show rate, by `
    + 'creator/source/department".',
  ai: `${SOW_F}, AI operations: "AI conversations, handoffs, AI-created appointments, escalation reasons, response `
    + 'times, human overrides".',
  lead_source: `${SOW_F}, Lead source / ROI: "Leads, contacts, appointments, shows, sales by source; spend, CPL and `
    + 'ROI only when valid cost/revenue inputs exist".',
  bdc: `${SOW_F}, BDC productivity: "Assigned leads, speed to lead, attempts, meaningful contacts, appointments, `
    + 'shows, overdue tasks, rep conversion".',
  service: `${SOW_F}, Service retention: "Eligible/due customers, reminder outreach, booked/visited, `
    + 'active/inactive/at-risk segments where data supports them".',
  data_quality: `${SOW_F}, Data quality / compliance: "Missing mappings, duplicate candidates, sync errors, `
    + 'unresolved exceptions, consent and opt-out audit metrics".',
  sales: `${SOW_F}, Sales / Desk Log: "Showroom visits, stage aging, unsold reasons, T.O. rate, pending/delivered, `
    + 'follow-up compliance".',
});
const SOW_8A = 'SOW §8A Deliverable F2: AI / AI-assisted / human-only / unknown, "One appointment ID is counted once".';
const BASIS = Object.freeze({
  'exec.appointments_set': `${SOW_8A} Same bookings as the Dashboard card "Appointments Made" (made in the range), `
    + 'duplicates counted once.',
  'exec.appointments_scheduled': 'Dashboard card "Appointments for These Dates" (app/lib/appointmentFunnel.js '
    + `scheduled), duplicates counted once; ${SOW_F}.`,
  'appointments.scheduled': 'Dashboard card "Appointments for These Dates" (app/lib/appointmentFunnel.js scheduled), '
    + `duplicates counted once; ${SOW_F}.`,
  'exec.customers_replied': 'SOW §8B Deliverable F3: distinct customers who replied, customer-level de-duplicated.',
  'appointments.by_ai': SOW_8A, 'appointments.ai_assisted': SOW_8A, 'appointments.human_only': SOW_8A,
  'appointments.unknown_creator': SOW_8A, 'appointments.ai_influenced': `${SOW_8A} AI-influenced = AI + AI-assisted.`,
  'ai.appointments_ai': SOW_8A, 'ai.appointments_assisted': SOW_8A,
});

export const REPORT_KPIS = Object.freeze([
  ...EXECUTIVE_KPIS, ...APPOINTMENT_KPIS, ...AI_KPIS, ...LEAD_SOURCE_KPIS, ...BDC_KPIS, ...SERVICE_KPIS,
  ...DATA_QUALITY_KPIS, ...SALES_KPIS,
].map((k) => ({ ...k, basedOn: k.basedOn || BASIS[k.id] || TAB_BASIS[k.dashboard] })));
