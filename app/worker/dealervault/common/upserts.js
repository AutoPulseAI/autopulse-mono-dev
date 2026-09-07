// Shared by ingestion workers. All values passed here must already be normalized.
export function timestampFilter(key, timestamp) {
  return { ...key, $or: [
    { source_file_timestamp: { $exists: false } },
    { source_file_timestamp: null },
    { source_file_timestamp: { $lte: timestamp } },
  ] };
}

export function isNaturalKeyDuplicate(error, key) {
  const detail = error.err || error;
  if ((error.code ?? detail.code) !== 11000) return false;
  const pattern = detail.keyPattern || detail.errInfo?.keyPattern || error.keyPattern;
  if (pattern) {
    return Object.keys(pattern).length === Object.keys(key).length
      && Object.keys(key).every(field => pattern[field] === 1);
  }
  // Mongo bulk errors can expose only the index name in their text. Inspect it
  // locally; never log this message, which also contains the duplicate key value.
  const indexName = Object.keys(key).map(field => `${field}_1`).join('_');
  return String(detail.errmsg || error.message || '').includes(`index: ${indexName} dup key:`);
}

function resultCounts(result = {}) {
  return {
    matched: result.matchedCount || 0,
    modified: result.modifiedCount || 0,
    upserted: result.upsertedCount || 0,
  };
}

/**
 * entries: [{ key: { dealer_id, <natural key> }, document, rowIndex }]
 * Use the natural-key unique index to distinguish an older rejected upsert
 * from a concurrent insert. Do not retry other duplicate indexes as stale rows.
 */
export async function writeTimestampedUpserts(Model, entries) {
  if (!entries.length) return { processed: 0, unchanged: 0, matched: 0, modified: 0, upserted: 0 };
  const operations = entries.map(({ key, document }) => {
    if (!key.dealer_id || Object.keys(key).length !== 2
        || Object.entries(key).some(([field, value]) => document[field] !== value)
        || !/^\d{12}$/.test(document.source_file_timestamp)) {
      throw new Error('UPSERT_FAILURE');
    }
    return { updateOne: {
      filter: timestampFilter(key, document.source_file_timestamp),
      update: { $set: document }, upsert: true,
    } };
  });
  try {
    const result = await Model.bulkWrite(operations, { ordered: false });
    return { processed: entries.length, unchanged: 0, ...resultCounts(result) };
  } catch (error) {
    const failures = error.writeErrors;
    const concern = error.result?.getWriteConcernError?.();
    if ((error.code !== undefined && error.code !== 11000)
        || !Array.isArray(failures) || !failures.length || concern
        || error.writeConcernErrors?.length
        || failures.some(failure => !entries[failure.index]
          || !isNaturalKeyDuplicate(failure, entries[failure.index].key))) throw error;
    const counts = resultCounts(error.result);
    let unchanged = 0;
    // Recovery is bounded by batch size; normal writes remain one unordered bulk.
    for (const failure of failures) {
      const { key, document } = entries[failure.index];
      const current = await Model.findOne(key).select('source_file_timestamp').lean();
      if (current?.source_file_timestamp > document.source_file_timestamp) {
        unchanged += 1;
        continue;
      }
      // Retry once using exactly the same timestamp condition. A newer update
      // racing this retry still cannot be overwritten.
      try {
        const result = await Model.updateOne(
          timestampFilter(key, document.source_file_timestamp),
          { $set: document }, { upsert: true },
        );
        counts.matched += result.matchedCount || 0;
        counts.modified += result.modifiedCount || 0;
        counts.upserted += result.upsertedCount || 0;
      } catch (retryError) {
        if (!isNaturalKeyDuplicate(retryError, key)) throw retryError;
        const winner = await Model.findOne(key).select('source_file_timestamp').lean();
        if (winner?.source_file_timestamp > document.source_file_timestamp) unchanged += 1;
        else throw retryError;
      }
    }
    return { processed: entries.length, unchanged, ...counts };
  }
}
