// Is a DMS feed file safe to import? (SOW G-087, 17 Nov 2026.) Checked on the whole file before any of it is queued:
//   - its key column is missing, or most rows have no key (Deal / RO / Appointment / Part Number): malformed
//   - far smaller than this store's usual files of this type (under 10% of the median of its last 10 files, when
//     those are usually 200+ rows): likely cut short. Daily delta files vary a lot, so only a drastic drop counts.
// A file that fails is held (DealerVaultHeldFile) and the team is emailed; nothing from it is written until a super
// admin releases it. Repeated files are already harmless (each record has a stable key; an older file never
// overwrites a newer one; blanks never overwrite values - common/upserts.js).
import Batch from '../../models/DealerVaultImportBatch.js';

export const KEY_COLUMN = Object.freeze({ SL: 'Deal Number', SV: 'RO Number', SV_APPT: 'Appointment Number', PTINV: 'Part Number' });
const SMALL_SHARE = 0.1;
const SMALL_MIN_TYPICAL = 200;

const median = (nums) => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** The sizes of this store's last files of this type (completed imports), newest first. */
export async function recentFileSizes(dvDealerId, fileType, { BatchModel = Batch, limit = 10 } = {}) {
  return (await BatchModel.aggregate([
    { $match: { dvDealerId, fileType, status: { $in: ['completed', 'completed_with_errors'] } } },
    { $group: { _id: '$fileName', n: { $sum: '$total_records' } } },
    { $sort: { _id: -1 } }, { $limit: limit },
  ])).map((r) => r.n);
}

/** @returns {{ ok: boolean, reasons: string[], expected: number|null }} */
export function checkFeedFile({ fileType, records, recentSizes = [] }) {
  const reasons = [];
  const col = KEY_COLUMN[fileType];
  const rows = Array.isArray(records) ? records : [];
  if (col && rows.length && !Object.hasOwn(rows[0], col)) reasons.push(`the "${col}" column is missing`);
  else if (col && rows.length) {
    const missing = rows.filter((r) => !String(r[col] ?? '').trim()).length;
    if (missing / rows.length > 0.5) reasons.push(`${missing} of ${rows.length} rows have no ${col}`);
  }
  const expected = recentSizes.length >= 5 ? median(recentSizes) : null;
  if (expected != null && expected >= SMALL_MIN_TYPICAL && rows.length < expected * SMALL_SHARE) {
    reasons.push(`only ${rows.length} rows; this store's recent ${fileType} files have about ${Math.round(expected)}`);
  }
  return { ok: reasons.length === 0, reasons, expected };
}
