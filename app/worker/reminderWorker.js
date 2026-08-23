import { Worker } from 'bullmq';
import { processAllPendingReminders } from '../lib/appointmentReminderService.js';

// Redis connection configuration
const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

// Create reminder worker
const reminderWorker = new Worker(
  'appointment-reminders',
  async (job) => {
    console.log(`🔄 Processing reminder job ${job.id}: ${job.name}`);
    
    try {
      const result = await processAllPendingReminders();
      
      console.log(`✅ Reminder job ${job.id} completed:`, result);
      
      return {
        success: true,
        result: result,
        processedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Reminder job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection,
    concurrency: 1, // Process one reminder batch at a time
    removeOnComplete: 10, // Keep last 10 completed jobs
    removeOnFail: 5, // Keep last 5 failed jobs
  }
);

// Worker event handlers
reminderWorker.on('completed', (job) => {
  console.log(`✅ Reminder job ${job.id} completed successfully`);
});

reminderWorker.on('failed', (job, err) => {
  console.error(`❌ Reminder job ${job.id} failed:`, err.message);
});

reminderWorker.on('error', (err) => {
  console.error('❌ Reminder worker error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down reminder worker...');
  await reminderWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down reminder worker...');
  await reminderWorker.close();
  process.exit(0);
});

console.log('🚀 Appointment reminder worker started');

export default reminderWorker;
