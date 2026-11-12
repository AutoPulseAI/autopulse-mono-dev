// The PDF of an on-screen form (SOW v6 Deliverable K; the user, 13 Nov 2026: the PDF is "just a reflection" of the
// form - its preview / download). Laid out from the form itself: the dealership's name, the title, each section with
// its fields in rows (full / half / third width), wording as written, checkboxes, signature lines. A section repeated
// per trade-in is printed once for each. Empty values print as a blank line to fill by hand - never made up.
import { renderPdf, INK, MUTED, HEAD } from '../reporting/sourcePerformancePdf.js';
import { dataKey } from './schema.js';

const SPAN = { full: 6, half: 3, third: 2 };

function cell(field, value, span = 6) {
  if (field.type === 'heading') return { text: field.text || field.label, bold: true, fontSize: 11, color: HEAD, margin: [0, 6, 0, 2] };
  if (field.type === 'paragraph') return { text: field.text, fontSize: 8, color: INK, margin: [0, 2, 0, 4] };
  if (field.type === 'checkbox') {
    const on = value === true || /^(true|yes|x|1)$/i.test(String(value ?? ''));
    return { text: [{ text: on ? '[X] ' : '[   ] ', bold: true }, field.label], margin: [0, 4, 0, 4] };
  }
  const shown = value == null || value === '' ? '' : String(value);
  return {
    stack: [
      { text: field.label + (field.required ? ' *' : ''), fontSize: 7, color: MUTED },
      { text: shown || ' ', fontSize: 10, margin: [0, 1, 0, 0] },
      { canvas: [{ type: 'line', x1: 0, y1: 1, x2: Math.round((span / 6) * 520) - 14, y2: 1, lineWidth: 0.5,
        lineColor: '#9aa1ac' }] },
    ],
    margin: [0, field.type === 'signature' ? 14 : 4, 8, 4],
  };
}

// Fields -> rows of up to 6 units (full = 6, half = 3, third = 2); headings and wording take a row of their own.
function rows(fields, valueOf) {
  const out = [];
  let row = []; let used = 0;
  const flush = () => {
    if (!row.length) return;
    const filler = 6 - used;
    out.push({ columns: [...row.map(([f, span]) => ({ width: `${(span / 6) * 100}%`, ...cell(f, valueOf(f), span) })),
      ...(filler > 0 ? [{ width: `${(filler / 6) * 100}%`, text: '' }] : [])], columnGap: 6 });
    row = []; used = 0;
  };
  for (const f of fields) {
    const span = f.type === 'heading' || f.type === 'paragraph' || f.type === 'signature' && f.width === 'full' ? 6
      : SPAN[f.width] || 6;
    if (used + span > 6) flush();
    row.push([f, span]); used += span;
    if (used >= 6) flush();
  }
  flush();
  return out;
}

/**
 * @param {object} schema  the form
 * @param {Record<string, any>} data  field id (or id#n) -> value
 * @param {{ dealer: string, trades: number, stamp?: string, footer?: string }} opts
 */
export function formPdf(schema, data, { dealer = '', trades = 0, stamp = null, footer = '' } = {}) {
  const content = [
    { text: dealer, fontSize: 9, color: MUTED },
    { text: schema.title, fontSize: 16, bold: true, color: HEAD, margin: [0, 2, 0, 4] },
    ...(schema.description ? [{ text: schema.description, fontSize: 9, margin: [0, 0, 0, 6] }] : []),
  ];
  for (const s of schema.sections) {
    const copies = s.repeat === 'trade_in' ? Math.max(1, trades) : 1;
    for (let n = 0; n < copies; n += 1) {
      const title = s.repeat === 'trade_in' && copies > 1 ? `${s.title || 'Trade-in'} ${n + 1}` : s.title;
      if (title) {
        content.push({ table: { widths: ['*'], body: [[{ text: title, bold: true, fontSize: 10, color: '#ffffff',
          fillColor: HEAD, margin: [4, 2, 4, 2] }]] }, layout: 'noBorders', margin: [0, 10, 0, 4] });
      }
      const valueOf = (f) => data[dataKey(f.id, s.repeat === 'trade_in' ? n : null)];
      content.push(...rows(s.fields, valueOf));
    }
  }
  return renderPdf({
    pageSize: 'LETTER', pageMargins: [40, 40, 40, 44],
    info: { title: schema.title, creator: 'AutoPulse' },
    defaultStyle: { font: 'Helvetica', fontSize: 9, color: INK },
    ...(stamp ? { watermark: { text: stamp, color: '#c8ccd3', opacity: 0.25, bold: true } } : {}),
    footer: (page, pages) => ({ columns: [{ text: footer, color: MUTED, fontSize: 7 },
      { text: `Page ${page} of ${pages}`, alignment: 'right', color: MUTED, fontSize: 7 }], margin: [40, 12, 40, 0] }),
    content,
  });
}
