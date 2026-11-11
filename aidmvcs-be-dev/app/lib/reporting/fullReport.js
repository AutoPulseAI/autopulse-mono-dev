// The Dashboard's "Download report" (client, 11 Nov 2026): one file for the dates picked on the Dashboard with every
// report - Executive first, then Betsy's source and sub-source table (eLead's "Source and Sub Source Performance",
// counted within the timeframe and from current leads), then Appointments, AI performance, BDC, Service, Data quality
// and Sales / Desk Log. Every number is the one the Dashboard's reports show (registry.js evaluateKpi, same rules and
// dates); a number that can't be counted yet says why instead of showing a zero.
import { evaluateKpi, kpisForDashboard, listDashboards } from './registry.js';
import { BASIS, countedText, sourcePerformance, sourceTableLines, toCsv } from './sourcePerformance.js';

// Executive first; the source table goes right after it.
const ORDER = ['executive', 'appointments', 'ai', 'lead_source', 'bdc', 'service', 'data_quality', 'sales'];

function valueOf(def, ev) {
  if (!ev || ev.state === 'error') return { value: '', outOf: '', note: 'Could not be counted.' };
  if (ev.state !== 'live') {
    return { value: '', outOf: '', note: `Not available yet: ${def.reason || ev.reason || 'needs data'}` };
  }
  if (ev.value == null) return { value: '', outOf: '', note: '' };
  if (ev.kind === 'rate') {
    return { value: `${ev.value}%`, outOf: `${ev.numerator?.count ?? 0} of ${ev.denominator?.count ?? 0}`,
      note: def.denominatorLabel ? `Out of: ${def.denominatorLabel}` : '' };
  }
  if (ev.kind === 'median') return { value: `${ev.value} min`, outOf: '', note: 'Median' };
  return { value: Number(ev.value), outOf: '', note: def.proxy ? 'Stand-in until the Desk Log (CRM status changes)'
    : '' };
}

/**
 * @param {{dealerId: string, from: string, to: string, tz: string, spec?: object}} args
 * @returns {Promise<{sections: {id: string, label: string, rows: object[]}[], sources: object}>}
 */
export async function fullReport(args) {
  const ctx = {};
  const labels = new Map(listDashboards().map((d) => [d.id, d.label]));
  const sections = [];
  for (const id of ORDER.filter((d) => labels.has(d))) {
    const rows = [];
    for (const def of kpisForDashboard(id)) {
      let ev = null;
      try {
        ev = await evaluateKpi(def.id, args, ctx);
      } catch (error) {
        console.error(`[reports] full report: ${def.id} failed:`, error);
      }
      rows.push({ id: def.id, label: def.label, ...valueOf(def, ev) });
    }
    sections.push({ id, label: labels.get(id), rows });
  }
  const sources = {
    timeframe: await sourcePerformance(args, { basis: BASIS.TIMEFRAME, ctx }),
    current: await sourcePerformance(args, { basis: BASIS.CURRENT, ctx }),
  };
  return { sections, sources };
}

export function fullReportCsv(report, { company, from, to, generated, filters = '' }) {
  const lines = [
    ['Dealership Performance Report'],
    [company],
    [`Generated: ${generated}`],
    [`Report Period: ${from} - ${to}`],
    ...(filters ? [[`Filters: ${filters}`]] : []),
  ];
  const section = (s) => {
    lines.push([], [s.label.toUpperCase()], ['Measure', 'Value', 'Out of', 'Note']);
    for (const r of s.rows) lines.push([r.label, r.value, r.outOf, r.note]);
  };
  const sourceTable = (basis) => {
    lines.push([], [`SOURCE AND SUB SOURCE PERFORMANCE - ${countedText(basis)}`],
      ...sourceTableLines(report.sources[basis], company));
  };
  for (const s of report.sections) {
    section(s);
    if (s.id === 'executive') {
      sourceTable(BASIS.TIMEFRAME);
      sourceTable(BASIS.CURRENT);
    }
  }
  return toCsv(lines);
}
