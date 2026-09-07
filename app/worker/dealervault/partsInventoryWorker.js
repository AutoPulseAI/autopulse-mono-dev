import { Worker } from 'bullmq';
import PartInventory from '../../models/PartInventory.js';
import { createBatchProcessor } from './common/batchProcessor.js';
import { getConcurrency, isRecord } from './common/validation.js';
import { permanentError, logEvent } from './common/logger.js';
import { PTINV_FIELDS } from './common/sourceFields.js';
import { PARTS_QUEUE } from './queues.js';

export function normalizePart(row, context, rowIndex) {
  if (!isRecord(row)) throw permanentError('INVALID_RECORD');
  const partNumber = row['Part Number'];
  if (typeof partNumber !== 'string' || !partNumber.trim()) {
    throw permanentError('INVALID_PART_NUMBER');
  }
  for (const [header, expected] of [
    ['File Type', 'PTINV'], ['DV Dealer ID', context.dvDealerId],
    ['Vendor Dealer ID', context.dvDealerId],
  ]) {
    if (Object.hasOwn(row, header) && row[header] !== expected) {
      throw permanentError('ROW_SOURCE_MISMATCH');
    }
  }
  const source = {};
  for (const field of PTINV_FIELDS) {
    if (!Object.hasOwn(row, field)) continue;
    if (row[field] !== null && typeof row[field] !== 'string') throw permanentError('INVALID_RECORD');
    source[field] = row[field];
  }
  const key = { dealer_id: context.dealer_id, part_number: partNumber.trim() };
  return {
    key, rowIndex,
    document: {
      ...source, ...key,
      source_file_timestamp: context.source_file_timestamp,
      source_batch_id: context.batchId, source_row_index: rowIndex,
      source_import: {
        provider: 'dealervault', fileName: context.fileName, fileType: 'PTINV',
        dvDealerId: context.dvDealerId,
      },
    },
  };
}

export function createPartsProcessor(dependencies = {}) {
  return createBatchProcessor({
    fileType: 'PTINV', Model: PartInventory, normalize: normalizePart, ...dependencies,
  });
}

export function setupPartsInventoryWorker(redis) {
  const worker = new Worker(PARTS_QUEUE, createPartsProcessor(), {
    connection: redis, concurrency: getConcurrency(),
  });
  // Never forward raw BullMQ errors or job payloads to the existing generic logger.
  worker.on('error', () => logEvent('worker_error', { fileType: 'PTINV' }, { code: 'DATABASE_FAILURE' }));
  worker.on('failed', () => logEvent('job_failed', { fileType: 'PTINV' }));
  return worker;
}
