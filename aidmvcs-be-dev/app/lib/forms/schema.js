// A dealership form as an on-screen form (SOW v6 Deliverable K; the user, 13 Nov 2026: "the actual form ... is the
// component form", the PDF is only its preview / download). Built from the dealer's PDF (./extract.js), then edited in
// the Forms Library builder like any form builder: title, sections, fields, their types, required, options, width,
// and which CRM value fills a field (./sources.js). Shared by the server and the screens - no server imports here.
//
// schema = { title, description, sections: [{ id, title, repeat: null | 'trade_in', fields: [field] }] }
// field  = { id, type, label, required, width: 'full' | 'half' | 'third', options: [..], source: null | key,
//            help, text (paragraph / heading wording) }

export const FIELD_TYPES = Object.freeze({
  text: 'Short text', textarea: 'Long text', number: 'Number', money: 'Money ($)', date: 'Date', email: 'Email',
  phone: 'Phone', checkbox: 'Checkbox', select: 'Dropdown', radio: 'Choice (one of)', signature: 'Signature line',
  heading: 'Heading', paragraph: 'Text block (wording)',
});
export const INPUT_TYPES = Object.freeze(['text', 'textarea', 'number', 'money', 'date', 'email', 'phone', 'checkbox',
  'select', 'radio', 'signature']);
export const WIDTHS = Object.freeze({ full: 'Full width', half: 'Half', third: 'Third' });
export const REPEATS = Object.freeze({ trade_in: 'Once for each trade-in picked' });

const LIMITS = { sections: 60, fields: 400, label: 200, text: 4000, options: 50 };
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
let seq = 0;
export const newId = (p = 'f') => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
  const out = sections.map((s, si) => {
    const fields = (Array.isArray(s?.fields) ? s.fields : []).map((f, fi) => {
      const where = `Section ${si + 1}, field ${fi + 1}`;
      if (!FIELD_TYPES[f?.type]) throw new Error(`${where}: unknown field type`);
      let id = clean(f.id, 60) || newId();
      if (ids.has(id)) id = newId();
      ids.add(id);
      const field = { id, type: f.type, label: clean(f.label, LIMITS.label), required: Boolean(f.required),
        width: WIDTHS[f.width] ? f.width : 'full', options: [], source: null, help: clean(f.help, 300) || null,
        text: null };
      if (f.type === 'paragraph' || f.type === 'heading') {
        field.text = String(f.text ?? f.label ?? '').trim().slice(0, LIMITS.text);
        field.required = false;
        if (!field.text) throw new Error(`${where}: the text block is empty`);
      } else if (!field.label) throw new Error(`${where}: give the field a label`);
      if (f.type === 'select' || f.type === 'radio') {
        field.options = [...new Set((f.options || []).map((o) => clean(o, 120)).filter(Boolean))].slice(0, LIMITS.options);
        if (!field.options.length) throw new Error(`${where} ("${field.label}"): add the choices`);
      }
      if (f.source && INPUT_TYPES.includes(f.type)) {
        if (!isSource(f.source)) throw new Error(`${where} ("${field.label}"): unknown CRM value`);
        field.source = f.source;
      }
      return field;
    });
    count += fields.length;
    return { id: clean(s?.id, 60) || newId('s'), title: clean(s?.title, 200), repeat: REPEATS[s?.repeat] ? s.repeat : null,
      fields };
  });
  if (count > LIMITS.fields) throw new Error(`At most ${LIMITS.fields} fields`);
  return { title, description: String(input.description ?? '').trim().slice(0, 2000) || null, sections: out };
}

// The fields a person fills (not headings / text blocks), with the section they're in.
export function inputFields(schema) {
  return (schema?.sections || []).flatMap((s) => s.fields.filter((f) => INPUT_TYPES.includes(f.type))
    .map((f) => ({ ...f, section: s })));
}

// Data keys: a field's id, or `${id}#${n}` in a section repeated per trade-in (n = 0, 1, ...).
export const dataKey = (fieldId, n = null) => (n == null ? fieldId : `${fieldId}#${n}`);
