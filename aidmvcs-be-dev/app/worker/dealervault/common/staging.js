import Batch from '../../../models/DealerVaultImportBatch.js';
import { permanentError } from './logger.js';

const terminal = ['completed', 'completed_with_errors'];
export const isCompleted = batch => terminal.includes(batch.status);

export function batchIdentity(context) {
  const { dealer_id, fileName, fileType, batchId } = context;
  return { dealer_id, fileName, fileType, batchId };
}

export async function stageBatch(context, Model = Batch) {
  const identity = batchIdentity(context);
  let batch;
  try {
    batch = await Model.findOneAndUpdate(identity, { $setOnInsert: {
      ...identity, dvDealerId: context.dvDealerId, digest: context.digest,
      raw_records_json: JSON.stringify(context.records), total_records: context.records.length,
      status: 'pending',
    } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    // Only recover a competing insert when the exact intended batch exists.
    batch = await Model.findOne(identity).lean();
    if (!batch) throw error;
  }
  if (batch.digest !== context.digest) throw permanentError('BATCH_CONTENT_CONFLICT');
  return batch;
}

export async function markProcessing(context, Model = Batch) {
  await Model.updateOne({ ...batchIdentity(context), digest: context.digest,
    status: { $nin: terminal } }, { $set: {
    status: 'processing', startedAt: new Date(), completedAt: null, error_code: null,
  } });
}

export async function finishBatch(context, result, Model = Batch) {
  await Model.updateOne({ ...batchIdentity(context), digest: context.digest,
    status: { $nin: terminal } }, { $set: {
    status: result.failed ? 'completed_with_errors' : 'completed',
    processed_count: result.processed, failed_count: result.failed,
    unchanged_count: result.unchanged, row_outcomes: result.outcomes,
    completedAt: new Date(), error_code: null,
  } });
}

export async function saveValidationFailures(context, outcomes, Model = Batch) {
  const failures = outcomes.filter(outcome => outcome.status === 'failed');
  await Model.updateOne({ ...batchIdentity(context), digest: context.digest,
    status: { $nin: terminal } }, { $set: {
    failed_count: failures.length, processed_count: 0, unchanged_count: 0,
    row_outcomes: failures,
  } });
}

export async function failBatch(context, code, Model = Batch) {
  await Model.updateOne({ ...batchIdentity(context), digest: context.digest,
    status: { $nin: terminal } }, { $set: { status: 'failed', error_code: code } });
}

export function storedResult(batch) {
  return {
    received: batch.total_records, processed: batch.processed_count,
    failed: batch.failed_count, unchanged: batch.unchanged_count, reused: true,
  };
}
