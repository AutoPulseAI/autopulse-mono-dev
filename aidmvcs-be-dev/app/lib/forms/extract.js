// The first draft of an on-screen form, read from the dealer's PDF (SOW v6 Deliverable K; the user, 13 Nov 2026:
// "they can upload a PDF, we extract all the information, create a replica of the form and give them an editable
// format"). The dealer then corrects it in the builder - this is a starting point, not the final form.
//
// Read from a digital PDF (text inside it, made by Word / Acrobat / a DMS):
//   - the PDF's own form fields (a fillable PDF), labelled by the text next to / above them
//   - blanks in the text: "Buyer Name: ________", several on one line ("Date ____  Stock # ____"), "Label:" with
//     nothing after it, checkboxes ("[ ] Yes", "☐ Financing")
//   - headings (larger or ALL-CAPS short lines) start sections; the biggest line on page 1 is the title
//   - every other line is kept as wording (a text block), so the form's own text isn't lost
// A field's type (date, money, phone, signature...) and the CRM value that fills it are guessed from its label; the
// dealer checks both. A scanned PDF (a picture, no text) can't be read: it is refused with a plain message.
import { PDFDocument } from 'pdf-lib';
import { getDocumentProxy } from 'unpdf';
import { newId } from './schema.js';

const MAX_BYTES = 15 * 1024 * 1024;
const BLANK = /_{3,}|\.{6,}/;
const BLANK_FIELD = /([A-Za-z#][^_:$]{0,70}?)\s*:?\s*\$?\s*(?:_{3,}|\.{6,})/g;
const CHECKBOX = /(?:\[\s?\]|☐|□|❑)\s*([^[☐□❑]{1,80})/g;

const TYPE_RULES = [
  [/sign(ature)?\b/i, 'signature'], [/\b(date|dob|birth|delivered on)\b/i, 'date'],
  [/(price|amount|fee|tax|total|balance|payment|payoff|down|rebate|cost|\$|acv|allowance|value|offer|registration)/i, 'money'],
  [/e-?mail/i, 'email'], [/\b(phone|cell|mobile|tel|fax)\b/i, 'phone'],
  [/\b(miles|mileage|odometer|year|zip|postal|term|months)\b/i, 'number'],
];
const SOURCE_RULES = [
  [/^(buyer|customer|purchaser|client)('?s)?\s*(full\s*)?name$|^name$/i, 'customer.full_name'],
  [/first\s*name/i, 'customer.first_name'], [/last\s*name|surname/i, 'customer.last_name'],
  [/(street|^address|home address|buyer'?s? address)/i, 'customer.address_line'], [/^city/i, 'customer.city'],
  [/^state/i, 'customer.state'], [/^(zip|postal)/i, 'customer.zip'], [/e-?mail/i, 'customer.email'],
  [/\b(phone|cell|mobile)\b/i, 'customer.phone'], [/^(vehicle\s*)?vin|serial/i, 'vehicle.vin'],
  [/^(vehicle\s*)?year$/i, 'vehicle.year'], [/^(vehicle\s*)?make$/i, 'vehicle.make'], [/^(vehicle\s*)?model$/i, 'vehicle.model'],
  [/stock/i, 'vehicle.stock_number'], [/sales\s*(person|consultant|rep)/i, 'staff.salesperson'],
  [/sales\s*manager/i, 'staff.sales_manager'], [/dealer(ship)?\s*name/i, 'dealer.name'],
];

const typeFor = (label) => (TYPE_RULES.find(([re]) => re.test(label)) || [null, 'text'])[1];
const sourceFor = (label) => (SOURCE_RULES.find(([re]) => re.test(label.trim())) || [null, null])[1];
const tidy = (s) => String(s || '').replace(/[_.]{3,}/g, ' ').replace(/\s+/g, ' ').replace(/[\s:–-]+$/, '').trim();
const humanize = (name) => tidy(String(name).replace(/[\[\].]+\d*/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')).replace(/^\w/, (c) => c.toUpperCase());

function field(label, type = null, extra = {}) {
  const l = tidy(label).slice(0, 200);
  const t = type || typeFor(l);
  const source = t === 'signature' || t === 'checkbox' ? null : sourceFor(l);
  return { id: newId(), type: t, label: l, required: false, width: 'full', options: [], source, help: null, text: null,
    ...extra };
}

// Text items -> lines (same page, same baseline), left to right.
function toLines(items) {
  const lines = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const line = lines.find((l) => l.page === it.page && Math.abs(l.y - it.y) <= 2.5);
    if (line) { line.parts.push(it); line.size = Math.max(line.size, it.size); }
    else lines.push({ page: it.page, y: it.y, size: it.size, parts: [it] });
  }
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    l.x = l.parts[0].x;
    l.text = l.parts.reduce((acc, p, i) => {
      if (!i) return p.str;
      const prev = l.parts[i - 1];
      const gap = p.x - (prev.x + prev.w);
      return acc + (gap > 12 ? '   ' : gap > 1 ? ' ' : '') + p.str;
    }, '').replace(/\s+$/, '');
    // Phrases: the words of a line that sit together (a gap under 8 points), each with where it starts and ends.
    l.phrases = [];
    for (const p of l.parts) {
      const last = l.phrases[l.phrases.length - 1];
      if (last && p.x - last.xEnd < 8) { last.text += (p.x - last.xEnd > 1 ? ' ' : '') + p.str; last.xEnd = p.x + p.w; }
      else l.phrases.push({ text: p.str, x: p.x, xEnd: p.x + p.w, line: l });
    }
    l.phrases = l.phrases.filter((ph) => ph.text.trim());
  }
  return lines.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
}

async function readText(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const items = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    for (const it of content.items) {
      if (typeof it.str !== 'string') continue;
      items.push({ page: n, str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0,
        size: Math.round(Math.abs(it.transform[0]) || Math.abs(it.transform[3]) || 10) });
    }
  }
  return { items, pages: pdf.numPages };
}

// The PDF's own form fields (a fillable PDF), with their page and position.
async function readAcroFields(pdfDoc) {
  const pages = pdfDoc.getPages();
  const out = [];
  for (const f of pdfDoc.getForm().getFields()) {
    const widget = f.acroField.getWidgets()[0];
    if (!widget) continue;
    const rect = widget.getRectangle();
    const ref = widget.P();
    let page = pages.findIndex((p) => p.ref === ref) + 1;
    if (page < 1) page = 1;
    const kind = f.constructor.name;
    const type = kind === 'PDFCheckBox' ? 'checkbox' : kind === 'PDFDropdown' || kind === 'PDFOptionList' ? 'select'
      : kind === 'PDFRadioGroup' ? 'radio' : kind === 'PDFSignature' ? 'signature' : null;
    let options = [];
    try { if (type === 'select' || type === 'radio') options = f.getOptions(); } catch { options = []; }
    out.push({ name: f.getName(), page, x: rect.x, y: rect.y, w: rect.width, h: rect.height, type, options });
  }
  return out;
}

/**
 * @returns {Promise<{schema: object, fillable: boolean, pages: number, found: {fields: number, sections: number}}>}
 */
export async function extractForm(buffer, { fallbackTitle = 'Form' } = {}) {
  if (!buffer?.length) throw Object.assign(new Error('The file is empty'), { status: 400 });
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('The PDF is larger than 15 MB'), { status: 400 });
  if (buffer.subarray(0, 5).toString() !== '%PDF-') throw Object.assign(new Error('That file is not a PDF'), { status: 400 });
  let pdfDoc;
  try { pdfDoc = await PDFDocument.load(buffer, { updateMetadata: false }); } catch (e) {
    throw Object.assign(new Error(/encrypt/i.test(e?.message || '') ? 'The PDF is password-protected: upload an unlocked copy'
      : 'The PDF could not be read'), { status: 400 });
  }
  const { items, pages } = await readText(buffer);
  const acro = await readAcroFields(pdfDoc);
  const textChars = items.reduce((n, it) => n + it.str.trim().length, 0);
  if (textChars < 20 && !acro.length) {
    throw Object.assign(new Error('This PDF is a scan (a picture of the page), so its text can\'t be read. Upload the '
      + 'digital version of the form (from Word, Acrobat or your DMS), or start a blank form and type it in.'), { status: 422 });
  }
  const lines = toLines(items);
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 10;
  const first = lines.filter((l) => l.page === 1).sort((a, b) => b.size - a.size || b.y - a.y)[0];
  const title = first && first.size > body * 1.2 ? tidy(first.text) : fallbackTitle;

  // Each AcroForm field's label: the words just to its left on the same row (a checkbox: just to its right), else the
  // words just above it. Words used as a label are not repeated as wording.
  const used = new Set();
  const phrases = lines.flatMap((l) => l.phrases.map((ph) => ({ ...ph, page: l.page, y: l.y })));
  const free = (ph) => !used.has(`${ph.page}:${ph.y}:${ph.x}`) && !BLANK.test(ph.text) && tidy(ph.text).length <= 80;
  const take = (ph) => { used.add(`${ph.page}:${ph.y}:${ph.x}`); return tidy(ph.text); };
  const acroEntries = acro.map((a) => {
    const onRow = phrases.filter((ph) => ph.page === a.page && ph.y >= a.y - 3 && ph.y <= a.y + a.h + 2 && free(ph));
    const near = a.type === 'checkbox'
      ? onRow.filter((ph) => ph.x >= a.x + a.w - 2 && ph.x - (a.x + a.w) < 40).sort((p, q) => p.x - q.x)[0]
      : onRow.filter((ph) => ph.xEnd <= a.x + 4 && a.x - ph.xEnd < 160).sort((p, q) => q.xEnd - p.xEnd)[0]
        || phrases.filter((ph) => ph.page === a.page && ph.y > a.y + a.h - 2 && ph.y - (a.y + a.h) < 16
          && Math.abs(ph.x - a.x) < 60 && free(ph)).sort((p, q) => p.y - q.y)[0];
    const label = near ? take(near) : humanize(a.name);
    const width = a.w >= 300 ? 'full' : a.w >= 150 ? 'half' : 'third';
    const type = a.type || (a.h >= 40 ? 'textarea' : null);
    return { page: a.page, y: a.y + a.h, x: a.x, field: { ...field(label, type, a.options.length ? { options: a.options } : {}), width } };
  });

  // Text lines -> headings, blanks, checkboxes, wording.
  const textEntries = [];
  for (const l of lines) {
    if (l === first && title !== fallbackTitle) continue;
    // A line whose words were all taken as field labels has nothing left; otherwise only what is left is read.
    const rest = l.phrases.filter((ph) => !used.has(`${l.page}:${l.y}:${ph.x}`));
    if (!rest.length) continue;
    const t = (rest.length === l.phrases.length ? l.text : rest.map((ph) => ph.text).join('   ')).trim();
    const isHeading = !BLANK.test(t) && t.length <= 70 && (l.size > body * 1.15 || (t === t.toUpperCase() && /[A-Z]{3}/.test(t)
      && t.split(' ').length <= 8 && !t.endsWith(':')));
    if (isHeading) { textEntries.push({ page: l.page, y: l.y, x: l.x, heading: tidy(t) }); continue; }
    // Each part of the line (parts are apart by a wide gap): blanks, checkboxes, or "Label:" with nothing after it.
    const fields = [];
    const parts = t.split(/\s{3,}/);
    for (const part of parts) {
      const before = fields.length;
      for (const m of part.matchAll(BLANK_FIELD)) if (tidy(m[1])) fields.push(field(m[1]));
      for (const m of part.matchAll(CHECKBOX)) if (tidy(m[1])) fields.push(field(m[1], 'checkbox'));
      if (fields.length === before && /^[A-Za-z][^:]{1,50}:\s*\$?$/.test(part.trim()) && (parts.length > 1
        || part.trim().length <= 40)) fields.push(field(part));
    }
    if (fields.length) {
      const width = fields.length === 2 ? 'half' : fields.length >= 3 ? 'third' : 'full';
      fields.forEach((f, i) => textEntries.push({ page: l.page, y: l.y, x: l.x + i, field: { ...f, width } }));
      continue;
    }
    textEntries.push({ page: l.page, y: l.y, x: l.x, words: t });
  }

  // In reading order; wording lines next to each other become one text block.
  const all = [...acroEntries, ...textEntries].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const sections = [{ id: newId('s'), title: '', repeat: null, fields: [] }];
  let paragraph = null;
  for (const e of all) {
    const current = sections[sections.length - 1];
    if (e.words) {
      if (paragraph && paragraph.page === e.page && paragraph.lastY - e.y < 18) {
        paragraph.field.text += ` ${e.words}`; paragraph.lastY = e.y; continue;
      }
      const f = { id: newId(), type: 'paragraph', label: '', required: false, width: 'full', options: [], source: null,
        help: null, text: e.words };
      current.fields.push(f);
      paragraph = { field: f, page: e.page, lastY: e.y };
      continue;
    }
    paragraph = null;
    if (e.heading) {
      if (!current.fields.length && !current.title) current.title = e.heading;
      else sections.push({ id: newId('s'), title: e.heading, repeat: /trade/i.test(e.heading) ? 'trade_in' : null, fields: [] });
      continue;
    }
    current.fields.push(e.field);
  }
  for (const s of sections) {
    for (const f of s.fields) if (f.type === 'paragraph') f.text = f.text.slice(0, 4000);
    if (s.repeat === 'trade_in') {
      for (const f of s.fields) {
        const k = { year: 'trade.year', make: 'trade.make', model: 'trade.model', vin: 'trade.vin', miles: 'trade.miles',
          mileage: 'trade.miles', odometer: 'trade.miles', payoff: 'trade.payoff', lienholder: 'trade.lienholder',
          color: 'trade.color', acv: 'trade.acv', allowance: 'trade.offer', trim: 'trade.trim' };
        const hit = Object.keys(k).find((w) => new RegExp(`\\b${w}\\b`, 'i').test(f.label || ''));
        if (hit && f.type !== 'paragraph') f.source = k[hit];
      }
    }
  }
  const kept = sections.filter((s) => s.fields.length || s.title);
  return { schema: { title, description: null, sections: kept.length ? kept : sections }, fillable: acro.length > 0,
    pages, found: { fields: kept.reduce((n, s) => n + s.fields.filter((f) => f.type !== 'paragraph').length, 0),
      sections: kept.length } };
}
