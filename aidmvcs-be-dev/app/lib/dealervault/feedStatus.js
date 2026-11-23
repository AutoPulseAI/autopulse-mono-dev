// The DealerVault feed status per store and file type (24 Nov 2026; models/DealerVaultFeedStatus.js). The importer calls
// noteFile for every file it sees; backfillFeedStatus rebuilds it from import batches and held files; feedWord says in
// words whether a feed is on time. Imports are relative so the DealerVault worker can load this module.
import mongoose from 'mongoose';
import FeedStatus from '../../models/DealerVaultFeedStatus.js';
import Batch from '../../models/DealerVaultImportBatch.js';
import HeldFile from '../../models/DealerVaultHeldFile.js';

export const LATE_HOURS = 36;
const KEEP_DAYS = 30;
const NAME = /^(DVD\d+|[A-Za-z0-9-]{1,64})_(\d{8})_(\d{4})_(PTINV|SL|SV|SV_APPT|OPENRO)\.txt$/;

/** YYYYMMDDhhmm of a feed file name, or null. */
export function stampOf(fileName) {
  const m = NAME.exec(String(fileName || ''));
  return m ? `${m[2]}${m[3]}` : null;
}
export function stampDate(stamp) {
  return stamp ? new Date(Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12))) : null;
}
const cutoff = (now) => { const d = new Date(now.getTime() - KEEP_DAYS * 86400000); return d.toISOString().replace(/\D/g, '').slice(0, 12); };

/** Record one file the importer saw. Never throws (a status write must not stop an import). */
export async function noteFile({ dvDealerId, fileType, fileName, state, dealerId = null }, now = new Date()) {
  try {
    const stamp = stampOf(fileName);
    if (!stamp) return;
    const doc = await FeedStatus.findOne({ dvDealerId, fileType }).lean();
    const stamps = [...new Set([...(doc?.stamps || []), stamp])].filter((s) => s >= cutoff(now)).sort();
    const newer = !doc?.last_stamp || stamp >= doc.last_stamp;
    await FeedStatus.updateOne({ dvDealerId, fileType }, {
      $set: { stamps, dealer_id: dealerId ? String(dealerId) : (doc?.dealer_id ?? null),
        ...(newer ? { last_file: fileName, last_stamp: stamp, last_state: state } : {}),
        first_stamp: !doc?.first_stamp || stamp < doc.first_stamp ? stamp : doc.first_stamp },
    }, { upsert: true });
  } catch (error) {
    console.error('[feed-status] not recorded', { fileName, message: error?.message?.slice(0, 200) });
  }
}

/** Rebuild every store's status from the import batches and held files (one-time, or to repair). */
export async function backfillFeedStatus(now = new Date()) {
  const [batches, held, dealers] = await Promise.all([
    Batch.aggregate([{ $group: { _id: { dv: '$dvDealerId', t: '$fileType', f: '$fileName' }, dealer: { $first: '$dealer_id' } } }]).allowDiskUse(true),
    HeldFile.find({}).select('dvDealerId fileType fileName status').lean(),
    mongoose.connection.collection('users').find({ type: 'dealer', dv_dealer_id: { $nin: [null, ''] } }, { projection: { dv_dealer_id: 1 } }).toArray(),
  ]);
  const linked = new Map(dealers.map((d) => [d.dv_dealer_id, String(d._id)]));
  const files = [
    ...batches.map((b) => ({ dvDealerId: b._id.dv, fileType: b._id.t, fileName: b._id.f, state: 'queued' })),
    ...held.filter((h) => !batches.some((b) => b._id.f === h.fileName)).map((h) => ({ dvDealerId: h.dvDealerId, fileType: h.fileType, fileName: h.fileName, state: 'held' })),
  ].sort((a, b) => String(stampOf(a.fileName)).localeCompare(String(stampOf(b.fileName))));
  for (const f of files) await noteFile({ ...f, dealerId: linked.get(f.dvDealerId) || null }, now);
  return { files: files.length };
}

/**
 * A feed in words. late = it sent files in the last 30 days but nothing for LATE_HOURS; held = its newest file was held.
 * @returns {{ word: 'on time'|'late'|'held'|'never sent', hours: number|null }}
 */
export function feedWord(row, now = new Date()) {
  if (!row?.last_stamp) return { word: 'never sent', hours: null };
  const hours = Math.floor((now.getTime() - stampDate(row.last_stamp).getTime()) / 3600000);
  if (hours > LATE_HOURS) return { word: 'late', hours };
  if (row.last_state === 'held') return { word: 'held', hours };
  return { word: 'on time', hours };
}
