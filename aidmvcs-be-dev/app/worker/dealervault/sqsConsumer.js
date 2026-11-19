import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { TextDecoder } from 'node:util';

import AWS from 'aws-sdk';
import { Queue } from 'bullmq';
import csv from 'csv-parser';

import { MAX_JOB_BYTES, MAX_RECORDS } from './common/validation.js';
import dbConnect from '../../lib/mongodb.js';
import HeldFile from '../../models/DealerVaultHeldFile.js';
import User from '../../models/User.js';
import Batch from '../../models/DealerVaultImportBatch.js';
import { checkFeedFile, recentFileSizes } from './feedCheck.js';
import { sendEmail } from '../../lib/email.js';
import {
  PARTS_QUEUE,
  SALES_QUEUE,
  SERVICE_APPOINTMENTS_QUEUE,
  SERVICE_QUEUE,
  defaultJobOptions,
} from './queues.js';

const DEFAULT_AWS_REGION = 'us-east-1';
const FILE_NAME_PATTERN =
  /^([A-Za-z0-9-]{1,64})_(\d{8})_(\d{4})_(PTINV|SL|SV|SV_APPT)\.txt$/;
const RECEIVE_ERROR_DELAY_MS = 1000;
const FEED_SILENT_HOURS = 36; // files arrive once a day

const QUEUE_NAMES_BY_FILE_TYPE = Object.freeze({
  PTINV: PARTS_QUEUE,
  SL: SALES_QUEUE,
  SV: SERVICE_QUEUE,
  SV_APPT: SERVICE_APPOINTMENTS_QUEUE,
});

class IngestionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'IngestionError';
    this.code = code;
  }
}

function log(level, event, details = {}) {
  const output = JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...details,
  });
  const writer = console[level] || console.log;
  writer(output);
}

function sanitizedErrorCode(error) {
  return error instanceof IngestionError ? error.code : 'DEALERVAULT_INGESTION_FAILED';
}

function parseMessage(message, expectedBucket) {
  if (!message?.Body || !message.ReceiptHandle) {
    throw new IngestionError('INVALID_SQS_MESSAGE');
  }

  let body;
  try {
    body = JSON.parse(message.Body);
  } catch {
    throw new IngestionError('INVALID_MESSAGE_BODY');
  }

  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    body.version !== 1 ||
    body.source !== 'dealervault' ||
    body.bucket !== expectedBucket ||
    typeof body.key !== 'string' ||
    !body.key.startsWith('raw/')
  ) {
    throw new IngestionError('INVALID_MESSAGE_BODY');
  }

  return body;
}

function parseFileName(key) {
  const fileName = path.posix.basename(key);
  const match = FILE_NAME_PATTERN.exec(fileName);
  if (!match) {
    throw new IngestionError('INVALID_FILE_NAME');
  }

  const [, dvDealerId, date, time, fileType] = match;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  const parsedDate = new Date(Date.UTC(year, month - 1, day, hour, minute));

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day ||
    parsedDate.getUTCHours() !== hour ||
    parsedDate.getUTCMinutes() !== minute
  ) {
    throw new IngestionError('INVALID_FILE_NAME_TIMESTAMP');
  }

  return { fileName, fileType, dvDealerId };
}

function objectBodyToUtf8(body) {
  let bytes;
  if (Buffer.isBuffer(body)) {
    bytes = body;
  } else if (body instanceof Uint8Array) {
    bytes = Buffer.from(body);
  } else if (typeof body === 'string') {
    bytes = Buffer.from(body, 'utf8');
  } else {
    throw new IngestionError('INVALID_S3_OBJECT_BODY');
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new IngestionError('INVALID_UTF8');
  }
}

function parseRecords(body, fileType) {
  return new Promise((resolve, reject) => {
    const records = [];
    const parser = csv({
      separator: '\t',
      mapHeaders: ({ header, index }) =>
        index === 0 ? header.replace(/^\uFEFF/, '') : header,
    });

    parser.on('data', (row) => {
      row['File Type'] = fileType;
      records.push(row);
    });
    parser.on('error', () => reject(new IngestionError('INVALID_TAB_SEPARATED_FILE')));
    parser.on('end', () => resolve(records));

    Readable.from([body]).pipe(parser);
  });
}

function createJobData(metadata, batchId, records) {
  return {
    fileName: metadata.fileName,
    fileType: metadata.fileType,
    dvDealerId: metadata.dvDealerId,
    batchId,
    records,
  };
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function splitIntoBatches(records, metadata) {
  if (records.length === 0) {
    throw new IngestionError('EMPTY_DEALERVAULT_FILE');
  }

  const batches = [];
  let currentRecords = [];

  for (const record of records) {
    const batchId = batches.length;
    const candidateRecords = [...currentRecords, record];
    const candidate = createJobData(metadata, batchId, candidateRecords);

    if (
      candidateRecords.length <= MAX_RECORDS &&
      serializedBytes(candidate) <= MAX_JOB_BYTES
    ) {
      currentRecords = candidateRecords;
      continue;
    }

    if (currentRecords.length === 0) {
      throw new IngestionError('RECORD_EXCEEDS_MAX_JOB_BYTES');
    }

    batches.push(createJobData(metadata, batchId, currentRecords));
    currentRecords = [record];

    const nextBatch = createJobData(metadata, batches.length, currentRecords);
    if (serializedBytes(nextBatch) > MAX_JOB_BYTES) {
      throw new IngestionError('RECORD_EXCEEDS_MAX_JOB_BYTES');
    }
  }

  if (currentRecords.length > 0) {
    batches.push(createJobData(metadata, batches.length, currentRecords));
  }

  return batches;
}

function jobIdForBatch(jobData) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        jobData.dvDealerId,
        jobData.fileName,
        jobData.fileType,
        jobData.batchId,
      ]),
    )
    .digest('hex');
}

// Reads one feed file from S3 and queues its batches. `force` (a super admin released a held file) skips the check.
export async function importFeedFile({ bucket, key, s3, queueByFileType, force = false }) {
  const metadata = parseFileName(key);
  const object = await s3.getObject({ Bucket: bucket, Key: key }).promise();
  const records = await parseRecords(objectBodyToUtf8(object.Body), metadata.fileType);
  if (!force) {
    // SOW G-087 (17 Nov 2026): a malformed or cut-short file is held, never imported (feedCheck.js).
    let check = { ok: true, reasons: [], expected: null };
    let unlinked = false;
    try {
      await dbConnect({ reportErrors: false });
      // 20 Nov 2026: files of a DealerVault store no AutoPulse dealer is linked to (dv_dealer_id) used to fail row by
      // row ("Store not linked") and were lost from view; now they are held, listed on Admin > DMS feed, and imported
      // once the store is linked there.
      unlinked = !(await User.exists({ type: 'dealer', dv_dealer_id: metadata.dvDealerId }));
      check = unlinked
        ? { ok: false, expected: null, reasons: [`DealerVault store ${metadata.dvDealerId} is not linked to an AutoPulse dealer: `
          + 'link it on Admin > DMS feed > DealerVault stores, then import its files']}
        : checkFeedFile({ fileType: metadata.fileType, records,
          recentSizes: await recentFileSizes(metadata.dvDealerId, metadata.fileType) });
    } catch (error) {
      log('warn', 'dealervault_feed_check_skipped', { fileName: metadata.fileName, code: error?.code || 'CHECK_FAILED' });
    }
    if (!check.ok) {
      // One email a day per unlinked store, not one per file.
      const quiet = unlinked && await HeldFile.exists({ dvDealerId: metadata.dvDealerId, fileName: { $ne: metadata.fileName },
        createdAt: { $gte: new Date(Date.now() - 86400000) } }).catch(() => null);
      await HeldFile.updateOne({ fileName: metadata.fileName }, { $setOnInsert: {
        dvDealerId: metadata.dvDealerId, fileName: metadata.fileName, fileType: metadata.fileType, bucket, key,
        records: records.length, expected: check.expected, reasons: check.reasons, status: 'held' } }, { upsert: true });
      log('warn', 'dealervault_file_held', { fileName: metadata.fileName, reasons: check.reasons });
      const to = process.env.DEALERVAULT_ALERT_EMAIL || process.env.ADMIN_EMAIL;
      if (to && !quiet) {
        await sendEmail(to, `DMS feed file held: ${metadata.fileName}`,
          `The DMS feed file ${metadata.fileName} was not imported: ${check.reasons.join('; ')}.\n\nNothing from it `
          + 'was written. Release or discard it on Admin > DMS feed.').catch(() => null);
      }
      return { held: true, metadata, records: records.length };
    }
  }
  const batches = splitIntoBatches(records, metadata);
  const queue = queueByFileType[metadata.fileType];
  for (const jobData of batches) {
    await queue.add(metadata.fileType, jobData, {
      jobId: jobIdForBatch(jobData),
    });
  }
  return { held: false, metadata, records: records.length, batches: batches.length };
}

async function processMessage({ message, expectedBucket, s3, sqs, queueByFileType }) {
  const body = parseMessage(message, expectedBucket);
  const { metadata, records, batches, held } = await importFeedFile({ bucket: body.bucket, key: body.key, s3,
    queueByFileType });

  await sqs
    .deleteMessage({
      QueueUrl: process.env.DEALERVAULT_SQS_QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle,
    })
    .promise();

  log('info', 'dealervault_sqs_message_processed', {
    fileName: metadata.fileName,
    fileType: metadata.fileType,
    records,
    batches: batches || 0,
    held: Boolean(held),
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function setupDealerVaultSqsConsumer(redis) {
  const queueUrl = process.env.DEALERVAULT_SQS_QUEUE_URL;
  const bucket = process.env.DEALERVAULT_S3_BUCKET;
  if (!queueUrl || !bucket) {
    log('info', 'dealervault_sqs_ingestion_disabled');
    return;
  }

  const region = process.env.AWS_REGION || DEFAULT_AWS_REGION;
  const credentials = new AWS.EC2MetadataCredentials({
  httpOptions: {
    timeout: 5000,
  },
  maxRetries: 3,
});

const sqs = new AWS.SQS({
  region,
  credentials,
});

const s3 = new AWS.S3({
  region,
  credentials,
});
  const queueByFileType = Object.fromEntries(
    Object.entries(QUEUE_NAMES_BY_FILE_TYPE).map(([fileType, queueName]) => {
      const queue = new Queue(queueName, {
        connection: redis,
        defaultJobOptions: defaultJobOptions(),
      });
      queue.on('error', () => {
        log('error', 'dealervault_bullmq_queue_error', { fileType });
      });
      return [fileType, queue];
    }),
  );

  log('info', 'dealervault_sqs_ingestion_started', { region });

  // 20 Nov 2026: Victory Mitsubishi got no DMS file for 9 days and nobody was told. Every hour: a linked store whose
  // newest imported file is older than FEED_SILENT_HOURS gets one alert email a day (who to tell: as for held files).
  const alerted = new Map();
  setInterval(async () => {
    try {
      const to = process.env.DEALERVAULT_ALERT_EMAIL || process.env.ADMIN_EMAIL;
      if (!to) return;
      await dbConnect({ reportErrors: false });
      const stores = await User.find({ type: 'dealer', dv_dealer_id: { $nin: [null, ''] } }).select('name dv_dealer_id').lean();
      for (const store of stores) {
        const last = await Batch.findOne({ dealer_id: String(store._id) }).sort({ createdAt: -1 }).select('createdAt').lean();
        const since = last?.createdAt ? new Date(last.createdAt) : null;
        if (since && Date.now() - since.getTime() < FEED_SILENT_HOURS * 3600000) continue;
        const key = String(store._id);
        if (Date.now() - (alerted.get(key) || 0) < 86400000) continue;
        alerted.set(key, Date.now());
        await sendEmail(to, `No DMS files for ${store.name} since ${since ? since.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'ever'}`,
          `No DealerVault file has been imported for ${store.name} (DealerVault ${store.dv_dealer_id}) `
          + `${since ? `since ${since.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'yet'}.\n\n`
          + 'Check the daily DealerVault copy job (scripts/dealervault/sync.py, which copies the SFTP files to S3) and '
          + 'the store\'s feed with DealerVault. Admin > Integration health and Admin > DMS feed show the details.').catch(() => null);
        log('warn', 'dealervault_feed_silent', { dvDealerId: store.dv_dealer_id, since: since?.toISOString() || null });
      }
    } catch { /* next hour */ }
  }, 3600000).unref?.();

  // Held files a super admin released (Admin > DMS feed): imported here, where S3 and the queues are (SOW G-087).
  setInterval(async () => {
    try {
      await dbConnect({ reportErrors: false });
      // Oldest file first (a store's backlog imported in order); 20 a minute.
      const asked = await HeldFile.find({ status: 'release_requested' }).sort({ fileName: 1 }).limit(20).lean();
      for (const f of asked) {
        const claimed = await HeldFile.updateOne({ _id: f._id, status: 'release_requested' }, { $set: { status: 'releasing' } });
        if (!claimed.modifiedCount) continue;
        try {
          await importFeedFile({ bucket: f.bucket, key: f.key, s3, queueByFileType, force: true });
          await HeldFile.updateOne({ _id: f._id }, { $set: { status: 'released', decided_at: new Date() } });
          log('info', 'dealervault_held_file_released', { fileName: f.fileName });
        } catch (error) {
          await HeldFile.updateOne({ _id: f._id }, { $set: { status: 'release_requested' } });
          log('error', 'dealervault_held_file_release_failed', { fileName: f.fileName, code: sanitizedErrorCode(error) });
        }
      }
    } catch { /* next minute */ }
  }, 60000).unref?.();

  void (async () => {
    while (true) {
      let response;
      try {
        response = await sqs
          .receiveMessage({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 20,
            VisibilityTimeout: 300,
          })
          .promise();
      } catch (error) {
  log('error', 'dealervault_sqs_receive_failed', {
    code: sanitizedErrorCode(error),
    awsCode: typeof error?.code === 'string' ? error.code : undefined,
    statusCode: Number.isInteger(error?.statusCode)
      ? error.statusCode
      : undefined,
    awsMessage: typeof error?.message === 'string'
      ? error.message
      : undefined,
  });
  await delay(RECEIVE_ERROR_DELAY_MS);
  continue;
}

      for (const message of response.Messages || []) {
        try {
          await processMessage({
            message,
            expectedBucket: bucket,
            s3,
            sqs,
            queueByFileType,
          });
        } catch (error) {
          log('error', 'dealervault_sqs_message_failed', {
            code: sanitizedErrorCode(error),
          });
        }
      }
    }
  })().catch(() => {
    log('error', 'dealervault_sqs_consumer_stopped', {
      code: 'DEALERVAULT_INGESTION_FAILED',
    });
  });
}
