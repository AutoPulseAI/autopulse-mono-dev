// Finds the blanks of a dealer's PDF form and what customer data goes in each (the user, 16 Nov 2026, after the
// meeting: "whenever a dealership uploads their form ... the customer data must be mapped into that form
// automatically" - no editing, no builder; the dealer's own PDF is filled and downloaded).
//
// Two kinds of blank:
//   - a fillable PDF's own fields (made in Acrobat): their position comes from the PDF; the label is the text just
//     left of / above the field, else the field's name
//   - in a digital PDF's text, a run of underscores ("Buyer Name: ________"), several per line too: the position is
//     the underscores' own place on the page; the label is the words just before them on the line
// Each blank is matched to a customer-data key by its label (and the section it is in: a "Trade-in" heading makes
// Year / Make / VIN the trade-in's). A blank nothing matches stays empty on export - nothing is made up. A scanned
// PDF (a picture, no text and no fields) has nothing to read: it is refused with a plain message.
import { PDFDocument, PDFTextField } from 'pdf-lib';
import { getDocumentProxy } from 'unpdf';

const MAX_BYTES = 15 * 1024 * 1024;
const BLANK_RUN = /_{3,}/g;

// label (lower case, no punctuation) -> data key. First match wins; order matters (specific before general).
const RULES = [
  [/\b(sign|signature|initial)/, null],
  [/\b(dob|birth|ssn|social security|license|licence|credit|bank|routing|account)\b/, null],
  [/\bco ?buyer\b|\bco ?applicant\b|\bco ?signer\b/, null],
  [/\b(price|fee|fees|tax|payment|amount|total|due|down|rebate|cost|deposit|registration|allowance)\b/, null],
  [/\bfirst name\b/, 'customer.first_name'], [/\b(last name|surname)\b/, 'customer.last_name'],
  [/\b(e ?mail)\b/, 'customer.email'],
  [/\b(phone|cell|mobile|telephone)\b/, 'customer.phone'],
  [/\b(street|address)\b/, 'customer.address_full'], [/^city\b/, 'customer.city'], [/^state\b/, 'customer.state'],
  [/\b(zip|postal)\b/, 'customer.zip'],
  [/\bvin\b|\bserial\b/, 'vehicle.vin'], [/\bstock\b/, 'vehicle.stock_number'],
  [/^(vehicle )?year\b/, 'vehicle.year'], [/^(vehicle )?make\b/, 'vehicle.make'], [/^(vehicle )?model\b/, 'vehicle.model'],
  [/^(vehicle )?trim\b/, 'vehicle.trim'], [/\b(mileage|miles|odometer)\b/, 'vehicle.mileage'],
  [/\b(vehicle|year make model)\b/, 'vehicle.description'],
  [/\bsales ?(person|consultant|rep|associate)\b/, 'staff.salesperson'], [/\bsales manager\b/, 'staff.sales_manager'],
  [/\b(releasee|seller|lessor)\b|\b(dealer|dealership)( name)?$/, 'dealer.name'],
  [/^(date|today'?s date|date signed)$/, 'date.today'],
  [/\b(name|buyer|customer|purchaser|consentee|client|applicant|print name|printed name)\b/, 'customer.full_name'],
];
const TRADE_KEYS = { 'vehicle.year': 'trade.year', 'vehicle.make': 'trade.make', 'vehicle.model': 'trade.model',
  'vehicle.trim': 'trade.trim', 'vehicle.vin': 'trade.vin', 'vehicle.mileage': 'trade.miles',
  'vehicle.description': 'trade.description' };
const TRADE_ONLY = [[/\bpayoff\b/, 'trade.payoff'], [/\blien ?holder\b/, 'trade.lienholder'], [/\bacv\b/, 'trade.acv'],
  [/\b(trade|allowance) (offer|value|allowance)\b|\btrade allowance\b/, 'trade.offer'], [/\bcolou?r\b/, 'trade.color']];

const clean = (s) => String(s || '').replace(/[_.]{2,}/g, ' ').replace(/[^a-zA-Z0-9#' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const humanize = (name) => clean(String(name).replace(/\[\d+\]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.-]+/g, ' '));

/** The data key for a blank's label, or null. `trade` = the blank is in a trade-in part of the form; `party` =
 * 'dealer' when the sentence is about the dealership (a Releasee's / seller's address is the dealer's). */
export function matchSource(label, { trade = false, party = 'customer' } = {}) {
  const l = clean(label).toLowerCase();
  if (!l) return null;
  if (party === 'dealer') {
    if (/\b(address|street)\b/.test(l)) return 'dealer.address';
    if (/\b(phone|telephone)\b/.test(l)) return 'dealer.phone';
    if (/\b(e ?mail)\b/.test(l)) return 'dealer.email';
  }
  if (trade) for (const [re, key] of TRADE_ONLY) if (re.test(l)) return key;
  if (trade && /\b(payoff|lien|acv)\b/.test(l)) return null;
  if (/\btrade\b/.test(l)) {
    for (const [re, key] of TRADE_ONLY) if (re.test(l)) return key;
    const base = RULES.find(([re]) => re.test(l.replace(/\btrade( in)?\b/, '').trim()));
    return base?.[1] ? TRADE_KEYS[base[1]] || null : null;
  }
  const hit = RULES.find(([re]) => re.test(l));
  if (!hit || !hit[1]) return null;
  if (trade && TRADE_KEYS[hit[1]]) return TRADE_KEYS[hit[1]];
  return hit[1] === 'vehicle.mileage' ? null : hit[1]; // the CRM has no current mileage for the car being bought
}

async function textLines(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const lines = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    for (const it of content.items) {
      if (typeof it.str !== 'string' || !it.str.length) continue;
      const item = { page: n, str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0,
        size: Math.abs(it.transform[0]) || Math.abs(it.transform[3]) || 10 };
      const line = lines.find((l) => l.page === n && Math.abs(l.y - item.y) <= 2.5);
      if (line) line.items.push(item); else lines.push({ page: n, y: item.y, items: [item] });
    }
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => a.page - b.page || b.y - a.y);
}

// A heading line (short, upper case or larger) sets the part of the form the next blanks are in.
const isHeading = (text) => text.length <= 60 && !/_{3,}/.test(text) && /[A-Z]{3}/.test(text) && text === text.toUpperCase();

/**
 * @returns {Promise<{ fillable: boolean, pages: number, fields: Array<{ id, label, source, page, x, y, w, h, size,
 *   pdf_field?: string, kind: 'pdf_field' | 'blank' }> }>}
 */
export async function detectFields(buffer) {
  if (!buffer?.length) throw Object.assign(new Error('The file is empty'), { status: 400 });
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('The PDF is larger than 15 MB'), { status: 400 });
  if (buffer.subarray(0, 5).toString() !== '%PDF-') throw Object.assign(new Error('That file is not a PDF'), { status: 400 });
  let doc;
  try { doc = await PDFDocument.load(buffer, { updateMetadata: false }); } catch (e) {
    throw Object.assign(new Error(/encrypt/i.test(e?.message || '') ? 'The PDF is password-protected: upload an unlocked copy'
      : 'The PDF could not be read'), { status: 400 });
  }
  const pages = doc.getPages();
  const lines = await textLines(buffer);
  // A form whose title is about a trade-in (a "Trade-In Appraisal Worksheet"): its vehicle is the trade-in.
  const title = lines.filter((l) => l.page === 1).map((l) => l.items.map((i) => i.str).join(' ').trim()).find(isHeading) || '';
  const tradeDoc = /trade/i.test(title);
  const fields = [];
  let n = 0;

  // 1. A fillable PDF's own fields.
  const acro = doc.getForm().getFields();
  for (const f of acro) {
    const widget = f.acroField.getWidgets()[0];
    if (!widget) continue;
    const r = widget.getRectangle();
    const page = Math.max(1, pages.findIndex((p) => p.ref === widget.P()) + 1);
    // instanceof, not the class name: the live build shortens class names, so a name check matched nothing.
    if (!(f instanceof PDFTextField)) continue; // checkboxes, choices, signatures: left for the person
    // Its label: the nearest words to its left on the same row, else just above it.
    const row = lines.filter((l) => l.page === page && l.y >= r.y - 3 && l.y <= r.y + r.height + 2)
      .flatMap((l) => l.items).filter((it) => it.x + it.w <= r.x + 4 && r.x - (it.x + it.w) < 160 && clean(it.str))
      .sort((a, b) => b.x - a.x)[0];
    const above = !row && lines.filter((l) => l.page === page && l.y > r.y + r.height - 2 && l.y - (r.y + r.height) < 16)
      .flatMap((l) => l.items).filter((it) => Math.abs(it.x - r.x) < 60 && clean(it.str)).sort((a, b) => a.y - b.y)[0];
    const label = clean((row || above)?.str) || humanize(f.getName());
    const heading = lines.filter((l) => l.page < page || (l.page === page && l.y > r.y)).reverse()
      .map((l) => l.items.map((i) => i.str).join(' ').trim()).find(isHeading) || '';
    fields.push({ id: `f${(n += 1)}`, kind: 'pdf_field', pdf_field: f.getName(), label, page, x: r.x, y: r.y, w: r.width,
      h: r.height, size: Math.min(11, Math.max(7, r.height * 0.6)),
      source: matchSource(label, { trade: tradeDoc || /trade/i.test(heading) })
        || matchSource(humanize(f.getName()), { trade: tradeDoc || /trade/i.test(heading) }) });
  }

  // 2. Underscore blanks in the text (a flat PDF; a fillable one only where no field covers the blank).
  // The label is the words just before the blank on its line; a blank that starts a line takes the end of the line
  // before ("with a mailing address of / ________"). Who the sentence is about (customer / dealership) follows the last
  // party named ("Consentee:" / "Releasee:").
  const labelOf = (words) => {
    const t = clean(String(words).replace(/[:\u2013-]\s*$/, '')).replace(/\s+/g, ' ').trim();
    const after = t.includes(':') ? t.slice(t.lastIndexOf(':') + 1).trim() : t;
    return (after || t).split(' ').slice(-6).join(' ');
  };
  let heading = '';
  let party = 'customer';
  let carry = '';
  for (const line of lines) {
    const text = line.items.map((i) => i.str).join(' ').trim();
    if (isHeading(text)) { heading = text; carry = ''; continue; }
    let before = '';
    for (const it of line.items) {
      const perChar = it.str.length ? it.w / it.str.length : 0;
      let last = 0;
      for (const m of it.str.matchAll(BLANK_RUN)) {
        before += ` ${it.str.slice(last, m.index)}`;
        last = m.index + m[0].length;
        if (/\b(releasee|seller|dealer|dealership|lessor)\b/i.test(before)) party = 'dealer';
        else if (/\b(consentee|buyer|customer|purchaser|applicant|lessee|co-?buyer)\b/i.test(before)) party = 'customer';
        const x = it.x + perChar * m.index;
        const w = perChar * m[0].length;
        const covered = fields.some((f) => f.kind === 'pdf_field' && f.page === line.page
          && Math.abs(f.y - line.y) < 12 && f.x < x + w && f.x + f.w > x);
        const label = labelOf(clean(before) ? before : carry);
        before = '';
        if (covered || w < 15) continue;
        fields.push({ id: `f${(n += 1)}`, kind: 'blank', label, page: line.page, x: x + 1, y: line.y + 1, w, h: it.size,
          size: Math.min(10, Math.max(7, it.size * 0.9)),
          source: matchSource(label, { trade: tradeDoc || /trade/i.test(heading), party }) });
      }
      before += ` ${it.str.slice(last)}`;
    }
    carry = before.trim() ? before : '';
  }

  const textChars = lines.reduce((t, l) => t + l.items.reduce((s, i) => s + i.str.trim().length, 0), 0);
  if (!fields.length && textChars < 20) {
    throw Object.assign(new Error('This PDF is a scan (a picture of the page), so its blanks can\'t be found. Upload the '
      + 'digital version of the form (from Word, Acrobat or your DMS).'), { status: 422 });
  }
  return { fillable: acro.length > 0, pages: pages.length, fields };
}

/**
 * Forms uploaded while the live build couldn't see fillable fields (16 Nov 2026: class names are shortened in the
 * build, so every fillable field was skipped and the form showed "0 of 0") are read again from their stored PDF the
 * next time the library lists them. Returns how many forms were fixed.
 */
export async function redetectEmpty(templates, { readFile, Model }) {
  let fixed = 0;
  for (const t of templates) {
    const v = (t.versions || []).find((x) => x.version === t.current_version);
    if (!v?.source_file_id || !Array.isArray(v.fields) || v.fields.length || v.redetected) continue;
    try {
      const found = await detectFields(await readFile(v.source_file_id));
      await Model.updateOne({ _id: t._id, 'versions.version': v.version }, { $set: { 'versions.$.fields': found.fields,
        'versions.$.fillable': found.fillable, 'versions.$.redetected': true } });
      v.fields = found.fields; v.fillable = found.fillable;
      fixed += 1;
    } catch { /* stays as it is */ }
  }
  return fixed;
}
