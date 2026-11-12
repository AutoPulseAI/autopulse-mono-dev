// Betsy's source / sub-source report as a PDF (Betsy, 12 Nov 2026: "Is the source subsource available as pdf too not
// just csv? Dealers need pretty reports to present"). The same rows as the screen and the CSV
// (./sourcePerformance.js), laid out like her eLead "Source and Sub Source Performance" report: a header with the
// dealership, period and how it was counted, then one table - All Types, each lead type, its sources and sub-sources.
// pdfmake with the PDF standard fonts (Helvetica), so no font files ship with the app.
import PdfPrinter from 'pdfmake';
import { countedText } from './sourcePerformance.js';

const FONTS = { Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique',
  bolditalics: 'Helvetica-BoldOblique' } };
const INK = '#16181d';
const MUTED = '#5b6270';
const HEAD = '#1f3b63';
const LINE = '#e3e6eb';
const FILL = { total: '#e8eef8', type: '#f3f6fb' };

const COLUMNS = [
  ['up_type', 'Up Type', 70, 'left'], ['source', 'Source', '*', 'left'], ['sub_source', 'Sub-Source', '*', 'left'],
  ['leads', 'Leads', 36, 'right'], ['visits', 'Visits', 36, 'right'], ['appts_set', 'Appts Set', 38, 'right'],
  ['appts_shown', 'Appts Shown', 40, 'right'], ['sold', 'Sold', 30, 'right'],
  ['closing_ratio', 'Closing Ratio', 44, 'right'], ['front_gross', 'Front Gross', 52, 'right'],
  ['back_gross', 'Back Gross', 52, 'right'], ['total_gross', 'Total Gross', 54, 'right'],
];

const count = (n) => Number(n || 0).toLocaleString('en-US');
const money = (n) => (n == null ? '–' : `${n < 0 ? '(' : ''}$${Math.abs(n).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${n < 0 ? ')' : ''}`);

/** One table row's cells. Like eLead, a lead type is named on its own row only, a source on its own row only. */
function cells(r) {
  const label = {
    up_type: r.level === 'total' || r.level === 'type' ? r.up_type : '',
    source: r.level === 'sub' ? '' : r.source,
    sub_source: r.sub_source,
  };
  const bold = r.level === 'total' || r.level === 'type';
  return COLUMNS.map(([key, , , align]) => {
    let text;
    if (key in label) text = label[key];
    else if (key === 'closing_ratio') text = `${Number(r.closing_ratio || 0).toFixed(2)}%`;
    else if (key.endsWith('_gross')) text = money(r[key]);
    else text = count(r[key]);
    return { text, alignment: align, bold, color: r.level === 'sub' && key in label ? MUTED : INK,
      fillColor: FILL[r.level] || null, margin: [0, 3, 0, 3] };
  });
}

/** The PDF document definition (exported for tests). */
export function sourcePerformanceDoc(report, { company, from, to, generated, filters = '' }) {
  const meta = [
    ['Generated', generated], ['Report Period', `${from} - ${to}`], ['Counted', countedText(report.basis)],
    ...(filters ? [['Filters', filters]] : []),
  ];
  return {
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [28, 28, 28, 36],
    info: { title: `Source and Sub Source Performance - ${company}`, creator: 'AutoPulse' },
    defaultStyle: { font: 'Helvetica', fontSize: 8.5, color: INK },
    footer: (page, pages) => ({
      columns: [
        { text: `${company} · Source and Sub Source Performance · ${from} - ${to}`, color: MUTED, fontSize: 7.5 },
        { text: `Page ${page} of ${pages}`, alignment: 'right', color: MUTED, fontSize: 7.5 },
      ],
      margin: [28, 10, 28, 0],
    }),
    content: [
      {
        columns: [
          { width: '*', stack: [
            { text: 'Source and Sub Source Performance', fontSize: 16, bold: true, color: HEAD },
            { text: company, fontSize: 11, margin: [0, 3, 0, 0] },
          ] },
          { width: 'auto', table: { body: meta.map(([k, v]) => [
            { text: k, color: MUTED, alignment: 'right' }, { text: v, bold: true }]) },
          layout: 'noBorders' },
        ],
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          headerRows: 1,
          widths: COLUMNS.map(([, , w]) => w),
          body: [
            COLUMNS.map(([, label, , align]) => ({ text: label, bold: true, color: '#ffffff', fillColor: HEAD,
              alignment: align, margin: [0, 4, 0, 4] })),
            ...report.rows.map(cells),
          ],
        },
        layout: {
          hLineWidth: (i) => (i === 0 ? 0 : 0.5),
          vLineWidth: () => 0,
          hLineColor: () => LINE,
          paddingLeft: () => 5,
          paddingRight: () => 5,
        },
      },
      { text: 'Visits: customers checked in on the Desk Log. Front / Back / Total Gross: being added from DealerVault '
        + '(sold deals matched to leads).', color: MUTED, fontSize: 7.5, margin: [0, 8, 0, 0] },
    ],
  };
}

/** The report as a PDF (a Buffer). */
export function sourcePerformancePdf(report, opts) {
  const doc = new PdfPrinter(FONTS).createPdfKitDocument(sourcePerformanceDoc(report, opts));
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
