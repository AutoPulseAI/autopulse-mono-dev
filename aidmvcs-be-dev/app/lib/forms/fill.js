// Writes a customer's data into the dealer's own PDF (lib/forms/detect.js found its blanks): a fillable field gets
// the value as its text, an underscore blank gets the value printed on its line. The PDF otherwise stays exactly as
// uploaded. Fields are flattened, so what was exported can't be changed in the file afterwards. A value too long for
// its blank is shrunk to fit (down to 6 pt), then cut.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function fit(font, text, size, width) {
  let s = size;
  while (s > 6 && width && font.widthOfTextAtSize(text, s) > width) s -= 0.5;
  let t = text;
  while (t.length > 1 && width && font.widthOfTextAtSize(t, s) > width) t = t.slice(0, -1);
  return { text: t, size: s };
}

/** @returns {Promise<{ pdf: Buffer, filled: number, empty: string[] }>} */
export async function fillForm(buffer, fields, values) {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const form = doc.getForm();
  let filled = 0; const empty = [];
  for (const f of fields) {
    if (!f.source) continue;
    const value = String(values[f.source] ?? '').trim();
    if (!value) { empty.push(f.label); continue; }
    if (f.kind === 'pdf_field') {
      try { form.getTextField(f.pdf_field).setText(value); filled += 1; } catch { /* the field is gone from this PDF */ }
      continue;
    }
    const page = pages[f.page - 1];
    if (!page) continue;
    const { text, size } = fit(font, value, f.size || 10, f.w);
    page.drawText(text, { x: f.x, y: f.y, size, font, color: rgb(0.05, 0.05, 0.3) });
    filled += 1;
  }
  try { form.updateFieldAppearances(font); form.flatten(); } catch { /* odd widgets: values stay as set */ }
  return { pdf: Buffer.from(await doc.save()), filled, empty };
}
