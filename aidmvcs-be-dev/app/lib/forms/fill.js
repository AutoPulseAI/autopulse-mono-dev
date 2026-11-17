// Writes a customer's data into the dealer's own PDF (lib/forms/detect.js found its blanks): a fillable field gets
// the value as its text, any other blank gets the value printed on its line, upright on a page turned sideways. The
// PDF otherwise stays exactly as uploaded. Fields are flattened, so what was exported can't be changed in the file
// afterwards. A value too long for its blank is shrunk to fit (down to 6 pt), then cut; a fillable field's own
// character limit is kept. Letters the form's font can't print are written without their accent (Ł -> L); a value
// with nothing printable (e.g. Chinese) is left blank and reported, never printed as boxes.
// preview: every blank shows a box and what fills it, so its place can be checked before the form is used.
import { PDFDocument, PDFRef, StandardFonts, degrees, rgb } from 'pdf-lib';

const EXTRA = { Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', Ħ: 'H', ħ: 'h', ı: 'i', Ŀ: 'L', ŀ: 'l', ŉ: 'n', Ŧ: 'T', ŧ: 't' };

/** The text as the font can print it, or '' when any letter can't be printed even without its accent. */
export function printable(font, value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const ok = (s) => { try { font.encodeText(s); return true; } catch { return false; } };
  if (ok(text)) return text;
  let out = ''; let lost = 0;
  for (const ch of text) {
    if (ok(ch)) { out += ch; continue; }
    const plain = (EXTRA[ch] || ch.normalize('NFD').replace(/[̀-ͯ]/g, ''));
    if (plain && plain !== ch && ok(plain)) out += plain; else lost += 1;
  }
  return lost ? '' : out.replace(/\s+/g, ' ').trim();
}

function fit(font, text, size, width) {
  let s = size;
  while (s > 6 && width && font.widthOfTextAtSize(text, s) > width) s -= 0.5;
  let t = text;
  while (t.length > 1 && width && font.widthOfTextAtSize(t, s) > width) t = t.slice(0, -1);
  return { text: t, size: s };
}

// A point `along` points along the text's direction and `up` points above it, from (x, y), on a page turned `rot`.
function shift(x, y, rot, along, up) {
  const a = (rot * Math.PI) / 180;
  return [x + along * Math.cos(a) - up * Math.sin(a), y + along * Math.sin(a) + up * Math.cos(a)];
}

/** @returns {Promise<{ pdf: Buffer, filled: number, empty: string[], unprintable: string[] }>} */
export const EXPORT_MARK = 'autopulse-filled-copy';

// Typed by staff in the check box before downloading (17 Nov 2026): { [field id]: text }. Never for signatures,
// initials or checkboxes (signed / ticked by hand).
export const HAND_ONLY = ['signature', 'initials', 'checkbox'];

export async function fillForm(buffer, fields, values, { preview = false, describe = (k) => k, overrides = {} } = {}) {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const form = doc.getForm();
  // A LiveCycle (XFA) copy of the form would be shown instead of the filled fields in Adobe Reader.
  try { if (form.hasXFA()) form.deleteXFA(); } catch { /* none */ }
  let filled = 0; const empty = []; const unprintable = [];
  for (const [i, f] of fields.entries()) {
    const page = pages[f.page - 1];
    const rot = Number(f.rot) || 0;
    if (preview) {
      if (!page) continue;
      const auto = f.source && f.fill_policy !== 'person';
      const tag = printable(font, `${i + 1}. ${auto ? describe(f.source) : 'left blank'}`);
      const w = Math.max(20, f.w || 60); const h = Math.max(8, (f.kind === 'pdf_field' ? f.h : f.size + 3) || 10);
      const [bx, by] = f.kind === 'pdf_field' ? [f.x, f.y] : shift(f.x, f.y, rot, -1, -2);
      const color = auto ? rgb(0.1, 0.35, 0.85) : rgb(0.9, 0.5, 0.1);
      page.drawRectangle({ x: bx, y: by, width: w, height: h, borderColor: color, borderWidth: 0.8, opacity: 0, borderOpacity: 0.9,
        rotate: degrees(f.kind === 'pdf_field' ? 0 : rot) });
      const { text, size } = fit(font, tag, Math.min(8, h - 1), w - 2);
      const [tx, ty] = f.kind === 'pdf_field' ? [f.x + 2, f.y + Math.max(1, (h - size) / 2)] : [f.x, f.y];
      page.drawText(text, { x: tx, y: ty, size, font, color, rotate: degrees(f.kind === 'pdf_field' ? 0 : rot) });
      continue;
    }
    const typed = !HAND_ONLY.includes(f.field_type) && Object.hasOwn(overrides || {}, f.id);
    if (!typed && (!f.source || f.fill_policy === 'person')) continue;
    const raw = String(typed ? overrides[f.id] : values[f.source] ?? '').trim();
    if (!raw) { if (!typed) empty.push(f.label); continue; }
    let value = printable(font, raw);
    if (!value) { unprintable.push(f.label); continue; }
    if (f.kind === 'pdf_field') {
      try {
        const field = form.getTextField(f.pdf_field);
        const max = field.getMaxLength();
        if (max) value = value.slice(0, max);
        field.setText(value); filled += 1;
      } catch { /* the field is gone from this PDF */ }
      continue;
    }
    if (!page) continue;
    const { text, size } = fit(font, value, f.size || 10, f.w);
    page.drawText(text, { x: f.x, y: f.y, size, font, color: rgb(0.05, 0.05, 0.3), rotate: degrees(rot) });
    filled += 1;
  }
  if (!preview) {
    try { form.updateFieldAppearances(font); form.flatten(); } catch { /* odd widgets: values stay as set */ }
    // Flattening removes the fields but can leave the page pointing at them, which PDF readers report as damage.
    for (const page of pages) {
      const annots = page.node.Annots();
      for (let i = (annots?.size() || 0) - 1; i >= 0; i -= 1) {
        const r = annots.get(i);
        if (r instanceof PDFRef && !doc.context.lookup(r)) annots.remove(i);
      }
    }
  }
  // Marked as a filled copy, so it is refused if someone uploads it back as a form (17 Nov 2026: a downloaded copy was
  // uploaded as the form; its printed customer data then went on every export).
  if (!preview) doc.setKeywords([EXPORT_MARK]);
  return { pdf: Buffer.from(await doc.save()), filled, empty, unprintable };
}
