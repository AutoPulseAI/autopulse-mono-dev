// The Dashboard's "Download report" (client, 11 Nov 2026): one file for the dates picked on the Dashboard with every
// report - Executive first, then Betsy's source and sub-source table (eLead's "Source and Sub Source Performance",
// counted within the timeframe and from current leads), then Appointments, AI performance, BDC, Service, Data quality
// and Sales / Desk Log. Every number is the one the Dashboard's reports show (registry.js evaluateKpi, same rules and
// dates); a number that can't be counted yet says why instead of showing a zero.
import { evaluateKpi, kpisForDashboard, listDashboards } from './registry.js';
import { BASIS, countedText, sourcePerformance, sourceTableLines, toCsv } from './sourcePerformance.js';
import { HEAD, LINE, MUTED, SOURCE_NOTE, TABLE_LAYOUT, renderPdf, reportPage, sourceTableNode }
  from './sourcePerformancePdf.js';

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

// The same report as a PDF (Betsy, 12 Nov 2026: "Dealers need pretty reports to present"; the user: the whole report
// pretty, not a CSV). Same numbers as the CSV, in the source report's style (sourcePerformancePdf.js). Only numbers that
// can be counted are shown - a "not available yet" line is left out, and a section with none is skipped.
const fmtValue = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v ?? ''));

function highlights(section) {
  const picks = (section?.rows || []).filter((r) => r.value !== '' && !r.outOf).slice(0, 6);
  if (!picks.length) return [];
  return [{
    columns: picks.map((r) => ({ stack: [
      { text: fmtValue(r.value), fontSize: 20, bold: true, color: HEAD },
      { text: r.label, color: MUTED, fontSize: 8, margin: [0, 2, 0, 0] },
    ] })),
    columnGap: 14,
    margin: [0, 0, 0, 14],
  }, { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 736, y2: 0, lineWidth: 0.5, lineColor: LINE }],
    margin: [0, 0, 0, 10] }];
}

// A section's title as its table's first header row: it goes to the next page with the column headings and at least
// one row (keepWithHeaderRows), never alone at the bottom of a page, and a long table repeats it on the next page.
function titled(node, title, sub = '') {
  const cols = node.table.widths.length;
  const titleRow = [{ text: [{ text: title, fontSize: 12, bold: true, color: HEAD },
    ...(sub ? [{ text: `\n${sub}`, color: MUTED, fontSize: 8 }] : [])], colSpan: cols, border: [false, false, false, false],
  margin: [-5, 0, 0, 6] }, ...Array(cols - 1).fill({})];
  return { ...node, table: { ...node.table, headerRows: node.table.headerRows + 1, keepWithHeaderRows: 1,
    body: [titleRow, ...node.table.body] }, layout: { ...node.layout, hLineWidth: (i) => (i <= 1 ? 0 : 0.5) },
  margin: [0, 14, 0, 0] };
}

function measuresTable(rows) {
  return {
    table: {
      headerRows: 1,
      widths: ['*', 80, 110, 230],
      body: [
        ['Measure', 'Value', 'Out of', 'Note'].map((t, i) => ({ text: t, bold: true, color: '#ffffff', fillColor: HEAD,
          alignment: i === 1 ? 'right' : 'left', margin: [0, 4, 0, 4] })),
        ...rows.map((r, i) => [
          { text: r.label, margin: [0, 3, 0, 3] },
          { text: fmtValue(r.value), bold: true, alignment: 'right', margin: [0, 3, 0, 3] },
          { text: r.outOf || '', color: MUTED, margin: [0, 3, 0, 3] },
          { text: r.note || '', color: MUTED, fontSize: 7.5, margin: [0, 3, 0, 3] },
        ].map((c) => ({ ...c, fillColor: i % 2 ? '#f7f8fa' : null }))),
      ],
    },
    layout: TABLE_LAYOUT,
  };
}

export function fullReportDoc(report, { company, from, to, generated, filters = '' }) {
  const content = [];
  const exec = report.sections.find((s) => s.id === 'executive');
  content.push(...highlights(exec));
  for (const s of report.sections) {
    const rows = s.rows.filter((r) => r.value !== '');
    if (rows.length) content.push(titled(measuresTable(rows), s.label));
    if (s.id === 'executive') {
      for (const basis of [BASIS.TIMEFRAME, BASIS.CURRENT]) {
        content.push(titled(sourceTableNode(report.sources[basis]), 'Source and Sub Source Performance',
          countedText(basis)));
      }
      content.push({ text: SOURCE_NOTE, color: MUTED, fontSize: 7.5, margin: [0, 6, 0, 0] });
    }
  }
  return reportPage({ title: 'Dealership Performance Report', company, from, to, content,
    meta: [['Generated', generated], ['Report Period', `${from} - ${to}`], ...(filters ? [['Filters', filters]] : [])] });
}

export const fullReportPdf = (report, opts) => renderPdf(fullReportDoc(report, opts));
