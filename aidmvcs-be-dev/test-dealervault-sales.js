import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { Queue, Worker, QueueEvents, UnrecoverableError } from 'bullmq';
import Customer, { CUSTOMER_MAPPING_INDEX } from './app/models/Customer.js';
import Deal from './app/models/Deal.js';
import Vehicle from './app/models/Vehicle.js';
import Batch from './app/models/DealerVaultImportBatch.js';
import dbConnect from './app/lib/mongodb.js';
import { ensureIndexes, requiredIndexes } from './scripts/ensure-dealervault-indexes.js';
import { createSalesProcessor, normalizeSale } from './app/worker/dealervault/salesWorker.js';
import { SL_FIELDS } from './app/worker/dealervault/common/salesFields.js';
import { resolveCustomers } from './app/worker/dealervault/common/customerResolver.js';
import { resolveVehicles } from './app/worker/dealervault/common/vehicleResolver.js';
import { requireUniqueIndex } from './app/worker/dealervault/common/indexProtection.js';
import { validateJob, getConcurrency } from './app/worker/dealervault/common/validation.js';
import { logEvent } from './app/worker/dealervault/common/logger.js';
import { mapBounded } from './app/worker/dealervault/common/bounded.js';
import { SALES_QUEUE, defaultJobOptions } from './app/worker/dealervault/queues.js';

const path = 'extra.dealervault.customer_numbers';
import { query, matches, duplicate, customers, staging, deals, vehicles } from './test-support/dealervault-memory.js';
const job = (records = [{ 'Deal Number': '001' }], stamp = '20260908_1200', batchId = 0) => ({ data: {
  fileName: `DVD46315_${stamp}_SL.txt`, fileType: 'SL', dvDealerId: 'DVD46315', batchId, records,
} });
const context = () => ({ ...validateJob(job().data, 'SL'), dealer_id: 'dealer-a' });
const entry = (row = {}) => normalizeSale({ 'Deal Number': '001', ...row }, context(), 0);
function harness(overrides = {}) {
  const dependencies = { Model: deals(), BatchModel: staging(), CustomerModel: customers(), VehicleModel: vehicles(),
    connect: async () => {}, dealerResolver: async () => 'dealer-a', log: () => {}, ...overrides };
  return { ...dependencies, process: createSalesProcessor(dependencies) };
}

test('SL whitelist contains exactly all 376 official columns', async () => {
  const reference = await readFile(new URL('../scripts/dealervault/dealertrack_file_types.txt', import.meta.url), 'utf8');
  const section = reference.split('SL — Sales')[1].split('SV — Service')[0];
  const fields = [...section.matchAll(/^\d+\. (.+)$/gm)].map(match => match[1]);
  assert.equal(SL_FIELDS.length, 376);
  assert.deepEqual(SL_FIELDS, fields);
});

test('Deal Number required; malformed structures and mismatched source identity are row errors', () => {
  for (const row of [null, [], {}, { 'Deal Number': ' ' }, { 'Deal Number': 12 },
    { 'Deal Number': '1', 'Email 1': {} }, { 'Deal Number': '1', 'DV Dealer ID': 'other' },
    { 'Deal Number': '1', 'Vendor Dealer ID': 'other' }, { 'Deal Number': '1', 'File Type': 'SV' }]) {
    assert.throws(() => normalizeSale(row, context(), 0), UnrecoverableError);
  }
});

test('source whitelist protects trusted fields and preserves identifiers, co-buyer and nested trades', () => {
  const row = Object.fromEntries(SL_FIELDS.map(field => [field, 'source text']));
  Object.assign(row, { 'File Type': 'SL', 'DV Dealer ID': 'DVD46315', 'Vendor Dealer ID': 'DVD46315',
    'Deal Number': ' 0001 ', 'Customer Number': ' 0007 ', VIN: ' abc123 ', 'Sales Price': '1,000.00',
    _id: 'evil', dealer_id: 'evil', customer_id: 'evil', vehicle_id: 'evil', status: 'evil',
    createdAt: 'evil', updatedAt: 'evil', source_import: 'evil', source_file_timestamp: '999999999999',
    source_batch_id: 999, source_row_index: 999, trade_ins: 'evil', unknown: 'raw only' });
  const { document } = normalizeSale(row, context(), 2);
  for (const field of SL_FIELDS) assert.equal(document[field], row[field]);
  assert.equal(document.dealer_id, 'dealer-a');
  assert.equal(document.deal_number, '0001');
  assert.equal(document.customer_number, '0007');
  assert.equal(document.vin, 'ABC123');
  assert.equal(document.customer_id, null);
  assert.equal(document.vehicle_id, null);
  assert.equal(document.source_file_timestamp, '202609081200');
  assert.equal(document.source_batch_id, 0);
  assert.equal(document.source_row_index, 2);
  for (const key of ['_id', 'status', 'createdAt', 'updatedAt', 'unknown']) assert.equal(Object.hasOwn(document, key), false);
  assert.equal(document.trade_ins.length, 2);
  assert.deepEqual(Object.keys(document.trade_ins[0]), ['vin', 'year', 'make', 'model', 'odometer', 'actual_cash_value', 'gross', 'payoff']);
});

test('mapped DMS customer wins over other contacts without changing established Customer data', async () => {
  const Model = customers([{ _id: 'mapped', dealer_id: 'dealer-a', extra: { dealervault: { customer_numbers: ['0007'] } },
    emails: [{ value: 'trusted@example.invalid', is_primary: true }], merge_history: [] },
  { _id: 'contact', dealer_id: 'dealer-a', emails: [{ value: 'other@example.invalid' }] }]);
  const before = structuredClone(Model.rows);
  const item = entry({ 'Customer Number': ' 0007 ', 'Email 1': 'other@example.invalid' });
  await resolveCustomers([item], context(), Model);
  assert.equal(item.document.customer_id, 'mapped');
  assert.deepEqual(Model.rows, before);
});

test('unique normalized contact attaches mapping and preserves contact flags, consent and other extra data', async () => {
  const original = { _id: 'existing', dealer_id: 'dealer-a', name: 'Trusted',
    emails: [{ value: 'buyer@example.invalid', is_primary: true }],
    phones: [{ value: '4155551212', is_primary: false, sms_opt_in: false }],
    extra: { other: 'keep' }, merge_history: [{ reason: 'keep' }] };
  const Model = customers([original]);
  const item = entry({ 'Customer Number': '0007', 'Email 1': ' BUYER@EXAMPLE.INVALID ', 'Home Phone': '+1 (415) 555-1212' });
  await resolveCustomers([item], context(), Model);
  assert.equal(item.document.customer_id, 'existing');
  assert.deepEqual(Model.rows[0], { ...original, extra: { other: 'keep', dealervault: { customer_numbers: ['0007'] } } });
  for (const [, filter] of Model.calls) assert.equal(filter.dealer_id, 'dealer-a');
});

test('conflicting email/phone and duplicate contact candidates stay unresolved without mutation', async () => {
  for (const second of [{ phones: [{ value: '4155551212' }] }, { emails: [{ value: 'buyer@example.invalid' }] }]) {
    const Model = customers([{ _id: 'one', dealer_id: 'dealer-a', emails: [{ value: 'buyer@example.invalid' }] },
      { _id: 'two', dealer_id: 'dealer-a', ...second }]);
    const item = entry({ 'Customer Number': '007', 'Email 1': 'buyer@example.invalid', 'Cell Phone': '4155551212' });
    await resolveCustomers([item], context(), Model);
    assert.equal(item.document.customer_id, null);
    assert.deepEqual(item.warnings, ['CUSTOMER_AMBIGUOUS']);
    assert.equal(Model.calls.some(([action]) => ['create', 'updateOne'].includes(action)), false);
  }
});

test('no contact match creates primary Customer with mapping, normalized contacts and no inferred consent or Lead', async () => {
  const Model = customers([{ _id: 'other', dealer_id: 'dealer-b', emails: [{ value: 'buyer@example.invalid' }] }]);
  const item = entry({ 'Customer Number': '0007', 'Full Name': ' Buyer ', 'Email 1': 'BUYER@example.invalid',
    'Cell Phone': '+1 415 555 1212', 'Opt Out': 'N', 'Co-Buyer Customer Number': '999', 'Co-Buyer Email 1': 'co@example.invalid' });
  await resolveCustomers([item], context(), Model);
  const created = Model.rows[1];
  assert.equal(Model.rows.length, 2);
  assert.equal(created.dealer_id, 'dealer-a');
  assert.equal(created.name, 'Buyer');
  assert.equal(created.emails[0].value, 'buyer@example.invalid');
  assert.equal(created.phones[0].value, '4155551212');
  assert.equal(created.phones[0].sms_opt_in, undefined);
  assert.equal(created.emails[0].first_seen_lead_id, undefined);
  assert.deepEqual(created.extra.dealervault.customer_numbers, ['0007']);
});

test('missing customer number only links unambiguous existing contacts, never creates', async () => {
  const Model = customers([{ _id: 'existing', dealer_id: 'dealer-a', emails: [{ value: 'buyer@example.invalid' }] }]);
  const items = [entry({ 'Email 1': 'buyer@example.invalid' }), entry({ 'Email 1': 'missing@example.invalid' }), entry()];
  items.forEach((item, index) => { item.rowIndex = index; });
  await resolveCustomers(items, context(), Model);
  assert.equal(items[0].document.customer_id, 'existing');
  assert.equal(items[1].document.customer_id, null);
  assert.equal(items[2].document.customer_id, null);
  assert.equal(Model.rows.length, 1);
});

test('merged mapped/contact Customers are warnings; merge records are untouched', async () => {
  for (const extra of [{ dealervault: { customer_numbers: ['007'] } }, {}]) {
    const Model = customers([{ _id: 'merged', dealer_id: 'dealer-a', merged_into: 'canonical', extra,
      emails: [{ value: 'buyer@example.invalid' }] }]);
    const item = entry({ 'Customer Number': '007', 'Email 1': 'buyer@example.invalid' });
    await resolveCustomers([item], context(), Model);
    assert.equal(item.document.customer_id, null);
    assert.deepEqual(item.warnings, ['CUSTOMER_MERGED']);
    assert.equal(Model.calls.some(([action]) => ['create', 'updateOne'].includes(action)), false);
  }
});

test('concurrent mapping creation and repeated delivery produce one Customer per dealer/DMS identity', async () => {
  const Model = customers();
  const first = entry({ 'Customer Number': '0007' });
  const second = entry({ 'Customer Number': '0007' });
  await Promise.all([resolveCustomers([first], context(), Model), resolveCustomers([second], context(), Model)]);
  await resolveCustomers([entry({ 'Customer Number': '0007' })], context(), Model);
  assert.equal(Model.rows.length, 1);
  assert.equal(first.document.customer_id, second.document.customer_id);
  assert.deepEqual(Model.rows[0].extra.dealervault.customer_numbers, ['0007']);
});

test('concurrent attempts attaching the same mapping to different contact matches recover the winner', async () => {
  const Model = customers([{ _id: 'one', dealer_id: 'dealer-a', emails: [{ value: 'one@example.invalid' }] },
    { _id: 'two', dealer_id: 'dealer-a', emails: [{ value: 'two@example.invalid' }] }]);
  const first = entry({ 'Customer Number': '007', 'Email 1': 'one@example.invalid' });
  const second = entry({ 'Customer Number': '007', 'Email 1': 'two@example.invalid' });
  await Promise.all([resolveCustomers([first], context(), Model), resolveCustomers([second], context(), Model)]);
  assert.equal(first.document.customer_id, second.document.customer_id);
  assert.equal(Model.rows.filter(row => matches(row, { [path]: '007' })).length, 1);
});

test('unrelated duplicate indexes and database failures remain retryable rather than unresolved warnings', async () => {
  for (const error of [Object.assign(new Error('private'), { code: 11000, keyPattern: { _id: 1 } }), new Error('private network')]) {
    const Model = customers();
    Model.create = async () => { throw error; };
    const h = harness({ CustomerModel: Model });
    await assert.rejects(h.process(job([{ 'Deal Number': '1', 'Customer Number': '007' }])), { message: 'DATABASE_FAILURE' });
    assert.equal(h.Model.rows.length, 0);
    assert.equal(h.BatchModel.rows[0].status, 'failed');
  }
});

test('VIN lookup is batched, normalized and dealer scoped; no inventory writes even for trades', async () => {
  const items = [entry({ VIN: ' abc123 ', 'Trade 1 VIN': 'TRADE' }), entry({ VIN: 'MISSING' }), entry(), entry({ VIN: 'N/A' }), entry({ VIN: 'DUP' })];
  let calls = 0;
  const Model = { find: filter => {
    calls += 1;
    assert.deepEqual(filter, { dealerId: 'dealer-a', vin: { $in: ['ABC123', 'MISSING', 'DUP'] } });
    return query([{ _id: 'sold', vin: 'ABC123' }, { _id: 'dup1', vin: 'DUP' }, { _id: 'dup2', vin: 'DUP' }]);
  } };
  await resolveVehicles(items, context(), Model);
  assert.equal(calls, 1);
  assert.equal(items[0].document.vehicle_id, 'sold');
  assert.deepEqual(items.slice(1).map(item => item.warnings[0]), ['VEHICLE_NOT_FOUND', 'VIN_MISSING', 'VIN_INVALID', 'VEHICLE_AMBIGUOUS']);
});

test('full SL flow stages untouched data first, resolves dealer once, stores valid deals and relationship warnings', async () => {
  let dealerCalls = 0;
  const h = harness({ dealerResolver: async () => { dealerCalls += 1; return 'dealer-a'; } });
  const records = [{ 'Deal Number': '001', unknown: { keep: 'raw' }, dealer_id: 'evil', 'Co-Buyer Customer Number': '9' }, {}, null];
  const originalFind = h.CustomerModel.find;
  h.CustomerModel.find = filter => {
    assert.deepEqual(JSON.parse(h.BatchModel.rows[0].raw_records_json), records);
    return originalFind.call(h.CustomerModel, filter);
  };
  // Check the staging boundary even when no contact lookup is needed.
  const originalBulk = h.Model.bulkWrite;
  h.Model.bulkWrite = (...args) => {
    assert.deepEqual(JSON.parse(h.BatchModel.rows[0].raw_records_json), records);
    assert.equal(h.BatchModel.rows[0].status, 'processing');
    return originalBulk(...args);
  };
  assert.deepEqual(await h.process(job(records)), { received: 3, processed: 1, failed: 2, unchanged: 0, reused: false });
  assert.equal(dealerCalls, 1);
  assert.equal(h.Model.rows[0].dealer_id, 'dealer-a');
  assert.equal(h.Model.rows[0].unknown, undefined);
  assert.equal(h.CustomerModel.rows.length, 0);
  assert.equal(h.BatchModel.rows[0].status, 'completed_with_errors');
  assert.deepEqual(h.BatchModel.rows[0].row_outcomes[0].warnings, ['CUSTOMER_UNRESOLVED', 'VIN_MISSING']);
});

test('completed SL replay reuses counts; different digest cannot replace raw or normalized records', async () => {
  const h = harness();
  const payload = job([{ 'Deal Number': '001', 'Customer Number': '007' }]);
  await h.process(payload);
  const counts = await h.process(payload);
  assert.equal(counts.reused, true);
  assert.equal(h.Model.rows.length, 1);
  assert.equal(h.CustomerModel.rows.length, 1);
  assert.equal(h.BatchModel.rows[0].processed_count, 1);
  await assert.rejects(h.process(job([{ 'Deal Number': '002' }])), /BATCH_CONTENT_CONFLICT/);
  assert.deepEqual(JSON.parse(h.BatchModel.rows[0].raw_records_json), payload.data.records);
});

test('failed/incomplete SL retries existing raw data and mappings without duplicating Customers', async () => {
  const h = harness();
  const originalBulk = h.Model.bulkWrite;
  let calls = 0;
  h.Model.bulkWrite = (...args) => { if (++calls === 1) throw new Error('private financial info'); return originalBulk(...args); };
  const payload = job([{ 'Deal Number': '001', 'Customer Number': '007' }]);
  await assert.rejects(h.process(payload), { message: 'UPSERT_FAILURE' });
  assert.equal(h.CustomerModel.rows.length, 1);
  assert.equal(h.BatchModel.rows[0].status, 'failed');
  await h.process(payload);
  assert.equal(h.Model.rows.length, 1);
  assert.equal(h.CustomerModel.rows.length, 1);
  assert.equal(h.BatchModel.rows[0].status, 'completed');
});

test('older SL cannot overwrite newer deal; equal timestamps and separate dealers follow shared behavior', async () => {
  const h = harness();
  await h.process(job([{ 'Deal Number': '001', 'Sales Price': 'new' }]));
  const older = await h.process(job([{ 'Deal Number': '001', 'Sales Price': 'old' }], '20260907_1200'));
  assert.equal(older.unchanged, 1);
  assert.equal(h.Model.rows[0]['Sales Price'], 'new');
  await h.process(job([{ 'Deal Number': '001', 'Sales Price': 'equal' }], '20260908_1200', 1));
  assert.equal(h.Model.rows[0]['Sales Price'], 'equal');
  const other = harness({ Model: h.Model, dealerResolver: async () => 'dealer-b' });
  await other.process(job());
  assert.deepEqual(h.Model.rows.map(row => row.dealer_id), ['dealer-a', 'dealer-b']);
});

test('missing/incompatible mapping indexes prevent Customer writes and are retryable INDEX_REQUIRED', async () => {
  for (const index of [{ key: CUSTOMER_MAPPING_INDEX.key },
    { key: CUSTOMER_MAPPING_INDEX.key, unique: true },
    { key: CUSTOMER_MAPPING_INDEX.key, ...CUSTOMER_MAPPING_INDEX.options, collation: { locale: 'en' } }]) {
    const h = harness();
    h.CustomerModel.collection = { listIndexes: () => ({ toArray: async () => [index] }) };
    const error = await h.process(job()).catch(error => error);
    assert.equal(error.message, 'INDEX_REQUIRED');
    assert.equal(error instanceof UnrecoverableError, false);
    assert.equal(h.Model.rows.length, 0);
  }
  assert.notEqual(Customer.schema.options.autoIndex, false);
  assert.equal(Customer.schema.options.strict, true);
  const mappingIndex = Customer.schema.indexes().find(([key]) => key[path] === 1);
  assert.equal(mappingIndex[1].unique, true);
  assert.equal(mappingIndex[1]._autoIndex, false);
  for (const contactPath of ['emails.value', 'phones.value']) {
    const contactIndex = Customer.schema.indexes().find(([key]) => key[contactPath] === 1);
    assert.equal(contactIndex[1]._autoIndex, undefined);
  }
});

test('logs, staging errors and BullMQ failedReason contain no raw financial or personal values', async t => {
  const messages = [];
  t.mock.method(console, 'info', message => messages.push(message));
  const secret = 'PRIVATE_PERSON_AND_FINANCIAL_DATA';
  const h = harness({ log: logEvent });
  await h.process(job([{ 'Deal Number': '1', 'Full Name': secret, 'Email 1': secret, 'Sales Price': secret }, {}]));
  h.Model.bulkWrite = async () => { throw new Error(secret); };
  await assert.rejects(h.process(job([{ 'Deal Number': '2', 'Sale Comments': secret }], '20260908_1201')), { message: 'UPSERT_FAILURE' });
  assert.equal(messages.join('').includes(secret), false);
  assert.ok(messages.some(message => JSON.parse(message).row_index === 1));
  assert.equal(h.BatchModel.rows[1].error_code, 'UPSERT_FAILURE');
});

test('connection failures are sanitized before the shared database helper can log raw diagnostics', async t => {
  const messages = [];
  t.mock.method(console, 'error', (...args) => messages.push(args));
  t.mock.method(mongoose, 'connect', async () => {
    throw Object.assign(new Error('private connection diagnostics'), {
      name: 'MongoNetworkTimeoutError', code: 'ETIMEDOUT',
    });
  });
  await assert.rejects(dbConnect({ reportErrors: false }), { message: 'DATABASE_FAILURE' });
  assert.equal(messages.length, 1);
  const diagnostic = JSON.parse(messages[0][0]);
  assert.equal(diagnostic.event, 'mongodb_connection_failed');
  assert.equal(diagnostic.code, 'DATABASE_FAILURE');
  assert.equal(diagnostic.error_name, 'MongoNetworkTimeoutError');
  assert.equal(diagnostic.error_code, 'ETIMEDOUT');
  assert.equal(messages.flat().join('').includes('private connection diagnostics'), false);
});

test('successful runtime index checks coalesce, expire, and failed checks retry after deployment', async () => {
  const spec = { key: { dealer_id: 1, test_key: 1 }, options: { unique: true } };
  let reads = 0;
  const Model = { collection: { listIndexes: () => ({ toArray: async () => {
    reads += 1;
    return [{ key: spec.key, unique: true }];
  } }) } };
  await Promise.all([
    requireUniqueIndex(Model, spec, { now: 1000, ttlMs: 100 }),
    requireUniqueIndex(Model, spec, { now: 1000, ttlMs: 100 }),
  ]);
  await requireUniqueIndex(Model, spec, { now: 1099, ttlMs: 100 });
  assert.equal(reads, 1);
  await requireUniqueIndex(Model, spec, { now: 1100, ttlMs: 100 });
  assert.equal(reads, 2);

  let deployed = false;
  let retryReads = 0;
  const RetryModel = { collection: { listIndexes: () => ({ toArray: async () => {
    retryReads += 1;
    return deployed ? [{ key: spec.key, unique: true }] : [];
  } }) } };
  await assert.rejects(requireUniqueIndex(RetryModel, spec, { now: 1000 }), { message: 'INDEX_REQUIRED' });
  deployed = true;
  await requireUniqueIndex(RetryModel, spec, { now: 1001 });
  assert.equal(retryReads, 2);
});

test('staging failure prevents Customer/Vehicle reconciliation and every normalized write', async () => {
  const h = harness({ BatchModel: { findOneAndUpdate() { throw new Error('private staging failure'); } } });
  await assert.rejects(h.process(job([{ 'Deal Number': '001', 'Customer Number': '0007' }])), { message: 'STAGING_FAILURE' });
  assert.equal(h.CustomerModel.calls.length, 0);
  assert.equal(h.Model.rows.length, 0);
});

test('Customer creation happens only after the original raw SL batch is durably staged', async () => {
  const h = harness();
  const payload = job([{ 'Deal Number': '001', 'Customer Number': '0007', unrecognized: { source: 'untouched' } }]);
  const originalCreate = h.CustomerModel.create;
  h.CustomerModel.create = data => {
    assert.deepEqual(JSON.parse(h.BatchModel.rows[0].raw_records_json), payload.data.records);
    assert.equal(h.BatchModel.rows[0].status, 'processing');
    return originalCreate(data);
  };
  await h.process(payload);
  assert.equal(h.CustomerModel.rows.length, 1);
});

test('index migration check is read-only and apply creates only declared missing indexes', async t => {
  t.mock.method(console, 'info', () => {});
  const created = [];
  const connection = { collection: name => ({
    listIndexes: () => ({ toArray: async () => [] }),
    createIndex: async (key, options) => { created.push({ name, key, options }); },
  }) };
  assert.equal(await ensureIndexes(connection), requiredIndexes.length);
  assert.deepEqual(created, []);
  assert.equal(await ensureIndexes(connection, true), 0);
  assert.equal(created.length, requiredIndexes.length);
  assert.deepEqual(created.find(item => item.name === Customer.collection.name).key, CUSTOMER_MAPPING_INDEX.key);
  const conflicting = { collection: () => ({ listIndexes: () => ({ toArray: async () => [] }),
    createIndex: async () => { throw duplicate(CUSTOMER_MAPPING_INDEX); },
  }) };
  await assert.rejects(ensureIndexes(conflicting, true), { code: 11000 });
});

test('bounded reconciliation drains tasks and does not launch remaining work after failure', async () => {
  let active = 0;
  let peak = 0;
  let launched = 0;
  await assert.rejects(mapBounded(Array.from({ length: 100 }), 5, async (_item, index) => {
    launched += 1; active += 1; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active -= 1;
    if (index === 0) throw new Error('test failure');
  }));
  assert.equal(active, 0);
  assert.equal(peak, 5);
  assert.equal(launched, 5);
});

test('SL queue config and envelope use shared retry, limits and type checks', () => {
  assert.equal(SALES_QUEUE, 'dealervault-sales');
  assert.equal(defaultJobOptions().attempts, 3);
  assert.equal(getConcurrency(5, 'DEALERVAULT_SL_CONCURRENCY'), 5);
  assert.throws(() => getConcurrency('0', 'DEALERVAULT_SL_CONCURRENCY'), /DEALERVAULT_SL_CONCURRENCY/);
  for (const change of [{ records: Array(101).fill({}) }, { records: [{ x: 'x'.repeat(500000) }] },
    { fileType: 'SV' }, { dvDealerId: 'other' }]) {
    assert.throws(() => validateJob({ ...job().data, ...change }, 'SL'), UnrecoverableError);
  }
});

const mongoUri = process.env.DEALERVAULT_TEST_MONGO_URI;
test('Mongo integration: real SL indexes, concurrent mappings/deals, tenant isolation and source ordering', {
  skip: !mongoUri && 'Set DEALERVAULT_TEST_MONGO_URI to a disposable local Mongo server',
}, async t => {
  const parsed = new URL(mongoUri);
  assert.equal(parsed.protocol, 'mongodb:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname));
  const dbName = `dealervault_test_sales_${process.pid}_${Date.now()}`;
  const connection = mongoose.createConnection(mongoUri, { dbName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  t.after(async () => {
    if (connection.readyState === 1) { assert.equal(connection.name, dbName); await connection.dropDatabase(); }
    await connection.close();
  });
  await connection.asPromise();
  const Model = connection.model('Deal', Deal.schema.clone());
  const CustomerModel = connection.model('Customer', Customer.schema.clone());
  const VehicleModel = connection.model('Vehicle', Vehicle.schema.clone());
  const BatchModel = connection.model('DealerVaultImportBatch', Batch.schema.clone());
  await Promise.all([Model.createIndexes(), CustomerModel.createIndexes(), VehicleModel.createIndexes(), BatchModel.createIndexes()]);
  await requireUniqueIndex(CustomerModel, CUSTOMER_MAPPING_INDEX);
  // Unmapped legacy customers may share contact data; mapping index is partial.
  await CustomerModel.create([{ dealer_id: 'legacy' }, { dealer_id: 'legacy' }]);
  const vehicle = await VehicleModel.create({ dealerId: 'dealer-a', vin: 'ABC123' });
  await VehicleModel.create({ dealerId: 'dealer-b', vin: 'ABC123' });
  const h = harness({ Model, CustomerModel, VehicleModel, BatchModel });
  const payload = job([{ 'Deal Number': '001', 'Customer Number': '0007', VIN: ' abc123 ', 'Sales Price': 'new',
    'Trade 1 VIN': 'TRADE', 'Co-Buyer Customer Number': '999', unknown: 'raw' }]);
  await Promise.all([h.process(payload), h.process(payload), h.process(payload)]);
  assert.equal(await Model.countDocuments({ dealer_id: 'dealer-a' }), 1);
  assert.equal(await CustomerModel.countDocuments({ dealer_id: 'dealer-a' }), 1);
  assert.equal(await VehicleModel.countDocuments({ dealerId: 'dealer-a' }), 1);
  assert.equal(await BatchModel.countDocuments({ dealer_id: 'dealer-a' }), 1);
  const original = await Model.findOne({ dealer_id: 'dealer-a', deal_number: '001' }).lean();
  assert.equal(String(original.vehicle_id), String(vehicle._id));
  assert.ok(original.customer_id instanceof mongoose.Types.ObjectId);
  assert.equal(original.trade_ins[0].vin, 'TRADE');
  assert.equal(original.unknown, undefined);
  const older = await h.process(job([{ 'Deal Number': '001', 'Sales Price': 'old' }], '20260907_1200'));
  assert.equal(older.unchanged, 1);
  const current = await Model.findOne({ dealer_id: 'dealer-a', deal_number: '001' }).lean();
  assert.equal(current['Sales Price'], 'new');
  assert.deepEqual(current.updatedAt, original.updatedAt);
  assert.equal((await h.process(payload)).reused, true);
  const other = harness({ Model, CustomerModel, VehicleModel, BatchModel, dealerResolver: async () => 'dealer-b' });
  await other.process(payload);
  assert.equal(await Model.countDocuments({ deal_number: '001' }), 2);
  assert.equal(await CustomerModel.countDocuments({ [path]: '0007' }), 2);
  await assert.rejects(CustomerModel.create({ dealer_id: 'dealer-a', extra: { dealervault: { customer_numbers: ['0007'] } } }), { code: 11000 });
  // Two existing contacts race to claim the same new mapping.
  await CustomerModel.create([{ dealer_id: 'dealer-a', emails: [{ value: 'one@example.invalid' }] },
    { dealer_id: 'dealer-a', emails: [{ value: 'two@example.invalid' }] }]);
  const first = entry({ 'Customer Number': 'race', 'Email 1': 'one@example.invalid' });
  const second = entry({ 'Customer Number': 'race', 'Email 1': 'two@example.invalid' });
  await Promise.all([resolveCustomers([first], context(), CustomerModel), resolveCustomers([second], context(), CustomerModel)]);
  assert.equal(String(first.document.customer_id), String(second.document.customer_id));
  assert.equal(await CustomerModel.countDocuments({ dealer_id: 'dealer-a', [path]: 'race' }), 1);

});

const redisPort = process.env.DEALERVAULT_TEST_REDIS_PORT;
test('Redis delivery and retry reuse staged SL without duplicating domain records (memory database)', {
  skip: !redisPort && 'Set DEALERVAULT_TEST_REDIS_PORT to a disposable localhost Redis server',
}, async () => {
      const h = harness();
      const payload = job([{ 'Deal Number': '001', 'Customer Number': '0007' }]);
      const redis = { host: '127.0.0.1', port: Number(redisPort), maxRetriesPerRequest: null };
      const queueName = `dealervault-sales-test-${process.pid}-${Date.now()}`;
      const queue = new Queue(queueName, { connection: redis, defaultJobOptions: defaultJobOptions() });
      const events = new QueueEvents(queueName, { connection: redis });
      let attempts = 0;
      const worker = new Worker(queueName, async incoming => {
        const result = await h.process(incoming);
        if (++attempts === 1) throw new Error('simulated acknowledgement failure');
        return result;
      }, { connection: redis, concurrency: 5 });
      try {
        await events.waitUntilReady();
        const queued = await queue.add('SL', payload.data, { backoff: { type: 'fixed', delay: 10 } });
        const result = await queued.waitUntilFinished(events, 15000);
        assert.equal(result.reused, true);
        assert.equal(attempts, 2);
        assert.equal(h.Model.rows.length, 1);
        assert.equal(h.CustomerModel.rows.length, 1);
        assert.equal(h.BatchModel.rows.length, 1);
      } finally {
        await worker.close();
        await events.close();
        await queue.obliterate({ force: true });
        await queue.close();
      }
});
