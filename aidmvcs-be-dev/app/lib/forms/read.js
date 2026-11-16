// Reading an uploaded form, whatever its format (the user, 16 Nov 2026: "it can be an image that has been converted to
// the PDF ... the forms can be in different format ... handle all of the edge cases"):
//   - a fillable PDF, a digital PDF with underscores or drawn lines / boxes: read from the PDF (lib/forms/detect.js)
//   - a scanned PDF, or nothing found to fill: the AI finds the blanks (lib/forms/aiLocate.js); the form then waits
//     for a check of its Preview before staff can use it
//   - a JPG / PNG of the form (a photo or a scan saved as a picture): made into a one-page PDF first, then as a scan
//   - Word, HEIC and other files: refused with what to upload instead
// Locked, password-protected, damaged and LiveCycle (XFA-only) PDFs are refused by detectFields with what to do.
import { PDFDocument } from 'pdf-lib';
import { MAX_BYTES, detectFields, fail } from './detect.js';
import { aiAvailable, aiLocate } from './aiLocate.js';

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
 * @returns {Promise<{ buffer, filename, fillable, pages, fields, found_by_ai: boolean }>}
 */
export async function readForm(rawBuffer, rawFilename) {
  const { buffer, filename } = await asPdf(rawBuffer, rawFilename);
  const found = await detectFields(buffer);
  if (found.fields.length) return { buffer, filename, ...found, found_by_ai: false };
  if (!aiAvailable()) {
    throw fail(found.scan ? 'This form is a scan (a picture of the page), and the AI that reads scans is not set up on '
      + 'this server. Upload the digital version of the form (from Word, Acrobat or your DMS).'
      : 'No blanks to fill were found on this form.', 422);
  }
  const ai = await aiLocate(buffer, { filename });
  return { buffer, filename, fillable: found.fillable, pages: ai.pages, fields: ai.fields, found_by_ai: true };
}
