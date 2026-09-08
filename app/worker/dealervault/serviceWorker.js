import { Worker } from 'bullmq';
import RepairOrder from '../../models/RepairOrder.js';
import { createBatchProcessor } from './common/batchProcessor.js';
import { getConcurrency, isRecord } from './common/validation.js';
import { permanentError, logEvent } from './common/logger.js';
import { SV_FIELDS, SV_REPEATING_FIELDS } from './common/serviceFields.js';
import { splitRepeatingGroups } from './common/repeatingGroups.js';
import { resolveCustomers } from './common/customerResolver.js';
import { normalizeVin, resolveVehicles } from './common/vehicleResolver.js';
import { requireUniqueIndex } from './common/indexProtection.js';
import { SERVICE_QUEUE } from './queues.js';

// Delimiters plus outer padding can expand a small transport payload enormously.
// Bound the derived structure before allocating it; the raw row remains staged.
export const MAX_SERVICE_OPERATION_CELLS = 100000;

export function parseServiceOperations(source) {
  const columns = [];
  for (const [header, field] of Object.entries(SV_REPEATING_FIELDS)) {
    // A missing/null source column provides no parseable string. Preserve it
    // unchanged in source storage; do not manufacture it in the derived view.
    if (!Object.hasOwn(source, header) || source[header] === null) continue;
    try { columns.push([field, splitRepeatingGroups(source[header])]); }
    catch { throw permanentError('SV_REPEAT_PARSE_ERROR'); }
  }
  if (!columns.length) {
    // Explicit null repeat inputs clear an old derived view; absent inputs do not.
    return Object.keys(SV_REPEATING_FIELDS).some(header => Object.hasOwn(source, header)) ? [] : undefined;
  }
  const groupCount = Math.max(...columns.map(([, groups]) => groups.length));
  const cells = columns.reduce((total, [, groups]) => total
    + groups.reduce((count, group) => count + group.length, 0) + groupCount - groups.length, 0);
  if (cells > MAX_SERVICE_OPERATION_CELLS) throw permanentError('SV_REPEAT_PARSE_ERROR');
  return Array.from({ length: groupCount }, (_, group_index) => ({
    group_index,
    ...Object.fromEntries(columns.map(([field, groups]) => [field, groups[group_index] ?? ['']])),
  }));
}

export function normalizeService(row, context, rowIndex) {
  if (!isRecord(row)) throw permanentError('INVALID_RECORD');
  if (typeof row['RO Number'] !== 'string' || !row['RO Number'].trim()) {
    throw permanentError('ROW_MISSING_RO_NUMBER');
  }
  for (const [header, expected] of [['File Type', 'SV'], ['DV Dealer ID', context.dvDealerId], ['Vendor Dealer ID', context.dvDealerId]]) {
    if (Object.hasOwn(row, header) && row[header] !== expected) throw permanentError('ROW_SOURCE_MISMATCH');
  }
  const source = {};
  for (const field of SV_FIELDS) {
    if (!Object.hasOwn(row, field)) continue;
    if (row[field] !== null && typeof row[field] !== 'string') {
      throw permanentError(Object.hasOwn(SV_REPEATING_FIELDS, field) ? 'SV_REPEAT_PARSE_ERROR' : 'INVALID_RECORD');
    }
    source[field] = row[field];
  }
  const key = { dealer_id: context.dealer_id, ro_number: row['RO Number'].trim() };
  const operations = parseServiceOperations(source);
  return { key, rowIndex, warnings: [], document: {
    ...source, ...key,
    ...(Object.hasOwn(source, 'Customer Number') ? { customer_number: source['Customer Number']?.trim() ?? null } : {}),
    ...(Object.hasOwn(source, 'VIN') ? { vin: normalizeVin(source.VIN) } : {}),
    ...(operations ? { service_operations: operations } : {}),
    source_file_timestamp: context.source_file_timestamp,
    source_batch_id: context.batchId, source_row_index: rowIndex,
    source_import: { provider: 'dealervault', fileName: context.fileName, fileType: 'SV', dvDealerId: context.dvDealerId },
  } };
}

export function createServiceProcessor({ CustomerModel, VehicleModel, Model = RepairOrder, ...dependencies } = {}) {
  return createBatchProcessor({
    fileType: 'SV', Model, normalize: normalizeService,
    reconcile: async (entries, context) => {
      await requireUniqueIndex(Model, { key: { dealer_id: 1, ro_number: 1 }, options: { unique: true } });
      await resolveCustomers(entries, context, CustomerModel);
      await resolveVehicles(entries, context, VehicleModel);
      for (const { document } of entries) {
        // In partial SV rows, absent identity/contact inputs must not clear an
        // existing link. Explicit source inputs still use SL's null-on-unresolved
        // behavior, avoiding a stale relationship after an identity change.
        if (document.customer_id === null && !['Customer Number', 'Email 1', 'Email 2', 'Email 3',
          'Home Phone', 'Cell Phone', 'Work Phone'].some(field => Object.hasOwn(document, field))) {
          delete document.customer_id;
        }
        if (document.vehicle_id === null && !Object.hasOwn(document, 'VIN')) delete document.vehicle_id;
      }
    },
    ...dependencies,
  });
}

export function setupServiceWorker(redis) {
  const worker = new Worker(SERVICE_QUEUE, createServiceProcessor(), {
    connection: redis,
    concurrency: getConcurrency(process.env.DEALERVAULT_SV_CONCURRENCY ?? 5, 'DEALERVAULT_SV_CONCURRENCY'),
  });
  worker.on('error', () => logEvent('worker_error', { fileType: 'SV' }, { code: 'DATABASE_FAILURE' }));
  worker.on('failed', () => logEvent('job_failed', { fileType: 'SV' }));
  return worker;
}
