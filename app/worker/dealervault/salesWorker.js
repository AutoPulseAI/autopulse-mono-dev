import { Worker } from 'bullmq';
import Deal from '../../models/Deal.js';
import { createBatchProcessor } from './common/batchProcessor.js';
import { getConcurrency, isRecord } from './common/validation.js';
import { permanentError, logEvent } from './common/logger.js';
import { SL_FIELDS } from './common/salesFields.js';
import { resolveCustomers } from './common/customerResolver.js';
import { normalizeVin, resolveVehicles } from './common/vehicleResolver.js';
import { requireUniqueIndex } from './common/indexProtection.js';
import { SALES_QUEUE } from './queues.js';

const tradeFields = { VIN: 'vin', Year: 'year', Make: 'make', Model: 'model', Odometer: 'odometer',
  'Actual Cash Value': 'actual_cash_value', Gross: 'gross', Payoff: 'payoff' };

export function normalizeSale(row, context, rowIndex) {
  if (!isRecord(row)) throw permanentError('INVALID_RECORD');
  if (typeof row['Deal Number'] !== 'string' || !row['Deal Number'].trim()) {
    throw permanentError('INVALID_DEAL_NUMBER');
  }
  for (const [header, expected] of [['File Type', 'SL'], ['DV Dealer ID', context.dvDealerId], ['Vendor Dealer ID', context.dvDealerId]]) {
    if (Object.hasOwn(row, header) && row[header] !== expected) throw permanentError('ROW_SOURCE_MISMATCH');
  }
  const source = {};
  for (const field of SL_FIELDS) {
    if (!Object.hasOwn(row, field)) continue;
    if (row[field] !== null && typeof row[field] !== 'string') throw permanentError('INVALID_RECORD');
    source[field] = row[field];
  }
  const key = { dealer_id: context.dealer_id, deal_number: row['Deal Number'].trim() };
  return { key, rowIndex, warnings: [], document: {
    ...source, ...key,
    customer_number: source['Customer Number']?.trim() || null,
    vin: normalizeVin(source.VIN), customer_id: null, vehicle_id: null,
    trade_ins: [1, 2].map(number => Object.fromEntries(Object.entries(tradeFields)
      .filter(([header]) => Object.hasOwn(source, `Trade ${number} ${header}`))
      .map(([header, field]) => [field, source[`Trade ${number} ${header}`]]))),
    source_file_timestamp: context.source_file_timestamp,
    source_batch_id: context.batchId, source_row_index: rowIndex,
    source_import: { provider: 'dealervault', fileName: context.fileName, fileType: 'SL', dvDealerId: context.dvDealerId },
  } };
}

export function createSalesProcessor({ CustomerModel, VehicleModel, Model = Deal, ...dependencies } = {}) {
  return createBatchProcessor({
    fileType: 'SL', Model, normalize: normalizeSale,
    reconcile: async (entries, context) => {
      await requireUniqueIndex(Model, { key: { dealer_id: 1, deal_number: 1 }, options: { unique: true } });
      await resolveCustomers(entries, context, CustomerModel);
      await resolveVehicles(entries, context, VehicleModel);
    },
    ...dependencies,
  });
}

export function setupSalesWorker(redis) {
  const worker = new Worker(SALES_QUEUE, createSalesProcessor(), {
    connection: redis,
    concurrency: getConcurrency(process.env.DEALERVAULT_SL_CONCURRENCY ?? 5, 'DEALERVAULT_SL_CONCURRENCY'),
  });
  worker.on('error', () => logEvent('worker_error', { fileType: 'SL' }, { code: 'DATABASE_FAILURE' }));
  worker.on('failed', () => logEvent('job_failed', { fileType: 'SL' }));
  return worker;
}
