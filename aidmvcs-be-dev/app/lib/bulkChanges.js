// Records one call of a bulk change into its Bulk history row (app/models/BulkChange.js). Never throws: the leads are
// already changed; a history row that can't be written is logged.
import BulkChange from '@models/BulkChange';

const BATCH = /^[A-Za-z0-9_-]{8,64}$/;

export function validBatchId(value) {
  return typeof value === 'string' && BATCH.test(value) ? value : null;
}

export async function recordBulkCall({ dealerId, batchId, action, toId = null, toLabel = null, user, items },
  { Model = BulkChange, logger = console } = {}) {
  if (!batchId || !items?.length) return null;
  const count = (r) => items.filter((i) => i.result === r).length;
  try {
    return await Model.updateOne({ dealer_id: String(dealerId), batch_id: batchId }, {
      $setOnInsert: { action, to_id: toId, to_label: toLabel, by_id: user?._id || null, by_name: user?.name || null,
        at: new Date() },
      $inc: { updated: count('updated'), unchanged: count('unchanged'), failed: count('failed') },
      $push: { items: { $each: items } },
    }, { upsert: true });
  } catch (error) {
    logger.error?.('[bulk-history] could not record', { batchId, error: error?.message });
    return null;
  }
}

// A bulk reassignment that changed at least one lead and was not undone yet can be undone; status changes cannot.
export function canUndo(row) {
  return row?.action === 'reassign' && !row.undone_at && (row.updated || 0) > 0;
}
