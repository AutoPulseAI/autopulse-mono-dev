import { Worker } from 'bullmq';
import ServiceAppointment from '../../models/ServiceAppointment.js';
import { createBatchProcessor } from './common/batchProcessor.js';
import { getConcurrency, isRecord } from './common/validation.js';
import { permanentError, logEvent } from './common/logger.js';
import { SV_APPT_FIELDS } from './common/appointmentFields.js';
import { resolveCustomers } from './common/customerResolver.js';
import { normalizeVin, resolveVehicles } from './common/vehicleResolver.js';
import { resolveRepairOrders } from './common/repairOrderResolver.js';
import { requireUniqueIndex } from './common/indexProtection.js';
import { SERVICE_APPOINTMENTS_QUEUE } from './queues.js';

const dateFields = ['Appointment Date', 'Appointment Create Date', 'Last RO Date', 'Promise Date',
  'Delivery Date', 'In Service Date', 'Birth Date', 'Customer Create Date', 'Customer Last Activity Date'];
const operationFields = ['Operation Code', 'Operation Code Description',
  'Recommended Operation Code', 'Recommended Operation Code Description'];

// Validate the reference's M/D/YYYY convention without changing stored strings,
// interpreting timezones, or relying on JavaScript's permissive date rollover.
export function validSourceDate(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return true;
  if (typeof value !== 'string') return false;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return false;
  const [, month, day, year] = match.map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

export function normalizeServiceAppointment(row, context, rowIndex) {
  if (!isRecord(row)) throw permanentError('SV_APPT_INVALID_SOURCE_FIELD');
  if (typeof row['Appointment Number'] !== 'string' || !row['Appointment Number'].trim()) {
    throw permanentError('SV_APPT_MISSING_APPOINTMENT_NUMBER');
  }
  for (const [header, expected] of [['File Type', 'SV_APPT'], ['DV Dealer ID', context.dvDealerId], ['Vendor Dealer ID', context.dvDealerId]]) {
    if (Object.hasOwn(row, header) && row[header] !== expected) throw permanentError('ROW_SOURCE_MISMATCH');
  }
  const source = {};
  for (const field of SV_APPT_FIELDS) {
    if (!Object.hasOwn(row, field)) continue;
    if (row[field] !== null && typeof row[field] !== 'string') throw permanentError('SV_APPT_INVALID_SOURCE_FIELD');
    source[field] = row[field];
  }
  const warnings = [];
  if (dateFields.some(field => !validSourceDate(source[field]))) warnings.push('SV_APPT_INVALID_DATE');
  if (operationFields.some(field => /[|^]/.test(source[field] ?? ''))) warnings.push('SV_APPT_OPERATION_DELIMITERS');
  const key = { dealer_id: context.dealer_id, appointment_number: row['Appointment Number'].trim() };
  const identifiers = {};
  for (const [header, field] of [['RO Number', 'ro_number'], ['Customer Number', 'customer_number']]) {
    if (Object.hasOwn(source, header)) identifiers[field] = source[header]?.trim() ?? null;
  }
  return { key, rowIndex, warnings, document: {
    ...source, ...key, ...identifiers,
    ...(Object.hasOwn(source, 'VIN') ? { vin: normalizeVin(source.VIN) } : {}),
    ...(Object.hasOwn(source, 'Appointment Date') ? { appointment_date: source['Appointment Date'] } : {}),
    ...(Object.hasOwn(source, 'Appointment Time') ? { appointment_time: source['Appointment Time'] } : {}),
    source_file_timestamp: context.source_file_timestamp,
    source_batch_id: context.batchId, source_row_index: rowIndex,
    source_import: { provider: 'dealervault', fileName: context.fileName, fileType: 'SV_APPT', dvDealerId: context.dvDealerId },
  } };
}

export function createServiceAppointmentProcessor({ CustomerModel, VehicleModel, RepairOrderModel, Model = ServiceAppointment, ...dependencies } = {}) {
  return createBatchProcessor({
    fileType: 'SV_APPT', Model, normalize: normalizeServiceAppointment,
    reconcile: async (entries, context) => {
      await requireUniqueIndex(Model, { key: { dealer_id: 1, appointment_number: 1 }, options: { unique: true } });
      await resolveCustomers(entries, context, CustomerModel);
      await resolveVehicles(entries, context, VehicleModel);
      await resolveRepairOrders(entries, context, RepairOrderModel);
      for (const { document } of entries) {
        // As with SV, partial rows must not clear links when their source inputs
        // are wholly absent. Explicit unresolved identities still clear old links.
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

export function setupServiceAppointmentWorker(redis) {
  const worker = new Worker(SERVICE_APPOINTMENTS_QUEUE, createServiceAppointmentProcessor(), {
    connection: redis,
    concurrency: getConcurrency(process.env.DEALERVAULT_SV_APPT_CONCURRENCY ?? 5, 'DEALERVAULT_SV_APPT_CONCURRENCY'),
  });
  worker.on('error', () => logEvent('worker_error', { fileType: 'SV_APPT' }, { code: 'DATABASE_FAILURE' }));
  worker.on('failed', () => logEvent('job_failed', { fileType: 'SV_APPT' }));
  return worker;
}
