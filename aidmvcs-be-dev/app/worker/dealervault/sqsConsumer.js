import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { TextDecoder } from 'node:util';

import AWS from 'aws-sdk';
import { Queue } from 'bullmq';
import csv from 'csv-parser';

import { MAX_JOB_BYTES, MAX_RECORDS } from './common/validation.js';
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

async function processMessage({ message, expectedBucket, s3, sqs, queueByFileType }) {
  const body = parseMessage(message, expectedBucket);
  const metadata = parseFileName(body.key);
  const object = await s3.getObject({ Bucket: body.bucket, Key: body.key }).promise();
  const records = await parseRecords(objectBodyToUtf8(object.Body), metadata.fileType);
  const batches = splitIntoBatches(records, metadata);
  const queue = queueByFileType[metadata.fileType];

  for (const jobData of batches) {
    await queue.add(metadata.fileType, jobData, {
      jobId: jobIdForBatch(jobData),
    });
  }

  await sqs
    .deleteMessage({
      QueueUrl: process.env.DEALERVAULT_SQS_QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle,
    })
    .promise();

  log('info', 'dealervault_sqs_message_processed', {
    fileName: metadata.fileName,
    fileType: metadata.fileType,
    records: records.length,
    batches: batches.length,
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
  const sqs = new AWS.SQS({ region });
  const s3 = new AWS.S3({ region });
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
