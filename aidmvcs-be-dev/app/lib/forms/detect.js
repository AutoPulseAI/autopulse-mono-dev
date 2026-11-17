// Finds the blanks of a dealer's PDF form and what customer data goes in each (the user, 16 Nov 2026, after the
// meeting: "whenever a dealership uploads their form ... the customer data must be mapped into that form
// automatically" - no editing, no builder; the dealer's own PDF is filled and downloaded).
//
// Kinds of blank, read straight from the PDF (no AI):
//   - a fillable PDF's own fields (made in Acrobat): position from the PDF; label = the field's tooltip, else the text
//     just left of / above it, else the field's name
//   - a run of underscores in the text ("Buyer Name: ________"), several per line too
//   - a drawn write-in line ("Buyer Name:" then a ruled line), a signature-style line with its label under it, and a
//     boxed cell with a small caption at its top ("NAME" in a buyer's-order grid): read from the page's drawing
// Pages turned sideways (/Rotate) are read as they are seen; the text is written upright on them.
// Each blank is matched to a customer-data key by its label (and the section it is in: a "Trade-in" heading makes
// Year / Make / VIN the trade-in's). A blank nothing matches stays empty on export - nothing is made up.
// A scan (a picture of the page: a photo, a scanned PDF, a JPG) has no text or drawing to read: detectFields says so
// (scan: true) and lib/forms/read.js asks the AI to find its blanks (lib/forms/aiLocate.js).
import { PDFDocument, PDFName, PDFTextField } from 'pdf-lib';
import { getDocumentProxy, getResolvedPDFJS } from 'unpdf';

export const MAX_BYTES = 15 * 1024 * 1024;
const BLANK_RUN = /_{3,}/g;

// label (lower case, no punctuation) -> data key. First match wins; order matters (specific before general).
const RULES = [
  [/\b(sign|signature|initial|initials)\b/, null],
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

export const clean = (s) => String(s || '').replace(/[_.]{2,}/g, ' ').replace(/[^a-zA-Z0-9#' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const humanize = (name) => clean(String(name).replace(/\[\d+\]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.-]+/g, ' '));
export const fail = (message, status) => Object.assign(new Error(message), { status });

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

// ---------------------------------------------------------------------------------------------------------------
// The page as it is seen. Everything below works in "view" points: x to the right, y up, origin at the bottom left of
// the page as displayed (a page with /Rotate 90 is turned first). toUser() turns a view point back into the PDF's own
// coordinates, where the text is written (rotated by the page's rotation, so it reads upright).

const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const apply = (m, x, y) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

// Straight lines the page draws (rules, underlines, box edges), as horizontal and vertical segments in view points.
async function drawnSegments(page, OPS, toView) {
  let ops;
  try { ops = await page.getOperatorList(); } catch { return { h: [], v: [] }; }
  const h = []; const v = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let pending = [];
  const add = (a, b) => {
    const [x1, y1] = toView(...apply(ctm, ...a));
    const [x2, y2] = toView(...apply(ctm, ...b));
    if (Math.abs(y1 - y2) < 0.8 && Math.abs(x1 - x2) >= 1) h.push({ x0: Math.min(x1, x2), x1: Math.max(x1, x2), y: (y1 + y2) / 2 });
    else if (Math.abs(x1 - x2) < 0.8 && Math.abs(y1 - y2) >= 1) v.push({ x: (x1 + x2) / 2, y0: Math.min(y1, y2), y1: Math.max(y1, y2) });
  };
  const commit = () => {
    for (const p of pending) {
      if (p.rect) {
        const pts = p.rect.map(([x, y]) => toView(...apply(ctm, x, y)));
        const xs = pts.map((q) => q[0]); const ys = pts.map((q) => q[1]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const axis = pts.every((q, i) => { const r = pts[(i + 1) % 4]; return Math.abs(q[0] - r[0]) < 0.8 || Math.abs(q[1] - r[1]) < 0.8; });
        if (!axis) continue;
        if (y1 - y0 < 3 && x1 - x0 >= 1) h.push({ x0, x1, y: (y0 + y1) / 2 }); // a thin filled bar = a rule
        else if (x1 - x0 < 3 && y1 - y0 >= 1) v.push({ x: (x0 + x1) / 2, y0, y1 });
        else { h.push({ x0, x1, y: y0 }, { x0, x1, y: y1 }); v.push({ x: x0, y0, y1 }, { x: x1, y0, y1 }); }
      } else add(p.a, p.b);
    }
    pending = [];
  };
  const paint = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke,
    OPS.closeFillStroke, OPS.closeEOFillStroke]);
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i]; const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(args, ctm);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = mul(args[0], ctm); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.constructPath) {
      const [sub, coords] = args; let k = 0; let cur = null; let start = null;
      for (const op of sub) {
        if (op === OPS.moveTo) { cur = [coords[k], coords[k + 1]]; start = cur; k += 2; }
        else if (op === OPS.lineTo) { const p = [coords[k], coords[k + 1]]; k += 2; if (cur) pending.push({ a: cur, b: p }); cur = p; }
        else if (op === OPS.curveTo) { cur = [coords[k + 4], coords[k + 5]]; k += 6; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cur = [coords[k + 2], coords[k + 3]]; k += 4; }
        else if (op === OPS.closePath) { if (cur && start) pending.push({ a: cur, b: start }); cur = start; }
        else if (op === OPS.rectangle) {
          const [x, y, w, hh] = coords.slice(k, k + 4); k += 4;
          pending.push({ rect: [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]] });
          cur = [x, y]; start = cur;
        }
      }
    } else if (paint.has(fn)) commit();
    else if (fn === OPS.endPath) pending = []; // a clipping path: not drawn
  }
  // One line drawn in pieces = one line.
  h.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const merged = [];
  for (const s of h) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.y - s.y) <= 1.5 && s.x0 <= last.x1 + 1) last.x1 = Math.max(last.x1, s.x1);
    else merged.push({ ...s });
  }
  return { h: merged, v };
}

/**
 * Every page as it is seen: its text (pieces running left to right only) and drawn lines, in view points.
 * @returns {Promise<Array<{ page, width, height, rotate, toUser, items: Array<{str,x,y,w,size}>, h, v }>>}
 */
export async function readPages(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { OPS } = await getResolvedPDFJS();
  const out = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const toView = (x, y) => { const [vx, vy] = vp.convertToViewportPoint(x, y); return [vx, vp.height - vy]; };
    const toUser = (x, y) => vp.convertToPdfPoint(x, vp.height - y);
    const items = [];
    const content = await page.getTextContent();
    for (const it of content.items) {
      if (typeof it.str !== 'string' || !it.str.length || !it.transform) continue;
      const t = it.transform;
      const [x, y] = toView(t[4], t[5]);
      const [ax, ay] = toView(t[4] + t[0], t[5] + t[1]);
      const dx = ax - x; const dy = ay - y;
      if (!(dx > 0) || Math.abs(dy) > 0.15 * Math.hypot(dx, dy)) continue; // sideways / upside-down text: not a label row
      items.push({ str: it.str, x, y, w: it.width || 0, size: Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 10 });
    }
    const { h, v } = await drawnSegments(page, OPS, toView);
    out.push({ page: n, width: vp.width, height: vp.height, rotate: ((page.rotate % 360) + 360) % 360, toUser, toView, items, h, v });
  }
  return out;
}

function textLines(pages) {
  const lines = [];
  for (const p of pages) {
    const mine = [];
    for (const item of p.items) {
      const line = mine.find((l) => Math.abs(l.y - item.y) <= 2.5);
      if (line) line.items.push(item); else mine.push({ page: p.page, y: item.y, items: [item] });
    }
    for (const l of mine) l.items.sort((a, b) => a.x - b.x);
    lines.push(...mine.sort((a, b) => b.y - a.y));
  }
  return lines;
}

// A heading line (short, upper case or larger) sets the part of the form the next blanks are in.
const isHeading = (text) => text.length <= 60 && !/_{3,}/.test(text) && /[A-Z]{3}/.test(text) && text === text.toUpperCase();

const labelOf = (words) => {
  const t = clean(String(words).replace(/[:–-]\s*$/, '')).replace(/\s+/g, ' ').trim();
  const after = t.includes(':') ? t.slice(t.lastIndexOf(':') + 1).trim() : t;
  return (after || t).split(' ').slice(-6).join(' ');
};

/** A blank at view point (x, y) = the start of the text's baseline, turned into the PDF's own coordinates. */
function blankAt(p, { x, y, w, size }) {
  const [ux, uy] = p.toUser(x, y);
  return { page: p.page, x: ux, y: uy, w, h: size, size, rot: p.rotate };
}

// Drawn write-in lines and captioned boxes of one page (no text of their own), as { x, y, w, size, label } in view points.
function drawnBlanks(p, taken) {
  const found = [];
  const vSegs = p.v;
  // A row of cells drawn as one long line with dividers: each cell is its own blank.
  const pieces = [];
  for (const s of p.h) {
    const cuts = vSegs.filter((v) => v.x > s.x0 + 3 && v.x < s.x1 - 3 && v.y0 <= s.y + 2 && v.y1 >= s.y - 2)
      .map((v) => v.x).sort((a, b) => a - b);
    let x0 = s.x0;
    for (const c of [...cuts, s.x1]) { if (c - x0 >= 30) pieces.push({ x0, x1: c, y: s.y }); x0 = c; }
  }
  const near = (y0, y1, x0, x1) => p.items.filter((it) => it.y >= y0 && it.y <= y1 && it.x + it.w > x0 && it.x < x1 && clean(it.str));
  for (const s of pieces) {
    const width = s.x1 - s.x0;
    if (width > p.width * 0.9) continue; // a full-width rule between sections
    if (taken(p.page, s)) continue;
    // The box above it (a cell): the nearest line above that spans most of it.
    const ceiling = pieces.filter((o) => o !== s && o.y > s.y + 6 && o.y - s.y <= 45
      && Math.min(o.x1, s.x1) - Math.max(o.x0, s.x0) >= 0.5 * width).sort((a, b) => a.y - b.y)[0];
    const top = ceiling ? ceiling.y - 1 : s.y + 9;
    const inside = near(s.y - 1, top, s.x0 + 1, s.x1 - 1).filter((it) => it.x + it.w / 2 >= s.x0 && it.x + it.w / 2 <= s.x1);
    const onLine = inside.filter((it) => it.y <= s.y + 9);
    let x0 = s.x0 + 2; let label = ''; let size = 10;
    if (onLine.length) {
      // Text sitting on the line: a label at its start ("Name: ______" drawn as one underline) leaves the rest free.
      const end = Math.max(...onLine.map((it) => it.x + it.w));
      if (onLine.some((it) => it.x > s.x0 + 0.5 * width) || s.x1 - end < 40) continue; // filled in / an underlined word
      const words = onLine.sort((a, b) => a.x - b.x).map((it) => it.str).join(' ').trim();
      if (isHeading(words) && !/:\s*$/.test(words)) continue; // an underlined section heading
      x0 = end + 4; label = labelOf(words);
    } else if (ceiling && inside.length) {
      // A cell with its caption at the top ("NAME"): write under the caption.
      const caption = inside.sort((a, b) => b.y - a.y || a.x - b.x).map((it) => it.str).join(' ').trim();
      const room = Math.min(...inside.map((it) => it.y)) - s.y;
      if (caption.length > 40 || room < 8) continue;
      label = labelOf(caption); size = Math.min(10, room - 2);
    } else if (inside.length) continue;
    if (!label) {
      // The words just left of the line on its row (only those after the previous blank of the row).
      const prev = pieces.filter((o) => Math.abs(o.y - s.y) <= 1.5 && o.x1 <= s.x0 + 1).reduce((m, o) => Math.max(m, o.x1), s.x0 - 160);
      const left = p.items.filter((it) => it.y >= s.y - 2 && it.y <= s.y + 10 && it.x >= prev - 1 && it.x + it.w <= s.x0 + 3 && clean(it.str))
        .sort((a, b) => a.x - b.x);
      const words = left.map((it) => it.str).join(' ').trim();
      // A section heading with a rule after it ("BUYER INFORMATION ________"): not a blank.
      if (left.length && isHeading(words) && !/:\s*$/.test(words)) continue;
      if (left.length) label = labelOf(words);
    }
    // The top edge of a box (another line just under it): its words belong to the box below, not to this line.
    const floor = pieces.some((o) => o !== s && o.y < s.y - 6 && s.y - o.y <= 45
      && Math.min(o.x1, s.x1) - Math.max(o.x0, s.x0) >= 0.5 * width);
    if (!label && !ceiling && !floor && width < p.width * 0.7) {
      // A signature-style line with its label printed under it ("Buyer Signature", "Date").
      const under = p.items.filter((it) => it.y < s.y - 1 && it.y >= s.y - 14 && it.x >= s.x0 - 5 && it.x <= s.x0 + 0.6 * width && clean(it.str))
        .sort((a, b) => a.x - b.x);
      const lineY = under.length ? Math.max(...under.map((it) => it.y)) : null;
      if (under.length) label = labelOf(under.filter((it) => Math.abs(it.y - lineY) <= 2.5 && it.x + it.w <= s.x1 + 5).map((it) => it.str).join(' '));
    }
    if (!label) continue; // a line with no words around it: decoration
    found.push({ x: x0, y: s.y + 2, w: s.x1 - x0 - 2, size: Math.max(6, size), label, line: s });
  }
  return found;
}

/**
 * @returns {Promise<{ fillable: boolean, pages: number, scan: boolean, fields: Array<{ id, label, source, page, x, y, w,
 *   h, size, rot, pdf_field?: string, kind: 'pdf_field' | 'blank' }> }>}
 */
export async function detectFields(buffer) {
  if (!buffer?.length) throw fail('The file is empty', 400);
  if (buffer.length > MAX_BYTES) throw fail('The file is larger than 15 MB', 400);
  if (buffer.subarray(0, 1024).indexOf('%PDF-') < 0) throw fail('That file is not a PDF', 400);
  let doc;
  try { doc = await PDFDocument.load(buffer, { updateMetadata: false }); } catch (e) {
    if (!/encrypt/i.test(e?.message || '')) throw fail('The PDF could not be read (it may be damaged)', 400);
    // Locked. Opens without a password = only changes are locked (a "permissions" password).
    const opens = await getDocumentProxy(new Uint8Array(buffer)).then(() => true, () => false);
    throw fail(opens ? 'This PDF is locked against changes, so it can\'t be filled in. Open it, choose Print > Save as PDF '
      + '(or remove its security in Acrobat), and upload that copy.' : 'The PDF is password-protected: upload an unlocked copy', 400);
  }
  const form = doc.getForm();
  const acro = form.getFields();
  const pages = await readPages(buffer);
  const lines = textLines(pages);
  const textChars = lines.reduce((t, l) => t + l.items.reduce((s, i) => s + i.str.trim().length, 0), 0);
  if (form.hasXFA() && !acro.length) {
    throw fail('This is a LiveCycle (XFA) form, which can\'t be filled outside Adobe Reader. Open it in Adobe Reader, '
      + 'choose Print > Save as PDF, and upload that copy.', 422);
  }
  // A form whose title is about a trade-in (a "Trade-In Appraisal Worksheet"): its vehicle is the trade-in.
  const title = lines.filter((l) => l.page === 1).map((l) => l.items.map((i) => i.str).join(' ').trim()).find(isHeading) || '';
  const tradeDoc = /trade/i.test(title);
  const fields = [];
  let n = 0;
  const docPages = doc.getPages();
  const headingAbove = (page, y) => lines.filter((l) => l.page < page || (l.page === page && l.y > y)).reverse()
    .map((l) => l.items.map((i) => i.str).join(' ').trim()).find(isHeading) || '';

  // 1. A fillable PDF's own fields.
  for (const f of acro) {
    // instanceof, not the class name: the live build shortens class names, so a name check matched nothing.
    if (!(f instanceof PDFTextField)) continue; // checkboxes, choices, signatures: left for the person
    const widget = f.acroField.getWidgets()[0];
    if (!widget) continue;
    const r = widget.getRectangle();
    const page = Math.max(1, docPages.findIndex((pg) => pg.ref === widget.P()) + 1);
    const p = pages[page - 1];
    if (!p) continue;
    const box = viewBox(p, r); // the field's box as seen on the page
    // Its label: the nearest words to its left on the same row, else just above it.
    const row = p.items.filter((it) => it.y >= box.y - 3 && it.y <= box.y + box.h + 2 && it.x + it.w <= box.x + 4
      && box.x - (it.x + it.w) < 160 && clean(it.str)).sort((a, b) => b.x - a.x)[0];
    const above = !row && p.items.filter((it) => it.y > box.y + box.h - 2 && it.y - (box.y + box.h) < 16
      && Math.abs(it.x - box.x) < 60 && clean(it.str)).sort((a, b) => a.y - b.y)[0];
    const near = clean((row || above)?.str);
    const tip = tooltip(f);
    const trade = tradeDoc || /trade/i.test(headingAbove(page, box.y));
    fields.push({ id: `f${(n += 1)}`, kind: 'pdf_field', pdf_field: f.getName(), label: tip || near || humanize(f.getName()),
      page, x: r.x, y: r.y, w: r.width, h: r.height, size: Math.min(11, Math.max(7, r.height * 0.6)), rot: p.rotate,
      vx: box.x, vy: box.y, vw: box.w,
      source: (tip && matchSource(tip, { trade })) || matchSource(near, { trade }) || matchSource(humanize(f.getName()), { trade }) });
  }
  const taken = (page, s) => fields.some((f) => f.page === page && Math.abs((f.vy ?? f.y) - s.y) < 10
    && Math.min((f.vx ?? f.x) + (f.vw ?? f.w), s.x1) - Math.max(f.vx ?? f.x, s.x0) > 0.4 * Math.min(f.vw ?? f.w, s.x1 - s.x0));

  // 2. Underscore blanks in the text (a fillable PDF: only where no field covers the blank).
  // The label is the words just before the blank on its line; a blank that starts a line takes the end of the line
  // before ("with a mailing address of / ________"). Who the sentence is about (customer / dealership) follows the last
  // party named ("Consentee:" / "Releasee:").
  let heading = '';
  let party = 'customer';
  let carry = '';
  for (const line of lines) {
    const p = pages[line.page - 1];
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
        const label = labelOf(clean(before) ? before : carry);
        before = '';
        if (w < 15 || taken(line.page, { x0: x, x1: x + w, y: line.y })) continue;
        const size = Math.min(10, Math.max(7, it.size * 0.9));
        fields.push({ id: `f${(n += 1)}`, kind: 'blank', label, ...blankAt(p, { x: x + 1, y: line.y + 1, w, size }),
          h: it.size, vx: x, vy: line.y, vw: w,
          source: matchSource(label, { trade: tradeDoc || /trade/i.test(heading), party }) });
      }
      before += ` ${it.str.slice(last)}`;
    }
    carry = before.trim() ? before : '';
  }

  // 3. Drawn write-in lines and captioned boxes.
  for (const p of pages) {
    for (const b of drawnBlanks(p, taken)) {
      const trade = tradeDoc || /trade/i.test(headingAbove(p.page, b.y));
      const before = p.items.filter((it) => it.y > b.y + 12 && it.y < b.y + 80).map((it) => it.str).join(' ');
      const party = /\b(releasee|seller|dealer|dealership|lessor)\b/i.test(before.slice(-120))
        && !/\b(consentee|buyer|customer|purchaser)\b/i.test(b.label) ? 'dealer' : 'customer';
      fields.push({ id: `f${(n += 1)}`, kind: 'blank', label: b.label, ...blankAt(p, b), vx: b.x, vy: b.y, vw: b.w,
        source: matchSource(b.label, { trade, party: /\b(dealer|seller|releasee)\b/i.test(b.label) ? 'dealer' : party }) });
    }
  }

  for (const f of fields) { delete f.vx; delete f.vy; delete f.vw; }
  fields.sort((a, b) => a.page - b.page);
  // Nothing written on the page and nothing to fill: a picture of a form.
  const scan = !fields.length && textChars < 20;
  return { fillable: acro.length > 0, pages: pages.length, scan, fields };
}

// A fillable field's own description (its tooltip, "TU"), when the form's author gave one.
function tooltip(field) {
  try {
    const tu = field.acroField.dict.lookup(PDFName.of('TU'));
    return clean(tu?.decodeText?.() || '').slice(0, 80);
  } catch { return ''; }
}

// A rectangle in the PDF's coordinates, as seen on the page (view points).
function viewBox(p, r) {
  const pts = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]].map(([x, y]) => p.toView(x, y));
  const xs = pts.map((q) => q[0]); const ys = pts.map((q) => q[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Forms uploaded while the live build couldn't see fillable fields (16 Nov 2026: class names are shortened in the
 * build, so every fillable field was skipped and the form showed "0 of 0") are read again from their stored PDF the
 * next time the library lists them. Forms whose blanks the AI found are left alone. Returns how many forms were fixed.
 */
export async function redetectEmpty(templates, { readFile, Model }) {
  let fixed = 0;
  for (const t of templates) {
    const v = (t.versions || []).find((x) => x.version === t.current_version);
    if (!v?.source_file_id || !Array.isArray(v.fields) || v.fields.length || v.redetected || v.found_by_ai) continue;
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
