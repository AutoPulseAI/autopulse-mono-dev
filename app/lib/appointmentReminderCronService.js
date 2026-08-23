import dbConnect from './mongodb.js';
import AppointmentReminder from '../models/AppointmentReminder.js';
import moment from 'moment-timezone';

/**
 * Cron service that triggers the /api/cron/appointment-reminder endpoint via HTTP
 * Queries pending reminders and calls the API endpoint for each one
 */
class AppointmentReminderCronService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.lastProcessed = null;
  }

  /**
   * Start the appointment reminder cron service
   * @param {number} intervalMinutes - How often to check for reminders (default: 5 minutes)
   */
  start(intervalMinutes = 5) {
    if (this.isRunning) {
      console.log('🔄 Appointment reminder cron service is already running');
      return;
    }

    console.log(`🚀 Starting appointment reminder cron service (checking every ${intervalMinutes} minutes)`);
    this.isRunning = true;

    // Run immediately
    this.processReminders();

    // Then run at intervals
    this.intervalId = setInterval(() => {
      this.processReminders();
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stop the appointment reminder cron service
   */
  stop() {
    if (!this.isRunning) {
      console.log('🛑 Appointment reminder cron service is not running');
      return;
    }

    console.log('🛑 Stopping appointment reminder cron service');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Get pending reminders that are due to be sent
   * Supports both booking_id and lead_id for all message types
   */
  async getPendingReminders(currentTime = new Date()) {
    try {
      await dbConnect();
      
      const pendingReminders = await AppointmentReminder.find({
        status: 'pending',
        scheduled_for: { $lte: currentTime },
        attempt_count: { $lt: 3 } // Max 3 attempts
      }).populate('dealer_id', 'name email branding_information dealer_account_information');
      
      console.log(`Found ${pendingReminders.length} pending reminders`);
      
      // Log timezone information for debugging
      pendingReminders.forEach(reminder => {
        const dealerTimezone = reminder.dealer_id?.dealer_account_information?.time_zone || 'America/New_York';
        const scheduledMoment = moment(reminder.scheduled_for).tz(dealerTimezone);
        const messageType = reminder.message_type || 'appointment_reminder';
        const identifier = reminder.lead_id ? `lead_id: ${reminder.lead_id}` : `booking_id: ${reminder.booking_id}`;
        console.log(`Reminder ${reminder._id} (${messageType}, ${identifier}): ${scheduledMoment.format()} (${dealerTimezone})`);
      });
      
      return pendingReminders;
      
    } catch (error) {
      console.error('Error getting pending reminders:', error);
      return [];
    }
  }

  /**
   * Process reminders by calling the HTTP endpoint
   */
  async processReminders() {
    try {
      console.log('🔄 Processing appointment reminders via HTTP endpoint...');
      
      const pendingReminders = await this.getPendingReminders();
      
      if (pendingReminders.length === 0) {
        console.log('✅ No pending reminders to process');
        this.lastProcessed = new Date();
        return { processed: 0, success: 0, failed: 0 };
      }
      
      let successCount = 0;
      let failedCount = 0;
      
      // Get base URL from environment or default to localhost
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
                     process.env.APP_URL || 
                     'http://localhost:3000';
      
      for (const reminder of pendingReminders) {
        try {
          // Call the appointment-reminder API endpoint
          const response = await fetch(`${baseUrl}/api/cron/appointment-reminder`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              reminder_id: reminder._id.toString(),
              // message is optional - if not provided, endpoint will generate it
            }),
          });
          
          const result = await response.json();
          
          if (response.ok && result.success) {
            successCount++;
            console.log(`✅ Successfully processed reminder ${reminder._id} (${reminder.message_type || 'appointment_reminder'})`);
          } else {
            failedCount++;
            console.error(`❌ Failed to process reminder ${reminder._id}:`, result.error || result.message);
            
            // Update reminder status on API failure
            try {
              await dbConnect();
              reminder.attempt_count = (reminder.attempt_count || 0) + 1;
              reminder.status = reminder.attempt_count >= 3 ? 'failed' : 'pending';
              reminder.error_message = result.error || result.message || 'API call failed';
              await reminder.save();
            } catch (saveError) {
              console.error(`Error updating reminder ${reminder._id} status:`, saveError.message);
            }
          }
        } catch (error) {
          failedCount++;
          console.error(`❌ Error calling API for reminder ${reminder._id}:`, error.message);
          
          // Update reminder status on API call failure
          try {
            await dbConnect();
            reminder.attempt_count = (reminder.attempt_count || 0) + 1;
            reminder.status = reminder.attempt_count >= 3 ? 'failed' : 'pending';
            reminder.error_message = error.message;
            await reminder.save();
          } catch (saveError) {
            console.error(`Error updating reminder ${reminder._id} status:`, saveError.message);
          }
        }
      }
      
      this.lastProcessed = new Date();
      console.log(`✅ Processed ${pendingReminders.length} reminders: ${successCount} success, ${failedCount} failed`);
      
      return {
        processed: pendingReminders.length,
        success: successCount,
        failed: failedCount
      };
      
    } catch (error) {
      console.error('❌ Error processing reminders:', error);
      this.lastProcessed = new Date();
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
const appointmentReminderCronService = new AppointmentReminderCronService();

export default appointmentReminderCronService;

