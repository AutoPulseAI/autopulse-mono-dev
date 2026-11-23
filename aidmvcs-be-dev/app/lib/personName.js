// A customer's name in parts - first, middle, last, suffix - as DMSs (DealerVault "First Name / Middle Name / Last
// Name / Suffix"), ADF leads (<name part="first|middle|last">) and dealership forms keep it (19 Nov 2026: "first name,
// middle and last name field ... we need to be universal"). Customer.name stays the full name everything else shows.
//
// Where the parts came from, weakest first. A stronger source is never overwritten by a weaker one, so a name staff
// typed is never changed by an import, and the DMS's name beats a guess.
//   guess  split from a one-line name (may be wrong for two-word first names - staff fix it on the profile)
//   adf    the lead provider's own first / middle / last
//   dms    the dealership's DMS
//   staff  typed on the customer profile
// Pure (no database): the API, workers, forms and the profile all use it.
export const NAME_SOURCES = Object.freeze(['guess', 'adf', 'dms', 'staff']);
export const NAME_PART_FIELDS = Object.freeze(['first_name', 'middle_name', 'last_name', 'suffix']);
export const NAME_PART_MAX = 60;

const SUFFIX = /^(jr|sr|ii|iii|iv|v|md|phd|esq)\.?$/i;
// Words that belong to the last name ("Maria de la Cruz" -> last "de la Cruz").
const PARTICLE = /^(de|del|della|der|di|da|dos|das|du|la|le|van|von|st\.?|bin|al|el|mac|ter|ten)$/i;

export const cleanPart = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_PART_MAX);

/** "JOHN O'NEIL-SMITH" -> "John O'Neil-Smith"; a name typed in mixed case is left alone. */
export function tidyCase(v) {
  const t = cleanPart(v);
  if (!t || t !== t.toUpperCase() || t === t.toLowerCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'\-.])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

export const rankOf = (from) => (NAME_SOURCES.includes(from) ? NAME_SOURCES.indexOf(from) : -1);
/** May parts from `next` replace parts that came from `current`? */
export const mayReplace = (current, next) => rankOf(next) >= rankOf(current);

/** One-line name -> parts. "Smith, John A" (DMS style) and "John A Smith Jr" both work. Empty parts are ''. */
export function splitFullName(full) {
  const out = { first_name: '', middle_name: '', last_name: '', suffix: '' };
  let t = cleanPart(full).replace(/\s*,\s*$/, '');
  if (!t) return out;
  const comma = t.match(/^([^,]+),\s*(.+)$/);
  let tokens;
  if (comma && !SUFFIX.test(comma[2].trim())) {
    // "Last, First Middle"
    const rest = comma[2].trim().split(' ');
    if (rest.length > 1 && SUFFIX.test(rest[rest.length - 1])) out.suffix = rest.pop();
    out.last_name = comma[1].trim();
    out.first_name = rest.shift() || '';
    out.middle_name = rest.join(' ');
    return out;
  }
  t = t.replace(/,/g, ' ').replace(/\s+/g, ' ');
  tokens = t.split(' ');
  if (tokens.length > 1 && SUFFIX.test(tokens[tokens.length - 1])) out.suffix = tokens.pop();
  if (tokens.length === 1) { out.first_name = tokens[0]; return out; }
  out.first_name = tokens.shift();
  const last = [tokens.pop()];
  while (tokens.length && PARTICLE.test(tokens[tokens.length - 1])) last.unshift(tokens.pop());
  out.last_name = last.join(' ');
  out.middle_name = tokens.join(' ');
  return out;
}

/** Parts -> the one-line full name. */
export function joinName(parts = {}) {
  return [parts.first_name, parts.middle_name, parts.last_name, parts.suffix].map(cleanPart).filter(Boolean).join(' ');
}

/** The parts to show / fill forms with: the stored ones, else a guess from the full name. */
export function namePartsOf(person = {}) {
  const stored = Object.fromEntries(NAME_PART_FIELDS.map((f) => [f, cleanPart(person?.[f])]));
  if (stored.first_name || stored.last_name) return { ...stored, from: person?.name_parts_from || 'guess' };
  return { ...splitFullName(person?.name), from: 'guess' };
}

/** "Smith, John A" for lists where people are looked up by last name; the full name when there is no last name. */
export function lastFirst(person = {}) {
  const p = namePartsOf(person);
  if (!p.last_name) return cleanPart(person?.name) || p.first_name || '';
  const given = [p.first_name, p.middle_name].filter(Boolean).join(' ');
  return `${p.last_name}${p.suffix ? ` ${p.suffix}` : ''}${given ? `, ${given}` : ''}`;
}

/** DMS row columns (DealerVault SL / service files) -> parts in tidy case, or null when the row has no name. */
export function dmsNameParts(row = {}, prefix = '') {
  const f = (k) => tidyCase(row[`${prefix}${k}`]);
  const parts = { first_name: f('First Name'), middle_name: f('Middle Name'), last_name: f('Last Name'), suffix: f('Suffix') };
  if (parts.first_name || parts.last_name) return parts;
  const full = cleanPart(row[`${prefix}Full Name`]);
  if (!full) return null;
  const split = splitFullName(full);
  return Object.fromEntries(Object.entries(split).map(([k, v]) => [k, tidyCase(v)]));
}
