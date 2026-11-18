import { UnrecoverableError } from 'bullmq';
import dbConnect from '../../../lib/mongodb.js';
import Batch from '../../../models/DealerVaultImportBatch.js';
import { resolveDealer } from './dealerResolver.js';
import { validateJob } from './validation.js';
import { stageBatch, markProcessing, finishBatch, failBatch, saveValidationFailures, isCompleted, storedResult } from './staging.js';
import { writeTimestampedUpserts, isBlank } from './upserts.js';
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
      // SOW G-086 (17 Nov 2026): what was decided for every row, and why - so a record's history can be rebuilt.
      //   ACCEPT  new record, or a newer file updating it (blank fields left as they were: retained_fields)
      //   RETAIN  this file is older than the one already applied: nothing changed
      //   REVIEW  written, but its customer could not be matched safely (ambiguous / not found): a person checks it
      //   REJECT  the row was invalid (outcome already 'failed' above)
      phase = 'DATABASE_FAILURE';
      const existing = entries.length && Model?.find ? await Model.find({ $or: entries.map((e) => e.key) })
        .select({ ...Object.fromEntries(Object.keys(entries[0].key).map((k) => [k, 1])), source_file_timestamp: 1 })
        .lean().catch(() => []) : [];
      const keyOf = (k) => JSON.stringify(Object.keys(k).sort().map((f) => [f, String(k[f])]));
      const before = new Map(existing.map((d) => [keyOf(Object.fromEntries(Object.keys(entries[0].key).map((f) => [f, d[f]]))), d]));
      for (const entry of entries) {
        const prev = before.get(keyOf(entry.key));
        const outcome = outcomes[entry.rowIndex];
        const blanks = Object.entries(entry.document).filter(([, v]) => isBlank(v)).map(([f]) => f);
        if (prev && prev.source_file_timestamp && prev.source_file_timestamp > entry.document.source_file_timestamp) {
          Object.assign(outcome, { decision: 'RETAIN', reason: `a newer file (${prev.source_file_timestamp}) is already applied` });
        } else {
          Object.assign(outcome, { decision: (entry.warnings || []).length ? 'REVIEW' : 'ACCEPT',
            reason: prev ? `updated from file ${prev.source_file_timestamp || 'without a date'}` : 'new record',
            ...(prev && blanks.length ? { retained_fields: blanks.slice(0, 40) } : {}),
            ...((entry.warnings || []).length ? { review: entry.warnings } : {}) });
        }
        outcome.effective = entry.document.source_file_timestamp;
      }
      for (const outcome of outcomes) if (outcome.status === 'failed') Object.assign(outcome, { decision: 'REJECT', reason: outcome.code });
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
