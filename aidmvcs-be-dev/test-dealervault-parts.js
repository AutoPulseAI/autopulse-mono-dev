import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { UnrecoverableError } from 'bullmq';
import Part from './app/models/PartInventory.js';
import Batch from './app/models/DealerVaultImportBatch.js';
import User from './app/models/User.js';
import { normalizePart, createPartsProcessor } from './app/worker/dealervault/partsInventoryWorker.js';
import { PTINV_FIELDS } from './app/worker/dealervault/common/sourceFields.js';
import { validateJob } from './app/worker/dealervault/common/validation.js';
import { resolveDealer } from './app/worker/dealervault/common/dealerResolver.js';
import { failBatch } from './app/worker/dealervault/common/staging.js';
import { writeTimestampedUpserts, isNaturalKeyDuplicate } from './app/worker/dealervault/common/upserts.js';
import { PARTS_QUEUE, defaultJobOptions } from './app/worker/dealervault/queues.js';

const job = (records = [{ 'Part Number': '001' }], stamp = '20260902_1846', batchId = 4) => ({ data: {
  fileName: `DVD46315_${stamp}_PTINV.txt`, fileType: 'PTINV', dvDealerId: 'DVD46315', batchId, records,
} });
const context = () => ({ ...validateJob(job().data, 'PTINV'), dealer_id: 'dealer-a' });

function memoryStaging() {
  const stored = [];
  function find(filter) {
    return stored.find(row => Object.entries(filter).every(([key, value]) => (
      key === 'status' ? !value.$nin.includes(row.status) : row[key] === value
    )));
  }
  return {
    stored,
    findOneAndUpdate: (filter, update) => ({ lean: async () => {
      let record = find(filter);
      if (!record) {
        record = { processed_count: 0, failed_count: 0, unchanged_count: 0, ...update.$setOnInsert };
        stored.push(record);
      }
      return structuredClone(record);
    } }),
    updateOne: async (filter, update) => {
      const record = find(filter);
      if (record) Object.assign(record, update.$set);
      return { matchedCount: record ? 1 : 0 };
    },
  };
}

test('PTINV whitelist is exactly the reference header list', async () => {
  const reference = await readFile(new URL('../scripts/dealervault/dealertrack_file_types.txt', import.meta.url), 'utf8');
  const section = reference.split('PTINV — Parts Inventory')[1].split('SL — Sales')[0];
  const fields = [...section.matchAll(/^\d+\. (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(PTINV_FIELDS, fields);
});

test('normalization protects internal fields while preserving source values', () => {
  const row = JSON.parse('{"Part Number":" 001 ","Part Price":"1,234.50","BIN#":"","_id":"evil","dealer_id":"other","dealerId":"other","createdAt":"bad","updatedAt":"bad","source_file_timestamp":"999999999999","source_import":{"provider":"evil"},"__proto__":{"polluted":true}}');
  const { key, document } = normalizePart(row, context(), 8);
  assert.deepEqual(key, { dealer_id: 'dealer-a', part_number: '001' });
  assert.equal(document['Part Price'], '1,234.50');
  assert.equal(document['BIN#'], '');
  assert.equal(document['Part Number'], ' 001 ');
  assert.equal(document.source_file_timestamp, '202609021846');
  assert.equal(document.source_batch_id, 4);
  assert.equal(document.source_row_index, 8);
  assert.equal(document.source_import.dvDealerId, 'DVD46315');
  for (const key of ['_id', 'dealerId', 'createdAt', 'updatedAt', '__proto__']) assert.equal(Object.hasOwn(document, key), false);
});

test('bad business rows and row-level dealer mismatches are permanent row errors', () => {
  for (const row of [null, [], {}, { 'Part Number': ' ' }, { 'Part Number': 1 },
    { 'Part Number': '1', 'DV Dealer ID': 'other' },
    { 'Part Number': '1', 'File Type': 'SL' },
    { 'Part Number': '1', 'Part Price': { $gt: 1 } },
  ]) assert.throws(() => normalizePart(row, context(), 0), UnrecoverableError);
});

test('PTINV stages the complete batch first and completes valid rows despite bad rows', async () => {
  const BatchModel = memoryStaging();
  let dealerCalls = 0;
  const records = [{ 'Part Number': '001', unexpected: 'raw only' }, {}, null];
  const process = createPartsProcessor({
    BatchModel, connect: async () => {}, log: () => {},
    dealerResolver: async () => { dealerCalls += 1; return 'dealer-a'; },
    write: async (Model, entries) => {
      assert.equal(Model, Part);
      assert.deepEqual(JSON.parse(BatchModel.stored[0].raw_records_json), records);
      assert.equal(BatchModel.stored[0].status, 'processing');
      assert.equal(entries.length, 1);
      assert.equal(entries[0].document.unexpected, undefined);
      return { unchanged: 0, upserted: 1 };
    },
  });
  assert.deepEqual(await process(job(records)), {
    received: 3, processed: 1, failed: 2, unchanged: 0, reused: false,
  });
  assert.equal(dealerCalls, 1);
  assert.equal(BatchModel.stored[0].status, 'completed_with_errors');
  assert.equal(BatchModel.stored[0].row_outcomes.length, 3);
});

test('same completed batch is reused; failed batch retries; changed digest never replaces raw data', async () => {
  const BatchModel = memoryStaging();
  let writeCalls = 0;
  const process = createPartsProcessor({
    BatchModel, connect: async () => {}, log: () => {}, dealerResolver: async () => 'dealer-a',
    write: async () => {
      if (++writeCalls === 1) throw new Error('private source information');
      return { unchanged: 0 };
    },
  });
  await assert.rejects(process(job()), { message: 'UPSERT_FAILURE' });
  assert.equal(BatchModel.stored[0].status, 'failed');
  assert.equal((await process(job())).reused, false);
  assert.equal((await process(job())).reused, true);
  assert.equal(writeCalls, 2);
  assert.equal(BatchModel.stored.length, 1);
  assert.equal(BatchModel.stored[0].processed_count, 1);
  await assert.rejects(process(job([{ 'Part Number': 'different' }])), /BATCH_CONTENT_CONFLICT/);
  assert.equal(JSON.parse(BatchModel.stored[0].raw_records_json)[0]['Part Number'], '001');
  assert.equal(BatchModel.stored[0].status, 'completed');
});

test('a late concurrent failure cannot regress a completed batch or duplicate counts', async () => {
  const BatchModel = memoryStaging();
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const process = createPartsProcessor({
    BatchModel, connect: async () => {}, log: () => {}, dealerResolver: async () => 'dealer-a',
    write: async () => {
      if (++calls === 1) { await blocked; throw new Error('network'); }
      release();
      return { unchanged: 0 };
    },
  });
  const results = await Promise.allSettled([process(job()), process(job())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(BatchModel.stored.length, 1);
  assert.equal(BatchModel.stored[0].status, 'completed');
  assert.equal(BatchModel.stored[0].processed_count, 1);
});

test('queue defaults retain failures and use repository retry/backoff conventions', () => {
  assert.equal(PARTS_QUEUE, 'dealervault-parts-inventory');
  assert.deepEqual(defaultJobOptions(), {
    attempts: 3, backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100, removeOnFail: false,
  });
});

test('Mongo bulk duplicate errors exposing only their index name are classified narrowly', () => {
  const key = { dealer_id: 'dealer-a', part_number: '001' };
  assert.equal(isNaturalKeyDuplicate({ code: 11000, err: {
    errmsg: 'E11000 collection: parts index: dealer_id_1_part_number_1 dup key: { private: "value" }',
  } }, key), true);
  assert.equal(isNaturalKeyDuplicate({ code: 11000, message: 'index: _id_ dup key:' }, key), false);
});

const mongoUri = process.env.DEALERVAULT_TEST_MONGO_URI;
test('Mongo integration: timestamp guards, concurrent upserts and staging reuse', {
  skip: !mongoUri && 'Set DEALERVAULT_TEST_MONGO_URI to a disposable local Mongo server',
}, async t => {
  const parsed = new URL(mongoUri);
  assert.equal(parsed.protocol, 'mongodb:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'Only local test Mongo is allowed');
  const dbName = `dealervault_test_ptinv_${process.pid}_${Date.now()}`;
  const connection = mongoose.createConnection(mongoUri, {
    dbName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000,
  });
  t.after(async () => {
    if (connection.readyState === 1) {
      assert.equal(connection.name, dbName);
      await connection.dropDatabase();
    }
    await connection.close();
  });
  await connection.asPromise();
  const Model = connection.model('PartInventory', Part.schema.clone());
  const BatchModel = connection.model('DealerVaultImportBatch', Batch.schema.clone());
  const UserModel = connection.model('User', User.schema.clone());
  await Promise.all([Model.createIndexes(), BatchModel.createIndexes(), UserModel.createIndexes()]);
  const dealer = await UserModel.create({ email: 'test@example.invalid', name: 'Test',
    password: 'test-only', type: 'dealer', dv_dealer_id: 'DVD46315' });
  const dealerId = String(dealer._id);
  const process = createPartsProcessor({ Model, BatchModel, connect: async () => {}, log: () => {},
    dealerResolver: dvId => resolveDealer(dvId, UserModel) });
  const newer = job([{ 'Part Number': '001', 'Part Description': 'new' }], '20260903_1846');
  await Promise.all([process(newer), process(newer)]);
  assert.equal(await Model.countDocuments({ dealer_id: dealerId }), 1);
  assert.equal(await BatchModel.countDocuments({ dealer_id: dealerId }), 1);
  const original = await Model.findOne({ dealer_id: dealerId, part_number: '001' }).lean();
  const older = await process(job([{ 'Part Number': '001', 'Part Description': 'old' }]));
  assert.equal(older.unchanged, 1);
  let current = await Model.findOne({ dealer_id: dealerId, part_number: '001' }).lean();
  assert.equal(current['Part Description'], 'new');
  assert.deepEqual(current.createdAt, original.createdAt);
  assert.deepEqual(current.updatedAt, original.updatedAt);
  const c = { ...validateJob(newer.data, 'PTINV'), dealer_id: dealerId };
  await failBatch(c, 'UPSERT_FAILURE', BatchModel);
  assert.equal((await BatchModel.findOne({ dealer_id: dealerId, fileName: newer.data.fileName }).lean()).status, 'completed');
  assert.equal((await process(newer)).reused, true);
  // Equal timestamps are allowed; a separate batch provides a new staging identity.
  await process(job([{ 'Part Number': '001', 'Part Description': 'equal' }], '20260903_1846', 5));
  current = await Model.findOne({ dealer_id: dealerId, part_number: '001' }).lean();
  assert.equal(current['Part Description'], 'equal');
  // Legacy records lacking source timestamps remain updateable.
  await Model.updateOne({ dealer_id: dealerId, part_number: 'legacy' }, { $set: { 'Part Description': 'legacy' } }, { upsert: true });
  await process(job([{ 'Part Number': 'legacy', 'Part Description': 'updated' }], '20260903_1900'));
  assert.equal((await Model.findOne({ dealer_id: dealerId, part_number: 'legacy' }).lean())['Part Description'], 'updated');
  // The exact same natural key at another dealer must remain independent.
  const other = { ...c, dealer_id: 'another-dealer' };
  await writeTimestampedUpserts(Model, [normalizePart({ 'Part Number': '001' }, other, 0)]);
  assert.equal(await Model.countDocuments({ part_number: '001' }), 2);
  await assert.rejects(process(job([{ 'Part Number': 'changed' }], '20260903_1846')), /BATCH_CONTENT_CONFLICT/);
});
