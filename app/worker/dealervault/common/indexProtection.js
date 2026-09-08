import { RetryableError } from './logger.js';

export function matchesUniqueIndex(index, spec) {
  return index.unique === true && !index.sparse
    && (!index.collation || index.collation.locale === 'simple')
    && JSON.stringify(index.key) === JSON.stringify(spec.key)
    && JSON.stringify(index.partialFilterExpression) === JSON.stringify(spec.options.partialFilterExpression);
}

export async function requireUniqueIndex(Model, spec) {
  let indexes;
  try { indexes = await Model.collection.listIndexes().toArray(); }
  catch (error) {
    if (error.code === 26) throw new RetryableError('INDEX_REQUIRED');
    throw error;
  }
  if (!indexes.some(index => matchesUniqueIndex(index, spec))) {
    throw new RetryableError('INDEX_REQUIRED');
  }
}
