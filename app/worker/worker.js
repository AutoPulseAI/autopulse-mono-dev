import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { processEmail } from './emailWorker.js';
import { processSMS } from './processSms.js';
import { processLead } from './leadworker.js';
import { setupCampaignWorker } from './campaignWorker.js';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
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
const campaignWorker = setupCampaignWorker(redis);

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
console.log('Workers started for: emailQueue, communicationQueue, leadProcessingQueue & campaignProcessingQueue');