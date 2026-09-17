// lib/queue.js
// Dynamic imports to avoid Next.js module resolution issues
import Redis from 'ioredis';
import { TRADE_QUEUE } from './adfTradeEnrichment.js';
import { PARTS_QUEUE, SALES_QUEUE, SERVICE_QUEUE, SERVICE_APPOINTMENTS_QUEUE, defaultJobOptions } from '../worker/dealervault/queues.js';

// Redis configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

// Use REDIS_URL if provided
if (process.env.REDIS_URL) {
  redisConfig.url = process.env.REDIS_URL;
}

// Queue factory function
async function createQueue(queueName) {
  try {
    const { Queue } = await import('bullmq');
    return new Queue(queueName, {
      connection: queueName === TRADE_QUEUE
        ? { ...redisConfig, maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 1000 }
        : redisConfig,
      ...([PARTS_QUEUE, SALES_QUEUE, SERVICE_QUEUE, SERVICE_APPOINTMENTS_QUEUE].includes(queueName) ? { defaultJobOptions: defaultJobOptions() } : {}),
    });
  } catch (error) {
    console.error(`Error creating queue ${queueName}:`, error);
    throw new Error(`Failed to create queue ${queueName}: ${error.message}`);
  }
}

// Lazy initialization of queues
let emailQueue = null;
let adfTradeQueue = null;
let communicationQueue = null;
let leadProcessingQueue = null;
let campaignProcessingQueue = null;
let dealerVaultPartsQueue = null;
let dealerVaultSalesQueue = null;
let dealerVaultServiceQueue = null;
let dealerVaultServiceAppointmentsQueue = null;
let redis = null;

// Initialize Redis connection
function getRedisConnection() {
  // Ensure we're in a server-side context
  if (typeof window !== 'undefined') {
    throw new Error('Redis operations are only available on the server side');
  }
  
  if (!redis) {
    redis = new Redis(redisConfig);
  }
  return redis;
}

// Initialize a specific queue
export async function getQueue(queueName) {
  // Ensure we're in a server-side context
  if (typeof window !== 'undefined') {
    throw new Error('Queue operations are only available on the server side');
  }
  
  try {
    switch (queueName) {
      case TRADE_QUEUE:
        if (!adfTradeQueue) adfTradeQueue = await createQueue(TRADE_QUEUE);
        return adfTradeQueue;
      case SERVICE_APPOINTMENTS_QUEUE:
        if (!dealerVaultServiceAppointmentsQueue) dealerVaultServiceAppointmentsQueue = await createQueue(SERVICE_APPOINTMENTS_QUEUE);
        return dealerVaultServiceAppointmentsQueue;
      case SERVICE_QUEUE:
        if (!dealerVaultServiceQueue) dealerVaultServiceQueue = await createQueue(SERVICE_QUEUE);
        return dealerVaultServiceQueue;
      case SALES_QUEUE:
        if (!dealerVaultSalesQueue) dealerVaultSalesQueue = await createQueue(SALES_QUEUE);
        return dealerVaultSalesQueue;
      case PARTS_QUEUE:
        if (!dealerVaultPartsQueue) dealerVaultPartsQueue = await createQueue(PARTS_QUEUE);
        return dealerVaultPartsQueue;
      case 'emailQueue':
        if (!emailQueue) {
          emailQueue = await createQueue('emailQueue');
        }
        return emailQueue;
      case 'communicationQueue':
        if (!communicationQueue) {
          communicationQueue = await createQueue('communicationQueue');
        }
        return communicationQueue;
      case 'leadProcessingQueue':
        if (!leadProcessingQueue) {
          leadProcessingQueue = await createQueue('leadProcessingQueue');
        }
        return leadProcessingQueue;
      case 'campaignProcessingQueue':
        if (!campaignProcessingQueue) {
          campaignProcessingQueue = await createQueue('campaignProcessingQueue');
        }
        return campaignProcessingQueue;
      default:
        throw new Error(`Unknown queue: ${queueName}`);
    }
  } catch (error) {
    console.error(`Error initializing queue ${queueName}:`, error);
    throw new Error(`Failed to initialize queue ${queueName}: ${error.message}`);
  }
}

// Get all queues
async function getAllQueues() {
  return await Promise.all([
    getQueue('emailQueue'),
    getQueue('communicationQueue'),
    getQueue('leadProcessingQueue'),
    getQueue('campaignProcessingQueue')
  ]);
}

// Function to clear all Redis queues
export async function clearAllQueues() {
  try {
    console.log('🧹 Starting Redis queue cleanup...');
    
    const queues = await getAllQueues();
    const results = {};
    
    for (const queue of queues) {
      try {
        const queueName = queue.name;
        console.log(`📋 Clearing queue: ${queueName}`);
        
        // Get queue info before clearing
        const jobCounts = await queue.getJobCounts();
        console.log(`  Before: ${JSON.stringify(jobCounts)}`);
        
        // Clear all jobs from the queue
        await queue.empty();
        
        // Verify queue is empty
        const afterCounts = await queue.getJobCounts();
        console.log(`  After: ${JSON.stringify(afterCounts)}`);
        
        results[queueName] = {
          before: jobCounts,
          after: afterCounts,
          success: true
        };
        
        console.log(`✅ Successfully cleared ${queueName}`);
      } catch (error) {
        console.error(`❌ Error clearing queue ${queue.name}:`, error);
        results[queue.name] = {
          error: error.message,
          success: false
        };
      }
    }
    
    console.log('🧹 Redis queue cleanup completed');
    return results;
    
  } catch (error) {
    console.error('❌ Error in clearAllQueues:', error);
    throw error;
  }
}

// Function to clear a specific queue
export async function clearQueue(queueName) {
  try {
    let targetQueue;
    
    switch (queueName.toLowerCase()) {
      case 'email':
        targetQueue = await getQueue('emailQueue');
        break;
      case 'communication':
      case 'sms':
        targetQueue = await getQueue('communicationQueue');
        break;
      case 'lead':
      case 'leadprocessing':
        targetQueue = await getQueue('leadProcessingQueue');
        break;
      case 'campaign':
      case 'campaignprocessing':
        targetQueue = await getQueue('campaignProcessingQueue');
        break;
      default:
        throw new Error(`Unknown queue: ${queueName}`);
    }
    
    console.log(`🧹 Clearing specific queue: ${targetQueue.name}`);
    
    // Get queue info before clearing
    const jobCounts = await targetQueue.getJobCounts();
    console.log(`  Before: ${JSON.stringify(jobCounts)}`);
    
    // Clear all jobs from the queue
    await targetQueue.empty();
    
    // Verify queue is empty
    const afterCounts = await targetQueue.getJobCounts();
    console.log(`  After: ${JSON.stringify(afterCounts)}`);
    
    const result = {
      queueName: targetQueue.name,
      before: jobCounts,
      after: afterCounts,
      success: true
    };
    
    console.log(`✅ Successfully cleared ${targetQueue.name}`);
    return result;
    
  } catch (error) {
    console.error(`❌ Error clearing queue ${queueName}:`, error);
    throw error;
  }
}

// Function to get queue status
export async function getQueueStatus() {
  try {
    const queues = await getAllQueues();
    const status = {};
    
    for (const queue of queues) {
      try {
        const jobCounts = await queue.getJobCounts();
        status[queue.name] = {
          ...jobCounts,
          total: jobCounts.waiting + jobCounts.active + jobCounts.completed + jobCounts.failed + jobCounts.delayed + jobCounts.paused
        };
      } catch (error) {
        status[queue.name] = {
          error: error.message
        };
      }
    }
    
    return status;
  } catch (error) {
    console.error('❌ Error getting queue status:', error);
    throw error;
  }
}

// Function to pause all queues
export async function pauseAllQueues() {
  try {
    const queues = await getAllQueues();
    
    for (const queue of queues) {
      await queue.pause();
      console.log(`⏸️ Paused queue: ${queue.name}`);
    }
    
    return { success: true, message: 'All queues paused' };
  } catch (error) {
    console.error('❌ Error pausing queues:', error);
    throw error;
  }
}

// Function to resume all queues
export async function resumeAllQueues() {
  try {
    const queues = await getAllQueues();
    
    for (const queue of queues) {
      await queue.resume();
      console.log(`▶️ Resumed queue: ${queue.name}`);
    }
    
    return { success: true, message: 'All queues resumed' };
  } catch (error) {
    console.error('❌ Error resuming queues:', error);
    throw error;
  }
}

// Export queue getters for external use
export async function getEmailQueue() {
  return await getQueue('emailQueue');
}

export async function getCommunicationQueue() {
  return await getQueue('communicationQueue');
}

export async function getLeadProcessingQueue() {
  return await getQueue('leadProcessingQueue');
}

export async function getCampaignProcessingQueue() {
  return await getQueue('campaignProcessingQueue');
}

// Default export for backward compatibility
export default getEmailQueue;
