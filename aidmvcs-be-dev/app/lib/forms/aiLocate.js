// The AI finds a form's blanks when they can't be read from the PDF itself (the user, 16 Nov 2026: "it can be an
// image that has been converted to the PDF ... the forms can be in different format"): a scanned form, a photo or JPG
// of it, or a form whose blanks are drawn in a way lib/forms/detect.js doesn't recognise.
// The PDF goes to OpenAI as it is (the model sees each page); it answers, per blank, the printed label next to it, the
// section it is in and where it is on the page. What fills each blank is still decided here by its label
// (matchSource), never by the AI. A blank the AI places near a line drawn on the page is put exactly on that line.
// Its places are approximate on a scan: the form is checked with "Preview" before staff use it.
import { clean, matchSource, readPages } from './detect.js';

const API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_FORMS_MODEL || 'gpt-4.1';
const key = () => process.env.OPENAI_API_KEY || process.env.OPENAPI_KEY || '';
export const aiAvailable = () => Boolean(key());

const SCHEMA = {
  name: 'form_blanks', strict: true,
  schema: { type: 'object', additionalProperties: false, required: ['title', 'blanks'], properties: {
    title: { type: 'string' },
    blanks: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['page', 'label', 'section', 'x0', 'y0', 'x1', 'y1'],
      properties: { page: { type: 'integer' }, label: { type: 'string' }, section: { type: 'string' },
        x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } } } },
  } },
};

const PROMPT = `This PDF is a car dealership's paper form. List every space on it that is meant to be written in by
hand: write-in lines, underlined spaces, empty boxes and table cells to fill. Skip checkboxes, and text that is already
printed. For each one give:
- page: the page number, starting at 1
- label: the printed words that say what goes in it, exactly as printed (e.g. "Buyer Name", "VIN", "Signature")
- section: the heading of the part of the form it is in (e.g. "Trade-In Vehicle"), or "" if none
- x0, y0, x1, y1: the writing space itself (not its label), as fractions 0 to 1 of the page's width and height as
  the page is seen upright, measured from the page's top left corner: (x0, y0) its top left, (x1, y1) its bottom right.
  For a write-in line, y1 is the line itself and y0 is about one line of text above it.
title: the form's title.`;

async function ask(buffer, filename) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(API_URL, { method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0, response_format: { type: 'json_schema', json_schema: SCHEMA },
        messages: [{ role: 'user', content: [
          { type: 'file', file: { filename: filename || 'form.pdf', file_data: `data:application/pdf;base64,${buffer.toString('base64')}` } },
          { type: 'text', text: PROMPT }] }] }) });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } finally { clearTimeout(timer); }
}

/**
 * @returns {Promise<{ pages: number, fields: Array }>} the blanks, in the same shape as detectFields' (kind 'blank',
 *   found_by: 'ai'). Throws { status: 422 } with a plain message when the AI is not set up or finds nothing.
 */
export async function aiLocate(buffer, { filename } = {}) {
  if (!aiAvailable()) throw Object.assign(new Error('The AI that reads scanned forms is not set up on this server.'), { status: 422 });
  const pages = await readPages(buffer);
  let answer;
  try { answer = await ask(buffer, filename); } catch (e) {
    console.error('[forms] AI locate failed:', e?.message);
    throw Object.assign(new Error('The AI could not read this form just now. Try again in a minute.'), { status: 502 });
  }
  const tradeDoc = /trade/i.test(answer.title || '');
  const fields = [];
  let n = 0;
  for (const b of answer.blanks || []) {
    const p = pages[(Number(b.page) || 1) - 1];
    const label = clean(b.label).split(' ').slice(-6).join(' ');
    if (!p || !label) continue;
    const c = (v) => Math.min(1, Math.max(0, Number(v) || 0));
    const [x0, x1] = [c(b.x0), c(b.x1)].sort((a, z) => a - z);
    const [y0, y1] = [c(b.y0), c(b.y1)].sort((a, z) => a - z);
    if (x1 - x0 < 0.01) continue;
    // View points (y up): the bottom of the space is where the text sits.
    let x = x0 * p.width; let w = (x1 - x0) * p.width; let bottom = (1 - y1) * p.height;
    const height = Math.max(6, (y1 - y0) * p.height);
    // On a digital page, snap to a drawn line the AI's box sits on.
    const line = p.h.filter((s) => Math.abs(s.y - bottom) <= 8 && Math.min(s.x1, x + w) - Math.max(s.x0, x) >= 0.5 * Math.min(w, s.x1 - s.x0))
      .sort((a, z) => Math.abs(a.y - bottom) - Math.abs(z.y - bottom))[0];
    if (line) { bottom = line.y; x = Math.max(x, line.x0); w = Math.min(x + w, line.x1) - x; }
    const size = Math.max(6, Math.min(10, height * 0.7));
    const [ux, uy] = p.toUser(x + 2, bottom + 2);
    const trade = tradeDoc || /trade/i.test(b.section || '');
    const party = /\b(releasee|seller|dealer|dealership|lessor)\b/i.test(`${b.section} ${label}`) ? 'dealer' : 'customer';
    fields.push({ id: `a${(n += 1)}`, kind: 'blank', found_by: 'ai', label, page: p.page, x: ux, y: uy, w: Math.max(10, w - 4),
      h: height, size, rot: p.rotate, source: matchSource(label, { trade, party }) });
  }
  if (!fields.length) throw Object.assign(new Error('No blanks could be found on this form.'), { status: 422 });
  return { pages: pages.length, fields };
}
