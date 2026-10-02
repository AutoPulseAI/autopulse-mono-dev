import Lead from '../models/Lead.js';
import Email from '../models/Email.js';
import Vehicle from '../models/Vehicle.js';
import ReportSchedule from '../models/ReportSchedule.js';
import { sendEmail } from './email.js';
import moment from 'moment-timezone';

export async function generateAndSendReport(reportData) {
  try {
    const { userId, userName, userEmail, schedule, reportId, settings } = reportData;
    console.log(`Generating report for user: ${userName}, reportId: ${reportId}`);
    
    const reportContent = await generateReportContent(userId, schedule);
    if (!reportContent) {
      console.error('Failed to generate report content');
      return false;
    }
    
    // Get email addresses - support comma-separated emails
    const emailString = userEmail || settings?.default_email || '';
    const emailAddresses = emailString
      .split(',')
      .map(email => email.trim())
      .filter(email => email.length > 0);
    
    if (emailAddresses.length === 0) {
      console.error('No email addresses provided');
      await updateReportScheduleStatus(reportId, 'failed');
      return false;
    }
    
    console.log(`Sending report to ${emailAddresses.length} email address(es): ${emailAddresses.join(', ')}`);
    
    // Send email to all addresses
    let allSent = true;
    const sendResults = await Promise.allSettled(
      emailAddresses.map(email => sendReportEmail(email, userName, reportContent, settings?.branding))
    );
    
    // Check if all emails were sent successfully
    sendResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        console.log(`Report email sent successfully to ${emailAddresses[index]}`);
      } else {
        console.error(`Failed to send report email to ${emailAddresses[index]}`);
        allSent = false;
      }
    });
    
    if (allSent) {
      console.log(`Report emails sent successfully to all ${emailAddresses.length} address(es)`);
      
      // Update the current report schedule status to "sent" using the ReportSchedule ID
      await updateReportScheduleStatus(reportId, 'sent');
      
      // Create the next scheduled report entry
      await createNextReportSchedule(userId, schedule, settings);
      
      return true;
    } else {
      console.error(`Failed to send report email to one or more addresses`);
      
      // Update the current report schedule status to "failed" using the ReportSchedule ID
      await updateReportScheduleStatus(reportId, 'failed');
      
      return false;
    }
  } catch (error) {
    console.error('Error in generateAndSendReport:', error);
    
    // Update the current report schedule status to "failed" on error using the ReportSchedule ID
    if (reportData.reportId) {
      await updateReportScheduleStatus(reportData.reportId, 'failed');
    }
    
    return false;
  }
}

async function generateReportContent(userId, schedule) {
  try {
    const dealerId = userId;
    const reportPeriod = getReportPeriod(schedule.frequency);
    
    console.log(`📊 Generating ${schedule.frequency} report for period:`, {
      startDate: reportPeriod.startDate.toISOString(),
      endDate: reportPeriod.endDate.toISOString(),
      frequency: schedule.frequency
    });
    
    // Get communication metrics from Email model
    const emailMetrics = await getEmailMetrics(dealerId, reportPeriod);
    
    // Get lead metrics
    const leadMetrics = await getLeadMetrics(dealerId, reportPeriod);
    
    // Get vehicle metrics
    const vehicleMetrics = await getVehicleMetrics(dealerId, reportPeriod);
    
    return {
      period: reportPeriod,
      emailMetrics,
      leadMetrics,
      vehicleMetrics,
      timestamp: new Date().toISOString(),
      frequency: schedule.frequency
    };
  } catch (error) {
    console.error('Error generating report content:', error);
    return null;
  }
}

async function getEmailMetrics(dealerId, period) {
  try {
    const { startDate, endDate, type } = period;
    
    console.log(`📧 Getting email metrics for ${type} report:`, {
      dealerId: dealerId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      periodType: type
    });
    
    // Get all emails for the dealer in the period
    const emails = await Email.find({
      dealer_id: dealerId,
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: -1 });
    
    console.log(`📧 Found ${emails.length} emails in period for dealer ${dealerId}`);
    
    // Separate by communication type and direction
    const emailSent = emails.filter(e => e.communication_type === 'email' && e.status === 'sent');
    const emailReceived = emails.filter(e => e.communication_type === 'email' && e.status === 'incoming');
    const smsSent = emails.filter(e => e.communication_type === 'sms' && e.status === 'sent');
    const smsReceived = emails.filter(e => e.communication_type === 'sms' && e.status === 'received');
    
    // Get previous period for comparison
    const prevPeriod = getPreviousPeriod(period);
    const prevEmails = await Email.find({
      dealer_id: dealerId,
      date: { $gte: prevPeriod.startDate, $lte: prevPeriod.endDate }
    });
    
    const prevEmailSent = prevEmails.filter(e => e.communication_type === 'email' && e.status === 'sent');
    const prevSmsSent = prevEmails.filter(e => e.communication_type === 'sms' && e.status === 'sent');
    
    return {
      email: {
        sent: emailSent.length,
        received: emailReceived.length,
        change: calculatePercentageChange(prevEmailSent.length, emailSent.length)
      },
      sms: {
        sent: smsSent.length,
        received: smsReceived.length,
        change: calculatePercentageChange(prevSmsSent.length, smsSent.length)
      },
      total: emails.length,
      unread: emails.filter(e => e.status === 'incoming').length,
      missed: 0 // Could be calculated based on response time
    };
  } catch (error) {
    console.error('Error getting email metrics:', error);
    return { email: { sent: 0, received: 0, change: 0 }, sms: { sent: 0, received: 0, change: 0 }, total: 0, unread: 0, missed: 0 };
  }
}

async function getLeadMetrics(dealerId, period) {
  try {
    const { startDate, endDate, type } = period;
    
    console.log(`🎯 Getting lead metrics for ${type} report:`, {
      dealerId: dealerId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      periodType: type
    });
    
    const leads = await Lead.find({
      dealer_id: dealerId,
      createdAt: { $gte: startDate, $lte: endDate }
    });
    
    console.log(`🎯 Found ${leads.length} leads in period for dealer ${dealerId}`);
    
    const prevPeriod = getPreviousPeriod(period);
    const prevLeads = await Lead.find({
      dealer_id: dealerId,
      createdAt: { $gte: prevPeriod.startDate, $lte: prevPeriod.endDate }
    });
    
    // Case-insensitive grouping for both source and lead_source fields
    const bySourceMap = new Map();
    const byLeadSourceMap = new Map();

    leads.forEach(lead => {
      const rawSource = (lead.source || 'unknown').toString();
      const normSource = rawSource.toLowerCase().trim();
      const rawLeadSource = (lead.lead_source || 'unknown').toString();
      const normLeadSource = rawLeadSource.toLowerCase().trim();

      // Group source
      if (bySourceMap.has(normSource)) {
        const existing = bySourceMap.get(normSource);
        existing.count += 1;
        if (rawSource !== rawSource.toLowerCase() && existing.label === existing.label.toLowerCase()) {
          existing.label = rawSource;
        }
      } else {
        bySourceMap.set(normSource, { label: rawSource, count: 1 });
      }

      // Group lead_source
      if (byLeadSourceMap.has(normLeadSource)) {
        const existing = byLeadSourceMap.get(normLeadSource);
        existing.count += 1;
        if (rawLeadSource !== rawLeadSource.toLowerCase() && existing.label === existing.label.toLowerCase()) {
          existing.label = rawLeadSource;
        }
      } else {
        byLeadSourceMap.set(normLeadSource, { label: rawLeadSource, count: 1 });
      }
    });

    const bySource = Object.fromEntries(Array.from(bySourceMap.values()).map(v => [v.label, v.count]));
    const byLeadSource = Object.fromEntries(Array.from(byLeadSourceMap.values()).map(v => [v.label, v.count]));

    // Get ALL managerial review leads (no date filter) - always show total count
    const managerialReviewLeads = await Lead.countDocuments({
      dealer_id: dealerId,
      fe_lead_status: 'Managerial Review'
    });
    
    console.log(`🔍 Managerial Review leads (all time): ${managerialReviewLeads}`);

    return {
      total: leads.length,
      change: calculatePercentageChange(prevLeads.length, leads.length),
      bySource,
      byLeadSource,
      newLeads: leads.filter(lead => lead.fe_lead_status === 'Lead').length,
      convertedLeads: leads.filter(lead => lead.fe_lead_status === 'Contacted').length,
      bookedLeads: leads.filter(lead => lead.booking_status === true).length,
      // Sold Pending / Sold Delivered are sold too (MASTER_PLAN_3 C5 manager outcomes).
      soldLeads: leads.filter(lead => ['Sold', 'Sold Pending', 'Sold Delivered'].includes(lead.fe_lead_status)).length,
      visitedLeads: leads.filter(lead => lead.fe_lead_status === 'visited').length,
      managerialReviewLeads: managerialReviewLeads  // All time count, no date filter
    };
  } catch (error) {
    console.error('Error getting lead metrics:', error);
    return { total: 0, change: 0, bySource: {}, newLeads: 0, convertedLeads: 0,bookedLeads: 0,soldLeads: 0 ,visitedLeads: 0, managerialReviewLeads: 0};
  }
}

async function getVehicleMetrics(dealerId, period) {
  try {
    const { startDate, endDate } = period;
    
    const vehicles = await Vehicle.find({
      dealer_id: dealerId,
      createdAt: { $gte: startDate, $lte: endDate }
    });
    
    const prevPeriod = getPreviousPeriod(period);
    const prevVehicles = await Vehicle.find({
      dealer_id: dealerId,
      createdAt: { $gte: prevPeriod.startDate, $lte: prevPeriod.endDate }
    });
    
    return {
      total: vehicles.length,
      change: calculatePercentageChange(prevVehicles.length, vehicles.length),
      byStatus: vehicles.reduce((acc, vehicle) => {
        const status = vehicle.status || 'unknown';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {}),
      byMake: vehicles.reduce((acc, vehicle) => {
        const make = vehicle.make || 'unknown';
        acc[make] = (acc[make] || 0) + 1;
        return acc;
      }, {})
    };
  } catch (error) {
    console.error('Error getting vehicle metrics:', error);
    return { total: 0, change: 0, byStatus: {}, byMake: {} };
  }
}

export function getReportPeriod(frequency) {
  const now = new Date();
  let startDate, endDate;
  
  switch (frequency) {
    case 'daily':
      // Last 1 day (from yesterday to today)
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      break;
      
    case 'weekly':
      // Last 7 days
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      break;
      
    case 'monthly':
      // Last 1 month (30 days)
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      break;
      
    case 'yearly':
      // Last 1 year (365 days)
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 365);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      break;
      
    default:
      // Fallback to daily
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      break;
  }
  
  console.log(`📅 Report period for ${frequency}:`, {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    daysCovered: Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
  });
  
  return {
    startDate,
    endDate,
    type: frequency
  };
}

export function getPreviousPeriod(currentPeriod) {
  const { startDate, endDate, type } = currentPeriod;
  
  // Calculate previous period based on frequency type
  let prevStartDate, prevEndDate;
  
  switch (type) {
    case 'daily':
      // Previous day
      prevStartDate = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
      prevEndDate = new Date(startDate.getTime() - 1);
      break;
      
    case 'weekly':
      // Previous 7 days
      prevStartDate = new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      prevEndDate = new Date(startDate.getTime() - 1);
      break;
      
    case 'monthly':
      // Previous 30 days
      prevStartDate = new Date(startDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      prevEndDate = new Date(startDate.getTime() - 1);
      break;
      
    case 'yearly':
      // Previous 365 days
      prevStartDate = new Date(startDate.getTime() - 365 * 24 * 60 * 60 * 1000);
      prevEndDate = new Date(startDate.getTime() - 1);
      break;
      
    default:
      // Fallback to duration-based calculation
      const duration = endDate.getTime() - startDate.getTime();
      prevStartDate = new Date(startDate.getTime() - duration);
      prevEndDate = new Date(startDate.getTime() - 1);
      break;
  }
  
  console.log(`📅 Previous period for ${type}:`, {
    prevStartDate: prevStartDate.toISOString(),
    prevEndDate: prevEndDate.toISOString(),
    daysCovered: Math.ceil((prevEndDate - prevStartDate) / (1000 * 60 * 60 * 24))
  });
  
  return {
    startDate: prevStartDate,
    endDate: prevEndDate
  };
}

function calculatePercentageChange(previous, current) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Generate frequency-specific email subject line
 */
export function generateReportSubject(frequency, period) {
  const frequencyLabels = {
    daily: 'Daily',
    weekly: 'Weekly', 
    monthly: 'Monthly',
    yearly: 'Yearly'
  };
  
  const label = frequencyLabels[frequency] || 'Business';
  
  return `📊 ${label} Business Report - ${period.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${period.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}



async function sendReportEmail(email, userName, reportContent, brandingInfo = {}) {
  try {
    const htmlContent = generateEmailHTML(userName, reportContent, brandingInfo);
    
    // Generate frequency-specific subject line
    const subject = generateReportSubject(reportContent.frequency, reportContent.period);
    
    const emailSent = await sendEmail(
      email, // to
      subject, // frequency-specific subject
      htmlContent, // text/html content
      process.env.EMAIL_FROM || 'support@autopulse.ai', // from
      null, // parentMessageId
      null  // brandingInfo
    );
    
    return !!emailSent; // Convert to boolean
  } catch (error) {
    console.error('Error sending report email:', error);
    return false;
  }
}

/**
 * Update the status of a report schedule
 */
async function updateReportScheduleStatus(reportId, status) {
  try {
    console.log(`🔄 Updating ReportSchedule ${reportId} status to: ${status}`);
    
    const result = await ReportSchedule.findByIdAndUpdate(
      reportId,
      { 
        status: status,
        sentAt: status === 'sent' ? new Date() : null
      },
      { new: true }
    );
    
    if (result) {
      console.log(`✅ Successfully updated ReportSchedule ${reportId} status to: ${status}`);
    } else {
      console.error(`❌ ReportSchedule ${reportId} not found for status update`);
    }
  } catch (error) {
    console.error(`❌ Error updating ReportSchedule ${reportId} status:`, error);
  }
}

/**
 * Create the next scheduled report entry
 */
async function createNextReportSchedule(userId, schedule, settings) {
  try {
    console.log(`🔄 Creating next report schedule for user ${userId}, schedule ${schedule.id} (${schedule.frequency})`);
    
    // Get user timezone from settings
    const userTimezone = settings?.timezone || 'America/New_York';
    console.log(`🌍 Using timezone: ${userTimezone} for next schedule calculation`);
    
    // Calculate next execution time based on frequency and timezone
    // Use the sentAt time or current time as the base
    const baseTime = new Date();
    const nextExecutionTime = calculateNextExecutionTimeWithTimezone(schedule, baseTime, userTimezone);
    
    if (!nextExecutionTime) {
      console.log(`⚠️ Could not calculate next execution time for schedule ${schedule.id}`);
      return;
    }
    
    console.log(`📅 Next execution time calculated: ${nextExecutionTime.toISOString()} (${userTimezone})`);
    
    // Create new report schedule entry
    const newReportSchedule = new ReportSchedule({
      dealer_id: userId,
      schedule_id: schedule.id,
      frequency: schedule.frequency,
      scheduledAt: nextExecutionTime,
      status: 'pending',
      report_data: {
        email: settings?.default_email || '',
        timezone: settings?.timezone || 'America/New_York',
        include_metrics: settings?.include_metrics || {
          leads: true,
          conversations: true,
          vehicles: true,
          revenue: true
        },
        custom_message: settings?.custom_message || ''
      }
    });
    
    console.log(`💾 Saving new ReportSchedule entry...`);
    await newReportSchedule.save();
    
    console.log(`✅ Successfully created next report schedule:`, {
      reportScheduleId: newReportSchedule._id,
      scheduleId: schedule.id,
      frequency: schedule.frequency,
      nextExecution: nextExecutionTime.toISOString(),
      userId: userId,
      status: 'pending'
    });
    
  } catch (error) {
    console.error(`❌ Error creating next report schedule for user ${userId}, schedule ${schedule.id}:`, error);
  }
}

/**
 * Calculate next schedule date based on frequency (for display purposes)
 */
function calculateNextScheduleDate(frequency) {
  const now = new Date();
  let nextDate = new Date(now);
  
  switch (frequency) {
    case 'daily':
      nextDate.setDate(now.getDate() + 1);
      break;
    case 'weekly':
      nextDate.setDate(now.getDate() + 7);
      break;
    case 'monthly':
      nextDate.setMonth(now.getMonth() + 1);
      break;
    case 'yearly':
      nextDate.setFullYear(now.getFullYear() + 1);
      break;
    default:
      nextDate.setDate(now.getDate() + 1);
      break;
  }
  
  return nextDate;
}

/**
 * Calculate next execution time for a schedule with timezone support
 */
function calculateNextExecutionTimeWithTimezone(schedule, fromDate = new Date(), userTimezone = 'America/New_York') {
  try {
    console.log(`🔄 Calculating next execution time for schedule ${schedule.id} (${schedule.frequency}) in timezone ${userTimezone}`);
    
    // Get current time in user's timezone
    const now = fromDate;
    const nowInTimezone = moment.tz(now, userTimezone);
    
    const [hours, minutes] = schedule.time.split(':');
    
    // Create next time in user's timezone
    let nextTimeInTimezone = nowInTimezone.clone();
    nextTimeInTimezone.hour(parseInt(hours));
    nextTimeInTimezone.minute(parseInt(minutes));
    nextTimeInTimezone.second(0);
    nextTimeInTimezone.millisecond(0);
    
    console.log(`⏰ Initial next time (${userTimezone}): ${nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss')}, Current time: ${nowInTimezone.format('YYYY-MM-DD HH:mm:ss')}`);
    
    // Handle different frequencies
    if (schedule.frequency === 'daily') {
      // Daily: If time has passed today, schedule for tomorrow
      const beforeCheck = nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss');
      const isTimePassed = nextTimeInTimezone.isSameOrBefore(nowInTimezone);
      
      console.log(`📅 Daily calculation details:`, {
        currentTime: nowInTimezone.format('YYYY-MM-DD HH:mm:ss'),
        scheduledTime: beforeCheck,
        isTimePassed: isTimePassed
      });
      
      if (isTimePassed) {
        nextTimeInTimezone.add(1, 'day');
        console.log(`📅 Daily: Scheduled for tomorrow at ${nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss')} (${userTimezone})`);
      } else {
        console.log(`📅 Daily: Scheduled for today at ${nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss')} (${userTimezone})`);
      }
    } else if (schedule.frequency === 'weekly') {
      // Weekly: Always find next occurrence of the selected day
      const targetDay = schedule.days?.[0];
      if (!targetDay) {
        console.error(`⚠️ Weekly schedule ${schedule.id} missing target day`);
        return null;
      }
      
      const dayMap = { 
        'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 
        'thursday': 4, 'friday': 5, 'saturday': 6 
      };
      const targetDayNum = dayMap[targetDay.toLowerCase()];
      
      if (targetDayNum === undefined) {
        console.error(`⚠️ Invalid day name: ${targetDay}`);
        return null;
      }
      
      // Find next occurrence of target day
      const currentDay = nextTimeInTimezone.day();
      let daysToAdd = targetDayNum - currentDay;
      
      console.log(`📅 Weekly calculation details:`, {
        targetDay: targetDay,
        targetDayNum: targetDayNum,
        currentDay: currentDay,
        currentDayName: nextTimeInTimezone.format('dddd'),
        initialDaysToAdd: daysToAdd,
        nextTimeBefore: nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss'),
        nowTime: nowInTimezone.format('YYYY-MM-DD HH:mm:ss'),
        isAfter: nextTimeInTimezone.isAfter(nowInTimezone)
      });
      
      // If same day but time hasn't passed, use today
      // If same day but time has passed, or different day, go to next occurrence
      if (daysToAdd === 0 && nextTimeInTimezone.isAfter(nowInTimezone)) {
        // Same day, time hasn't passed yet - use today
        console.log(`📅 Weekly: Scheduled for today (${targetDay}) at ${nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss')} (${userTimezone})`);
      } else {
        // Different day or time has passed - find next occurrence
        if (daysToAdd <= 0) {
          daysToAdd += 7; // Next week
        }
        const beforeAdd = nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss');
        nextTimeInTimezone.add(daysToAdd, 'days');
        const afterAdd = nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss');
        console.log(`📅 Weekly: Scheduled for next ${targetDay} in ${daysToAdd} days (${beforeAdd} -> ${afterAdd}) (${userTimezone})`);
      }
    } else if (schedule.frequency === 'monthly') {
      // Monthly: Schedule for the specific date
      const targetDate = parseInt(schedule.days?.[0]);
      if (!targetDate || isNaN(targetDate)) {
        console.error(`⚠️ Monthly schedule ${schedule.id} missing or invalid target date`);
        return null;
      }
      
      const currentMonth = nextTimeInTimezone.month();
      const currentDate = nextTimeInTimezone.date();
      
      // Set to target date of current month
      nextTimeInTimezone.date(targetDate);
      
      // If target date doesn't exist in that month (e.g., Feb 30), use last day of month
      if (nextTimeInTimezone.date() !== targetDate) {
        nextTimeInTimezone.endOf('month');
      }
      
      const targetDateThisMonth = nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss');
      const isDatePassed = nextTimeInTimezone.isSameOrBefore(nowInTimezone);
      
      console.log(`📅 Monthly calculation details:`, {
        targetDate: targetDate,
        currentMonth: currentMonth + 1, // moment months are 0-indexed
        currentDate: currentDate,
        targetDateThisMonth: targetDateThisMonth,
        currentTime: nowInTimezone.format('YYYY-MM-DD HH:mm:ss'),
        isDatePassed: isDatePassed
      });
      
      // If date has passed or time has passed today, move to next month
      if (isDatePassed) {
        const beforeAdd = nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss');
        nextTimeInTimezone.add(1, 'month');
        nextTimeInTimezone.date(targetDate);
        // Handle edge case again for next month
        if (nextTimeInTimezone.date() !== targetDate) {
          nextTimeInTimezone.endOf('month');
        }
        const afterAdd = nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss');
        console.log(`📅 Monthly: Scheduled for ${targetDate} of next month (${beforeAdd} -> ${afterAdd}) (${userTimezone})`);
      } else {
        console.log(`📅 Monthly: Scheduled for ${targetDate} of this month at ${nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss')} (${userTimezone})`);
      }
    } else if (schedule.frequency === 'yearly') {
      // Yearly: Schedule for the specific month and date
      const month = schedule.days?.[0];
      const targetDate = parseInt(schedule.days?.[1]);
      
      if (!month || !targetDate || isNaN(targetDate)) {
        console.error(`⚠️ Yearly schedule ${schedule.id} missing month or date`);
        return null;
      }
      
      const monthMap = {
        'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
        'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
      };
      
      const targetMonthNum = monthMap[month.toLowerCase()];
      if (targetMonthNum === undefined) {
        console.error(`⚠️ Invalid month name: ${month}`);
        return null;
      }
      
      const currentYear = nextTimeInTimezone.year();
      const currentMonth = nextTimeInTimezone.month();
      
      // Set to target month and date of current year
      nextTimeInTimezone.month(targetMonthNum);
      nextTimeInTimezone.date(targetDate);
      
      // If target date doesn't exist in that month, use last day of month
      if (nextTimeInTimezone.date() !== targetDate) {
        nextTimeInTimezone.endOf('month');
      }
      
      const targetDateThisYear = nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss');
      const isDatePassed = nextTimeInTimezone.isSameOrBefore(nowInTimezone);
      
      console.log(`📅 Yearly calculation details:`, {
        targetMonth: month,
        targetMonthNum: targetMonthNum + 1, // moment months are 0-indexed
        targetDate: targetDate,
        currentYear: currentYear,
        currentMonth: currentMonth + 1,
        targetDateThisYear: targetDateThisYear,
        currentTime: nowInTimezone.format('YYYY-MM-DD HH:mm:ss'),
        isDatePassed: isDatePassed
      });
      
      // If date has passed or time has passed today, move to next year
      if (isDatePassed) {
        const beforeAdd = nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss');
        nextTimeInTimezone.add(1, 'year');
        nextTimeInTimezone.month(targetMonthNum);
        nextTimeInTimezone.date(targetDate);
        // Handle edge case again for next year
        if (nextTimeInTimezone.date() !== targetDate) {
          nextTimeInTimezone.endOf('month');
        }
        const afterAdd = nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss');
        console.log(`📅 Yearly: Scheduled for ${month} ${targetDate} next year (${beforeAdd} -> ${afterAdd}) (${userTimezone})`);
      } else {
        console.log(`📅 Yearly: Scheduled for ${month} ${targetDate} this year at ${nextTimeInTimezone.format('YYYY-MM-DD HH:mm:ss')} (${userTimezone})`);
      }
    }
    
    // Convert back to UTC Date object
    const nextTimeUTC = nextTimeInTimezone.utc().toDate();
    
    // Final safety check: ensure next time is in the future
    if (nextTimeUTC <= now) {
      console.log(`⚠️ Calculated time ${nextTimeUTC.toISOString()} is still in the past, adding one day`);
      nextTimeInTimezone.add(1, 'day');
      return nextTimeInTimezone.utc().toDate();
    }
    
    console.log(`✅ Final next execution time (UTC): ${nextTimeUTC.toISOString()}`);
    return nextTimeUTC;
    
  } catch (error) {
    console.error('Error calculating next execution time:', error);
    return null;
  }
}

/**
 * Calculate next execution time for a schedule (legacy function, kept for compatibility)
 */
function calculateNextExecutionTime(schedule, fromDate = new Date()) {
  // Use default timezone for legacy calls
  return calculateNextExecutionTimeWithTimezone(schedule, fromDate, 'America/New_York');
}

function generateEmailHTML(userName, reportContent, brandingInfo = {}) {
  const { emailMetrics, leadMetrics, vehicleMetrics, frequency, period } = reportContent;
  
  // Calculate next schedule date based on frequency
  const nextScheduleDate = calculateNextScheduleDate(frequency);
  
  // Default branding values
  const logoUrl = brandingInfo?.logoUrl || process.env.COMPANY_LOGO_URL || 'https://www.autopulse.ai/Images/logo.png';
  const companyName = brandingInfo?.companyName || process.env.COMPANY_NAME || 'Autopulse.ai';
  const companyWebsite = brandingInfo?.companyWebsite || process.env.COMPANY_WEBSITE || 'autopulse.ai';
  const footerText = brandingInfo?.footerText || `You are receiving this email because you registered on ${companyWebsite}.`;
  
  return `
    <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
          <title>Business Report</title>

          <style>
          body{
              margin:0;
              padding:0
          }
          .mail_parent table{
              border-spacing:0
          }
          .mail_parent img{
              border:0;
              height:auto;
              line-height:100%;
              outline:none;
              text-decoration:none
          }
          .mail_parent p{
              display:block;
              margin:13px 0
          }
          @media only screen and (min-width:950px){
              .mail_parent .column-100{
                  width:100%!important;
                  max-width:100%
              }
              .mail_parent .column-50{
                  width:50%!important;
                  max-width:50%
              }
          }
          .mail_parent u~div .img-container img+div{
              display:none
          }
          .mail_parent .links-0068A5-underline a{
              color:#0068a5;
              text-decoration:underline
          }
          .mail_parent .links-1A73E8-bold a{
              color:#1a73e8;
              text-decoration:none;
              font-weight:bold
          }
          .mail_parent .links-1A73E8-underline a{
              color:#1a73e8;
              text-decoration:underline
          }
          .mail_parent .links-1967D2-underline a{
              color:#1967d2;
              text-decoration:underline
          }
          @media only screen and (min-width:950px){
              .mail_parent .padding-0px-90px-8px-90px{
                  padding:0px 90px 8px 90px!important
              }
              .mail_parent .padding-8px-75px-8px-75px{
                  padding:8px 75px 8px 75px!important
              }
              .mail_parent .padding-8px-75px-0px-75px{
                  padding:8px 75px 0px 75px!important
              }
              .mail_parent .padding-0px-40px-20px-40px{
                  padding:0px 40px 20px 40px!important
              }
              .mail_parent .padding-10px-20px-0px-0px{
                  padding:10px 20px 0px 0px!important
              }
              .mail_parent .margin-0-auto-0-0{
                  margin:0 auto 0 0!important
              }
              .mail_parent .img-full-width{
                  max-width:100%!important
              }
              .mail_parent .text-align-left{
                  text-align:left!important
              }
              .mail_parent .padding-10px-0px-10px-0px{
                  padding:10px 0px 10px 0px!important
              }
              .mail_parent .padding-0px-0px-10px-0px{
                  padding:0px 0px 10px 0px!important
              }
              .mail_parent .padding-0px-20px-0px-0px{
                  padding:0px 20px 0px 0px!important
              }
              .mail_parent .padding-8px-10px-20px-10px{
                  padding:8px 10px 20px 10px!important
              }
              .mail_parent .padding-32px-30px-25px-30px{
                  padding:32px 30px 25px 30px!important
              }
              .mail_parent .padding-10px-65px-10px-65px{
                  padding:10px 65px 10px 65px!important
              }
          }
          .mail_parent p{
              margin:0 0
          }
          .mail_parent ul{
              display:block
          }
          .mail_parent sup,.mail_parent sub{
              line-height:0
          }
          .mail_parent body a{
              text-decoration:none;
              color:#0068a5
          }
          .mail_parent .image-highlight{
          }
          .mail_parent .image-highlight:hover{
          }
          .mail_parent .button-highlight{
          }
          .mail_parent .button-highlight:hover{
          }
          @media only screen and (min-width:950px){
              .mail_parent .hide-on-mobile{
                  display:block!important
              }
              .mail_parent .hide-on-desktop{
                  display:none!important
              }
          }
          .mail_parent .hide-on-desktop{
              display:block
          }
          .mail_parent .hide-on-mobile{
              display:none
          }
          .mail_parent [class~="x_body"]{
              width:99.9%
          }
          </style>

        </head>
        <body>
        <div style="background-color:#f1f3f4;background-position:center center;background-size:auto;background-repeat:repeat" class="mail_parent">
          <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%">
            <tbody>
              <tr>
                <td align="center">
                  <div style="Margin:0px auto;border-radius:0;max-width:600px">
                    <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;border-radius:0">
                      <tbody>
                        <tr>
                          <td style="border-radius:0;font-size:0px;padding:0px;text-align:center;vertical-align:top">
                            <div class="column-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%">
                              <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-radius:0px;vertical-align:top" width="100%">
                                <tbody>
                                  <tr>
                                    <td style="font-size:0px;padding:0 0 0 0;word-break:break-word">
                                      <div style="line-height:32px;height:32px">&nbsp;</div>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:transparent;width:100%">
            <tbody>
              <tr>
                <td align="center">
                  <div role="presentation">
                    <div style="background:#ffffff;background-color:#ffffff;Margin:0px auto;border-radius:0 0 0px 0px;max-width:600px">
                      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;width:100%;border-radius:12px 12px 0px 0px">
                        <tbody>
                          <tr>
                            <td style="border-radius:12px 12px 0px 0px;font-size:0px;padding:0px 0px 0px 0px;text-align:center;vertical-align:top">
                              <div class="column-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%">
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-radius:0px;vertical-align:top" width="100%">
                                  <tbody>
                                    <tr>
                                      <td class="img-container" style="font-size:0px;padding:32px 25px 24px 25px;word-break:break-word;text-align:center">
                                        <div style="margin:0 auto;max-width:170px">
                                          <img alt="Logo" height="auto" width="170" src="${logoUrl}" style="border:none;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;display:block" class="CToWUd" tabindex="0">
                                        </div>
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:transparent;width:100%">
            <tbody>
              <tr>
                <td align="center">
                  <div style="background:#ffffff;background-color:#ffffff;Margin:0px auto;max-width:600px">
                    <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;width:100%;">
                      <tbody>
                        <tr>
                          <td style="font-size:0px;padding:0px 0px 24px 0px;text-align:center;vertical-align:top">
                            <div class="column-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%">
                              <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                                <tbody>
                                  <tr>
                                    <td style="background-color:transparent;border-radius:0px;vertical-align:top;padding:5px 0px 5px 0px">
                                      <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                                        <tbody>
                                          <tr>
                                            <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 20px 8px 20px;word-break:break-word;text-align:center">
                                              <div class="links-1A73E8-bold">
                                                <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:22px;letter-spacing:none;line-height:1.50;text-align:center;color:#3c4043;padding-bottom:2px;">
                                                  <p style="margin:0 0"><b>${frequency.charAt(0).toUpperCase() + frequency.slice(1)} Business Report</b></p>
                                                </div>
                                                <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:center;color:#3c4043">
                                                  <p style="margin:0 0">${period.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${period.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>

                                          <tr>
                                            <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 20px 8px 20px;word-break:break-word;text-align:left;">
                                              <div class="links-1A73E8-bold">
                                                <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                  <p style="margin:0 0">Hello <b>${userName}</b>, here's your comprehensive business summary.</p>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>

                                          <tr>
                                            <td class="padding-8px-75px-0px-75px" style="font-size:0px;padding:8px 25px 0 25px;word-break:break-word;text-align:left">
                                              <div class="links-1A73E8-bold">
                                                <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:16px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                  <p style="margin:0 0"><b>Communication Overview</b></p>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                          
                                          <tr>
                                            <td class="padding-8px-75px-8px-75px" style="background-color:transparent;border-radius:0px;vertical-align:top;padding:8px 20px 8px 20px;">
                                              <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                                                <tbody>
                                                  <tr>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:50%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">Emails Sent:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${emailMetrics.email.sent || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:50%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">Emails Received:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${emailMetrics.email.received || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                  <tr>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:50%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">SMS Sent:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${emailMetrics.sms.sent || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:50%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">SMS Received:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${emailMetrics.sms.received || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                  <tr>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:50%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">Total Communications:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${emailMetrics.total || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:50%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">Unread Messages:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${emailMetrics.unread || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                </tbody>
                                              </table>
                                            </td>
                                          </tr>

                                          <tr>
                                            <td class="padding-8px-75px-0px-75px" style="font-size:0px;padding:8px 25px 0 25px;word-break:break-word;text-align:left">
                                              <div class="links-1A73E8-bold">
                                                <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:16px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                  <p style="margin:0 0"><b>Lead Status Distribution</b></p>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                          
                                          <tr>
                                            <td class="padding-8px-75px-8px-75px" style="background-color:transparent;border-radius:0px;vertical-align:top;padding:8px 20px 8px 20px;">
                                              <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                                                <tbody>
                                                  <tr>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:50%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">Total Leads:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${leadMetrics.total || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:50%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">New This Period:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${leadMetrics.newLeads || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                </tbody>
                                              </table>

                                              <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                                                <tbody>
                                                  <tr>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:33.333%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">Contacted:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${leadMetrics.convertedLeads || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:33.333%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">Appointment Booked:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${leadMetrics.bookedLeads || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                  <tr>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:33.333%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">Visited:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${leadMetrics.visitedLeads || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:33.333%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">Sold:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${leadMetrics.soldLeads || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:33.333%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;background-color:#FFF3CD;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">Managerial Review (All Time):</p>
                                                          <p style="margin:0; font-size:18px;"><b>${leadMetrics.managerialReviewLeads || 0}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                </tbody>
                                              </table>
                                            </td>
                                          </tr>

                                          ${Object.keys(leadMetrics.bySource || {}).length > 0 ? `
                                          <tr>
                                            <td class="padding-8px-75px-0px-75px" style="font-size:0px;padding:8px 25px 0 25px;word-break:break-word;text-align:left">
                                              <div class="links-1A73E8-bold">
                                                <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:16px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                  <p style="margin:0 0"><b>Lead Sources</b></p>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                          
                                          <tr>
                                            <td class="padding-8px-75px-8px-75px" style="background-color:transparent;border-radius:0px;vertical-align:top;padding:8px 20px 8px 20px;">
                                              <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                                                <tbody>
                                                  <tr>
                                                    ${Object.entries(leadMetrics.bySource).map(([source, count]) => `
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:33.333%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 6px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0 0 2px 0">${source.charAt(0).toUpperCase() + source.slice(1)}:</p>
                                                          <p style="margin:0; font-size:18px;"><b>${count}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                    `).join('')}
                                                  </tr>
                                                </tbody>
                                              </table>
                                            </td>
                                          </tr>
                                          ` : ''}

                                          ${Object.keys(leadMetrics.byLeadSource || {}).length > 0 ? `
                                          <tr>
                                            <td class="padding-8px-75px-0px-75px" style="font-size:0px;padding:8px 25px 0 25px;word-break:break-word;text-align:left">
                                              <div class="links-1A73E8-bold">
                                                <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:16px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                  <p style="margin:0 0"><b>Lead Source Field</b></p>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                          
                                          <tr>
                                            <td class="padding-8px-75px-8px-75px" style="background-color:transparent;border-radius:0px;vertical-align:top;padding:8px 20px 8px 20px;">
                                              <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                                                <tbody>
                                                  ${Object.entries(leadMetrics.byLeadSource).map(([source, count]) => `
                                                  <tr>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:100%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 4px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0;display: flex;align-items: center;">${source.charAt(0).toUpperCase() + source.slice(1)}: <b style="margin-left:auto; font-size:18px;">${count}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                  `).join('')}
                                                </tbody>
                                              </table>
                                            </td>
                                          </tr>
                                          ` : ''}

                                          ${Object.keys(vehicleMetrics.byStatus || {}).length > 0 ? `
                                          <tr>
                                            <td class="padding-8px-75px-0px-75px" style="font-size:0px;padding:8px 25px 0 25px;word-break:break-word;text-align:left">
                                              <div class="links-1A73E8-bold">
                                                <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:16px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                  <p style="margin:0 0"><b>Vehicle Status</b></p>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                          
                                          <tr>
                                            <td class="padding-8px-75px-8px-75px" style="background-color:transparent;border-radius:0px;vertical-align:top;padding:8px 20px 8px 20px;">
                                              <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                                                <tbody>
                                                  ${Object.entries(vehicleMetrics.byStatus).map(([status, count]) => `
                                                  <tr>
                                                    <td style="font-size:0px;padding:2px;word-break:break-word;text-align:left;width:100%;vertical-align: top;">
                                                      <div class="links-1A73E8-bold" style="border: 1px solid #f1f3f4;padding: 4px 8px;height:100%;">
                                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:14px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                          <p style="margin:0;display: flex;align-items: center;">${status.charAt(0).toUpperCase() + status.slice(1)}: <b style="margin-left:auto; font-size:18px;">${count}</b></p>
                                                        </div>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                  `).join('')}
                                                </tbody>
                                              </table>
                                            </td>
                                          </tr>
                                          ` : ''}

                                          <tr>
                                            <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 20px 8px 20px;word-break:break-word;text-align:left">
                                              <div class="links-1A73E8-bold">
                                                <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                                  <p style="margin:0 0">This report was automatically generated based on your schedule settings.</p>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                          <tr>
                                            <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 20px 8px 20px;word-break:break-word;text-align:left">
                                              <div class="links-1A73E8-bold">
                                                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#5f6368">
                                                  <p style="margin:0 0"><small>Next ${frequency} report: ${nextScheduleDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</small></p>
                                                  </div>
                                              </div>
                                            </td>
                                          </tr>
                                          
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          
          <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%">
            <tbody>
              <tr>
                <td align="center">
                  <div style="background:transparent;background-color:transparent;Margin:0px auto;border-radius:0;max-width:600px">
                    <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:transparent;width:100%;border-radius:0">
                      <tbody>
                        <tr>
                          <td style="border-radius:0;font-size:0px;padding:20px 0px 60px 0px;text-align:center;vertical-align:top">
                            <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                              <tbody>
                                <tr>
                                  <td style="background-color:transparent;line-height:0;font-size:0;direction:ltr;border-radius:0px">
                                    <div class="column-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%">
                                      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-radius:0px;vertical-align:top" width="100%">
                                        <tbody>
                                          <tr>
                                            <td class="padding-10px-65px-10px-65px" style="font-size:0px;padding:10px 25px 10px 25px;word-break:break-word;text-align:center">
                                              <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:12px;letter-spacing:0px;line-height:1.4;text-align:center;color:#5f6368">
                                                <p style="margin:0 0">© ${new Date().getFullYear()} ${companyName}</p>
                                                <p style="margin:0 0">&nbsp;</p>
                                                <p style="margin:0 0">${footerText}</p>
                                              </div>
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        </body>
        </html>
  `;
}
