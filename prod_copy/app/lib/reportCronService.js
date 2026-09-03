import { getScheduledReports, getScheduleStatusSummary, cleanupOrphanedReports, updateLastReportSent } from '@utils/reportScheduler';
import { generateAndSendReport } from '@lib/reportGenerator';

class ReportCronService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.checkInterval = 60000; // Check every minute
  }

  /**
   * Start the cron service
   */
  start() {
    if (this.isRunning) {
      console.log('Report cron service is already running');
      return;
    }

    console.log('Starting report cron service...');
    this.isRunning = true;

    // Run initial check
    this.checkAndProcessReports();

    // Set up interval to check every minute
    this.intervalId = setInterval(() => {
      this.checkAndProcessReports();
    }, this.checkInterval);

    console.log('Report cron service started successfully');
  }

  /**
   * Stop the cron service
   */
  stop() {
    if (!this.isRunning) {
      console.log('Report cron service is not running');
      return;
    }

    console.log('Stopping report cron service...');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('Report cron service stopped successfully');
  }

  /**
   * Check for scheduled reports and process them
   */
  async checkAndProcessReports() {
    try {
      console.log(`[${new Date().toISOString()}] Checking for scheduled reports...`);
      
      const scheduledReports = await getScheduledReports();
      
      if (scheduledReports.length === 0) {
        console.log('No reports scheduled for this time');
        return;
      }

      console.log(`Found ${scheduledReports.length} scheduled reports`);

      // Process each scheduled report
      for (const report of scheduledReports) {
        try {
          const reportType = report.isOverdue ? 'OVERDUE' : 'SCHEDULED';
          console.log(`Processing ${reportType} report for user: ${report.userName} (${report.userEmail})`);
          
          // Generate and send the report
          const success = await generateAndSendReport(report);
          
          if (success) {
            console.log(`${reportType} report sent successfully for user: ${report.userName}`);
            // Note: The report generator now handles updating ReportSchedule status and creating next entries
          } else {
            console.error(`Failed to send ${reportType} report for user: ${report.userName}`);
          }
        } catch (error) {
          console.error(`Error processing ${reportType} report for user ${report.userName}:`, error);
        }
      }

      console.log(`Processed ${scheduledReports.length} reports`);
      
      // Clean up old completed reports (run every 24 hours)
      const now = new Date();
      const lastCleanup = this.lastCleanup || new Date(0);
      const hoursSinceLastCleanup = (now - lastCleanup) / (1000 * 60 * 60);
      
      if (hoursSinceLastCleanup >= 24) {
        console.log('Running cleanup of old completed reports...');
        await cleanupOldReports();
        
        // Also clean up any future-dated reports that were incorrectly created
        console.log('Running cleanup of future-dated reports...');
        await cleanupFutureReports();
        
        // Clean up orphaned reports that reference non-existent users
        console.log('Running cleanup of orphaned reports...');
        await cleanupOrphanedReports();
        
        // Get status summary for monitoring
        console.log('Getting schedule status summary...');
        await getScheduleStatusSummary();
        
        this.lastCleanup = now;
      }
    } catch (error) {
      console.error('Error in checkAndProcessReports:', error);
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkInterval: this.checkInterval,
      lastCheck: this.lastCheck || null
    };
  }

  /**
   * Manually trigger a report check (useful for testing)
   */
  async manualCheck() {
    console.log('Manual report check triggered');
    await this.checkAndProcessReports();
  }

  /**
   * Manually trigger due/overdue report processing
   */
  async processOverdueReports() {
    console.log('Manual due/overdue report processing triggered');
    
    try {
      // Use current time to find reports that are due now or overdue
      const currentTime = new Date();
      console.log(`🔍 Looking for reports that are due now or overdue: ${currentTime.toISOString()}`);
      const overdueReports = await getScheduledReports(currentTime);
      console.log('Due/overdue reports found:', overdueReports.length);
      if (overdueReports.length === 0) {
        console.log('No overdue reports found');
        return;
      }

      console.log(`Found ${overdueReports.length} overdue reports`);

      // Process each overdue report
      for (const report of overdueReports) {
        try {
          console.log(`Processing OVERDUE report for user: ${report.userName} (${report.userEmail})`);
          
          // Generate and send the report
          const success = await generateAndSendReport(report);
          
          if (success) {
            // Update last report sent time
            await updateLastReportSent(report.userId, report.schedule.id);
            console.log(`OVERDUE report sent successfully for user: ${report.userName}`);
          } else {
            console.error(`Failed to send OVERDUE report for user: ${report.userName}`);
          }
        } catch (error) {
          console.error(`Error processing OVERDUE report for user ${report.userName}:`, error);
        }
      }

      console.log(`Processed ${overdueReports.length} overdue reports`);
    } catch (error) {
      console.error('Error in processOverdueReports:', error);
    }
  }
}

// Create singleton instance
const reportCronService = new ReportCronService();

export default reportCronService;
