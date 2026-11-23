// Reading a scanned form on our own server, no AI (the user, 18 Nov 2026: "a combination of both" - local first, a
// model only when the local reader finds nothing; lib/forms/read.js). A scan is a picture of the page, so there is no
// text or drawn line in the PDF to read:
//   1. each page is drawn as a grey picture (poppler's pdftoppm, 100 dpi);
//   2. the write-in spaces are found in the picture: long thin dark horizontal runs (write-in lines, the bottom of
//      boxes); a rule running across almost the whole page is not a blank;
//   3. the printed words and where they are come from Tesseract OCR (`tesseract ... tsv`); a blank's label is the words
//      just before it on its row, else the words right above it - what fills it is then decided by that label
//      (matchSource), as for a digital form.
// Places are approximate: staff check the form with Preview / the review panel before it is used. Without pdftoppm
// nothing is read here; without tesseract the blanks are found but unlabelled ("Blank 1"...) only when no model is
// available to read the form instead (read.js decides). Server packages: apt install poppler-utils tesseract-ocr.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { clean, describe, matchSource, readPages } from './detect.js';

const run = promisify(execFile);
const DPI = 100;
const DARK = 110;             // a pixel this dark or darker is ink
const MIN_RUN = 0.06;         // a write-in line is at least 6% of the page wide...
const MAX_RUN = 0.92;         // ...and not a rule across the whole page
const MAX_THICK = 5;          // px: thicker is a filled bar, not a line

async function has(cmd) {
  try { await run(cmd, ['--version'], { timeout: 10000 }); return true; } catch (e) { return e?.code !== 'ENOENT' && e?.code !== 127 && !/not found/i.test(e?.message || ''); }
}

// A binary PGM (P5) file -> { width, height, data }.
function parsePgm(buf) {
  let i = 0; const tok = [];
  while (tok.length < 4) {
    while (/\s/.test(String.fromCharCode(buf[i]))) i += 1;
    if (buf[i] === 0x23) { while (buf[i] !== 0x0a) i += 1; continue; } // a comment line
    let s = ''; while (!/\s/.test(String.fromCharCode(buf[i]))) { s += String.fromCharCode(buf[i]); i += 1; }
    tok.push(s);
  }
  if (tok[0] !== 'P5') throw new Error('not a PGM');
  return { width: Number(tok[1]), height: Number(tok[2]), data: buf.subarray(i + 1) };
}

// Horizontal dark runs, merged across adjacent rows: [{ x0, x1, y }] in pixels (y = the line's middle row).
export function findLines({ width, height, data }) {
  const raw = [];
  for (let y = 0; y < height; y += 1) {
    let start = -1; let gaps = 0;
    for (let x = 0; x <= width; x += 1) {
      const ink = x < width && data[y * width + x] <= DARK;
      if (ink) { if (start < 0) start = x; gaps = 0; continue; }
      if (start >= 0 && gaps < 2 && x < width) { gaps += 1; continue; } // a dotted / broken scan line
      if (start >= 0) {
        const len = x - gaps - start;
        if (len >= MIN_RUN * width && len <= MAX_RUN * width) raw.push({ x0: start, x1: x - gaps, y });
        start = -1; gaps = 0;
      }
    }
  }
  const lines = [];
  for (const r of raw) {
    const near = lines.find((l) => r.y - l.yMax <= 1 && Math.min(l.x1, r.x1) - Math.max(l.x0, r.x0) > 0.8 * Math.min(l.x1 - l.x0, r.x1 - r.x0));
    if (near) { near.yMax = r.y; near.x0 = Math.min(near.x0, r.x0); near.x1 = Math.max(near.x1, r.x1); } else lines.push({ ...r, yMin: r.y, yMax: r.y });
  }
  return lines.filter((l) => l.yMax - l.yMin + 1 <= MAX_THICK).map((l) => ({ x0: l.x0, x1: l.x1, y: Math.round((l.yMin + l.yMax) / 2) }));
}

// Tesseract's words with their boxes, in pixels: [{ text, x0, y0, x1, y1, line }].
async function ocrWords(file) {
  const { stdout } = await run('tesseract', [file, 'stdout', '--psm', '11', 'tsv'], { timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  const words = [];
  for (const row of stdout.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const text = c[11].trim(); const conf = Number(c[10]);
    if (!text || conf < 30 || /^[_\-.]+$/.test(text)) continue;
    const [x, y, w, h] = c.slice(6, 10).map(Number);
    words.push({ text, x0: x, y0: y, x1: x + w, y1: y + h, line: `${c[2]}.${c[3]}.${c[4]}` });
  }
  return words;
}

// The label for a line: the words on its row ending before it starts, else the words right above it.
function labelFor(line, words) {
  const rowH = 30; // px at 100 dpi: about one text line
  const before = words.filter((w) => w.x1 <= line.x0 + 4 && w.x1 >= line.x0 - 0.3 * 1000 && w.y1 <= line.y + 4 && w.y1 >= line.y - rowH)
    .sort((a, b) => a.x0 - b.x0);
  if (before.length) {
    // only the run of words closest to the line (a gap of 60 px starts another label)
    const out = []; for (let i = before.length - 1; i >= 0; i -= 1) {
      if (out.length && out[0].x0 - before[i].x1 > 60) break; out.unshift(before[i]);
    }
    return out.map((w) => w.text).join(' ');
  }
  const above = words.filter((w) => w.y1 <= line.y - 2 && w.y1 >= line.y - 1.6 * rowH && w.x0 >= line.x0 - 10 && w.x0 <= line.x1)
    .sort((a, b) => a.x0 - b.x0);
  return above.map((w) => w.text).join(' ');
}

/**
 * @returns {Promise<null | { fields, labelled: boolean, ocr: boolean }>} null when the tools are missing or no
 *   write-in space was found. `labelled` false = blanks found without OCR (no tesseract).
 */
export async function scanRead(buffer) {
  if (!(await has('pdftoppm'))) return null;
  const ocr = await has('tesseract');
  const dir = await mkdtemp(path.join(tmpdir(), 'form-scan-'));
  try {
    const pdfPath = path.join(dir, 'in.pdf');
    await writeFile(pdfPath, buffer);
    await run('pdftoppm', ['-r', String(DPI), '-gray', pdfPath, path.join(dir, 'p')], { timeout: 120000 });
    const pages = await readPages(buffer);
    const files = (await readdir(dir)).filter((f) => /^p-\d+\.pgm$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    const fields = []; let n = 0;
    for (let i = 0; i < files.length && i < pages.length; i += 1) {
      const p = pages[i];
      const file = path.join(dir, files[i]);
      const img = parsePgm(await readFile(file));
      const lines = findLines(img);
      if (!lines.length) continue;
      const words = ocr ? await ocrWords(file).catch(() => []) : [];
      const sx = p.width / img.width; const sy = p.height / img.height;
      const tradeDoc = /trade/i.test(words.slice(0, 15).map((w) => w.text).join(' '));
      for (const l of lines) {
        const label = clean(ocr ? labelFor(l, words) : '').split(' ').slice(-6).join(' ');
        if (ocr && !label) continue; // a line with no words near it: a border or a rule, not a blank
        const x = l.x0 * sx; const w = (l.x1 - l.x0) * sx; const bottom = (img.height - l.y) * sy;
        const size = 9; const [ux, uy] = p.toUser(x + 2, bottom + 2);
        const party = /\b(releasee|seller|dealer|dealership|lessor)\b/i.test(label) ? 'dealer' : 'customer';
        const f = { id: `o${(n += 1)}`, kind: 'blank', found_by: 'ocr', label: label || `Blank ${n}`, page: p.page, x: ux, y: uy,
          w: Math.max(10, w - 4), h: 12, size, rot: p.rotate, source: label ? matchSource(label, { trade: tradeDoc, party }) : null };
        Object.assign(f, describe(f));
        fields.push(f);
      }
    }
    return fields.length ? { fields, labelled: ocr, ocr } : null;
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => null); }
}
