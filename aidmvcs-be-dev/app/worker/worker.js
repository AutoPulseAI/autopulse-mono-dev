import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { processEmail } from './emailWorker.js';
import { processSMS } from './processSms.js';
import { processLead } from './leadworker.js';
import { setupCampaignWorker } from './campaignWorker.js';
import { setupDealerVaultWorkers } from './dealervault/index.js';
import { setupDealerVaultSqsConsumer } from './dealervault/sqsConsumer.js';
import { setupAdfTradeWorker } from './adfTradeWorker.js';
import { AI_EVENT_RETRY_QUEUE, postAiEvent, processAiEventRetryJob } from '../lib/ai/aiEvents.js';
import { AI_OUTBOX_REPLAY_EVERY_MS, noteForStaff, replayAiOutbox } from '../lib/ai/aiOutbox.js';
import { getDealerAiMode } from '../lib/ai/aiMode.js';
import dbConnect from '../lib/mongodb.js';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  db: Number(process.env.REDIS_DB || 0),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    console.log(`Redis connection retry attempt ${times}, waiting ${delay}ms...`);
    return delay;
  },
  enableReadyCheck: true,
  enableOfflineQueue: false, // Don't queue commands when offline
});

// Handle Redis connection errors
redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
  console.error('⚠️  Make sure Redis is running and accessible');
});

redis.on('connect', () => {
  console.log('✅ Redis connected successfully');
});

redis.on('ready', () => {
  console.log('✅ Redis ready to accept commands');
});

redis.on('close', () => {
  console.warn('⚠️  Redis connection closed');
});

// Create workers for all queues
const emailWorker = new Worker('emailQueue', processEmail, { connection: redis });
const smsWorker = new Worker('communicationQueue', processSMS, { connection: redis });
const leadWorker = new Worker('leadProcessingQueue', processLead, { connection: redis });
// `make crm-live-db`: on the live database, campaigns and the DealerVault import stay with the live servers.
const onLiveDb = ['1', 'true', 'yes'].includes(String(process.env.CRM_LIVE_DB || '').toLowerCase());
const campaignWorker = onLiveDb ? null : setupCampaignWorker(redis);
if (!onLiveDb) {
  setupDealerVaultWorkers(redis);
  setupDealerVaultSqsConsumer(redis);
} else {
  console.log('CRM_LIVE_DB: campaign and DealerVault workers are off (the live servers run them).');
}
setupAdfTradeWorker(redis);
// Re-delivers AI-service events that failed on the first try (app/lib/ai/aiEvents.js).
const aiEventRetryWorker = new Worker(AI_EVENT_RETRY_QUEUE, processAiEventRetryJob, { connection: redis });
// PLAN_4 stream X3 item 6: events stored after every retry failed (ai_event_outbox) are replayed once the AI
// service answers again; a day-old one goes to staff as a note instead (the customer is not answered days late).
setInterval(async () => {
  try {
    await dbConnect();
    await replayAiOutbox({
      post: postAiEvent,
      skip: async (row) => (await getDealerAiMode(row.dealer_id)) === 'off',
      onExpired: (row) => noteForStaff({ type: row.type, leadId: row.lead_id, dealerId: row.dealer_id,
        reason: 'the AI service could not be reached for a day' }),
    });
  } catch (error) {
    console.error('[ai] outbox replay failed', error?.message);
  }
}, AI_OUTBOX_REPLAY_EVERY_MS).unref?.();

// Shared event listeners (optional)
const setupWorkerEvents = (worker, queueName) => {
  worker.on('completed', (job) => {
    console.log(`[${queueName}] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[${queueName}] Job ${job.id} failed:`, err);
  });
};

// Attach listeners to all workers
setupWorkerEvents(emailWorker, 'emailQueue');
setupWorkerEvents(smsWorker, 'communicationQueue');
setupWorkerEvents(leadWorker, 'leadProcessingQueue');
setupWorkerEvents(aiEventRetryWorker, AI_EVENT_RETRY_QUEUE);
console.log('Workers started for: emailQueue, communicationQueue, leadProcessingQueue & campaignProcessingQueue');
