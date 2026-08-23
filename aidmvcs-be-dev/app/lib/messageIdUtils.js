/**
 * Normalize RFC 5322 Message-ID to "<local@domain>" or ''.
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function normalizeMessageId(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  if (!s) return '';
  const bracketed = s.match(/^<\s*([^>]+?)\s*>$/);
  if (bracketed) {
    const inner = bracketed[1].trim();
    return inner ? `<${inner}>` : '';
  }
  const inner = s.replace(/^<\s*/, '').replace(/\s*>$/, '').trim();
  if (!inner) return '';
  return `<${inner}>`;
}
