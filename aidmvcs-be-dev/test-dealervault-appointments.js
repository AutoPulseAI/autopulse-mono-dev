import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { Queue, QueueEvents, Worker, UnrecoverableError } from 'bullmq';
import ServiceAppointment from './app/models/ServiceAppointment.js';
import RepairOrder from './app/models/RepairOrder.js';
import Customer from './app/models/Customer.js';
import Vehicle from './app/models/Vehicle.js';
import Batch from './app/models/DealerVaultImportBatch.js';
import { createServiceAppointmentProcessor, normalizeServiceAppointment, validSourceDate } from './app/worker/dealervault/serviceAppointmentWorker.js';
import { SV_APPT_FIELDS } from './app/worker/dealervault/common/appointmentFields.js';
import { resolveRepairOrders } from './app/worker/dealervault/common/repairOrderResolver.js';
import { validateJob, getConcurrency } from './app/worker/dealervault/common/validation.js';
import { logEvent } from './app/worker/dealervault/common/logger.js';
import { SERVICE_APPOINTMENTS_QUEUE, defaultJobOptions } from './app/worker/dealervault/queues.js';
import { requiredIndexes } from './scripts/ensure-dealervault-indexes.js';
import { customers, staging, deals, vehicles, query, matches } from './test-support/dealervault-memory.js';

const job = (records = [{ 'Appointment Number': '001' }], stamp = '20260908_1200', batchId = 0) => ({ data: {
  fileName: `DVD46315_${stamp}_SV_APPT.txt`, fileType: 'SV_APPT', dvDealerId: 'DVD46315', batchId, records,
} });
const context = () => ({ ...validateJob(job().data, 'SV_APPT'), dealer_id: 'dealer-a' });
const entry = row => normalizeServiceAppointment({ 'Appointment Number': '001', ...row }, context(), 0);
const orders = (rows = []) => ({ find: filter => query(rows.filter(row => matches(row, filter))) });
function harness(overrides = {}) {
  const dependencies = { Model: deals('appointment_number'), BatchModel: staging(), CustomerModel: customers(),
    VehicleModel: vehicles(), RepairOrderModel: orders(), connect: async () => {}, dealerResolver: async () => 'dealer-a',
    log: () => {}, ...overrides };
  return { ...dependencies, process: createServiceAppointmentProcessor(dependencies) };
}

test('SV_APPT whitelist exactly matches the 105 authoritative source columns', async () => {
  const reference = await readFile(new URL('../scripts/dealervault/dealertrack_file_types.txt', import.meta.url), 'utf8');
  const fields = [...reference.split('SV_APPT — Appointments')[1].matchAll(/^\d+\. (.+)$/gm)].map(match => match[1]);
  assert.equal(fields.length, 105);
  assert.deepEqual(SV_APPT_FIELDS, fields);
});

test('Appointment Number is required and must be a nonblank string', () => {
  for (const row of [{}, { 'Appointment Number': '' }, { 'Appointment Number': ' ' }, { 'Appointment Number': 1 }]) {
    assert.throws(() => normalizeServiceAppointment(row, context(), 0), { message: 'SV_APPT_MISSING_APPOINTMENT_NUMBER' });
  }
});

test('identifier normalization preserves leading zeros and trusts only resolved dealer ownership', () => {
  const { key, document } = entry({ 'Appointment Number': ' 0001 ', 'RO Number': ' 0002 ', 'Customer Number': ' 0003 ', VIN: ' abc123 ', dealer_id: 'evil' });
  assert.deepEqual(key, { dealer_id: 'dealer-a', appointment_number: '0001' });
  assert.equal(document.ro_number, '0002');
  assert.equal(document.customer_number, '0003');
  assert.equal(document.vin, 'ABC123');
  assert.equal(document['Appointment Number'], ' 0001 ');
});

test('raw internal fields and arbitrary unknown values cannot override normalized storage', () => {
  const row = JSON.parse('{"Appointment Number":"001","_id":"evil","dealerId":"evil","dealer_id":"evil","appointment_number":"evil","ro_number":"evil","customer_number":"evil","vin":"evil","customer_id":"evil","vehicle_id":"evil","repair_order_id":"evil","appointment_date":"evil","appointment_time":"evil","source_file_timestamp":"999999999999","source_batch_id":999,"source_row_index":999,"source_import":{"provider":"evil"},"createdAt":"evil","updatedAt":"evil","status":"evil","service_operations":["evil"],"booking_id":"evil","unknown":{"keep":"raw"},"__proto__":{"polluted":true}}');
  const { document } = normalizeServiceAppointment(row, context(), 2);
  assert.equal(document.dealer_id, 'dealer-a');
  assert.equal(document.appointment_number, '001');
  assert.equal(document.source_file_timestamp, '202609081200');
  assert.equal(document.source_batch_id, 0);
  assert.equal(document.source_row_index, 2);
  assert.equal(document.source_import.fileType, 'SV_APPT');
  for (const field of ['_id', 'dealerId', 'ro_number', 'customer_number', 'vin', 'customer_id', 'vehicle_id', 'repair_order_id',
    'appointment_date', 'appointment_time', 'createdAt', 'updatedAt', 'status', 'service_operations', 'booking_id', 'unknown', '__proto__']) {
    assert.equal(Object.hasOwn(document, field), false);
  }
});

test('malformed source structure and mismatched source identity are permanent row failures', () => {
  for (const row of [null, [], { 'Appointment Number': '1', 'Estimate Amount': {} }, { 'Appointment Number': '1', 'Email 1': [] }]) {
    assert.throws(() => normalizeServiceAppointment(row, context(), 0), { message: 'SV_APPT_INVALID_SOURCE_FIELD' });
  }
  for (const field of ['File Type', 'DV Dealer ID', 'Vendor Dealer ID']) {
    assert.throws(() => entry({ [field]: 'other' }), { message: 'ROW_SOURCE_MISMATCH' });
  }
});

const preservationGroups = {
  'appointment dates, times and concerns': ['Appointment Date', 'Appointment Time', 'Appointment Create Date', 'Promise Date', 'Promise Time', 'Cause', 'Complaint', 'Comment'],
  'operation and recommended operation strings': ['Operation Code', 'Operation Code Description', 'Recommended Operation Code', 'Recommended Operation Code Description'],
  'advisor information': ['Service Advisor Number', 'Service Advisor Name'],
  'waiting, loaner and transport flags': ['Sale Type', 'Waiting Flag', 'Loaner Flag', 'Alternate Transportation'],
  'estimates and tag': ['Estimate Time', 'Estimate Amount', 'Tag Number'],
  'vehicle details and VIN explosion metadata': SV_APPT_FIELDS.slice(29, 55),
  'customer contacts, addresses, dates and blocking flags': SV_APPT_FIELDS.slice(55, 84),
  'all CASS metadata': SV_APPT_FIELDS.slice(84),
};
for (const [name, fields] of Object.entries(preservationGroups)) {
  test(`preserves ${name} as source values`, () => {
    const row = Object.fromEntries(fields.map((field, index) => [field, index % 3 === 0 ? '' : index % 3 === 1 ? ' 001,234.00 ' : null]));
    const { document } = entry(row);
    for (const field of fields) assert.equal(document[field], row[field]);
  });
}

test('missing optional fields and relationships are omitted instead of populated with null', async () => {
  const h = harness();
  await h.process(job());
  const doc = h.Model.rows[0];
  for (const field of ['RO Number', 'ro_number', 'Customer Number', 'customer_number', 'VIN', 'vin',
    'Appointment Date', 'appointment_date', 'Appointment Time', 'appointment_time', 'customer_id', 'vehicle_id', 'repair_order_id']) {
    assert.equal(Object.hasOwn(doc, field), false);
  }
  assert.equal(h.BatchModel.rows[0].failed_count, 0);
  assert.deepEqual(h.BatchModel.rows[0].row_outcomes[0].warnings, []);
});

test('optional dates validate calendar values without casting dates or rewriting strings', async () => {
  for (const value of [null, undefined, '', ' ', '2/29/2024', '02/29/2000', '12/31/2026', ' 1/1/0001 ']) assert.equal(validSourceDate(value), true);
  for (const value of ['2/29/2025', '2/29/1900', '4/31/2026', '0/1/2026', '13/1/2026', '1/0/2026', '1/1/0000', '2026-09-08', 'private date']) {
    assert.equal(validSourceDate(value), false);
  }
  const h = harness();
  await h.process(job([{ 'Appointment Number': '1', 'Appointment Date': '2/30/2026', 'Appointment Time': ' 8:30 AM ', 'Promise Date': 'bad' }]));
  assert.equal(h.Model.rows[0].appointment_date, '2/30/2026');
  assert.equal(h.Model.rows[0].appointment_time, ' 8:30 AM ');
  assert.equal(h.Model.rows[0]['Promise Date'], 'bad');
  assert.equal(h.BatchModel.rows[0].failed_count, 0);
  assert.equal(h.BatchModel.rows[0].row_outcomes[0].warnings.filter(code => code === 'SV_APPT_INVALID_DATE').length, 1);
});

test('operation delimiters remain literal strings and produce a review warning, never parsed groups', () => {
  const result = entry({ 'Operation Code': 'A^^B||C^', 'Operation Code Description': 'one|two', 'Recommended Operation Code': '^D|' });
  assert.equal(result.document['Operation Code'], 'A^^B||C^');
  assert.equal(result.document['Operation Code Description'], 'one|two');
  assert.equal(result.document['Recommended Operation Code'], '^D|');
  assert.deepEqual(result.warnings, ['SV_APPT_OPERATION_DELIMITERS']);
  assert.equal(Object.hasOwn(result.document, 'service_operations'), false);
});

test('raw batch stages before normalization and relationship mutations; one bad row does not reject valid rows', async () => {
  let dealerCalls = 0;
  const records = [Object.fromEntries(SV_APPT_FIELDS.map(field => [field, 'source'])), {}, null];
  Object.assign(records[0], { 'Appointment Number': '001', 'Customer Number': '007', 'File Type': 'SV_APPT',
    'DV Dealer ID': 'DVD46315', 'Vendor Dealer ID': 'DVD46315', unknown: { untouched: true }, dealer_id: 'evil' });
  const h = harness({ dealerResolver: async dvId => { assert.equal(dvId, 'DVD46315'); dealerCalls += 1; return 'dealer-a'; } });
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
  assert.deepEqual(await h.process(job(records)), { received: 3, processed: 1, failed: 2, unchanged: 0, reused: false });
  assert.equal(dealerCalls, 1);
  for (const field of SV_APPT_FIELDS) assert.equal(h.Model.rows[0][field], records[0][field]);
  assert.equal(h.Model.rows[0].dealer_id, 'dealer-a');
  assert.equal(h.Model.rows[0].unknown, undefined);
  assert.equal(h.BatchModel.rows[0].status, 'completed_with_errors');
  const blocked = harness({ BatchModel: { findOneAndUpdate() { throw new Error('private staging error'); } },
    normalize: () => assert.fail('normalized before staging'),
  });
  await assert.rejects(blocked.process(job()), { message: 'STAGING_FAILURE' });
  assert.equal(blocked.CustomerModel.calls.length, 0);
});

test('mapped Customer is dealer-scoped and CASS/block flags never overwrite canonical data or consent', async () => {
  const CustomerModel = customers([{ _id: 'other', dealer_id: 'dealer-b', extra: { dealervault: { customer_numbers: ['007'] } } },
    { _id: 'mapped', dealer_id: 'dealer-a', extra: { address: 'trusted', dealervault: { customer_numbers: ['007'] } },
      emails: [{ value: 'trusted@example.invalid', is_primary: true }], phones: [{ value: '4155551212', sms_opt_in: false }], merge_history: [{ reason: 'keep' }] }]);
  const before = structuredClone(CustomerModel.rows);
  const h = harness({ CustomerModel });
  await h.process(job([{ 'Appointment Number': '1', 'Customer Number': '007', 'Email 1': 'new@example.invalid',
    'CASS_STD_LINE1': 'source address', 'Address Line 1': 'source address', 'Opt Out': 'N', 'Block Email': 'N', 'Block Phone': 'N', 'Block Mail': 'N' }]));
  assert.equal(h.Model.rows[0].customer_id, 'mapped');
  assert.equal(h.Model.rows[0].CASS_STD_LINE1, 'source address');
  assert.deepEqual(CustomerModel.rows, [before[0], { ...before[1], dealervault_upload: true }]);
  for (const [, filter] of CustomerModel.calls) assert.equal(filter.dealer_id, 'dealer-a');
});

test('conflicting Customer contacts remain unresolved and valid appointments still persist', async () => {
  const CustomerModel = customers([{ _id: 'email', dealer_id: 'dealer-a', emails: [{ value: 'a@example.invalid' }] },
    { _id: 'phone', dealer_id: 'dealer-a', phones: [{ value: '4155551212' }] }]);
  const h = harness({ CustomerModel });
  await h.process(job([{ 'Appointment Number': '1', 'Customer Number': '007', 'Email 1': 'a@example.invalid', 'Home Phone': '4155551212' }]));
  assert.equal(h.Model.rows[0].customer_id, null);
  assert.ok(h.BatchModel.rows[0].row_outcomes[0].warnings.includes('CUSTOMER_AMBIGUOUS'));
  assert.equal(CustomerModel.calls.some(([action]) => ['create', 'updateOne'].includes(action)), false);
});

test('approved Customer creation reuses stable mapping on concurrent delivery without Leads or inferred consent', async () => {
  const h = harness();
  const payload = job([{ 'Appointment Number': '1', 'Customer Number': '007', 'Email 1': ' New@Example.Invalid ',
    'Cell Phone': '+1 4155551212', 'Block Phone': 'N', 'CASS_STD_LINE1': 'source' }]);
  await Promise.all([h.process(payload), h.process(payload)]);
  const customer = h.CustomerModel.rows[0];
  assert.equal(h.CustomerModel.rows.length, 1);
  assert.equal(customer.emails[0].value, 'new@example.invalid');
  assert.equal(customer.emails[0].first_seen_lead_id, undefined);
  assert.equal(customer.phones[0].sms_opt_in, undefined);
  assert.equal(customer.dealervault_upload, true);
  assert.equal(customer.inbound_lead, false);
  assert.equal(customer.CASS_STD_LINE1, undefined);
  assert.deepEqual(customer.extra.dealervault.customer_numbers, ['007']);
  assert.equal(h.Model.rows.length, 1);
  assert.equal(h.BatchModel.rows[0].processed_count, 1);
});

test('missing Customer identity warns without creating or rejecting an appointment', async () => {
  const h = harness();
  await h.process(job([{ 'Appointment Number': '1', 'Email 1': 'missing@example.invalid' }]));
  assert.equal(h.Model.rows.length, 1);
  assert.equal(h.Model.rows[0].customer_id, null);
  assert.equal(h.CustomerModel.rows.length, 0);
  assert.ok(h.BatchModel.rows[0].row_outcomes[0].warnings.includes('CUSTOMER_UNRESOLVED'));
});

test('Vehicle and RO lookups are batched and dealer-scoped, with no inventory or RO writes', async () => {
  let vehicleReads = 0;
  let orderReads = 0;
  const VehicleModel = { find: filter => {
    vehicleReads += 1;
    assert.deepEqual(filter, { dealerId: 'dealer-a', vin: { $in: ['ABC123', 'MISSING'] } });
    return query([{ _id: 'car', vin: 'ABC123' }]);
  } };
  const RepairOrderModel = { find: filter => {
    orderReads += 1;
    assert.deepEqual(filter, { dealer_id: 'dealer-a', ro_number: { $in: ['0007', 'missing'] } });
    return query([{ _id: 'ro', ro_number: '0007' }]);
  } };
  const h = harness({ VehicleModel, RepairOrderModel });
  await h.process(job([{ 'Appointment Number': '1', VIN: ' abc123 ', 'RO Number': ' 0007 ' },
    { 'Appointment Number': '2', VIN: 'ABC123', 'RO Number': '0007' },
    { 'Appointment Number': '3', VIN: 'MISSING', 'RO Number': 'missing' }]));
  assert.equal(vehicleReads, 1);
  assert.equal(orderReads, 1);
  assert.equal(h.Model.rows[0].vehicle_id, 'car');
  assert.equal(h.Model.rows[0].repair_order_id, 'ro');
  assert.equal(h.Model.rows[2].vin, 'MISSING');
  assert.equal(h.Model.rows[2].ro_number, 'missing');
  assert.equal(h.Model.rows[2].vehicle_id, null);
  assert.equal(h.Model.rows[2].repair_order_id, null);
  assert.ok(h.BatchModel.rows[0].row_outcomes[2].warnings.includes('VEHICLE_NOT_FOUND'));
  assert.ok(h.BatchModel.rows[0].row_outcomes[2].warnings.includes('SV_APPT_RO_UNRESOLVED'));
});

test('RO and VIN at another dealer never link and never create replacement inventory or repair history', async () => {
  const h = harness({ VehicleModel: vehicles([{ _id: 'other-car', dealerId: 'dealer-b', vin: 'ABC123' }]),
    RepairOrderModel: orders([{ _id: 'other-ro', dealer_id: 'dealer-b', ro_number: '007' }]) });
  await h.process(job([{ 'Appointment Number': '1', VIN: 'ABC123', 'RO Number': '007' }]));
  assert.equal(h.Model.rows[0].vehicle_id, null);
  assert.equal(h.Model.rows[0].repair_order_id, null);
  assert.equal(h.BatchModel.rows[0].failed_count, 0);
});

test('absent/blank RO is legitimate; ambiguous RO matches warn without guessing', async () => {
  const absent = entry({});
  const blank = entry({ 'RO Number': ' ' });
  const ambiguous = entry({ 'RO Number': '007' });
  await resolveRepairOrders([absent, blank, ambiguous], context(), orders([
    { _id: 'one', dealer_id: 'dealer-a', ro_number: '007' }, { _id: 'two', dealer_id: 'dealer-a', ro_number: '007' },
  ]));
  assert.equal(Object.hasOwn(absent.document, 'repair_order_id'), false);
  assert.equal(blank.document.ro_number, '');
  assert.equal(blank.document.repair_order_id, null);
  assert.deepEqual(blank.warnings, []);
  assert.equal(ambiguous.document.repair_order_id, null);
  assert.deepEqual(ambiguous.warnings, ['SV_APPT_RO_AMBIGUOUS']);
});

test('older appointment exports cannot overwrite newer state and same key is independent across dealers', async () => {
  const h = harness();
  await h.process(job([{ 'Appointment Number': '001', 'Appointment Date': '9/10/2026', Comment: 'new' }]));
  const older = await h.process(job([{ 'Appointment Number': '001', Comment: 'old' }], '20260907_1200'));
  assert.equal(older.unchanged, 1);
  assert.equal(h.Model.rows[0].Comment, 'new');
  assert.equal(h.Model.rows[0].appointment_date, '9/10/2026');
  const other = harness({ Model: h.Model, dealerResolver: async () => 'dealer-b' });
  await other.process(job());
  assert.equal(h.Model.rows.length, 2);
  assert.deepEqual(h.Model.rows.map(row => row.dealer_id), ['dealer-a', 'dealer-b']);
});

test('partial rows preserve absent identifiers and links; explicit unresolved RO clears an obsolete link', async () => {
  const h = harness({ VehicleModel: vehicles([{ _id: 'car', dealerId: 'dealer-a', vin: 'ABC123' }]),
    RepairOrderModel: orders([{ _id: 'ro', dealer_id: 'dealer-a', ro_number: '007' }]) });
  await h.process(job([{ 'Appointment Number': '001', 'RO Number': '007', VIN: 'ABC123', 'Customer Number': '009', 'Appointment Date': '9/10/2026' }]));
  const original = structuredClone(h.Model.rows[0]);
  await h.process(job([{ 'Appointment Number': '001', Comment: 'changed' }], '20260909_1200'));
  for (const field of ['ro_number', 'customer_number', 'vin', 'appointment_date', 'customer_id', 'vehicle_id', 'repair_order_id']) {
    assert.deepEqual(h.Model.rows[0][field], original[field]);
  }
  assert.deepEqual(h.BatchModel.rows[1].row_outcomes[0].warnings, []);
  await h.process(job([{ 'Appointment Number': '001', 'RO Number': 'missing' }], '20260910_1200'));
  assert.equal(h.Model.rows[0].ro_number, 'missing');
  assert.equal(h.Model.rows[0].repair_order_id, null);
});

test('completed staging reuses counts and raw data; changed digest never overwrites original appointment data', async () => {
  const h = harness();
  const payload = job([{ 'Appointment Number': '001', unknown: 'raw only' }, {}]);
  await h.process(payload);
  const original = structuredClone(h.BatchModel.rows[0]);
  assert.equal((await h.process(payload)).reused, true);
  assert.deepEqual(h.BatchModel.rows[0], original);
  assert.equal(h.Model.rows.length, 1);
  await assert.rejects(h.process(job([{ 'Appointment Number': 'different' }])), { message: 'BATCH_CONTENT_CONFLICT' });
  assert.deepEqual(JSON.parse(h.BatchModel.rows[0].raw_records_json), payload.data.records);
  assert.equal(h.Model.rows[0].unknown, undefined);
});

test('transient Customer, Vehicle, RO and appointment database failures retry original staging safely', async () => {
  for (const phase of ['customer', 'vehicle', 'ro', 'bulk']) {
    const h = harness();
    const target = { customer: h.CustomerModel, vehicle: h.VehicleModel, ro: h.RepairOrderModel, bulk: h.Model }[phase];
    const method = phase === 'bulk' ? 'bulkWrite' : 'find';
    const original = target[method];
    let calls = 0;
    target[method] = (...args) => { if (++calls === 1) throw new Error('private source data'); return original.apply(target, args); };
    const payload = job([{ 'Appointment Number': '001', 'Customer Number': '007', VIN: 'ABC123', 'RO Number': '009' }]);
    const error = await h.process(payload).catch(error => error);
    assert.equal(error.message, phase === 'bulk' ? 'UPSERT_FAILURE' : 'DATABASE_FAILURE');
    assert.equal(error instanceof UnrecoverableError, false);
    assert.equal(h.BatchModel.rows[0].status, 'failed');
    assert.equal((await h.process(payload)).reused, false);
    assert.equal(h.Model.rows.length, 1);
    assert.equal(h.CustomerModel.rows.length, 1);
    assert.equal(h.BatchModel.rows[0].processed_count, 1);
  }
});

test('sensitive data never reaches logs or failure reasons including invalid optional dates and concerns', async t => {
  const messages = [];
  t.mock.method(console, 'info', message => messages.push(message));
  const privateValue = 'PRIVATE_NAME_PHONE_VIN_CONCERN_ESTIMATE';
  const h = harness({ log: logEvent });
  await h.process(job([{ 'Appointment Number': privateValue, 'Full Name': privateValue, Complaint: privateValue,
    Comment: privateValue, 'Estimate Amount': privateValue, 'Appointment Date': privateValue, VIN: privateValue }, {}]));
  h.Model.bulkWrite = async () => { throw new Error(privateValue); };
  await assert.rejects(h.process(job([{ 'Appointment Number': 'retry', 'Email 1': privateValue }], '20260909_1200')), { message: 'UPSERT_FAILURE' });
  assert.equal(messages.join('').includes(privateValue), false);
  assert.ok(messages.some(message => JSON.parse(message).code === 'SV_APPT_INVALID_DATE'));
  assert.ok(messages.some(message => JSON.parse(message).row_index === 1));
  assert.equal(h.BatchModel.rows[1].error_code, 'UPSERT_FAILURE');
});

test('appointment queue uses shared limits/retries, independent concurrency and existing unique protection', async () => {
  assert.equal(SERVICE_APPOINTMENTS_QUEUE, 'dealervault-service-appointments');
  assert.equal(defaultJobOptions().attempts, 3);
  assert.equal(getConcurrency(5, 'DEALERVAULT_SV_APPT_CONCURRENCY'), 5);
  assert.throws(() => getConcurrency('0', 'DEALERVAULT_SV_APPT_CONCURRENCY'), /DEALERVAULT_SV_APPT_CONCURRENCY/);
  assert.ok(ServiceAppointment.schema.indexes().some(([key, options]) => key.dealer_id === 1 && key.appointment_number === 1 && options.unique));
  assert.ok(requiredIndexes.some(spec => spec.collection === ServiceAppointment.collection.name && spec.key.appointment_number === 1));
  for (const change of [{ fileType: 'SV' }, { dvDealerId: 'other' }, { batchId: -1 }, { batchId: 0.5 }, { records: [] },
    { records: Array(101).fill({}) }, { records: [{ value: 'é'.repeat(250001) }] }]) {
    assert.throws(() => validateJob({ ...job().data, ...change }, 'SV_APPT'), UnrecoverableError);
  }
  const h = harness();
  h.Model.collection.listIndexes = () => ({ toArray: async () => [] });
  await assert.rejects(h.process(job()), { message: 'INDEX_REQUIRED' });
  assert.equal(h.CustomerModel.calls.length, 0);
});

const mongoUri = process.env.DEALERVAULT_TEST_MONGO_URI;
test('Mongo integration: appointment uniqueness, concurrent customer mappings, source order and read-only RO links', {
  skip: !mongoUri && 'Set DEALERVAULT_TEST_MONGO_URI to a disposable localhost Mongo server',
}, async t => {
  const parsed = new URL(mongoUri);
  assert.equal(parsed.protocol, 'mongodb:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname));
  const dbName = `dealervault_test_appointments_${process.pid}_${Date.now()}`;
  const connection = mongoose.createConnection(mongoUri, { dbName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  t.after(async () => {
    if (connection.readyState === 1) { assert.equal(connection.name, dbName); await connection.dropDatabase(); }
    await connection.close();
  });
  await connection.asPromise();
  const Model = connection.model('ServiceAppointment', ServiceAppointment.schema.clone());
  const CustomerModel = connection.model('Customer', Customer.schema.clone());
  const VehicleModel = connection.model('Vehicle', Vehicle.schema.clone());
  const RepairOrderModel = connection.model('RepairOrder', RepairOrder.schema.clone());
  const BatchModel = connection.model('DealerVaultImportBatch', Batch.schema.clone());
  await Promise.all([Model.createIndexes(), CustomerModel.createIndexes(), VehicleModel.createIndexes(), RepairOrderModel.createIndexes(), BatchModel.createIndexes()]);
  const vehicle = await VehicleModel.create({ dealerId: 'dealer-a', vin: 'ABC123', price: 42 });
  const ro = await RepairOrderModel.create({ dealer_id: 'dealer-a', ro_number: '009', Comment: 'keep' });
  const originalVehicle = await VehicleModel.findOne({ dealerId: 'dealer-a', _id: vehicle._id }).lean();
  const originalRo = await RepairOrderModel.findOne({ dealer_id: 'dealer-a', _id: ro._id }).lean();
  const h = harness({ Model, CustomerModel, VehicleModel, RepairOrderModel, BatchModel });
  const payload = job([{ 'Appointment Number': '0001', 'Customer Number': '007', 'RO Number': '009', VIN: ' abc123 ',
    'Appointment Date': '9/10/2026', 'Appointment Time': '08:30', Comment: 'new', unknown: 'raw only' }]);
  await Promise.all([h.process(payload), h.process(payload)]);
  assert.equal(await Model.countDocuments({ dealer_id: 'dealer-a' }), 1);
  assert.equal(await CustomerModel.countDocuments({ dealer_id: 'dealer-a' }), 1);
  assert.equal(await BatchModel.countDocuments({ dealer_id: 'dealer-a' }), 1);
  const current = await Model.findOne({ dealer_id: 'dealer-a', appointment_number: '0001' }).lean();
  assert.ok(current.customer_id instanceof mongoose.Types.ObjectId);
  assert.equal(String(current.vehicle_id), String(vehicle._id));
  assert.equal(String(current.repair_order_id), String(ro._id));
  assert.equal(current.appointment_date, '9/10/2026');
  assert.equal(current.appointment_time, '08:30');
  assert.equal(current.unknown, undefined);
  const older = await h.process(job([{ 'Appointment Number': '0001', Comment: 'old' }], '20260907_1200'));
  assert.equal(older.unchanged, 1);
  const unchanged = await Model.findOne({ dealer_id: 'dealer-a', appointment_number: '0001' }).lean();
  assert.equal(unchanged.Comment, 'new');
  assert.deepEqual(unchanged.updatedAt, current.updatedAt);
  assert.equal((await h.process(payload)).reused, true);
  const other = harness({ Model, CustomerModel, VehicleModel, RepairOrderModel, BatchModel, dealerResolver: async () => 'dealer-b' });
  await other.process(payload);
  assert.equal(await Model.countDocuments({ appointment_number: '0001' }), 2);
  assert.equal(await CustomerModel.countDocuments({ 'extra.dealervault.customer_numbers': '007' }), 2);
  const otherAppointment = await Model.findOne({ dealer_id: 'dealer-b', appointment_number: '0001' }).lean();
  assert.equal(otherAppointment.repair_order_id, null);
  assert.equal(otherAppointment.vehicle_id, null);
  assert.equal(await RepairOrderModel.countDocuments({ dealer_id: 'dealer-b' }), 0);
  assert.equal(await VehicleModel.countDocuments({ dealerId: 'dealer-b' }), 0);
  assert.deepEqual(await VehicleModel.findOne({ dealerId: 'dealer-a', _id: vehicle._id }).lean(), originalVehicle);
  assert.deepEqual(await RepairOrderModel.findOne({ dealer_id: 'dealer-a', _id: ro._id }).lean(), originalRo);
});

const redisPort = process.env.DEALERVAULT_TEST_REDIS_PORT;
test('Redis integration: appointment redelivery reuses staging and counts (memory database)', {
  skip: !redisPort && 'Set DEALERVAULT_TEST_REDIS_PORT to a disposable localhost Redis server',
}, async () => {
  const h = harness();
  const redis = { host: '127.0.0.1', port: Number(redisPort), maxRetriesPerRequest: null };
  const queueName = `dealervault-appointments-test-${process.pid}-${Date.now()}`;
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
    const queued = await queue.add('SV_APPT', job([{ 'Appointment Number': '001', 'Customer Number': '007' }]).data,
      { backoff: { type: 'fixed', delay: 10 } });
    assert.equal((await queued.waitUntilFinished(events, 15000)).reused, true);
    assert.equal(attempts, 2);
    assert.equal(h.Model.rows.length, 1);
    assert.equal(h.CustomerModel.rows.length, 1);
    assert.equal(h.BatchModel.rows[0].processed_count, 1);
  } finally {
    await worker.close();
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
