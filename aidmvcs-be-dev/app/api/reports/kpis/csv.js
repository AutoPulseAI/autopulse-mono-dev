// CSV for the Reports page drill-downs: exactly the rows the screen lists, one line per record (no footer row, so the
// line count is the total). Line breaks inside a value become spaces; a value a spreadsheet would run as a formula is
// prefixed with a quote.
function csvCell(value) {
  let s = value == null ? '' : String(value).replace(/[\r\n]+/g, ' ');
  if (/^[=@]/.test(s) || /^[+-][^\d\s]/.test(s)) s = `'${s}`;
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** @param {[string, string][]} columns [key, label] pairs  @param {object[]} rows */
export function toCsv(columns, rows) {
  const lines = [columns.map(([, label]) => csvCell(label)).join(',')];
  for (const r of rows) lines.push(columns.map(([key]) => csvCell(r[key])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
