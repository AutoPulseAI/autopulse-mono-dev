// Reading and filling the dealer's PDF (SOW v6 Deliverable K, gaps G-064 / G-065), with pdf-lib.
//   inspectPdf  - is it fillable, its form fields, its page sizes
//   fillPdf     - the mapped values written in: into the PDF's own fields (fillable), or as text at the placed
//                 positions (flat PDF); trade-ins beyond the form's trade sections go on an added "Trade-in schedule"
//                 page. The result is flattened, so the printed values can't be edited afterwards.
//   layoutPdf   - the blank form with each mapped box / field labelled and an optional grid, to check the mapping.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const MAX_BYTES = 15 * 1024 * 1024;

export async function inspectPdf(buffer) {
  if (!buffer?.length) throw Object.assign(new Error('The file is empty'), { status: 400 });
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('The PDF is larger than 15 MB'), { status: 400 });
  if (buffer.subarray(0, 5).toString() !== '%PDF-') throw Object.assign(new Error('That file is not a PDF'), { status: 400 });
  let pdf;
  try {
    pdf = await PDFDocument.load(buffer, { updateMetadata: false });
  } catch (error) {
    throw Object.assign(new Error(/encrypt/i.test(error?.message || '') ? 'The PDF is password-protected: upload an '
      + 'unlocked copy' : 'The PDF could not be read'), { status: 400 });
  }
  const fields = pdf.getForm().getFields().map((f) => ({ name: f.getName(), type: f.constructor.name.replace(/^PDF/, '') }));
  return { fillable: fields.length > 0, fields,
    pages: pdf.getPages().map((p) => ({ width: Math.round(p.getWidth()), height: Math.round(p.getHeight()) })) };
}

// The highest trade-in section the mapping uses (trade2.* -> 2).
export function mappedTradeSlots(mapping) {
  return Math.max(0, ...mapping.map((m) => Number((/^trade(\d+)\./.exec(m.source) || [])[1] || 0)));
}

function fitText(font, value, size, maxWidth) {
  let s = value;
  while (s.length > 1 && maxWidth && font.widthOfTextAtSize(s, size) > maxWidth) s = s.slice(0, -1);
  return s;
}

function addTradeSchedule(pdf, font, bold, trades, { first, title }) {
  let page = pdf.addPage([612, 792]);
  let y = 740;
  page.drawText(title, { x: 50, y, size: 14, font: bold });
  y -= 28;
  trades.forEach((t, i) => {
    if (y < 160) { page = pdf.addPage([612, 792]); y = 740; }
    page.drawText(`Trade-in ${first + i}`, { x: 50, y, size: 11, font: bold });
    y -= 16;
    const rows = [['Vehicle', t.description], ['VIN', t.vin], ['Mileage', t.miles], ['Color', t.color],
      ['Trade offer', t.offer], ['ACV', t.acv], ['Payoff', t.payoff], ['Lienholder', t.lienholder]].filter(([, v]) => v);
    for (const [label, value] of rows) {
      page.drawText(`${label}:`, { x: 60, y, size: 10, font: bold });
      page.drawText(String(value), { x: 150, y, size: 10, font });
      y -= 14;
    }
    y -= 10;
  });
}

/**
 * @param {Buffer} buffer      the template version's PDF
 * @param {object[]} mapping   [{ field } | { page, x, y, size }, source]
 * @param {Record<string,string>} values  source -> text ('' = missing, left blank)
 * @param {{ allTrades?: object[] }} opts  every trade-in picked (those past the mapped sections go on a schedule)
 */
export async function fillPdf(buffer, mapping, values, { allTrades = [] } = {}) {
  const pdf = await PDFDocument.load(buffer, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();
  const pages = pdf.getPages();
  for (const m of mapping) {
    const value = values[m.source] ?? '';
    if (!value) continue;
    if (m.field) {
      let field;
      try { field = form.getField(m.field); } catch { continue; } // a field the new version no longer has
      const kind = field.constructor.name;
      if (kind === 'PDFTextField') field.setText(String(value));
      else if (kind === 'PDFCheckBox') { if (/^(yes|true|x|1)$/i.test(String(value))) field.check(); }
      else if (kind === 'PDFDropdown' || kind === 'PDFOptionList') {
        if (field.getOptions().includes(String(value))) field.select(String(value));
      } else if (kind === 'PDFRadioGroup') {
        if (field.getOptions().includes(String(value))) field.select(String(value));
      }
    } else if (m.page && pages[m.page - 1]) {
      const page = pages[m.page - 1];
      const size = Number(m.size) || 10;
      page.drawText(fitText(font, String(value), size, page.getWidth() - Number(m.x) - 10),
        { x: Number(m.x), y: Number(m.y), size, font, color: rgb(0, 0, 0) });
    }
  }
  try { form.updateFieldAppearances(font); form.flatten(); } catch { /* a form with odd widgets: values stay as set */ }
  const slots = mappedTradeSlots(mapping);
  if (allTrades.length > slots) {
    addTradeSchedule(pdf, font, bold, allTrades.slice(slots), { first: slots + 1,
      title: slots ? 'Trade-in schedule (additional trade-ins)' : 'Trade-in schedule' });
  }
  return Buffer.from(await pdf.save());
}

/** The blank form with each mapped place labelled ("Customer: Full name") and, if asked, a 50-point grid. */
export async function layoutPdf(buffer, mapping, labelOf, { grid = false } = {}) {
  const pdf = await PDFDocument.load(buffer, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const form = pdf.getForm();
  const pages = pdf.getPages();
  if (grid) {
    for (const page of pages) {
      const w = page.getWidth(); const h = page.getHeight();
      for (let x = 0; x <= w; x += 50) {
        page.drawLine({ start: { x, y: 0 }, end: { x, y: h }, thickness: 0.3, color: rgb(0.6, 0.75, 0.95) });
        page.drawText(String(x), { x: x + 1, y: 2, size: 6, font, color: rgb(0.2, 0.4, 0.8) });
      }
      for (let y = 0; y <= h; y += 50) {
        page.drawLine({ start: { x: 0, y }, end: { x: w, y }, thickness: 0.3, color: rgb(0.6, 0.75, 0.95) });
        page.drawText(String(y), { x: 2, y: y + 1, size: 6, font, color: rgb(0.2, 0.4, 0.8) });
      }
    }
  }
  for (const m of mapping) {
    const label = `[${labelOf(m.source)}]`;
    if (m.field) {
      try {
        const field = form.getField(m.field);
        if (field.constructor.name === 'PDFTextField') field.setText(label);
      } catch { /* not on this version */ }
    } else if (m.page && pages[m.page - 1]) {
      pages[m.page - 1].drawText(label, { x: Number(m.x), y: Number(m.y), size: Number(m.size) || 10, font,
        color: rgb(0.8, 0.1, 0.1) });
    }
  }
  try { form.updateFieldAppearances(font); } catch { /* preview only */ }
  return Buffer.from(await pdf.save());
}
