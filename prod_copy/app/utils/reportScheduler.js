import User from '@models/User';
import ReportSchedule from '@models/ReportSchedule';
import dbConnect from '@lib/mongodb';

/**
 * Get all dealers who have reports scheduled for the current time
 * OPTIMIZED VERSION: Query ReportSchedule directly instead of querying all users first
 * @param {Date} currentTime - Current time to check against
 * @returns {Array} Array of dealers with scheduled reports
 */
export async function getScheduledReports(currentTime = new Date()) {
  try {
    await dbConnect();
    
    const now = currentTime;
    const actualNow = new Date();
    const isOverdueCheck = now < actualNow;
    
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const currentTimeStr = now.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    if (isOverdueCheck) {
      console.log(`🔍 Checking for OVERDUE reports (using past time): ${now.toISOString()}`);
      console.log(`📅 Actual current time: ${actualNow.toISOString()}`);
    } else {
      console.log(`🔍 Checking for scheduled reports at: ${now.toISOString()}`);
    }
    console.log(`📅 Check day: ${currentDay}, Check time: ${currentTimeStr}`);
    
    // HYBRID APPROACH: Query ReportSchedule for efficiency, but validate against original schedule logic
    const dueReports = await ReportSchedule.find({
      status: 'pending',
      scheduledAt: { $lte: now } // Only get reports that are due or overdue
    });
    
    console.log(`📊 Found ${dueReports.length} due/overdue reports in ReportSchedule`);
    
    const scheduledReports = [];
    
    for (const report of dueReports) {
      try {
        // Try to find the user directly instead of relying on populate
        let user = report.dealer_id;
        
        // If dealer_id is not populated (it's just an ObjectId), fetch the user
        if (!user || typeof user === 'string' || user._id) {
          user = await User.findById(report.dealer_id).select('name email report_schedule_settings');
        }
        
        if (!user) {
          console.log(`⚠️ Skipping report ${report._id}: No user found for dealer_id ${report.dealer_id}`);
          continue;
        }
        
        // Check if user still has report scheduling enabled
        if (!user.report_schedule_settings?.enabled) {
          console.log(`⚠️ Skipping report ${report._id}: User ${user.name} has disabled report scheduling`);
          continue;
        }
        
        // Find the corresponding schedule in user's settings
        const schedule = user.report_schedule_settings.schedules?.find(s => s.id === report.schedule_id);
        if (!schedule || !schedule.active) {
          console.log(`⚠️ Skipping report ${report._id}: Schedule ${report.schedule_id} not found or inactive for user ${user.name}`);
          continue;
        }
        
        // CRITICAL: Validate that this schedule should actually run based on frequency logic
        let shouldRun = false;
        let isOverdue = false;
        
        // Get user's timezone for proper time comparison
        const userTimezone = user.report_schedule_settings?.timezone || 'America/New_York';
        
        // Check if there's a next execution time set
        if (schedule.nextExecution) {
          const nextExecTime = new Date(schedule.nextExecution);
          shouldRun = nextExecTime <= now;
          console.log(`⏰ Schedule ${schedule.id} (${schedule.frequency}):`, {
            scheduledFor: nextExecTime.toISOString(),
            currentTime: now.toISOString(),
            shouldRun: shouldRun,
            timeDifference: Math.round((nextExecTime - now) / (1000 * 60 * 60 * 24)) + ' days'
          });
        } else {
          // Fallback to frequency-based logic for schedules without nextExecution
          if (schedule.frequency === 'daily') {
            // Daily reports run every day at the specified time
            shouldRun = schedule.time <= currentTimeStr;
            console.log(`📅 Daily schedule ${schedule.id}: time=${schedule.time}, current=${currentTimeStr}, shouldRun=${shouldRun}`);
          } else if (schedule.frequency === 'weekly') {
            // Weekly reports run on the specified day at the specified time
            const scheduleDay = schedule.days[0];
            const isCorrectDay = scheduleDay === currentDay;
            const isCorrectTime = schedule.time <= currentTimeStr;
            shouldRun = isCorrectDay && isCorrectTime;
            
            console.log(`📅 Weekly schedule ${schedule.id}:`, {
              scheduleDay: scheduleDay,
              currentDay: currentDay,
              scheduleTime: schedule.time,
              currentTime: currentTimeStr,
              isCorrectDay: isCorrectDay,
              isCorrectTime: isCorrectTime,
              shouldRun: shouldRun
            });
          } else if (schedule.frequency === 'monthly') {
            // Monthly reports run on the specified date at the specified time
            const scheduleDate = parseInt(schedule.days[0]);
            const currentDate = now.getDate();
            shouldRun = scheduleDate <= currentDate && schedule.time <= currentTimeStr;
            console.log(`📅 Monthly schedule ${schedule.id}:`, {
              scheduleDate: scheduleDate,
              currentDate: currentDate,
              scheduleTime: schedule.time,
              currentTime: currentTimeStr,
              shouldRun: shouldRun
            });
          } else if (schedule.frequency === 'yearly') {
            // Yearly reports run on the specified month and date at the specified time
            const scheduleMonth = schedule.days[0];
            const scheduleDate = parseInt(schedule.days[1]);
            const currentMonth = now.toLocaleDateString('en-US', { month: 'long' }).toLowerCase();
            const currentDate = now.getDate();
            shouldRun = scheduleMonth === currentMonth && scheduleDate <= currentDate && schedule.time <= currentTimeStr;
            console.log(`📅 Yearly schedule ${schedule.id}:`, {
              scheduleMonth: scheduleMonth,
              currentMonth: currentMonth,
              scheduleDate: scheduleDate,
              currentDate: currentDate,
              scheduleTime: schedule.time,
              currentTime: currentTimeStr,
              shouldRun: shouldRun
            });
          }
        }
        
        // Check if this schedule is overdue (should have run in the past)
        if (!shouldRun) {
          const lastRunTime = schedule.lastReportSent ? new Date(schedule.lastReportSent) : null;
          const nextRunTime = calculateNextExecutionTime(schedule, lastRunTime || new Date(0), userTimezone);
          
          if (nextRunTime && nextRunTime < now) {
            isOverdue = true;
            shouldRun = true; // Mark overdue schedules to run
            console.log(`⏰ OVERDUE: Schedule ${schedule.id} should have run at ${nextRunTime.toISOString()}`);
          }
        }
        
        // Only process if the schedule logic says it should run
        if (shouldRun) {
          // Check if this is overdue (should have run in the past)
          isOverdue = report.scheduledAt < now;
          
          if (isOverdue) {
            console.log(`⏰ OVERDUE: Report ${report._id} for user ${user.name} was scheduled for ${report.scheduledAt.toISOString()}`);
          } else {
            console.log(`⏰ DUE: Report ${report._id} for user ${user.name} is due at ${report.scheduledAt.toISOString()}`);
          }
          
          // Add to scheduled reports
          scheduledReports.push({
            userId: user._id,
            userName: user.name,
            userEmail: user.report_schedule_settings?.default_email || user.email,
            schedule: schedule,
            settings: user.report_schedule_settings,
            isOverdue: isOverdue,
            reportId: report._id
          });
          
          console.log(`✅ Added report ${report._id} for user ${user.name} to processing queue`);
        } else {
          console.log(`⏭️ SKIPPING: Schedule ${schedule.id} (${schedule.frequency}) for user ${user.name} - not due yet based on frequency logic`);
        }
        
      } catch (error) {
        console.error(`❌ Error processing report ${report._id}:`, error);
        // Continue with other reports
      }
    }
    
    console.log(`📋 Total reports to process: ${scheduledReports.length}`);
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
 * @param {string} userTimezone - User's timezone
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
      
      if (targetDayNum !== undefined) {
        const currentDay = userTime.getDay();
        let daysToAdd = targetDayNum - currentDay;
        
        if (daysToAdd <= 0) {
          daysToAdd += 7; // Next week
        }
        
        nextTime.setDate(userTime.getDate() + daysToAdd);
        
        console.log(`📅 Weekly next execution calculation:`, {
          targetDay: targetDay,
          targetDayNum: targetDayNum,
          currentDay: currentDay,
          daysToAdd: daysToAdd,
          fromDate: userTime.toISOString(),
          nextExecution: nextTime.toISOString()
        });
      }
    } else if (schedule.frequency === 'monthly') {
      // Monthly: Schedule for next month on the specified date
      const targetDate = parseInt(schedule.days[0]);
      nextTime.setDate(targetDate);
      
      if (nextTime <= userTime) {
        nextTime.setMonth(nextTime.getMonth() + 1);
        nextTime.setDate(targetDate);
      }
    } else if (schedule.frequency === 'yearly') {
      // Yearly: Schedule for next year on the specified month and date
      const targetMonth = schedule.days[0];
      const targetDate = parseInt(schedule.days[1]);
      const monthMap = {
        'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
        'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
      };
      
      const targetMonthNum = monthMap[targetMonth.toLowerCase()];
      if (targetMonthNum !== undefined) {
        nextTime.setMonth(targetMonthNum);
        nextTime.setDate(targetDate);
        
        if (nextTime <= userTime) {
          nextTime.setFullYear(nextTime.getFullYear() + 1);
        }
      }
    }
    
    return nextTime;
  } catch (error) {
    console.error('Error calculating next execution time:', error);
    return null;
  }
}

/**
 * Update last report sent time and next execution for a specific schedule
 * @param {string} userId - User ID
 * @param {string} scheduleId - Schedule ID
 * @param {Date} sentTime - When the report was sent
 * @param {string} userTimezone - User's timezone
 */
export async function updateLastReportSent(userId, scheduleId, sentTime = new Date(), userTimezone = 'America/New_York') {
  try {
    await dbConnect();
    
    const user = await User.findById(userId);
    if (!user || !user.report_schedule_settings) {
      console.log(`User ${userId} not found or has no report schedule settings`);
      return;
    }
    
    // Find the specific schedule
    const scheduleIndex = user.report_schedule_settings.schedules.findIndex(s => s.id === scheduleId);
    if (scheduleIndex === -1) {
      console.log(`Schedule ${scheduleId} not found for user ${userId}`);
      return;
    }
    
    // Update the specific schedule
    user.report_schedule_settings.schedules[scheduleIndex].lastReportSent = sentTime;
    
    // Calculate next execution time
    const nextExecution = calculateNextExecutionTime(
      user.report_schedule_settings.schedules[scheduleIndex], 
      sentTime, 
      userTimezone
    );
    
    if (nextExecution) {
      user.report_schedule_settings.schedules[scheduleIndex].nextExecution = nextExecution;
      console.log(`Updated schedule ${scheduleId} for user ${userId}: next execution at ${nextExecution.toISOString()}`);
    }
    
    await user.save();
    
  } catch (error) {
    console.error('Error updating last report sent:', error);
  }
}

/**
 * Ensure a ReportSchedule entry exists for tracking
 * @param {string} userId - User ID
 * @param {Object} schedule - Schedule object
 * @param {Object} settings - User's report schedule settings
 * @returns {Object|null} ReportSchedule entry or null if creation failed
 */
export async function ensureReportScheduleEntry(userId, schedule, settings) {
  try {
    await dbConnect();
    
    // Check for existing entry
    const existingEntry = await ReportSchedule.findOne({
      dealer_id: userId,
      schedule_id: schedule.id
    });
    
    if (existingEntry) {
      if (existingEntry.status === 'sent') {
        console.log(`⏭️ SKIPPING: ReportSchedule ${existingEntry._id} already completed for schedule ${schedule.id}`);
    return null;
      } else if (existingEntry.status === 'pending' || existingEntry.status === 'failed') {
        console.log(`📋 Using existing ReportSchedule ${existingEntry._id} with status: ${existingEntry.status}`);
        return existingEntry;
      }
    }
    
    // Create new entry
    const userTimezone = settings?.timezone || 'America/New_York';
    const nextExecutionTime = calculateNextExecutionTime(schedule, new Date(), userTimezone);
    
    // Safety check: Don't create future-dated entries
    if (nextExecutionTime && nextExecutionTime > new Date()) {
      console.log(`🚫 PREVENTED: Would create future-dated ReportSchedule for schedule ${schedule.id}`);
      return null;
    }
    
    const newEntry = new ReportSchedule({
      dealer_id: userId,
      schedule_id: schedule.id,
      frequency: schedule.frequency,
      scheduledAt: nextExecutionTime || new Date(),
      status: 'pending',
      report_data: {
        email: settings?.default_email,
        timezone: userTimezone,
        include_metrics: settings?.include_metrics || {},
        custom_message: settings?.custom_message || ''
      }
    });
    
    await newEntry.save();
    console.log(`✅ Created new ReportSchedule ${newEntry._id} for schedule ${schedule.id}`);
    
    return newEntry;
    
  } catch (error) {
    console.error('Error ensuring ReportSchedule entry:', error);
    return null;
  }
}

/**
 * SAFE: Clean up only very old completed reports (older than 90 days)
 * This is much safer than the previous 30-day cleanup
 */
export async function cleanupOldReports() {
  try {
    await dbConnect();
    
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90); // Increased from 30 to 90 days
    
    // Only delete reports that are both 'sent' AND very old
    const oldReports = await ReportSchedule.find({
      status: 'sent',
      sentAt: { $lt: ninetyDaysAgo }
    }).populate('dealer_id', 'name email');
    
    if (oldReports.length === 0) {
      console.log(`🧹 No old reports to clean up (older than 90 days)`);
      return;
    }
    
    console.log(`🧹 Found ${oldReports.length} old reports to clean up:`, 
      oldReports.map(r => `${r.dealer_id?.name || 'Unknown'} - ${r.sentAt?.toISOString()}`)
    );
    
    // Delete them one by one with logging
    let deletedCount = 0;
    for (const report of oldReports) {
      try {
        await ReportSchedule.findByIdAndDelete(report._id);
        deletedCount++;
        console.log(`🧹 Deleted old report: ${report._id} for ${report.dealer_id?.name || 'Unknown'}`);
      } catch (error) {
        console.error(`❌ Failed to delete old report ${report._id}:`, error);
      }
    }
    
    console.log(`🧹 Successfully cleaned up ${deletedCount}/${oldReports.length} old sent reports`);
    
  } catch (error) {
    console.error('Error cleaning up old reports:', error);
  }
}

/**
 * SAFE: Only clean up reports that are clearly problematic
 * Instead of deleting all future reports, we'll fix them
 */
export async function cleanupFutureReports() {
  try {
    await dbConnect();
    
    const now = new Date();
    
    // Find future-dated pending reports
    const futureReports = await ReportSchedule.find({
      status: 'pending',
      scheduledAt: { $gt: now }
    }).populate('dealer_id', 'name email');
    
    if (futureReports.length === 0) {
      console.log(`🧹 No future-dated reports to clean up`);
      return;
    }
    
    console.log(`🧹 Found ${futureReports.length} future-dated reports to fix:`, 
      futureReports.map(r => `${r.dealer_id?.name || 'Unknown'} - ${r.scheduledAt?.toISOString()}`)
    );
    
    // Instead of deleting, let's try to fix them by rescheduling
    let fixedCount = 0;
    let deletedCount = 0;
    
    for (const report of futureReports) {
      try {
        // Check if this is a legitimate future schedule (e.g., yearly reports)
        const daysUntilScheduled = Math.ceil((report.scheduledAt - now) / (1000 * 60 * 60 * 24));
        
        if (daysUntilScheduled > 365) {
          // If scheduled more than 1 year in the future, it's probably wrong
          console.log(`🚫 Deleting report scheduled ${daysUntilScheduled} days in the future: ${report._id}`);
          await ReportSchedule.findByIdAndDelete(report._id);
          deletedCount++;
        } else if (daysUntilScheduled > 30) {
          // If scheduled more than 30 days in the future, reschedule it
          console.log(`🔄 Rescheduling report scheduled ${daysUntilScheduled} days in the future: ${report._id}`);
          report.scheduledAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
          await report.save();
          fixedCount++;
        } else {
          // If scheduled within 30 days, it might be legitimate (e.g., monthly/yearly)
          console.log(`✅ Keeping legitimate future report: ${report._id} (${daysUntilScheduled} days away)`);
        }
      } catch (error) {
        console.error(`❌ Error processing future report ${report._id}:`, error);
      }
    }
    
    console.log(`🧹 Future reports cleanup: ${fixedCount} fixed, ${deletedCount} deleted`);
    
  } catch (error) {
    console.error('Error cleaning up future reports:', error);
  }
}

/**
 * Get summary of ReportSchedule statuses
 */
export async function getScheduleStatusSummary() {
  try {
    await dbConnect();
    
    const summary = await ReportSchedule.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const statusMap = {};
    summary.forEach(item => {
      statusMap[item._id] = item.count;
    });
    
    console.log('📊 ReportSchedule Status Summary:', statusMap);
    return statusMap;
    
  } catch (error) {
    console.error('Error getting schedule status summary:', error);
    return {};
  }
}

/**
 * Diagnose specific ReportSchedule entry to understand why user lookup fails
 */
export async function diagnoseReportSchedule(reportId) {
  try {
    await dbConnect();
    
    console.log(`🔍 Diagnosing ReportSchedule entry: ${reportId}`);
    
    // Find the specific report without populate first
    const report = await ReportSchedule.findById(reportId);
    if (!report) {
      console.log(`❌ ReportSchedule ${reportId} not found`);
      return { found: false };
    }
    
    console.log(`📋 ReportSchedule found:`, {
      _id: report._id,
      dealer_id: report.dealer_id,
      dealer_id_type: typeof report.dealer_id,
      schedule_id: report.schedule_id,
      status: report.status,
      scheduledAt: report.scheduledAt
    });
    
    // Try to find the user directly
    const user = await User.findById(report.dealer_id);
    if (!user) {
      console.log(`❌ User ${report.dealer_id} not found in User collection`);
      return { 
        found: true, 
        report: report, 
        userFound: false,
        dealer_id: report.dealer_id 
      };
    }
    
    console.log(`✅ User found:`, {
      _id: user._id,
      name: user.name,
      email: user.email,
      hasReportSettings: !!user.report_schedule_settings,
      reportSettingsEnabled: user.report_schedule_settings?.enabled
    });
    
    // Try populate with different field selections
    const reportWithPopulate = await ReportSchedule.findById(reportId).populate('dealer_id');
    console.log(`🔍 Populate result:`, {
      dealer_id_populated: !!reportWithPopulate.dealer_id,
      dealer_id_value: reportWithPopulate.dealer_id
    });
    
    return { 
      found: true, 
      report: report, 
      userFound: true, 
      user: user,
      populateWorks: !!reportWithPopulate.dealer_id
    };
    
  } catch (error) {
    console.error('Error diagnosing ReportSchedule:', error);
    return { found: false, error: error.message };
  }
}

/**
 * Clean up orphaned ReportSchedule entries that reference non-existent users
 */
export async function cleanupOrphanedReports() {
  try {
    await dbConnect();
    
    console.log('🧹 Starting cleanup of orphaned ReportSchedule entries...');
    
    // Find all ReportSchedule entries
    const allReports = await ReportSchedule.find({}).populate('dealer_id');
    
    const orphanedReports = allReports.filter(report => !report.dealer_id);
    
    if (orphanedReports.length === 0) {
      console.log('✅ No orphaned ReportSchedule entries found');
      return { cleaned: 0, total: allReports.length };
    }
    
    console.log(`🚨 Found ${orphanedReports.length} orphaned ReportSchedule entries:`, 
      orphanedReports.map(r => `${r._id} - dealer_id: ${r.dealer_id}`)
    );
    
    // Delete orphaned entries
    let deletedCount = 0;
    for (const report of orphanedReports) {
      try {
        await ReportSchedule.findByIdAndDelete(report._id);
        deletedCount++;
        console.log(`🧹 Deleted orphaned report: ${report._id}`);
      } catch (error) {
        console.error(`❌ Failed to delete orphaned report ${report._id}:`, error);
      }
    }
    
    console.log(`🧹 Successfully cleaned up ${deletedCount}/${orphanedReports.length} orphaned reports`);
    
    return { 
      cleaned: deletedCount, 
      total: allReports.length,
      orphaned: orphanedReports.length 
    };
    
  } catch (error) {
    console.error('Error cleaning up orphaned reports:', error);
    return { cleaned: 0, total: 0, error: error.message };
  }
}
