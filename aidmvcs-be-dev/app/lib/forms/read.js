// Reading an uploaded form, whatever its format (the user, 16 Nov 2026: "it can be an image that has been converted to
// the PDF ... the forms can be in different format ... handle all of the edge cases"):
//   - a fillable PDF, a digital PDF with underscores or drawn lines / boxes: read from the PDF (lib/forms/detect.js)
//   - a scanned PDF / photo (the user, 18 Nov 2026: "a combination of both"), read once per form:
//       1. the same scan read before (same file) takes those blanks again - no reading, no cost (lib/forms/reuse.js);
//       2. our own server reads it: write-in lines from the page picture + Tesseract OCR labels (lib/forms/scanRead.js);
//       3. only when that finds nothing, the AI reads it once (lib/forms/aiLocate.js, needs the OpenAI key); its blanks
//          are saved with the form, so exports and re-uploads never call it again;
//       4. nothing found, or neither tool available: refused with a plain message.
//   - a JPG / PNG of the form (a photo or a scan saved as a picture): made into a one-page PDF first, then as a scan
//   - Word, HEIC and other files: refused with what to upload instead
// Locked, password-protected, damaged and LiveCycle (XFA-only) PDFs are refused by detectFields with what to do.
import { PDFDocument } from 'pdf-lib';
import { MAX_BYTES, describe, detectFields, fail } from './detect.js';
import { scanRead } from './scanRead.js';
import { aiAvailable, aiLocate } from './aiLocate.js';
import { savedScanFieldsFor } from './reuse.js';

const isJpg = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

/** The upload as a PDF: a JPG / PNG becomes a Letter-width page holding the picture. */
export async function asPdf(buffer, filename = '') {
  if (!buffer?.length) throw fail('The file is empty', 400);
  if (buffer.length > MAX_BYTES) throw fail('The file is larger than 15 MB', 400);
  if (buffer.subarray(0, 1024).indexOf('%PDF-') >= 0) return { buffer, filename, converted: false };
  if (isJpg(buffer) || isPng(buffer)) {
    const doc = await PDFDocument.create();
    let img;
    try { img = isJpg(buffer) ? await doc.embedJpg(buffer) : await doc.embedPng(buffer); } catch {
      throw fail('The picture could not be read. Upload it as a PDF, JPG or PNG.', 400);
    }
    const width = 612; const height = (img.height / img.width) * width; // 8.5 in wide, the picture's own shape
    doc.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height });
    return { buffer: Buffer.from(await doc.save()), filename: `${String(filename).replace(/\.[a-z0-9]+$/i, '') || 'form'}.pdf`, converted: true };
  }
  throw fail('Upload the form as a PDF (or a JPG / PNG picture of it). A Word file: save it as PDF first.', 400);
}

/**
 * @returns {Promise<{ buffer, filename, fillable, pages, fields, fingerprint, found_by_ai: boolean, found_by: string|null,
 *   reused_scan?: object }>}  found_by: null (read from the PDF), 'ocr' (our scan reader), 'ai' (the model, once).
 */
export async function readForm(rawBuffer, rawFilename) {
  const { buffer, filename } = await asPdf(rawBuffer, rawFilename);
  const found = await detectFields(buffer);
  if (found.fields.length) return { buffer, filename, ...found, found_by_ai: false, found_by: null };
  if (!found.scan) throw fail('No blanks to fill were found on this form.', 422);

  const before = await savedScanFieldsFor(found.fingerprint);
  if (before) return { buffer, filename, ...found, fields: before.fields, found_by_ai: false, found_by: 'reused', reused_scan: before.reused_from };

  let local = null;
  try { local = await scanRead(buffer); } catch (e) { console.error('[forms] scan read failed:', e?.message); }
  if (local?.labelled) return { buffer, filename, ...found, fields: local.fields, found_by_ai: false, found_by: 'ocr' };

  if (aiAvailable()) {
    try {
      const ai = await aiLocate(buffer, { filename });
      const fields = ai.fields.map((f) => ({ ...f, ...describe(f) }));
      return { buffer, filename, ...found, fields, found_by_ai: true, found_by: 'ai' };
    } catch (e) {
      if (!local) throw fail(e.message, e.status || 422);
    }
  }
  // Lines found but no words read (no OCR on the server, no AI): the blanks are placed, staff name them in the review.
  if (local?.fields.length) return { buffer, filename, ...found, fields: local.fields, found_by_ai: false, found_by: 'ocr' };
  throw fail('This form is a scan (a picture of the page) and no blanks could be read from it. Upload the digital '
    + 'version of the form (from Word, Acrobat or your DMS), or a clearer scan.', 422);
}
