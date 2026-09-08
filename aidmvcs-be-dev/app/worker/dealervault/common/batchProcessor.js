import { UnrecoverableError } from 'bullmq';
import dbConnect from '../../../lib/mongodb.js';
import Batch from '../../../models/DealerVaultImportBatch.js';
import { resolveDealer } from './dealerResolver.js';
import { validateJob } from './validation.js';
import { stageBatch, markProcessing, finishBatch, failBatch, saveValidationFailures, isCompleted, storedResult } from './staging.js';
import { writeTimestampedUpserts } from './upserts.js';
import { logEvent, safeError, safeCode } from './logger.js';

export function createBatchProcessor({
  fileType, Model, normalize, connect = () => dbConnect({ reportErrors: false }), dealerResolver = resolveDealer,
  BatchModel = Batch, write = writeTimestampedUpserts, log = logEvent, reconcile,
}) {
  return async function processBatch(job) {
    let context;
    let staged = false;
    let phase = 'DATABASE_FAILURE';
    try {
      context = validateJob(job.data, fileType);
      log('batch_started', context, { received: context.records.length });
      await connect();
      context.dealer_id = await dealerResolver(context.dvDealerId);
      phase = 'STAGING_FAILURE';
      const batch = await stageBatch(context, BatchModel);
      if (isCompleted(batch)) {
        const result = storedResult(batch);
        log('batch_reused', context, result);
        return result;
      }
      staged = true;
      await markProcessing(context, BatchModel);
      // Reprocess the original persisted batch, not a replacement delivery.
      const records = JSON.parse(batch.raw_records_json);
      const entries = [];
      const outcomes = [];
      phase = 'DATABASE_FAILURE';
      for (let rowIndex = 0; rowIndex < records.length; rowIndex += 1) {
        try {
          entries.push(normalize(records[rowIndex], context, rowIndex));
          outcomes.push({ row_index: rowIndex, status: 'processed', code: 'PROCESSED' });
        } catch (error) {
          if (!(error instanceof UnrecoverableError)) throw error;
          outcomes.push({ row_index: rowIndex, status: 'failed', code: safeCode(error) });
          log('row_failed', context, { code: safeCode(error), row_index: rowIndex });
        }
      }
      phase = 'STAGING_FAILURE';
      await saveValidationFailures(context, outcomes, BatchModel);
      if (reconcile && entries.length) {
        phase = 'DATABASE_FAILURE';
        await reconcile(entries, context);
        for (const entry of entries) {
          outcomes[entry.rowIndex].warnings = entry.warnings || [];
          for (const code of entry.warnings || []) {
            log('row_warning', context, { code, row_index: entry.rowIndex });
          }
        }
      }
      phase = 'UPSERT_FAILURE';
      const writes = await write(Model, entries);
      const result = {
        received: records.length, processed: entries.length,
        failed: records.length - entries.length, unchanged: writes.unchanged,
      };
      phase = 'STAGING_FAILURE';
      await finishBatch(context, { ...result, outcomes }, BatchModel);
      log('batch_completed', context, { ...result, ...writes });
      return { ...result, reused: false };
    } catch (error) {
      const sanitized = safeError(error, phase);
      if (staged) {
        try { await failBatch(context, sanitized.message, BatchModel); }
        catch { log('staging_failure', context, { code: 'STAGING_FAILURE' }); }
      }
      log('batch_failed', context, { code: sanitized.message });
      throw sanitized;
    }
  };
}
