import User from '@models/User';
import ReportSchedule from '@models/ReportSchedule';
import dbConnect from '@lib/mongodb';
import cron from 'cron-parser';

/**
 * Get all dealers who have reports scheduled for the current time
 * @param {Date} currentTime - Current time to check against
 * @returns {Array} Array of dealers with scheduled reports
 */
export async function getScheduledReports(currentTime = new Date()) {
  try {
    await dbConnect();
    
    const now = currentTime;

    // OPTIMIZED APPROACH: Query ReportSchedule directly for due jobs
    // This is much more efficient than querying all users first
    const dueReports = await ReportSchedule.find({
      status: 'pending',
      scheduledAt: { $lte: now } // Only get reports that are due or overdue
    }).populate('dealer_id', 'name email report_schedule_settings');
    
    console.log(`📊 Found ${dueReports.length} due/overdue reports`);
    
    const scheduledReports = [];

    for (const report of dueReports) {
      const { schedules } = user.report_schedule_settings;
      
      for (const schedule of schedules) {
        if (!schedule.active) continue;
        
        let shouldRun = false;
        let isOverdue = false;
        
        // Get user's timezone for proper time comparison
        const userTimezone = user.report_schedule_settings?.timezone || 'America/New_York';
        
        // First check if there's a next execution time set
        if (schedule.nextExecution) {
          const nextExecTime = new Date(schedule.nextExecution);
          // CRITICAL FIX: Only run if the scheduled time has actually arrived
          shouldRun = nextExecTime <= now;
          console.log(`⏰ Schedule ${schedule.id} (${schedule.frequency}):`, {
            scheduledFor: nextExecTime.toISOString(),
            currentTime: now.toISOString(),
            shouldRun: shouldRun,
            timeDifference: Math.round((nextExecTime - now) / (1000 * 60 * 60 * 24)) + ' days'
          });
        } else {
          // Fallback to timezone-aware logic for schedules without nextExecution
          if (schedule.frequency === 'daily') {
            // Daily reports run every day at the specified time
            shouldRun = schedule.time <= currentTimeStr;
          } else if (schedule.frequency === 'weekly') {
            // Weekly reports run on the specified day at the specified time
            const scheduleDay = schedule.days[0];
            shouldRun = scheduleDay === currentDay && schedule.time <= currentTimeStr;
          } else if (schedule.frequency === 'monthly') {
            // Monthly reports run on the specified date at the specified time
            const scheduleDate = parseInt(schedule.days[0]);
            const currentDate = now.getDate();
            shouldRun = scheduleDate <= currentDate && schedule.time <= currentTimeStr;
          } else if (schedule.frequency === 'yearly') {
            // Yearly reports run on the specified month and date at the specified time
            const scheduleMonth = schedule.days[0];
            const scheduleDate = parseInt(schedule.days[1]);
            const currentMonth = now.toLocaleDateString('en-US', { month: 'long' }).toLowerCase();
            const currentDate = now.getDate();
            shouldRun = scheduleMonth === currentMonth && scheduleDate <= currentDate && schedule.time <= currentTimeStr;
          }
        }
        
        // Check if this schedule is overdue (should have run in the past)
        if (!shouldRun) {
          const lastRunTime = schedule.lastReportSent ? new Date(schedule.lastReportSent) : null;
          const nextRunTime = calculateNextExecutionTime(schedule, lastRunTime || new Date(0), userTimezone);
          
          if (nextRunTime && nextRunTime < now) {
            isOverdue = true;
            shouldRun = true; // Mark overdue schedules to run
          }
        }
        
        if (shouldRun) {
          // ADDITIONAL SAFETY CHECK: Never process future-dated schedules
          if (schedule.nextExecution) {
            const nextExecTime = new Date(schedule.nextExecution);
            if (nextExecTime > now) {
              console.log(`🚫 BLOCKED: Schedule ${schedule.id} is scheduled for the future:`, {
                scheduledFor: nextExecTime.toISOString(),
                currentTime: now.toISOString(),
                timeDifference: Math.round((nextExecTime - now) / (1000 * 60 * 60 * 24)) + ' days'
              });
              shouldRun = false;
            }
          }
          
          if (shouldRun) {
            // COMPREHENSIVE STATUS CHECK: Only process pending schedules
            const existingReport = await ReportSchedule.findOne({
              dealer_id: user._id,
              schedule_id: schedule.id
            });
            
            if (existingReport) {
              const status = existingReport.status;
              console.log(`📊 Schedule ${schedule.id} status check:`, {
                status: status,
                scheduledAt: existingReport.scheduledAt?.toISOString(),
                sentAt: existingReport.sentAt?.toISOString(),
                user: user.name
              });
              
              // BLOCK all non-pending statuses
              if (status === 'sent') {
                console.log(`⏭️ SKIPPING: Schedule ${schedule.id} already completed (status: ${status}) for user ${user.name}`);
                shouldRun = false;
              } else if (status === 'failed') {
                console.log(`⚠️ SKIPPING: Schedule ${schedule.id} previously failed (status: ${status}) for user ${user.name}`);
                shouldRun = false;
              } else if (status === 'pending') {
                console.log(`✅ PROCEEDING: Schedule ${schedule.id} is pending (status: ${status}) for user ${user.name}`);
                // Continue with processing
              } else {
                console.log(`❓ UNKNOWN STATUS: Schedule ${schedule.id} has unknown status (${status}) for user ${user.name}`);
                shouldRun = false;
              }
            } else {
              console.log(`🆕 NEW: Schedule ${schedule.id} has no existing ReportSchedule entry for user ${user.name}`);
              // This is a new schedule, proceed with processing
            }
            
            // Only process if status check passed
            if (shouldRun) {
              // Ensure we have a ReportSchedule entry for tracking
              const reportEntry = await ensureReportScheduleEntry(user._id, schedule, user.report_schedule_settings);
              
              // Only add to scheduled reports if we have a valid entry
              if (reportEntry) {
                scheduledReports.push({
                  userId: user._id,
                  userName: user.name,
                  userEmail: user.report_schedule_settings?.default_email || user.email,
                  schedule: schedule,
                  settings: user.report_schedule_settings,
                  isOverdue: isOverdue
                });
              }
            }
          }
        }
      }
    }

    return scheduledReports;
  } catch (error) {
    console.error('Error getting scheduled reports:', error);
    return [];
  }
}

/**
 * Calculate next execution time for a schedule
 * @param {Object} schedule - Schedule object
 * @param {Date} fromDate - Date to calculate from (defaults to now)
 * @returns {Date|null} Next scheduled execution time
 */
export function calculateNextExecutionTime(schedule, fromDate = new Date(), userTimezone = 'America/New_York') {
  try {
    // Get current time in user's timezone
    const now = fromDate;
    const userTime = new Date(now.toLocaleString("en-US", { timeZone: userTimezone }));
    
    const [hours, minutes] = schedule.time.split(':');
    
    let nextTime = new Date(userTime);
    nextTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    
    // Always schedule for upcoming dates, never immediate
    if (schedule.frequency === 'daily') {
      // Daily: Schedule for tomorrow if time has passed today
      if (nextTime <= userTime) {
        nextTime.setDate(nextTime.getDate() + 1);
      }
    } else if (schedule.frequency === 'weekly') {
      // Weekly: Find next occurrence of the selected day
      const targetDay = schedule.days[0];
      const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
      const targetDayNum = dayMap[targetDay.toLowerCase()];
      
      // Calculate days to add to reach the target day
      let daysToAdd = (targetDayNum - userTime.getDay() + 7) % 7;
      
      // If it's the same day, schedule for next week
      if (daysToAdd === 0) {
        daysToAdd = 7;
      }
      
      // Always schedule for the upcoming occurrence
      nextTime.setDate(nextTime.getDate() + daysToAdd);
    } else if (schedule.frequency === 'monthly') {
      // Monthly: Schedule for the specific date of next month
      const targetDate = parseInt(schedule.days[0]);
      
      // Start with next month
      nextTime.setMonth(nextTime.getMonth() + 1);
      nextTime.setDate(targetDate);
    } else if (schedule.frequency === 'yearly') {
      // Yearly: Schedule for the specific month and date of next year
      const month = schedule.days[0];
      const targetDate = parseInt(schedule.days[1]);
      const monthMap = {
        'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
        'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
      };
      
      // Always schedule for next year to ensure it's upcoming
      nextTime.setFullYear(nextTime.getFullYear() + 1);
      nextTime.setMonth(monthMap[month.toLowerCase()], targetDate);
    }
    
    console.log(`📅 Scheduler calculated next execution for ${schedule.frequency}:`, {
      userTimezone,
      scheduledTime: nextTime.toISOString(),
      localTime: nextTime.toLocaleString("en-US", { timeZone: userTimezone }),
      frequency: schedule.frequency,
      days: schedule.days,
      time: schedule.time
    });
    
    return nextTime;
  } catch (error) {
    console.error('Error calculating next execution time:', error);
    return null;
  }
}

/**
 * Update the last report sent time for a user
 * @param {string} userId - User ID
 * @param {string} scheduleId - Schedule ID
 * @param {Date} sentTime - When the report was sent
 */
export async function updateLastReportSent(userId, scheduleId, sentTime = new Date()) {
  try {
    await dbConnect();
    
    // Find the user and their schedule
    const user = await User.findById(userId);
    if (!user || !user.report_schedule_settings) {
      console.error('User or report settings not found');
      return;
    }
    
    const { schedules } = user.report_schedule_settings;
    const schedule = schedules.find(s => s.id === scheduleId);
    
    if (!schedule) {
      console.error('Schedule not found');
      return;
    }
    
    // Calculate next execution time based on frequency
    const nextExecutionTime = calculateNextExecutionTime(schedule, sentTime);
    
    // Update the schedule with last sent time and next execution
    const updatedSchedules = schedules.map(s => {
      if (s.id === scheduleId) {
        return {
          ...s,
          lastReportSent: sentTime,
          nextExecution: nextExecutionTime
        };
      }
      return s;
    });
    
    // Update user with new schedule data
    await User.findByIdAndUpdate(
      userId,
      { 
        $set: {
          'report_schedule_settings.schedules': updatedSchedules,
          'report_schedule_settings.last_settings_updated': sentTime
        }
      }
    );
    
    console.log(`✅ Updated schedule ${scheduleId} for user ${userId}:`);
    console.log(`   - Last sent: ${sentTime.toISOString()}`);
    console.log(`   - Next execution: ${nextExecutionTime ? nextExecutionTime.toISOString() : 'N/A'}`);
    
  } catch (error) {
    console.error('Error updating last report sent:', error);
  }
}

/**
 * Get all users with expired schedules (past due reports)
 * @returns {Array} Array of users with expired schedules
 */
export async function getExpiredSchedules() {
  try {
    await dbConnect();
    
    const now = new Date();
    
    // Find users with schedules that should have run but haven't
    const usersWithSchedules = await User.find({
      'report_schedule_settings.enabled': true,
      'report_schedule_settings.schedules': {
        $elemMatch: {
          active: true
        }
      }
    }).select('_id name email report_schedule_settings');

    const expiredSchedules = [];

    for (const user of usersWithSchedules) {
      const { schedules } = user.report_schedule_settings;
      
      for (const schedule of schedules) {
        if (!schedule.active) continue;
        
        const nextTime = calculateNextExecutionTime(schedule);
        if (nextTime && nextTime < now) {
          expiredSchedules.push({
            userId: user._id,
            userName: user.name,
            userEmail: user.email,
            schedule: schedule,
            settings: user.report_schedule_settings,
            nextScheduled: nextTime
          });
        }
      }
    }
    
    return expiredSchedules;
  } catch (error) {
    console.error('Error getting expired schedules:', error);
    return [];
  }
}

/**
 * Initialize a new schedule with next execution time
 * @param {Object} schedule - Schedule object
 * @returns {Object} Schedule with nextExecution set
 */
export function initializeSchedule(schedule) {
  try {
    if (schedule.nextExecution) {
      return schedule; // Already initialized
    }
    
    // Calculate next execution time from now
    const nextTime = calculateNextExecutionTime(schedule, new Date());
    
    return {
      ...schedule,
      nextExecution: nextTime
    };
  } catch (error) {
    console.error('Error initializing schedule:', error);
    return schedule;
  }
}

/**
 * Get report schedule summary for a user
 * @param {string} userId - User ID
 * @returns {Object} Summary of report schedule
 */
export async function getReportScheduleSummary(userId) {
  try {
    await dbConnect();
    
    const user = await User.findById(userId).select('report_schedule_settings');
    if (!user || !user.report_schedule_settings) {
      return {
        hasSchedule: false,
        totalSchedules: 0,
        activeSchedules: 0,
        nextReport: null,
        lastReport: null
      };
    }
    
    const { schedules, enabled, last_settings_updated } = user.report_schedule_settings;
    const activeSchedules = schedules.filter(s => s.active);
    
    // Find the next report time among all active schedules
    let nextReport = null;
    for (const schedule of activeSchedules) {
      const nextTime = calculateNextExecutionTime(schedule);
      if (!nextReport || (nextTime && nextTime < nextReport)) {
        nextReport = nextTime;
      }
    }
    
    return {
      hasSchedule: true,
      totalSchedules: schedules.length,
      activeSchedules: activeSchedules.length,
      nextReport: nextReport,
      lastReport: last_settings_updated,
      isActive: enabled,
      reportEmail: user.report_schedule_settings.default_email,
      timezone: user.report_schedule_settings.timezone
    };
  } catch (error) {
    console.error('Error getting report schedule summary:', error);
    return {
      hasSchedule: false,
      error: error.message
    };
  }
}

/**
 * Create a cron expression for a schedule
 * @param {Object} schedule - Schedule object
 * @returns {string} Cron expression
 */
export function createCronExpression(schedule) {
  try {
    const [hours, minutes] = schedule.time.split(':');
    
    if (schedule.frequency === 'daily') {
      return `${minutes} ${hours} * * *`; // Every day at HH:MM
    } else if (schedule.frequency === 'weekly') {
      const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
      const dayOfWeek = dayMap[schedule.days[0].toLowerCase()];
      return `${minutes} ${hours} * * ${dayOfWeek}`; // Every week on specific day at HH:MM
    } else if (schedule.frequency === 'monthly') {
      const dayOfMonth = schedule.days[0];
      return `${minutes} ${hours} ${dayOfMonth} * *`; // Every month on specific date at HH:MM
    } else if (schedule.frequency === 'yearly') {
      const month = schedule.days[0];
      const dayOfMonth = schedule.days[1];
      const monthMap = {
        'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
        'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12
      };
      const monthNum = monthMap[month.toLowerCase()];
      return `${minutes} ${hours} ${dayOfMonth} ${monthNum} *`; // Every year on specific month/date at HH:MM
    }
    
    return null;
  } catch (error) {
    console.error('Error creating cron expression:', error);
    return null;
  }
}

/**
 * Validate a cron expression
 * @param {string} cronExpression - Cron expression to validate
 * @returns {boolean} Whether the expression is valid
 */
export function validateCronExpression(cronExpression) {
  try {
    cron.parseExpression(cronExpression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a ReportSchedule entry exists for tracking
 */
async function ensureReportScheduleEntry(userId, schedule, settings) {
  try {
    // Check if a ReportSchedule entry already exists for this schedule
    const existingEntry = await ReportSchedule.findOne({
      dealer_id: userId,
      schedule_id: schedule.id
    });
    
    if (existingEntry) {
      // If status is 'sent', don't create a new one
      if (existingEntry.status === 'sent') {
        console.log(`⏭️ Schedule ${schedule.id} already completed for user ${userId}`);
        return null;
      }
      
      // If status is 'pending' or 'failed', return existing
      if (existingEntry.status === 'pending' || existingEntry.status === 'failed') {
        console.log(`📋 Using existing ${existingEntry.status} ReportSchedule entry for schedule ${schedule.id}`);
        return existingEntry;
      }
    }
    
    // Calculate next execution time with timezone support
    const userTimezone = settings.timezone || 'America/New_York';
    const nextExecutionTime = calculateNextExecutionTime(schedule, new Date(), userTimezone);
    
    // SAFETY CHECK: Never create entries with future dates
    if (nextExecutionTime && nextExecutionTime > new Date()) {
      console.log(`🚫 PREVENTED: Would create future-dated schedule for ${schedule.frequency}:`, {
        scheduledFor: nextExecutionTime.toISOString(),
        currentTime: new Date().toISOString(),
        timeDifference: Math.round((nextExecutionTime - new Date()) / (1000 * 60 * 60 * 24)) + ' days'
      });
      return null; // Don't create future-dated entries
    }
    
    // Create new ReportSchedule entry for tracking
    const newReportSchedule = new ReportSchedule({
      dealer_id: userId,
      schedule_id: schedule.id,
      frequency: schedule.frequency,
      scheduledAt: nextExecutionTime || new Date(), // Use calculated next execution time
      status: 'pending',
      report_data: {
        email: settings.default_email || '',
        timezone: userTimezone,
        include_metrics: settings.include_metrics || {
          leads: true,
          conversations: true,
          vehicles: true,
          revenue: true
        },
        custom_message: settings.custom_message || ''
      }
    });
    
    await newReportSchedule.save();
    console.log(`✅ Created new ReportSchedule entry for schedule ${schedule.id}`);
    
    return newReportSchedule;
  } catch (error) {
    console.error(`❌ Error ensuring ReportSchedule entry:`, error);
    return null;
  }
}

/**
 * Clean up old completed reports (older than 30 days)
 * This helps maintain database performance
 */
export async function cleanupOldReports() {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const result = await ReportSchedule.deleteMany({
      status: 'sent',
      sentAt: { $lt: thirtyDaysAgo }
    });
    
    if (result.deletedCount > 0) {
      console.log(`🧹 Cleaned up ${result.deletedCount} old completed reports`);
    }
  } catch (error) {
    console.error('❌ Error cleaning up old reports:', error);
  }
}

/**
 * Clean up any incorrectly scheduled future reports
 * This fixes the issue where reports were scheduled for future dates
 */
export async function cleanupFutureReports() {
  try {
    const now = new Date();
    
    const result = await ReportSchedule.deleteMany({
      scheduledAt: { $gt: now },
      status: 'pending'
    });
    
    if (result.deletedCount > 0) {
      console.log(`🚫 Cleaned up ${result.deletedCount} incorrectly scheduled future reports`);
    }
  } catch (error) {
    console.error('❌ Error cleaning up future reports:', error);
  }
}

/**
 * Get comprehensive status summary for all schedules
 * This helps monitor the health of the scheduling system
 */
export async function getScheduleStatusSummary() {
  try {
    await dbConnect();
    
    const summary = await ReportSchedule.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          schedules: { $push: { 
            dealer_id: '$dealer_id', 
            schedule_id: '$schedule_id',
            frequency: '$frequency',
            scheduledAt: '$scheduledAt',
            sentAt: '$sentAt'
          }}
        }
      },
      { $sort: { count: -1 } }
    ]);
    
    console.log('📊 Schedule Status Summary:');
    summary.forEach(statusGroup => {
      console.log(`  ${statusGroup._id.toUpperCase()}: ${statusGroup.count} schedules`);
      if (statusGroup._id === 'pending') {
        const futureSchedules = statusGroup.schedules.filter(s => 
          s.scheduledAt && new Date(s.scheduledAt) > new Date()
        );
        if (futureSchedules.length > 0) {
          console.log(`    ⚠️  ${futureSchedules.length} are scheduled for future dates`);
        }
      }
    });
    
    return summary;
  } catch (error) {
    console.error('❌ Error getting schedule status summary:', error);
    return [];
  }
}
