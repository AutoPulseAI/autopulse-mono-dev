import { processAllPendingReminders } from './appointmentReminderService.js';

class ReminderCronService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.lastProcessed = null;
  }

  /**
   * Start the reminder cron service
   * @param {number} intervalMinutes - How often to check for reminders (default: 5 minutes)
   */
  start(intervalMinutes = 5) {
    if (this.isRunning) {
      console.log('🔄 Reminder cron service is already running');
      return;
    }

    console.log(`🚀 Starting reminder cron service (checking every ${intervalMinutes} minutes)`);
    this.isRunning = true;

    // Run immediately
    this.processReminders();

    // Then run at intervals
    this.intervalId = setInterval(() => {
      this.processReminders();
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stop the reminder cron service
   */
  stop() {
    if (!this.isRunning) {
      console.log('🛑 Reminder cron service is not running');
      return;
    }

    console.log('🛑 Stopping reminder cron service');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Process reminders manually
   */
  async processReminders() {
    try {
      console.log('🔄 Processing appointment reminders...');
      const result = await processAllPendingReminders();
      this.lastProcessed = new Date();
      
      if (result.processed > 0) {
        console.log(`✅ Processed ${result.processed} reminders: ${result.success} success, ${result.failed} failed`);
      }
      
      return result;
    } catch (error) {
      console.error('❌ Error processing reminders:', error);
      return { processed: 0, success: 0, failed: 0, error: error.message };
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastProcessed: this.lastProcessed,
      nextCheck: this.isRunning && this.lastProcessed ? 
        new Date(this.lastProcessed.getTime() + 5 * 60 * 1000) : null
    };
  }
}

// Create singleton instance
const reminderCronService = new ReminderCronService();

export default reminderCronService;
