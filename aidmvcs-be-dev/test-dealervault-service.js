import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { Queue, QueueEvents, Worker, UnrecoverableError } from 'bullmq';
import RepairOrder from './app/models/RepairOrder.js';
import Customer from './app/models/Customer.js';
import Vehicle from './app/models/Vehicle.js';
import Batch from './app/models/DealerVaultImportBatch.js';
import { createServiceProcessor, normalizeService, parseServiceOperations } from './app/worker/dealervault/serviceWorker.js';
import { splitRepeatingGroups } from './app/worker/dealervault/common/repeatingGroups.js';
import { SV_FIELDS, SV_REPEATING_FIELDS } from './app/worker/dealervault/common/serviceFields.js';
import { validateJob, getConcurrency } from './app/worker/dealervault/common/validation.js';
import { logEvent } from './app/worker/dealervault/common/logger.js';
import { SERVICE_QUEUE, defaultJobOptions } from './app/worker/dealervault/queues.js';
import { requiredIndexes } from './scripts/ensure-dealervault-indexes.js';
import { customers, staging, deals, vehicles } from './test-support/dealervault-memory.js';

const job = (records = [{ 'RO Number': '001' }], stamp = '20260908_1200', batchId = 0) => ({ data: {
  fileName: `DVD46315_${stamp}_SV.txt`, fileType: 'SV', dvDealerId: 'DVD46315', batchId, records,
} });
const context = () => ({ ...validateJob(job().data, 'SV'), dealer_id: 'dealer-a' });
const entry = row => normalizeService({ 'RO Number': '001', ...row }, context(), 0);
function harness(overrides = {}) {
  const dependencies = { Model: deals('ro_number'), BatchModel: staging(), CustomerModel: customers(), VehicleModel: vehicles(),
    connect: async () => {}, dealerResolver: async () => 'dealer-a', log: () => {}, ...overrides };
  return { ...dependencies, process: createServiceProcessor(dependencies) };
}

test('SV whitelist exactly matches all 200 reference fields and operation block 85–122', async () => {
  const reference = await readFile(new URL('../scripts/dealervault/dealertrack_file_types.txt', import.meta.url), 'utf8');
  const section = reference.split('SV — Service')[1].split('SV_APPT — Appointments')[0];
  const fields = [...section.matchAll(/^\d+\. (.+)$/gm)].map(match => match[1]);
  assert.equal(fields.length, 200);
  assert.deepEqual(SV_FIELDS, fields);
  assert.deepEqual(Object.keys(SV_REPEATING_FIELDS), fields.slice(84, 122));
  assert.equal(new Set(Object.values(SV_REPEATING_FIELDS)).size, 38);
});

test('RO Number must be a nonblank string; malformed structures and source identities are row errors', () => {
  for (const row of [null, [], {}, { 'RO Number': ' ' }, { 'RO Number': 1 },
    { 'RO Number': '1', 'DV Dealer ID': 'other' }, { 'RO Number': '1', 'Vendor Dealer ID': 'other' },
    { 'RO Number': '1', 'File Type': 'SL' }, { 'RO Number': '1', 'Total Sale': { $gt: 1 } }]) {
    assert.throws(() => normalizeService(row, context(), 0), UnrecoverableError);
  }
  assert.throws(() => normalizeService({}, context(), 0), { message: 'ROW_MISSING_RO_NUMBER' });
});

test('core normalization preserves leading zeros and every source string without trusting internal fields', () => {
  const row = Object.fromEntries(SV_FIELDS.map(field => [field, 'original']));
  Object.assign(row, { 'RO Number': ' 000123 ', 'Customer Number': ' 0007 ', VIN: ' abc123 ',
    'File Type': 'SV', 'DV Dealer ID': 'DVD46315', 'Vendor Dealer ID': 'DVD46315',
    'Total Sale': '1,234.00', 'Open Date': '9/8/2026', 'RO Mileage': '00100',
    'Operation Codes': 'A^^C||D^', 'Labor Tech Hours': '1.0|0.5',
    _id: 'evil', dealer_id: 'evil', dealerId: 'evil', ro_number: 'evil', customer_number: 'evil', vin: 'evil',
    customer_id: 'evil', vehicle_id: 'evil', source_file_timestamp: '999999999999',
    source_batch_id: 999, source_row_index: 999, source_import: { provider: 'evil' },
    createdAt: 'evil', updatedAt: 'evil', service_operations: ['evil'], status: 'evil', unknown: 'raw only' });
  const result = normalizeService(row, context(), 2);
  assert.deepEqual(result.key, { dealer_id: 'dealer-a', ro_number: '000123' });
  for (const field of SV_FIELDS) assert.equal(result.document[field], row[field]);
  const doc = result.document;
  assert.equal(doc.customer_number, '0007');
  assert.equal(doc.vin, 'ABC123');
  assert.equal(doc.source_file_timestamp, '202609081200');
  assert.equal(doc.source_batch_id, 0);
  assert.equal(doc.source_row_index, 2);
  assert.equal(doc.source_import.fileType, 'SV');
  assert.deepEqual(doc.service_operations[0].operation_codes, ['A', '', 'C']);
  for (const field of ['_id', 'dealerId', 'customer_id', 'vehicle_id', 'status', 'unknown', 'createdAt', 'updatedAt']) {
    assert.equal(Object.hasOwn(doc, field), false);
  }
});

test('absent source columns and optional core identifiers are omitted instead of filled with null', () => {
  const doc = entry({}).document;
  for (const field of ['VIN', 'vin', 'Customer Number', 'customer_number', 'Total Sale', 'Open Date', 'Operation Codes', 'service_operations']) {
    assert.equal(Object.hasOwn(doc, field), false);
  }
  assert.equal(entry({ 'Total Sale': null }).document['Total Sale'], null);
});

const repeatCases = [
  ['normal outer groups', 'A|B|C', [['A'], ['B'], ['C']]],
  ['normal inner values', 'A^B^C', [['A', 'B', 'C']]],
  ['nested groups', 'A^B^C|D^E^F', [['A', 'B', 'C'], ['D', 'E', 'F']]],
  ['consecutive inner empties', 'A^^C', [['A', '', 'C']]],
  ['leading inner empty', '^B', [['', 'B']]],
  ['trailing inner empty', 'A^', [['A', '']]],
  ['leading outer empty', '|A', [[''], ['A']]],
  ['trailing outer empty', 'A|', [['A'], ['']]],
  ['consecutive outer empty groups', 'A^B||C^D', [['A', 'B'], [''], ['C', 'D']]],
  ['empty whole field', '', [['']]],
  ['all empty positions', '^||^', [['', ''], [''], ['', '']]],
  ['unequal inner lengths and whitespace', ' A^^C|D^E', [[' A', '', 'C'], ['D', 'E']]],
];
for (const [name, value, expected] of repeatCases) {
  test(`repeating parser preserves ${name}`, () => assert.deepEqual(splitRepeatingGroups(value), expected));
}

test('parser round trips every short delimiter combination without filtering empty positions', () => {
  let values = [''];
  for (let length = 0; length < 6; length += 1) {
    for (const value of values) assert.equal(splitRepeatingGroups(value).map(group => group.join('^')).join('|'), value);
    values = values.flatMap(value => ['A', '^', '|'].map(character => value + character));
  }
  for (const value of [null, undefined, [], {}, 42]) assert.throws(() => splitRepeatingGroups(value), { message: 'REPEATING_VALUE_NOT_STRING' });
});

test('related columns align by outer position and retain unequal inner lengths without shifting', () => {
  const source = { 'Operation Code Descriptions': 'Oil Change||Brake Inspection|',
    'Labor Tech Hours': '1.0|0.5', 'Tech Number': 'T1^T2|T3||T4', 'Part Number': 'P1^^P3',
    'Recommendations': '', 'Labor Comments': null };
  const operations = parseServiceOperations(source);
  assert.deepEqual(operations, [
    { group_index: 0, operation_code_descriptions: ['Oil Change'], labor_tech_hours: ['1.0'],
      tech_number: ['T1', 'T2'], part_number: ['P1', '', 'P3'], recommendations: [''] },
    { group_index: 1, operation_code_descriptions: [''], labor_tech_hours: ['0.5'],
      tech_number: ['T3'], part_number: [''], recommendations: [''] },
    { group_index: 2, operation_code_descriptions: ['Brake Inspection'], labor_tech_hours: [''],
      tech_number: [''], part_number: [''], recommendations: [''] },
    { group_index: 3, operation_code_descriptions: [''], labor_tech_hours: [''],
      tech_number: ['T4'], part_number: [''], recommendations: [''] },
  ]);
  assert.equal(parseServiceOperations({}), undefined);
  assert.deepEqual(parseServiceOperations({ 'Labor Comments': null }), []);
  assert.deepEqual(parseServiceOperations({ 'Operation Codes': '' }), [{ group_index: 0, operation_codes: [''] }]);
  assert.equal(source['Operation Code Descriptions'], 'Oil Change||Brake Inspection|');
});

test('invalid repeating cells and excessive derived expansion fail only their row with a sanitized code', async () => {
  assert.throws(() => parseServiceOperations({ 'Operation Codes': [] }), { message: 'SV_REPEAT_PARSE_ERROR' });
  const h = harness();
  const oversized = Object.fromEntries(Object.keys(SV_REPEATING_FIELDS).map(field => [field, '']));
  oversized['Operation Codes'] = '|'.repeat(3000);
  const records = [{ 'RO Number': 'good' }, { 'RO Number': 'bad', 'Operation Codes': {} }, { 'RO Number': 'large', ...oversized }];
  const result = await h.process(job(records));
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 2);
  assert.deepEqual(h.BatchModel.rows[0].row_outcomes.slice(1).map(row => row.code), ['SV_REPEAT_PARSE_ERROR', 'SV_REPEAT_PARSE_ERROR']);
  assert.deepEqual(JSON.parse(h.BatchModel.rows[0].raw_records_json), records);
});

test('dealer resolves once; staging precedes normalization and all domain mutations; mixed rows complete', async () => {
  let dealerCalls = 0;
  const h = harness({ dealerResolver: async dvId => { assert.equal(dvId, 'DVD46315'); dealerCalls += 1; return 'dealer-a'; } });
  const records = [{ 'RO Number': '001', 'Customer Number': '007', dealer_id: 'evil', 'Operation Codes': 'A^^C||D^', unknown: { keep: true } }, {}, null];
  const originalCreate = h.CustomerModel.create;
  h.CustomerModel.create = data => {
    assert.deepEqual(JSON.parse(h.BatchModel.rows[0].raw_records_json), records);
    assert.equal(h.BatchModel.rows[0].source_file_timestamp, '202609081200');
    return originalCreate(data);
  };
  const originalBulk = h.Model.bulkWrite;
  h.Model.bulkWrite = (...args) => {
    assert.equal(h.BatchModel.rows[0].status, 'processing');
    assert.deepEqual(JSON.parse(h.BatchModel.rows[0].raw_records_json), records);
    return originalBulk(...args);
  };
  const result = await h.process(job(records));
  assert.deepEqual(result, { received: 3, processed: 1, failed: 2, unchanged: 0, reused: false });
  assert.equal(dealerCalls, 1);
  assert.equal(h.Model.rows[0].dealer_id, 'dealer-a');
  assert.equal(h.Model.rows[0].unknown, undefined);
  assert.equal(h.Model.rows[0]['Operation Codes'], 'A^^C||D^');
  assert.equal(h.BatchModel.rows[0].status, 'completed_with_errors');
  const failedStaging = harness({ BatchModel: { findOneAndUpdate() { throw new Error('private'); } },
    normalize: () => assert.fail('Normalization before staging'),
  });
  await assert.rejects(failedStaging.process(job(records)), { message: 'STAGING_FAILURE' });
  assert.equal(failedStaging.CustomerModel.calls.length, 0);
  assert.equal(failedStaging.Model.rows.length, 0);
});

test('mapped Customer and sold VIN resolve within dealer scope without touching contact or inventory data', async () => {
  const CustomerModel = customers([{ _id: 'wrong', dealer_id: 'dealer-b', extra: { dealervault: { customer_numbers: ['007'] } } },
    { _id: 'right', dealer_id: 'dealer-a', extra: { dealervault: { customer_numbers: ['007'] } },
      phones: [{ value: '4155551212', sms_opt_in: false, is_primary: true }] }]);
  const before = structuredClone(CustomerModel.rows);
  const VehicleModel = vehicles([{ _id: 'wrong-car', dealerId: 'dealer-b', vin: 'ABC123' },
    { _id: 'right-car', dealerId: 'dealer-a', vin: 'ABC123' }]);
  const h = harness({ CustomerModel, VehicleModel });
  await h.process(job([{ 'RO Number': '001', 'Customer Number': ' 007 ', VIN: ' abc123 ', 'Block Phone': 'N' }]));
  assert.equal(h.Model.rows[0].customer_id, 'right');
  assert.equal(h.Model.rows[0].vehicle_id, 'right-car');
  assert.deepEqual(CustomerModel.rows, before);
  for (const [, filter] of CustomerModel.calls) assert.equal(filter.dealer_id, 'dealer-a');
  // The Vehicle fake exposes find only: any inventory mutation would fail.
  assert.deepEqual(Object.keys(VehicleModel), ['find']);
});

test('conflicting Customer contacts leave valid RO stored with warning and no merges/creation', async () => {
  const CustomerModel = customers([{ _id: 'email', dealer_id: 'dealer-a', emails: [{ value: 'a@example.invalid' }] },
    { _id: 'phone', dealer_id: 'dealer-a', phones: [{ value: '4155551212' }] }]);
  const h = harness({ CustomerModel });
  const result = await h.process(job([{ 'RO Number': '001', 'Customer Number': '007', 'Email 1': 'a@example.invalid', 'Cell Phone': '4155551212' }]));
  assert.equal(result.failed, 0);
  assert.equal(h.Model.rows[0].customer_id, null);
  assert.ok(h.BatchModel.rows[0].row_outcomes[0].warnings.includes('CUSTOMER_AMBIGUOUS'));
  assert.equal(CustomerModel.calls.some(([action]) => ['create', 'updateOne'].includes(action)), false);
});

test('unmatched stable Customer Number uses approved SL creation and remains idempotent on concurrent SV delivery', async () => {
  const h = harness();
  const payload = job([{ 'RO Number': '001', 'Customer Number': '007', 'Email 1': ' Buyer@Example.Invalid ', 'Cell Phone': '+1 4155551212' }]);
  await Promise.all([h.process(payload), h.process(payload)]);
  assert.equal(h.Model.rows.length, 1);
  assert.equal(h.CustomerModel.rows.length, 1);
  assert.equal(h.CustomerModel.rows[0].emails[0].value, 'buyer@example.invalid');
  assert.equal(h.CustomerModel.rows[0].phones[0].sms_opt_in, undefined);
  assert.equal(h.CustomerModel.rows[0].emails[0].first_seen_lead_id, undefined);
  assert.deepEqual(h.CustomerModel.rows[0].extra.dealervault.customer_numbers, ['007']);
  assert.equal(h.BatchModel.rows.length, 1);
  assert.equal(h.BatchModel.rows[0].processed_count, 1);
  assert.equal((await h.process(payload)).reused, true);
});

test('missing or unresolvable relationships and optional business fields do not reject valid RO', async () => {
  const h = harness();
  await h.process(job([{ 'RO Number': 'absent' }, { 'RO Number': 'unknown', VIN: 'MISSING', 'Email 1': 'missing@example.invalid' }]));
  assert.equal(h.Model.rows.length, 2);
  assert.equal(h.CustomerModel.rows.length, 0);
  assert.equal(Object.hasOwn(h.Model.rows[0], 'vin'), false);
  assert.equal(Object.hasOwn(h.Model.rows[0], 'customer_id'), false);
  assert.equal(Object.hasOwn(h.Model.rows[0], 'vehicle_id'), false);
  assert.deepEqual(h.BatchModel.rows[0].row_outcomes[0].warnings, []);
  assert.equal(h.Model.rows[1].vin, 'MISSING');
  assert.equal(h.Model.rows[1].customer_id, null);
  assert.equal(h.Model.rows[1].vehicle_id, null);
  assert.deepEqual(h.BatchModel.rows[0].row_outcomes[1].warnings, ['CUSTOMER_UNRESOLVED', 'VEHICLE_NOT_FOUND']);
});

test('same RO number is independent between dealers and older SV does not overwrite newer state', async () => {
  const h = harness();
  await h.process(job([{ 'RO Number': '001', 'Total Sale': 'new', 'Operation Codes': 'A^^C||D^' }]));
  const older = await h.process(job([{ 'RO Number': '001', 'Total Sale': 'old', 'Operation Codes': 'OLD' }], '20260907_1200'));
  assert.equal(older.unchanged, 1);
  assert.equal(h.Model.rows[0]['Total Sale'], 'new');
  assert.equal(h.Model.rows[0].source_file_timestamp, '202609081200');
  assert.deepEqual(h.Model.rows[0].service_operations[0].operation_codes, ['A', '', 'C']);
  const other = harness({ Model: h.Model, dealerResolver: async () => 'dealer-b' });
  await other.process(job());
  assert.equal(h.Model.rows.length, 2);
  assert.deepEqual(h.Model.rows.map(row => row.dealer_id), ['dealer-a', 'dealer-b']);
});

test('newer partial SV does not clear absent source fields, optional identifiers or established links', async () => {
  const h = harness({ VehicleModel: vehicles([{ dealerId: 'dealer-a', vin: 'ABC123', _id: 'car' }]) });
  await h.process(job([{ 'RO Number': '001', 'Customer Number': '007', VIN: 'ABC123', 'Total Sale': '42.00' }]));
  const original = structuredClone(h.Model.rows[0]);
  await h.process(job([{ 'RO Number': '001', 'Close Date': '9/9/2026' }], '20260909_1200'));
  const current = h.Model.rows[0];
  for (const field of ['Customer Number', 'customer_number', 'VIN', 'vin', 'Total Sale', 'customer_id', 'vehicle_id']) {
    assert.deepEqual(current[field], original[field]);
  }
  assert.equal(current['Close Date'], '9/9/2026');
  assert.deepEqual(h.BatchModel.rows[1].row_outcomes[0].warnings, []);
});

test('changed staging digest cannot replace original SV source; completed error batches reuse counts', async () => {
  const h = harness();
  const payload = job([{ 'RO Number': '001', 'Operation Codes': 'A^^' }, {}]);
  await h.process(payload);
  const before = structuredClone(h.BatchModel.rows[0]);
  assert.equal((await h.process(payload)).reused, true);
  assert.deepEqual(h.BatchModel.rows[0], before);
  await assert.rejects(h.process(job([{ 'RO Number': '001', 'Operation Codes': 'different' }, {}])), { message: 'BATCH_CONTENT_CONFLICT' });
  assert.deepEqual(JSON.parse(h.BatchModel.rows[0].raw_records_json), payload.data.records);
  assert.equal(h.Model.rows[0]['Operation Codes'], 'A^^');
});

test('transient Mongo failures at reconciliation or bulk persistence remain retryable and reuse staged data', async () => {
  for (const phase of ['customer', 'vehicle', 'bulk']) {
    const h = harness();
    const target = phase === 'customer' ? h.CustomerModel : phase === 'vehicle' ? h.VehicleModel : h.Model;
    const method = phase === 'bulk' ? 'bulkWrite' : 'find';
    const original = target[method];
    let attempts = 0;
    target[method] = (...args) => { if (++attempts === 1) throw new Error('private invoice data'); return original.apply(target, args); };
    const payload = job([{ 'RO Number': '001', 'Customer Number': '007', VIN: 'ABC123' }]);
    const error = await h.process(payload).catch(error => error);
    assert.equal(error.message, phase === 'bulk' ? 'UPSERT_FAILURE' : 'DATABASE_FAILURE');
    assert.equal(error instanceof UnrecoverableError, false);
    assert.equal(h.BatchModel.rows[0].status, 'failed');
    assert.equal((await h.process(payload)).reused, false);
    assert.equal(h.BatchModel.rows.length, 1);
    assert.equal(h.Model.rows.length, 1);
    assert.equal(h.CustomerModel.rows.length, 1);
    assert.equal(h.BatchModel.rows[0].processed_count, 1);
  }
});

test('sensitive values never appear in logs, staging error codes or BullMQ failed reasons', async t => {
  const messages = [];
  t.mock.method(console, 'info', message => messages.push(message));
  const privateValue = 'PRIVATE_NAME_VIN_PHONE_INVOICE_DATA';
  const h = harness({ log: logEvent });
  await h.process(job([{ 'RO Number': privateValue, 'Full Name': privateValue, 'Total Sale': privateValue, 'Labor Comments': privateValue }, {}]));
  h.Model.bulkWrite = async () => { throw new Error(privateValue); };
  await assert.rejects(h.process(job([{ 'RO Number': 'retry', 'Email 1': privateValue }], '20260909_1200')), { message: 'UPSERT_FAILURE' });
  assert.equal(messages.join('').includes(privateValue), false);
  assert.equal(h.BatchModel.rows[1].error_code, 'UPSERT_FAILURE');
  assert.ok(messages.some(message => JSON.parse(message).code === 'ROW_MISSING_RO_NUMBER'));
});

test('SV uses its own concurrency, shared queue retries/limits, and existing RepairOrder unique index', async () => {
  assert.equal(SERVICE_QUEUE, 'dealervault-service');
  assert.equal(defaultJobOptions().attempts, 3);
  assert.equal(getConcurrency(5, 'DEALERVAULT_SV_CONCURRENCY'), 5);
  assert.throws(() => getConcurrency('0', 'DEALERVAULT_SV_CONCURRENCY'), /DEALERVAULT_SV_CONCURRENCY/);
  assert.equal(RepairOrder.schema.options.strict, false);
  assert.ok(RepairOrder.schema.indexes().some(([key, options]) => key.ro_number === 1 && key.dealer_id === 1 && options.unique));
  assert.ok(requiredIndexes.some(spec => spec.collection === RepairOrder.collection.name && spec.key.ro_number === 1));
  for (const change of [{ fileType: 'SL' }, { dvDealerId: 'other' }, { batchId: -1 }, { records: [] },
    { records: Array(101).fill({}) }, { records: [{ value: 'é'.repeat(250001) }] }]) {
    assert.throws(() => validateJob({ ...job().data, ...change }, 'SV'), UnrecoverableError);
  }
  const h = harness();
  h.Model.collection.listIndexes = () => ({ toArray: async () => [] });
  await assert.rejects(h.process(job()), { message: 'INDEX_REQUIRED' });
  assert.equal(h.CustomerModel.calls.length, 0);
});

const mongoUri = process.env.DEALERVAULT_TEST_MONGO_URI;
test('Mongo integration: SV repeating BSON, concurrent unique upserts, ordering, customer reuse and inventory immutability', {
  skip: !mongoUri && 'Set DEALERVAULT_TEST_MONGO_URI to a disposable localhost MongoDB server',
}, async t => {
  const parsed = new URL(mongoUri);
  assert.equal(parsed.protocol, 'mongodb:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname));
  const dbName = `dealervault_test_service_${process.pid}_${Date.now()}`;
  const connection = mongoose.createConnection(mongoUri, { dbName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  t.after(async () => {
    if (connection.readyState === 1) { assert.equal(connection.name, dbName); await connection.dropDatabase(); }
    await connection.close();
  });
  await connection.asPromise();
  const Model = connection.model('RepairOrder', RepairOrder.schema.clone());
  const CustomerModel = connection.model('Customer', Customer.schema.clone());
  const VehicleModel = connection.model('Vehicle', Vehicle.schema.clone());
  const BatchModel = connection.model('DealerVaultImportBatch', Batch.schema.clone());
  await Promise.all([Model.createIndexes(), CustomerModel.createIndexes(), VehicleModel.createIndexes(), BatchModel.createIndexes()]);
  const car = await VehicleModel.create({ dealerId: 'dealer-a', vin: 'ABC123', price: 42 });
  const originalCar = await VehicleModel.findOne({ dealerId: 'dealer-a', _id: car._id }).lean();
  const h = harness({ Model, CustomerModel, VehicleModel, BatchModel });
  const payload = job([{ 'RO Number': '0001', 'Customer Number': '007', VIN: ' abc123 ',
    'Operation Codes': 'A^^C||D^', 'Tech Number': 'T1|T2', 'Total Sale': 'new', unknown: { keep: true } }]);
  await Promise.all([h.process(payload), h.process(payload)]);
  assert.equal(await Model.countDocuments({ dealer_id: 'dealer-a' }), 1);
  assert.equal(await CustomerModel.countDocuments({ dealer_id: 'dealer-a' }), 1);
  assert.equal(await BatchModel.countDocuments({ dealer_id: 'dealer-a' }), 1);
  const current = await Model.findOne({ dealer_id: 'dealer-a', ro_number: '0001' }).lean();
  assert.equal(String(current.vehicle_id), String(car._id));
  assert.ok(current.customer_id instanceof mongoose.Types.ObjectId);
  assert.deepEqual(current.service_operations.map(operation => operation.operation_codes), [['A', '', 'C'], [''], ['D', '']]);
  assert.deepEqual(current.service_operations[2].tech_number, ['']);
  assert.equal(current.unknown, undefined);
  const staged = await BatchModel.findOne({ dealer_id: 'dealer-a', fileName: payload.data.fileName }).lean();
  assert.deepEqual(JSON.parse(staged.raw_records_json), payload.data.records);
  assert.equal(staged.source_file_timestamp, '202609081200');
  const older = await h.process(job([{ 'RO Number': '0001', 'Total Sale': 'old' }], '20260907_1200'));
  assert.equal(older.unchanged, 1);
  const unchanged = await Model.findOne({ dealer_id: 'dealer-a', ro_number: '0001' }).lean();
  assert.equal(unchanged['Total Sale'], 'new');
  assert.deepEqual(unchanged.updatedAt, current.updatedAt);
  assert.equal((await h.process(payload)).reused, true);
  const other = harness({ Model, CustomerModel, VehicleModel, BatchModel, dealerResolver: async () => 'dealer-b' });
  await other.process(payload);
  assert.equal(await Model.countDocuments({ ro_number: '0001' }), 2);
  assert.equal(await CustomerModel.countDocuments({ 'extra.dealervault.customer_numbers': '007' }), 2);
  assert.equal(await VehicleModel.countDocuments({ dealerId: 'dealer-b' }), 0);
  assert.deepEqual(await VehicleModel.findOne({ dealerId: 'dealer-a', _id: car._id }).lean(), originalCar);
});

const redisPort = process.env.DEALERVAULT_TEST_REDIS_PORT;
test('Redis integration: SV retry reuses completed staging without duplicating domain records (memory database)', {
  skip: !redisPort && 'Set DEALERVAULT_TEST_REDIS_PORT to a disposable localhost Redis server',
}, async () => {
  const h = harness();
  const redis = { host: '127.0.0.1', port: Number(redisPort), maxRetriesPerRequest: null };
  const queueName = `dealervault-service-test-${process.pid}-${Date.now()}`;
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
    const queued = await queue.add('SV', job([{ 'RO Number': '001', 'Customer Number': '007', 'Operation Codes': 'A^^||B^' }]).data,
      { backoff: { type: 'fixed', delay: 10 } });
    assert.equal((await queued.waitUntilFinished(events, 15000)).reused, true);
    assert.equal(attempts, 2);
    assert.equal(h.Model.rows.length, 1);
    assert.equal(h.CustomerModel.rows.length, 1);
    assert.equal(h.BatchModel.rows.length, 1);
    assert.equal(h.Model.rows[0]['Operation Codes'], 'A^^||B^');
  } finally {
    await worker.close();
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
