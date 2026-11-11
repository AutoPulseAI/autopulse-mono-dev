// Source and sub-source performance (Betsy, 10 Nov 2026: like eLead's "Source and Sub Source Performance" report).
// Rows: All Types -> each lead type (Up Type) -> each source -> each sub-source, with Leads, Appts Set, Appts Shown,
// Sold and Closing Ratio (Sold / Leads). Built from the same KPIs as the Lead sources tag (source.leads,
// source.appointments, source.shown, source.crm_sold in kpis/leadSource.js), so the "All Types" row always equals
// the numbers on screen. Visits come with the Desk Log (Priority 3); gross with the DealerVault deal matching -
// both columns are there and empty until then.
//
// Two ways to count (Betsy's email):
//   timeframe - every appointment / show / sale in the range, whenever its lead came in (a CarGurus lead from
//               last month sold this month counts this month);
//   current   - only those whose lead came in during the range (that sale does not count).
// Leads are the leads received in the range either way.
import { evaluateKpi } from './registry.js';
import { leadsByIds, windowFor } from './kpis/common.js';
import { normalizeChannel, normalizeProvider } from './normalize.js';

export const BASIS = Object.freeze({ TIMEFRAME: 'timeframe', CURRENT: 'current' });
export const ALL_TYPES = 'All Types';
export const ALL_SOURCES = 'All Sources';
export const ALL_SUBS = 'All Sub-Sources';
export const NO_SUB = 'No Sub-Source';

const MEASURES = Object.freeze([
  ['leads', 'source.leads'], ['appts_set', 'source.appointments'], ['appts_shown', 'source.shown'],
  ['sold', 'source.crm_sold'],
]);
const UP_TYPES = Object.freeze({ internet: 'Internet', phone: 'Phone', walk_in: 'Walk-in', campaign: 'Campaign' });

/** The lead type ("Up Type") of a lead: Internet, Phone, Walk-in, Campaign, else Other. */
export function upType(lead) {
  return UP_TYPES[normalizeChannel(lead || {})] || 'Other';
}

const byName = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });
const ratio = (sold, leads) => (leads ? Math.round((sold / leads) * 10000) / 100 : 0);

/**
 * @param {{dealerId: string, from: string, to: string, tz?: string, spec?: object}} args  as for evaluateKpi
 * @param {{basis?: 'timeframe'|'current'}} opts
 * @returns {Promise<{basis: string, rows: object[]}>}  rows in report order; level = total | type | source | sub
 */
export async function sourcePerformance(args, { basis = BASIS.TIMEFRAME } = {}) {
  if (!Object.values(BASIS).includes(basis)) throw new RangeError(`basis must be ${Object.values(BASIS).join(' or ')}`);
  const ctx = {};
  const w = await windowFor(args);
  const sets = [];
  for (const [measure, id] of MEASURES) sets.push([measure, (await evaluateKpi(id, args, ctx)).rows]);
  const leads = await leadsByIds(sets.flatMap(([, rows]) => rows.map((r) => r.lead_id).filter(Boolean).map(String)), ctx);
  const inRange = (lead) => Boolean(lead?.createdAt) && lead.createdAt >= w.start && lead.createdAt <= w.end;

  // type -> source -> sub -> counts
  const tree = new Map();
  const total = { leads: 0, appts_set: 0, appts_shown: 0, sold: 0 };
  const node = (map, key, make) => {
    if (!map.has(key)) map.set(key, make());
    return map.get(key);
  };
  const counts = () => ({ leads: 0, appts_set: 0, appts_shown: 0, sold: 0 });
  for (const [measure, rows] of sets) {
    for (const r of rows) {
      const lead = r.lead_id ? leads.get(String(r.lead_id)) || null : null;
      if (basis === BASIS.CURRENT && measure !== 'leads' && !inRange(lead)) continue;
      const type = node(tree, upType(lead), () => ({ counts: counts(), sources: new Map() }));
      const source = node(type.sources, lead ? normalizeProvider(lead.lead_source, lead.source) : 'Unknown',
        () => ({ counts: counts(), subs: new Map() }));
      const sub = node(source.subs, (lead?.sub_source && String(lead.sub_source).trim()) || NO_SUB, counts);
      for (const c of [total, type.counts, source.counts, sub]) c[measure] += 1;
    }
  }

  const row = (level, up_type, source, sub_source, c) => ({
    level, up_type, source, sub_source, leads: c.leads, visits: null, appts_set: c.appts_set,
    appts_shown: c.appts_shown, sold: c.sold, closing_ratio: ratio(c.sold, c.leads),
    front_gross: null, back_gross: null, total_gross: null,
  });
  const rows = [row('total', ALL_TYPES, ALL_SOURCES, ALL_SUBS, total)];
  for (const typeName of [...tree.keys()].sort(byName)) {
    const type = tree.get(typeName);
    rows.push(row('type', typeName, ALL_SOURCES, ALL_SUBS, type.counts));
    for (const sourceName of [...type.sources.keys()].sort(byName)) {
      const source = type.sources.get(sourceName);
      const subs = [...source.subs.keys()].sort(byName);
      // One sub-source only: one row naming it (as eLead does), not a total plus the same line again.
      if (subs.length === 1) {
        rows.push(row('source', typeName, sourceName, subs[0], source.counts));
        continue;
      }
      rows.push(row('source', typeName, sourceName, ALL_SUBS, source.counts));
      for (const subName of subs) rows.push(row('sub', typeName, sourceName, subName, source.subs.get(subName)));
    }
  }
  return { basis, rows };
}

// A spreadsheet cell: quoted, and never read as a formula (a sub-source comes from a provider's email).
function cell(value) {
  if (value == null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = Object.freeze([
  ['company', 'Company'], ['up_type', 'Up Type'], ['source', 'Source'], ['sub_source', 'Sub-Source'],
  ['leads', 'Leads'], ['visits', 'Visits'], ['appts_set', 'Appts Set'], ['appts_shown', 'Appts Shown'],
  ['sold', 'Sold'], ['closing_ratio', 'Closing Ratio'], ['front_gross', 'Front Gross'], ['back_gross', 'Back Gross'],
  ['total_gross', 'Total Gross'],
]);

/** The report as CSV, laid out like Betsy's eLead PDF (a few header lines, then the table). */
export function sourcePerformanceCsv(report, { company, from, to, generated, filters = '' }) {
  const lines = [
    ['Source and Sub Source Performance'],
    [company],
    [`Generated: ${generated}`],
    [`Report Period: ${from} - ${to}`],
    [`Counted: ${report.basis === BASIS.CURRENT ? 'From current leads (leads received in the period only)'
      : 'Within timeframe (everything in the period, whenever the lead came in)'}`],
    ...(filters ? [[`Filters: ${filters}`]] : []),
    [],
    CSV_COLUMNS.map(([, label]) => label),
    ...report.rows.map((r, i) => CSV_COLUMNS.map(([key]) => {
      if (key === 'company') return i === 0 ? company : '';
      if (key === 'closing_ratio') return `${r.closing_ratio.toFixed(2)}%`;
      return r[key];
    })),
    [],
    ['Visits: available when the Desk Log is built (showroom visits are not recorded yet).'],
    ['Front / Back / Total Gross: being added from DealerVault (sold deals matched to leads).'],
  ];
  return `${lines.map((l) => l.map(cell).join(',')).join('\r\n')}\r\n`;
}
