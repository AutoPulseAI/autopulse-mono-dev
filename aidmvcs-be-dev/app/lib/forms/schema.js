// A dealership form as an on-screen form (SOW v6 Deliverable K; the user, 13 Nov 2026: "give people the opportunity
// to create their forms ... dynamic fields, checkboxes, bigger titles, editing and styling options; or upload the form
// and the AI layer parses it and makes it editable"). Built in the Forms Library builder from scratch, or drafted from
// the dealer's PDF by the AI (./aiParse.js), then edited. The PDF is only the form's print / download (./formPdf.js).
// Shared by the server and the screens - no server imports here.
//
// schema  = { title, description, sections: [{ id, title, repeat: null | 'trade_in', fields: [element] }] }
// element = an input field:  { id, type (INPUT_TYPES), label, required, width, options, source, help, rows }
//         | a heading:       { id, type: 'heading', text, level: 1 | 2 | 3, align }
//         | wording:         { id, type: 'paragraph', text, align, bold, italic, size, blanks }
//             The wording can hold blanks inside its sentences ("made on {{made_on}}, by and between ..."): each
//             {{key}} is one of `blanks` = [{ key, label, type, required, source, size: 'short'|'medium'|'long' }],
//             filled in like any field.
//         | a line / space:  { id, type: 'divider' | 'spacer' }
// A field's `source` is the CRM value that fills it (./sources.js); staff can still change it.

export const FIELD_TYPES = Object.freeze({
  text: 'Short text', textarea: 'Long text / box', number: 'Number', money: 'Money ($)', date: 'Date', email: 'Email',
  phone: 'Phone', checkbox: 'Checkbox', select: 'Dropdown', radio: 'Choice (one of)', signature: 'Signature',
  heading: 'Title / heading', paragraph: 'Text (with blanks)', divider: 'Line', spacer: 'Space',
});
export const INPUT_TYPES = Object.freeze(['text', 'textarea', 'number', 'money', 'date', 'email', 'phone', 'checkbox',
  'select', 'radio', 'signature']);
export const BLANK_TYPES = Object.freeze({ text: 'Text', date: 'Date', number: 'Number', money: 'Money ($)',
  email: 'Email', phone: 'Phone' });
export const WIDTHS = Object.freeze({ full: 'Full width', half: 'Half', third: 'Third', quarter: 'Quarter' });
export const ALIGNS = Object.freeze({ left: 'Left', center: 'Center', right: 'Right' });
export const TEXT_SIZES = Object.freeze({ small: 'Small (fine print)', normal: 'Normal', large: 'Large' });
export const BLANK_SIZES = Object.freeze({ short: 'Short', medium: 'Medium', long: 'Long' });
export const REPEATS = Object.freeze({ trade_in: 'Once for each trade-in picked' });
export const BLANK_TOKEN = /\{\{([a-z0-9_]{1,40})\}\}/g;

const LIMITS = { sections: 60, fields: 400, label: 200, text: 8000, options: 50, blanks: 40 };
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
let seq = 0;
export const newId = (p = 'f') => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'blank';
const pick = (map, v, dflt) => (Object.prototype.hasOwnProperty.call(map, v) ? v : dflt);

// The blanks a wording element really uses, in the order they appear.
export function blanksInText(text) {
  return [...new Set([...String(text || '').matchAll(BLANK_TOKEN)].map((m) => m[1]))];
}

/** The schema as sent, cleaned; throws an Error with a plain message when it can't be used. */
export function normalizeSchema(input, { isSource = () => true } = {}) {
  if (!input || typeof input !== 'object') throw new Error('The form is empty');
  const title = clean(input.title, 200);
  if (!title) throw new Error('Give the form a title');
  const sections = Array.isArray(input.sections) ? input.sections : [];
  if (!sections.length) throw new Error('The form needs at least one section');
  if (sections.length > LIMITS.sections) throw new Error(`At most ${LIMITS.sections} sections`);
  const ids = new Set();
  let count = 0;
  const source = (f, where) => {
    if (!f.source) return null;
    if (!isSource(f.source)) throw new Error(`${where}: unknown CRM value`);
    return f.source;
  };
  const out = sections.map((s, si) => {
    const fields = (Array.isArray(s?.fields) ? s.fields : []).map((f, fi) => {
      const where = `Section ${si + 1}, item ${fi + 1}`;
      if (!FIELD_TYPES[f?.type]) throw new Error(`${where}: unknown type`);
      let id = clean(f.id, 60) || newId();
      if (ids.has(id)) id = newId();
      ids.add(id);
      if (f.type === 'divider' || f.type === 'spacer') return { id, type: f.type };
      if (f.type === 'heading') {
        const text = clean(f.text ?? f.label, 300);
        if (!text) throw new Error(`${where}: the heading is empty`);
        return { id, type: 'heading', text, level: [1, 2, 3].includes(Number(f.level)) ? Number(f.level) : 2,
          align: pick(ALIGNS, f.align, 'left') };
      }
      if (f.type === 'paragraph') {
        const text = String(f.text ?? '').replace(/\r/g, '').trim().slice(0, LIMITS.text);
        if (!text) throw new Error(`${where}: the text is empty`);
        const used = blanksInText(text);
        if (used.length > LIMITS.blanks) throw new Error(`${where}: at most ${LIMITS.blanks} blanks in one text`);
        const given = new Map((Array.isArray(f.blanks) ? f.blanks : []).map((b) => [String(b?.key), b]));
        const blanks = used.map((key) => {
          const b = given.get(key) || {};
          return { key, label: clean(b.label, 120) || key.replace(/_/g, ' '), type: pick(BLANK_TYPES, b.type, 'text'),
            required: Boolean(b.required), source: source(b, `${where} (blank "${key}")`),
            size: pick(BLANK_SIZES, b.size, 'medium') };
        });
        count += blanks.length;
        return { id, type: 'paragraph', text, align: pick(ALIGNS, f.align, 'left'), bold: Boolean(f.bold),
          italic: Boolean(f.italic), size: pick(TEXT_SIZES, f.size, 'normal'), blanks };
      }
      const label = clean(f.label, LIMITS.label);
      if (!label) throw new Error(`${where}: give the field a label`);
      const field = { id, type: f.type, label, required: f.type === 'checkbox' ? false : Boolean(f.required),
        width: pick(WIDTHS, f.width, 'full'), options: [], source: source(f, `${where} ("${label}")`),
        help: clean(f.help, 300) || null, rows: f.type === 'textarea' ? Math.min(20, Math.max(2, Number(f.rows) || 3)) : null };
      if (f.type === 'select' || f.type === 'radio') {
        field.options = [...new Set((f.options || []).map((o) => clean(o, 120)).filter(Boolean))].slice(0, LIMITS.options);
        if (!field.options.length) throw new Error(`${where} ("${label}"): add the choices`);
      }
      count += 1;
      return field;
    });
    return { id: clean(s?.id, 60) || newId('s'), title: clean(s?.title, 200), repeat: REPEATS[s?.repeat] ? s.repeat : null,
      fields };
  });
  if (count > LIMITS.fields) throw new Error(`At most ${LIMITS.fields} fields`);
  return { title, description: String(input.description ?? '').trim().slice(0, 2000) || null, sections: out };
}

// Data keys: a field's id, a blank's `${elementId}.${key}`, and `#n` after it in a section repeated per trade-in.
export const dataKey = (id, n = null) => (n == null ? id : `${id}#${n}`);
export const blankId = (elementId, key) => `${elementId}.${key}`;

// Everything a person fills in - fields and blanks - as { id, label, type, required, source, section }.
export function fillables(schema) {
  const out = [];
  for (const s of schema?.sections || []) {
    for (const f of s.fields) {
      if (INPUT_TYPES.includes(f.type)) out.push({ ...f, section: s });
      else if (f.type === 'paragraph') {
        for (const b of f.blanks || []) out.push({ id: blankId(f.id, b.key), label: b.label, type: b.type,
          required: b.required, source: b.source, section: s });
      }
    }
  }
  return out;
}
