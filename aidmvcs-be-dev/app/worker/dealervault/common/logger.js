import { UnrecoverableError } from 'bullmq';

// Only application-owned codes are allowed in logs, staging, and failedReason.
const codes = new Set([
  'INVALID_JOB', 'INVALID_RECORD', 'INVALID_PART_NUMBER', 'ROW_SOURCE_MISMATCH',
  'DEALER_NOT_FOUND', 'DEALER_AMBIGUOUS', 'BATCH_CONTENT_CONFLICT',
  'DATABASE_FAILURE', 'STAGING_FAILURE', 'UPSERT_FAILURE', 'INDEX_REQUIRED',
]);

export function permanentError(code) {
  const error = new UnrecoverableError(codes.has(code) ? code : 'INVALID_JOB');
  error.safeCode = error.message;
  return error;
}

export function safeError(error, fallback = 'DATABASE_FAILURE') {
  if (error instanceof UnrecoverableError && codes.has(error.safeCode)) return error;
  return new Error(codes.has(fallback) ? fallback : 'DATABASE_FAILURE');
}

export function safeCode(error, fallback = 'DATABASE_FAILURE') {
  return safeError(error, fallback).message;
}

export function logEvent(event, context = {}, counts = {}) {
  // Context is supplied only after envelope validation; never pass job.data here.
  const { fileName, fileType, batchId, dvDealerId, dealer_id } = context;
  const { received, processed, failed, unchanged, matched, modified, upserted, code } = counts;
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(), event,
    fileName, fileType, batchId, dvDealerId, dealer_id,
    received, processed, failed, unchanged, matched, modified, upserted,
    ...(codes.has(code) ? { code } : {}),
  }));
}
