import { RetryableError } from './logger.js';

const verifiedIndexes = new WeakMap();
export const INDEX_VERIFICATION_TTL_MS = 60000;

export function matchesUniqueIndex(index, spec) {
  return index.unique === true && !index.sparse
    && (!index.collation || index.collation.locale === 'simple')
    && JSON.stringify(index.key) === JSON.stringify(spec.key)
    && JSON.stringify(index.partialFilterExpression) === JSON.stringify(spec.options.partialFilterExpression);
}

function indexSignature(spec) {
  return JSON.stringify({ key: spec.key, partialFilterExpression: spec.options.partialFilterExpression });
}

async function verifyUniqueIndex(Model, spec) {
  try {
    const indexes = await Model.collection.listIndexes().toArray();
    if (!indexes.some(index => matchesUniqueIndex(index, spec))) throw new RetryableError('INDEX_REQUIRED');
  } catch (error) {
    if (error.code === 26) throw new RetryableError('INDEX_REQUIRED');
    throw error;
  }
}

export function requireUniqueIndex(
  Model,
  spec,
  { now = Date.now(), ttlMs = INDEX_VERIFICATION_TTL_MS } = {},
) {
  let modelCache = verifiedIndexes.get(Model);
  if (!modelCache) {
    modelCache = new Map();
    verifiedIndexes.set(Model, modelCache);
  }
  const signature = indexSignature(spec);
  const cached = modelCache.get(signature);
  if (!cached || cached.expiresAt <= now) {
    const cacheEntry = { expiresAt: now + ttlMs };
    const verification = verifyUniqueIndex(Model, spec).catch(error => {
      // Retry after a failed check so a subsequently deployed index can recover
      // the worker without a process restart.
      if (modelCache.get(signature) === cacheEntry) modelCache.delete(signature);
      throw error;
    });
    cacheEntry.verification = verification;
    modelCache.set(signature, cacheEntry);
  }
  return modelCache.get(signature).verification;
}
