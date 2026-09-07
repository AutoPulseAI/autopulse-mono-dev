import test from 'node:test';
import assert from 'node:assert/strict';
import { UnrecoverableError } from 'bullmq';
import User from './app/models/User.js';
import Batch from './app/models/DealerVaultImportBatch.js';
import { validateJob, getConcurrency, MAX_JOB_BYTES } from './app/worker/dealervault/common/validation.js';
import { resolveDealer } from './app/worker/dealervault/common/dealerResolver.js';
import { logEvent, safeError } from './app/worker/dealervault/common/logger.js';
import { stageBatch, isCompleted, markProcessing, finishBatch, failBatch } from './app/worker/dealervault/common/staging.js';
import { writeTimestampedUpserts } from './app/worker/dealervault/common/upserts.js';
import { createBatchProcessor } from './app/worker/dealervault/common/batchProcessor.js';

const payload = () => ({
  fileName: 'DVD46315_20260902_1846_PTINV.txt', fileType: 'PTINV',
  dvDealerId: 'DVD46315', batchId: 4, records: [{ 'Part Number': '001' }],
});
const context = () => ({ ...validateJob(payload(), 'PTINV'), dealer_id: 'dealer-a' });
const query = value => ({ select() { return this; }, limit() { return this; }, lean: async () => value });
const item = (stamp = '202609021846') => ({
  key: { dealer_id: 'dealer-a', part_number: '001' }, rowIndex: 0,
  document: { dealer_id: 'dealer-a', part_number: '001', source_file_timestamp: stamp },
});
const duplicate = (index = 0) => ({ index, code: 11000, keyPattern: { dealer_id: 1, part_number: 1 } });
const bulkError = () => Object.assign(new Error('private duplicate value'), { writeErrors: [duplicate()] });

test('job validation enforces metadata, size, dates and batch limits', () => {
  assert.equal(validateJob(payload(), 'PTINV').source_file_timestamp, '202609021846');
  for (const change of [
    { fileType: 'SL' }, { batchId: -1 }, { batchId: 0.5 }, { batchId: '4' },
    { records: [] }, { records: {} }, { records: Array(101).fill({}) },
    { records: [{ value: 'x'.repeat(MAX_JOB_BYTES) }] },
    { dvDealerId: 'other' }, { fileName: '../DVD46315_20260902_1846_PTINV.txt' },
    { fileName: 'DVD46315_20260230_1846_PTINV.txt' },
  ]) assert.throws(() => validateJob({ ...payload(), ...change }, 'PTINV'), UnrecoverableError);
  const a = validateJob({ ...payload(), records: [{ a: '', b: null }] }, 'PTINV');
  const b = validateJob({ ...payload(), records: [{ b: null, a: '' }] }, 'PTINV');
  assert.equal(a.digest, b.digest);
});

test('concurrency is configurable with a conservative default', () => {
  assert.equal(getConcurrency('5'), 5);
  for (const value of ['0', '-1', '1.2', '', 'secret', 'Infinity']) {
    assert.throws(() => getConcurrency(value));
  }
});

test('dealer resolution checks dealer type and rejects missing or ambiguous mappings', async () => {
  let filter;
  const model = rows => ({ find: value => { filter = value; return query(rows); } });
  assert.equal(await resolveDealer('DVD46315', model([{ _id: 'internal' }])), 'internal');
  assert.deepEqual(filter, { type: 'dealer', dv_dealer_id: 'DVD46315' });
  await assert.rejects(resolveDealer('DVD46315', model([])), /DEALER_NOT_FOUND/);
  await assert.rejects(resolveDealer('DVD46315', model([{}, {}])), /DEALER_AMBIGUOUS/);
});

test('only dealer and staging indexes are introduced by shared infrastructure', () => {
  const dealerIndex = User.schema.indexes().find(([fields]) => fields.dv_dealer_id);
  assert.equal(dealerIndex[1].unique, true);
  assert.equal(dealerIndex[1].partialFilterExpression.type, 'dealer');
  const batchIndex = Batch.schema.indexes()[0];
  assert.deepEqual(batchIndex[0], { dealer_id: 1, fileName: 1, fileType: 1, batchId: 1 });
  assert.equal(batchIndex[1].unique, true);
});

test('staging retains raw data on insert and never replaces it on reuse', async () => {
  const c = context();
  let update;
  const batch = { digest: c.digest, status: 'completed' };
  const Model = { findOneAndUpdate: (filter, value) => {
    assert.equal(filter.dealer_id, c.dealer_id);
    update = value;
    return query(batch);
  } };
  assert.equal(await stageBatch(c, Model), batch);
  assert.deepEqual(JSON.parse(update.$setOnInsert.raw_records_json), c.records);
  assert.equal(update.$set, undefined);
  await assert.rejects(stageBatch({ ...c, digest: 'changed' }, Model), /BATCH_CONTENT_CONFLICT/);
});

test('staging recovers a duplicate insert by reading the exact identity', async () => {
  const c = context();
  const Model = {
    findOneAndUpdate: () => ({ lean: async () => { throw Object.assign(new Error(), { code: 11000 }); } }),
    findOne: filter => { assert.equal(filter.dealer_id, c.dealer_id); return query({ digest: c.digest }); },
  };
  assert.equal((await stageBatch(c, Model)).digest, c.digest);
});

test('only completed staging is reusable and terminal status cannot regress', async () => {
  for (const status of ['pending', 'processing', 'failed']) assert.equal(isCompleted({ status }), false);
  for (const status of ['completed', 'completed_with_errors']) assert.equal(isCompleted({ status }), true);
  const Model = { updateOne: async filter => {
    assert.equal(filter.dealer_id, 'dealer-a');
    assert.deepEqual(filter.status.$nin, ['completed', 'completed_with_errors']);
  } };
  await markProcessing(context(), Model);
  await finishBatch(context(), { processed: 1, failed: 0, unchanged: 0, outcomes: [] }, Model);
  await failBatch(context(), 'UPSERT_FAILURE', Model);
});

test('batch retries failed/incomplete staging but reuses completed results without writes', async () => {
  for (const status of ['pending', 'processing', 'failed', 'completed', 'completed_with_errors']) {
    const c = context();
    let writes = 0;
    let updates = 0;
    const BatchModel = {
      findOneAndUpdate: () => query({ digest: c.digest, status,
        raw_records_json: JSON.stringify(c.records), total_records: 1,
        processed_count: 1, failed_count: 0, unchanged_count: 0 }),
      updateOne: async () => { updates += 1; },
    };
    const process = createBatchProcessor({
      fileType: 'PTINV', Model: {}, BatchModel, connect: async () => {},
      dealerResolver: async () => c.dealer_id, log: () => {},
      normalize: () => item(), write: async () => { writes += 1; return { unchanged: 0 }; },
    });
    const result = await process({ data: payload() });
    const complete = status.startsWith('completed');
    assert.equal(result.reused, complete);
    assert.equal(writes, complete ? 0 : 1);
    assert.equal(updates, complete ? 0 : 3);
  }
});

test('staging failure prevents normalized writes and sanitizes failedReason', async () => {
  const process = createBatchProcessor({
    fileType: 'PTINV', Model: {}, normalize: () => assert.fail(),
    connect: async () => {}, dealerResolver: async () => 'dealer-a', log: () => {},
    BatchModel: { findOneAndUpdate: () => { throw new Error('customer@example.com'); } },
  });
  await assert.rejects(process({ data: payload() }), { message: 'STAGING_FAILURE' });
});

test('timestamp bulk upserts contain dealer scope and guard, with unordered execution', async () => {
  const Model = { bulkWrite: async (ops, options) => {
    assert.equal(options.ordered, false);
    assert.equal(ops[0].updateOne.filter.dealer_id, 'dealer-a');
    assert.equal(ops[0].updateOne.filter.part_number, '001');
    assert.ok(ops[0].updateOne.filter.$or.some(clause => clause.source_file_timestamp?.$lte === '202609021846'));
    assert.equal(ops[0].updateOne.upsert, true);
    return { upsertedCount: 1 };
  } };
  assert.equal((await writeTimestampedUpserts(Model, [item()])).upserted, 1);
});

test('older duplicate upsert becomes an unchanged row; concurrent insert retries once', async () => {
  let retries = 0;
  const Model = {
    bulkWrite: async () => { throw bulkError(); },
    findOne: filter => { assert.equal(filter.dealer_id, 'dealer-a'); return query({ source_file_timestamp: '202609031000' }); },
    updateOne: async () => { retries += 1; return { matchedCount: 1 }; },
  };
  assert.equal((await writeTimestampedUpserts(Model, [item()])).unchanged, 1);
  assert.equal(retries, 0);
  Model.findOne = () => query({ source_file_timestamp: '202609011000' });
  assert.equal((await writeTimestampedUpserts(Model, [item()])).matched, 1);
  assert.equal(retries, 1);
});

test('a newer write racing recovery remains protected', async () => {
  let reads = 0;
  const Model = {
    bulkWrite: async () => { throw bulkError(); },
    findOne: () => query({ source_file_timestamp: ++reads === 1 ? '202609011000' : '202609031000' }),
    updateOne: async () => { throw duplicate(); },
  };
  assert.equal((await writeTimestampedUpserts(Model, [item()])).unchanged, 1);
});

test('other unique indexes and database errors are never treated as old rows', async () => {
  for (const error of [new Error('network'), { writeErrors: [{ code: 11000, index: 0, keyPattern: { _id: 1 } }] }]) {
    const Model = { bulkWrite: async () => { throw error; } };
    await assert.rejects(writeTimestampedUpserts(Model, [item()]));
  }
});

test('logs and sanitized errors discard PII and complete raw data', t => {
  const messages = [];
  t.mock.method(console, 'info', message => messages.push(message));
  logEvent('test', { ...context(), email: 'private@example.com', records: ['private'] }, { code: 'private' });
  assert.equal(messages.join('').includes('private'), false);
  assert.equal(safeError(new Error('private')).message, 'DATABASE_FAILURE');
});
