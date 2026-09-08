import { createHash } from 'node:crypto';
import { permanentError } from './logger.js';

export const MAX_JOB_BYTES = 500000;
export const MAX_RECORDS = 100;

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateJob(data, expectedType) {
  const invalid = () => { throw permanentError('INVALID_JOB'); };
  if (!isRecord(data)) invalid();
  let json;
  try { json = JSON.stringify(data); } catch { invalid(); }
  if (Buffer.byteLength(json, 'utf8') > MAX_JOB_BYTES) invalid();
  const { fileName, fileType, dvDealerId, batchId, records } = data;
  if (fileType !== expectedType || typeof dvDealerId !== 'string'
      || !/^[A-Za-z0-9-]{1,64}$/.test(dvDealerId)
      || !Number.isSafeInteger(batchId) || batchId < 0
      || !Array.isArray(records) || !records.length || records.length > MAX_RECORDS
      || typeof fileName !== 'string') invalid();
  const match = /^([A-Za-z0-9-]{1,64})_(\d{8})_(\d{4})_(PTINV|SL|SV|SV_APPT)\.txt$/.exec(fileName);
  if (!match || match[1] !== dvDealerId || match[4] !== fileType) invalid();
  const stamp = match[2] + match[3];
  const date = new Date(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().replace(/[-:T]/g, '').slice(0, 12) !== stamp) invalid();
  // Use the JSON transport representation as the immutable staging boundary.
  const rawRecords = JSON.parse(json).records;
  return {
    fileName, fileType, dvDealerId, batchId, records: rawRecords,
    source_file_timestamp: stamp,
    digest: createHash('sha256').update(stableJson(rawRecords)).digest('hex'),
  };
}

export function getConcurrency(value = process.env.DEALERVAULT_PTINV_CONCURRENCY, name = 'DEALERVAULT_PTINV_CONCURRENCY') {
  if (value === undefined) return 5;
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`Invalid ${name}; expected a positive integer`);
  }
  return Number(value);
}
