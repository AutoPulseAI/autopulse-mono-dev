import { UnrecoverableError } from 'bullmq';

// Only application-owned codes are allowed in logs, staging, and failedReason.
const codes = new Set([
  'INVALID_JOB', 'INVALID_RECORD', 'INVALID_PART_NUMBER', 'ROW_SOURCE_MISMATCH',
  'DEALER_NOT_FOUND', 'DEALER_AMBIGUOUS', 'BATCH_CONTENT_CONFLICT',
  'DATABASE_FAILURE', 'STAGING_FAILURE', 'UPSERT_FAILURE', 'INDEX_REQUIRED',
  'INVALID_DEAL_NUMBER', 'CUSTOMER_UNRESOLVED', 'CUSTOMER_AMBIGUOUS',
  'CUSTOMER_MERGED', 'VEHICLE_NOT_FOUND', 'VEHICLE_AMBIGUOUS', 'VIN_MISSING', 'VIN_INVALID',
  'ROW_MISSING_RO_NUMBER', 'SV_REPEAT_PARSE_ERROR',
  'SV_APPT_MISSING_APPOINTMENT_NUMBER', 'SV_APPT_INVALID_SOURCE_FIELD',
  'SV_APPT_RO_UNRESOLVED', 'SV_APPT_RO_AMBIGUOUS', 'SV_APPT_INVALID_DATE', 'SV_APPT_OPERATION_DELIMITERS',
]);

export function permanentError(code) {
  const error = new UnrecoverableError(codes.has(code) ? code : 'INVALID_JOB');
  error.safeCode = error.message;
  return error;
}

export class RetryableError extends Error {}

export function safeError(error, fallback = 'DATABASE_FAILURE') {
  if (error instanceof UnrecoverableError && codes.has(error.safeCode)) return error;
  if (error instanceof RetryableError && codes.has(error.message)) return new Error(error.message);
  return new Error(codes.has(fallback) ? fallback : 'DATABASE_FAILURE');
}

export function safeCode(error, fallback = 'DATABASE_FAILURE') {
  return safeError(error, fallback).message;
}

export function logEvent(event, context = {}, counts = {}) {
  // Context is supplied only after envelope validation; never pass job.data here.
  const { fileName, fileType, batchId, dvDealerId, dealer_id } = context;
  const { received, processed, failed, unchanged, matched, modified, upserted, code, row_index } = counts;
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(), event,
    fileName, fileType, batchId, dvDealerId, dealer_id,
    received, processed, failed, unchanged, matched, modified, upserted,
    ...(Number.isSafeInteger(row_index) && row_index >= 0 ? { row_index } : {}),
    ...(codes.has(code) ? { code } : {}),
  }));
}
