// The user, 3 Nov 2026 (Darren McIntosh: CarGurus phone lead "Name Unknown"; he texted his name, the AI used it, the
// lead kept "Name Unknown" - the CRM's list didn't have it, the AI's did): a name is a placeholder when every word in
// it is one of the AI's own NOT_A_NAME words (agentic-upsell agent/templates.py), so both sides agree.
const NOT_A_NAME = new Set(['null', 'none', 'nil', 'undefined', 'name', 'names', 'first', 'firstname', 'last',
  'lastname', 'fullname', 'customer', 'client', 'guest', 'lead', 'unknown', 'na', 'n/a', 'nobody', 'noname', 'test',
  'there', 'sir', 'madam', 'mr', 'mrs', 'ms']);

export function isPlaceholderName(value) {
  const words = String(value || '').toLowerCase().replace(/[^a-z/\s]/g, ' ').split(/\s+/).filter(Boolean);
  return words.every((w) => NOT_A_NAME.has(w));
}
