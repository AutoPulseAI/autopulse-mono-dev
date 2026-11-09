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

export const REPORT_KPIS = Object.freeze([
  ...EXECUTIVE_KPIS, ...APPOINTMENT_KPIS, ...AI_KPIS, ...LEAD_SOURCE_KPIS, ...BDC_KPIS, ...SERVICE_KPIS,
  ...DATA_QUALITY_KPIS, ...SALES_KPIS,
]);
