// The PDF of an on-screen form (SOW v6 Deliverable K; the user, 13 Nov 2026: the PDF is "just a reflection" of the
// form - its preview / download). Laid out from the form itself: the dealership's name, the title, each section with
// its headings, wording (blanks inside sentences filled in, or left as a line to fill by hand), fields in rows (full /
// half / third / quarter width), checkboxes, boxes, signature lines, lines and spaces. A section repeated per
// trade-in is printed once for each. Empty values print as a blank line - never made up.
import { renderPdf, INK, MUTED, HEAD } from '../reporting/sourcePerformancePdf.js';
import { BLANK_TOKEN, blankId, dataKey } from './schema.js';

const SPAN = { full: 12, half: 6, third: 4, quarter: 3 };
const BLANK_LEN = { short: 10, medium: 22, long: 40 };
const FONT = { small: 7.5, normal: 9.5, large: 12 };
const HEADING = { 1: 15, 2: 12, 3: 10.5 };
const WIDTH = 532; // the page's text width (LETTER, 40 pt margins)

function inputCell(f, value, span) {
  if (f.type === 'checkbox') {
    const on = value === true || /^(true|yes|x|1)$/i.test(String(value ?? ''));
    return { text: [{ text: on ? '[X] ' : '[   ] ', bold: true }, f.label], margin: [0, 4, 0, 4] };
  }
  if (f.type === 'radio') {
    return { stack: [{ text: f.label + (f.required ? ' *' : ''), fontSize: 7, color: MUTED },
      { text: f.options.map((o) => `${value === o ? '[X]' : '[   ]'} ${o}`).join('      '), margin: [0, 2, 0, 0] }],
    margin: [0, 4, 6, 4] };
  }
  const shown = value == null || value === '' ? '' : String(value);
  const w = Math.round((span / 12) * WIDTH) - 12;
  const box = f.type === 'textarea';
  return {
    stack: [
      { text: f.label + (f.required ? ' *' : ''), fontSize: 7, color: MUTED },
      box ? { table: { widths: [w], heights: [Math.max(28, (f.rows || 3) * 13)], body: [[{ text: shown, fontSize: 9.5 }]] },
        layout: { hLineColor: () => '#9aa1ac', vLineColor: () => '#9aa1ac', hLineWidth: () => 0.5, vLineWidth: () => 0.5 } }
        : { text: shown || ' ', fontSize: 10, margin: [0, 1, 0, 0] },
      ...(box ? [] : [{ canvas: [{ type: 'line', x1: 0, y1: 1, x2: w, y2: 1, lineWidth: 0.5, lineColor: '#9aa1ac' }] }]),
    ],
    margin: [0, f.type === 'signature' ? 14 : 4, 6, 4],
  };
}

// Wording with its blanks: a filled blank is the value, underlined; an empty one a line to write on.
function paragraph(f, valueOf) {
  const parts = [];
  let last = 0;
  for (const m of f.text.matchAll(BLANK_TOKEN)) {
    if (m.index > last) parts.push({ text: f.text.slice(last, m.index) });
    const b = (f.blanks || []).find((x) => x.key === m[1]);
    const v = valueOf(blankId(f.id, m[1]));
    parts.push(v != null && v !== '' ? { text: ` ${v} `, decoration: 'underline' }
      : { text: '_'.repeat(BLANK_LEN[b?.size] || 22) });
    last = m.index + m[0].length;
  }
  if (last < f.text.length) parts.push({ text: f.text.slice(last) });
  return { text: parts, fontSize: FONT[f.size] || 9.5, bold: f.bold, italics: f.italic, alignment: f.align || 'left',
    lineHeight: 1.25, margin: [0, 3, 0, 5] };
}

function rows(fields, valueOf) {
  const out = [];
  let row = []; let used = 0;
  const flush = () => {
    if (!row.length) return;
    const filler = 12 - used;
    out.push({ columns: [...row.map(([f, span]) => ({ width: `${(span / 12) * 100}%`, ...inputCell(f, valueOf(f.id), span) })),
      ...(filler > 0 ? [{ width: `${(filler / 12) * 100}%`, text: '' }] : [])], columnGap: 6 });
    row = []; used = 0;
  };
  for (const f of fields) {
    if (['heading', 'paragraph', 'divider', 'spacer'].includes(f.type)) {
      flush();
      if (f.type === 'heading') out.push({ text: f.text, bold: true, fontSize: HEADING[f.level] || 12, color: HEAD,
        alignment: f.align || 'left', margin: [0, 8, 0, 3] });
      else if (f.type === 'paragraph') out.push(paragraph(f, valueOf));
      else if (f.type === 'divider') out.push({ canvas: [{ type: 'line', x1: 0, y1: 4, x2: WIDTH, y2: 4, lineWidth: 0.6, lineColor: '#c3c9d3' }], margin: [0, 4, 0, 6] });
      else out.push({ text: ' ', margin: [0, 6, 0, 6] });
      continue;
    }
    const span = SPAN[f.width] || 12;
    if (used + span > 12) flush();
    row.push([f, span]); used += span;
    if (used >= 12) flush();
  }
  flush();
  return out;
}

/**
 * @param {object} schema  the form
 * @param {Record<string, any>} data  field / blank id (or id#n) -> value
 * @param {{ dealer: string, trades: number, stamp?: string, footer?: string }} opts
 */
export function formPdf(schema, data, { dealer = '', trades = 0, stamp = null, footer = '' } = {}) {
  const content = [
    { text: dealer, fontSize: 9, color: MUTED },
    { text: schema.title, fontSize: 16, bold: true, color: HEAD, alignment: 'center', margin: [0, 2, 0, 4] },
    ...(schema.description ? [{ text: schema.description, fontSize: 9, alignment: 'center', margin: [0, 0, 0, 6] }] : []),
  ];
  for (const s of schema.sections) {
    const copies = s.repeat === 'trade_in' ? Math.max(1, trades) : 1;
    for (let n = 0; n < copies; n += 1) {
      const title = s.repeat === 'trade_in' && copies > 1 ? `${s.title || 'Trade-in'} ${n + 1}` : s.title;
      if (title) {
        content.push({ table: { widths: ['*'], body: [[{ text: title, bold: true, fontSize: 10, color: '#ffffff',
          fillColor: HEAD, margin: [4, 2, 4, 2] }]] }, layout: 'noBorders', margin: [0, 10, 0, 4] });
      }
      const valueOf = (id) => data[dataKey(id, s.repeat === 'trade_in' ? n : null)];
      content.push(...rows(s.fields, valueOf));
    }
  }
  return renderPdf({
    pageSize: 'LETTER', pageMargins: [40, 40, 40, 44],
    info: { title: schema.title, creator: 'AutoPulse' },
    defaultStyle: { font: 'Helvetica', fontSize: 9.5, color: INK },
    ...(stamp ? { watermark: { text: stamp, color: '#c8ccd3', opacity: 0.25, bold: true } } : {}),
    footer: (page, pages) => ({ columns: [{ text: footer, color: MUTED, fontSize: 7 },
      { text: `Page ${page} of ${pages}`, alignment: 'right', color: MUTED, fontSize: 7 }], margin: [40, 12, 40, 0] }),
    content,
  });
}
