import Lead from '../models/Lead.js';
import Email from '../models/Email.js';
import Vehicle from '../models/Vehicle.js';
import ReportSchedule from '../models/ReportSchedule.js';
import { sendEmail } from './email.js';

export async function generateAndSendReport(reportData) {
  try {
    const { userId, userName, userEmail, schedule, reportId, settings } = reportData;
    console.log(`Generating report for user: ${userName}, reportId: ${reportId}`);
    
    const reportContent = await generateReportContent(userId, schedule);
    if (!reportContent) {
      console.error('Failed to generate report content');
      return false;
    }
    
    const emailSent = await sendReportEmail(userEmail, userName, reportContent);
    if (emailSent) {
      console.log(`Report email sent successfully to ${userEmail}`);
      
      // Update the current report schedule status to "sent" using the ReportSchedule ID
      await updateReportScheduleStatus(reportId, 'sent');
      
      // Create the next scheduled report entry
      await createNextReportSchedule(userId, schedule, settings);
      
      return true;
    } else {
      console.error(`Failed to send report email to ${userEmail}`);
      
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

    return {
      total: leads.length,
      change: calculatePercentageChange(prevLeads.length, leads.length),
      bySource,
      byLeadSource,
      newLeads: leads.filter(lead => lead.fe_lead_status === 'Lead').length,
      convertedLeads: leads.filter(lead => lead.fe_lead_status === 'Contacted').length
    };
  } catch (error) {
    console.error('Error getting lead metrics:', error);
    return { total: 0, change: 0, bySource: {}, newLeads: 0, convertedLeads: 0 };
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



async function sendReportEmail(email, userName, reportContent) {
  try {
    const htmlContent = generateEmailHTML(userName, reportContent);
    
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
    
    // Calculate next execution time based on frequency
    const nextExecutionTime = calculateNextExecutionTime(schedule, new Date());
    
    if (!nextExecutionTime) {
      console.log(`⚠️ Could not calculate next execution time for schedule ${schedule.id}`);
      return;
    }
    
    console.log(`📅 Next execution time calculated: ${nextExecutionTime.toISOString()}`);
    
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
 * Calculate next execution time for a schedule
 */
function calculateNextExecutionTime(schedule, fromDate = new Date()) {
  try {
    console.log(`🔄 Calculating next execution time for schedule ${schedule.id} (${schedule.frequency})`);
    
    const now = fromDate;
    const [hours, minutes] = schedule.time.split(':');
    
    let nextTime = new Date(now);
    nextTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    
    console.log(`⏰ Initial next time: ${nextTime.toISOString()}, Current time: ${now.toISOString()}`);
    
    // If time has passed today, schedule for next occurrence
    if (nextTime <= now) {
      console.log(`⏰ Time has passed, calculating next occurrence...`);
      
      if (schedule.frequency === 'daily') {
        nextTime.setDate(nextTime.getDate() + 1);
        console.log(`📅 Daily: Scheduled for tomorrow at ${nextTime.toISOString()}`);
      } else if (schedule.frequency === 'weekly') {
        // Find next occurrence of the selected day
        const targetDay = schedule.days[0];
        const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
        const targetDayNum = dayMap[targetDay.toLowerCase()];
        
        let daysToAdd = (targetDayNum - now.getDay() + 7) % 7;
        if (daysToAdd === 0) daysToAdd = 7; // If same day, schedule for next week
        nextTime.setDate(nextTime.getDate() + daysToAdd);
        console.log(`📅 Weekly: Scheduled for ${targetDay} in ${daysToAdd} days at ${nextTime.toISOString()}`);
      } else if (schedule.frequency === 'monthly') {
        // Schedule for the specific date of next month
        const targetDate = parseInt(schedule.days[0]);
        nextTime.setMonth(nextTime.getMonth() + 1);
        nextTime.setDate(targetDate);
        console.log(`📅 Monthly: Scheduled for ${targetDate} of next month at ${nextTime.toISOString()}`);
      } else if (schedule.frequency === 'yearly') {
        // Schedule for the specific month and date of next year
        const month = schedule.days[0];
        const targetDate = parseInt(schedule.days[1]);
        const monthMap = {
          'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
          'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
        };
        
        nextTime.setFullYear(nextTime.getFullYear() + 1);
        nextTime.setMonth(monthMap[month.toLowerCase()], targetDate);
        console.log(`📅 Yearly: Scheduled for ${month} ${targetDate} next year at ${nextTime.toISOString()}`);
      }
    }
    
    // Final safety check: ensure next time is in the future
    if (nextTime <= now) {
      console.log(`⚠️ Calculated time ${nextTime.toISOString()} is still in the past, adding one day`);
      nextTime.setDate(nextTime.getDate() + 1);
    }
    
    console.log(`✅ Final next execution time: ${nextTime.toISOString()}`);
    return nextTime;
    
  } catch (error) {
    console.error('Error calculating next execution time:', error);
    return null;
  }
}

function generateEmailHTML(userName, reportContent) {
  const { emailMetrics, leadMetrics, vehicleMetrics, frequency, period } = reportContent;
  
  // Calculate next schedule date based on frequency
  const nextScheduleDate = calculateNextScheduleDate(frequency);
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Business Report</title>
      <style>
        /* Reset and base styles */
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
          line-height: 1.6; 
          color: #333; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 20px;
        }
        
        /* Container */
        .email-container { 
          max-width: 800px; 
          margin: 0 auto; 
          background: #ffffff; 
          border-radius: 20px; 
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0,0,0,0.15);
        }
        
        /* Header */
        .header { 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white; 
          padding: 40px 30px; 
          text-align: center;
          position: relative;
        }
        
        .header::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r="1" fill="white" opacity="0.1"/><circle cx="75" cy="75" r="1" fill="white" opacity="0.1"/><circle cx="50" cy="10" r="0.5" fill="white" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>');
        }
        
        .header-content {
          position: relative;
          z-index: 1;
        }
        
        .header h1 { 
          font-size: 32px; 
          font-weight: 700; 
          margin-bottom: 10px;
          text-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .header .subtitle { 
          font-size: 18px; 
          opacity: 0.9; 
          margin-bottom: 15px;
          font-weight: 300;
        }
        
        .header .date { 
          font-size: 16px; 
          opacity: 0.8;
          font-weight: 500;
        }
        
        .header .frequency { 
          font-size: 14px; 
          opacity: 0.7;
          font-weight: 400;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-top: 10px;
        }
        
        /* Content */
        .content { 
          padding: 40px 30px; 
          background: #fafbfc;
        }
        
        /* Metric Cards */
        .metric-card { 
          background: white; 
          border-radius: 16px; 
          padding: 30px; 
          margin-bottom: 25px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          border: 1px solid #e8eaed;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        
        .metric-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 30px rgba(0,0,0,0.12);
        }
        
        .metric-title { 
          font-size: 20px; 
          font-weight: 600; 
          color: #1a1a1a; 
          margin-bottom: 25px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .metric-title .icon {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 8px;
          color: white;
          font-size: 14px;
        }
        
        /* Grid Layout */
        .metric-grid { 
          display: grid; 
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); 
          gap: 20px; 
          margin-bottom: 25px;
        }
        
        .metric-item { 
          text-align: center; 
          padding: 20px 15px;
          background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
          border-radius: 12px;
          border: 1px solid #e8eaed;
          transition: all 0.2s ease;
        }
        
        .metric-item:hover {
          background: linear-gradient(135deg, #e9ecef 0%, #dee2e6 100%);
          transform: translateY(-1px);
        }
        
        .metric-value { 
          font-size: 32px; 
          font-weight: 700; 
          color: #667eea; 
          margin-bottom: 8px;
          line-height: 1;
        }
        
        .metric-label { 
          color: #6c757d; 
          font-size: 14px; 
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .metric-change { 
          font-size: 12px; 
          font-weight: 600; 
          padding: 4px 8px; 
          border-radius: 20px; 
          display: inline-block;
          margin-top: 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .positive { 
          color: #28a745; 
          background: #d4edda; 
          border: 1px solid #c3e6cb;
        }
        
        .negative { 
          color: #dc3545; 
          background: #f8d7da; 
          border: 1px solid #f5c6cb;
        }
        
        /* Stats Row */
        .stats-row { 
          display: grid; 
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); 
          gap: 15px; 
        }
        
        /* Footer */
        .footer {
          background: #f8f9fa;
          padding: 30px;
          text-align: center;
          border-top: 1px solid #e8eaed;
        }
        
        .footer p {
          margin-bottom: 10px;
          color: #6c757d;
        }
        
        .next-report {
          font-weight: 600;
          color: #667eea;
          font-size: 16px;
        }
        
        .stat-box { 
          text-align: center; 
          padding: 20px 15px; 
          background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
          border-radius: 12px; 
          border: 1px solid #e8eaed;
          transition: all 0.2s ease;
        }
        
        .stat-box:hover {
          background: linear-gradient(135deg, #e9ecef 0%, #dee2e6 100%);
          transform: translateY(-1px);
        }
        
        .stat-value { 
          font-size: 24px; 
          font-weight: 700; 
          color: #667eea; 
          margin-bottom: 5px;
        }
        
        .stat-label { 
          color: #6c757d; 
          font-size: 12px; 
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        /* Footer */
        .footer { 
          text-align: center; 
          margin-top: 40px; 
          padding: 30px; 
          background: #f8f9fa;
          border-top: 1px solid #e8eaed;
          color: #6c757d;
        }
        
        .footer p { 
          margin-bottom: 10px; 
          font-size: 14px;
        }
        
        .footer .next-report { 
          color: #667eea; 
          font-weight: 600;
          font-size: 16px;
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
          body { padding: 10px; }
          .email-container { border-radius: 16px; }
          .header { padding: 30px 20px; }
          .header h1 { font-size: 28px; }
          .content { padding: 30px 20px; }
          .metric-card { padding: 25px 20px; }
          .metric-grid { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 15px; }
          .metric-value { font-size: 28px; }
        }
        
        @media (max-width: 480px) {
          .metric-grid { grid-template-columns: 1fr 1fr; }
          .stats-row { grid-template-columns: 1fr 1fr; }
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <!-- Header -->
        <div class="header">
          <div class="header-content">
            <h1>📊 ${frequency.charAt(0).toUpperCase() + frequency.slice(1)} Business Report</h1>
            <div class="subtitle">Hello ${userName}, here's your comprehensive business summary</div>
            <div class="date">${period.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${period.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
            <div class="frequency">${frequency.toUpperCase()} Report</div>
          </div>
        </div>
        
        <!-- Content -->
        <div class="content">
          <!-- Communication Overview -->
          <div class="metric-card">
            <div class="metric-title">
              <div class="icon">📧</div>
              Communication Overview
            </div>
            <div class="metric-grid">
              <div class="metric-item">
                <div class="metric-value">${emailMetrics.email.sent || 0}</div>
                <div class="metric-label">Emails Sent</div>
                
              </div>
              <div class="metric-item">
                <div class="metric-value">${emailMetrics.email.received || 0}</div>
                <div class="metric-label">Emails Received</div>
              </div>
              <div class="metric-item">
                <div class="metric-value">${emailMetrics.sms.sent || 0}</div>
                <div class="metric-label">SMS Sent</div>
               
              </div>
              <div class="metric-item">
                <div class="metric-value">${emailMetrics.sms.received || 0}</div>
                <div class="metric-label">SMS Received</div>
              </div>
            </div>
            
            <!-- Additional Communication Stats -->
            <div class="stats-row">
              <div class="stat-box">
                <div class="stat-value">${emailMetrics.total || 0}</div>
                <div class="stat-label">Total Communications</div>
              </div>
              <div class="stat-box">
                <div class="stat-value">${emailMetrics.unread || 0}</div>
                <div class="stat-label">Unread Messages</div>
              </div>
            </div>
          </div>
          
          <!-- Lead Status Distribution -->
          <div class="metric-card">
            <div class="metric-title">
              <div class="icon">🎯</div>
              Lead Status Distribution
            </div>
            <div class="metric-grid">
              <div class="metric-item">
                <div class="metric-value">${leadMetrics.total || 0}</div>
                <div class="metric-label">Total Leads</div>
              </div>
              <div class="metric-item">
                <div class="metric-value">${leadMetrics.newLeads || 0}</div>
                <div class="metric-label">New This Period</div>
              </div>
              <div class="metric-item">
                <div class="metric-value">${leadMetrics.convertedLeads || 0}</div>
                <div class="metric-label">Contacted</div>
              </div>
              <div class="metric-item">
                <div class="metric-value">${vehicleMetrics.total || 0}</div>
                <div class="metric-label">Total Vehicles</div>
              </div>
            </div>
          </div>
          
          <!-- Lead Source Breakdown (source field) -->
          ${Object.keys(leadMetrics.bySource || {}).length > 0 ? `
          <div class="metric-card">
            <div class="metric-title">
              <div class="icon">📈</div>
              Lead Sources
            </div>
            <div class="metric-grid">
              ${Object.entries(leadMetrics.bySource).map(([source, count]) => `
                <div class="metric-item">
                  <div class="metric-value">${count}</div>
                  <div class="metric-label">${source.charAt(0).toUpperCase() + source.slice(1)}</div>
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}

          <!-- Lead Source Breakdown (lead_source field) -->
          ${Object.keys(leadMetrics.byLeadSource || {}).length > 0 ? `
          <div class="metric-card">
            <div class="metric-title">
              <div class="icon">🔎</div>
              Lead Source Field
            </div>
            <div class="metric-grid">
              ${Object.entries(leadMetrics.byLeadSource).map(([source, count]) => `
                <div class="metric-item">
                  <div class="metric-value">${count}</div>
                  <div class="metric-label">${source.charAt(0).toUpperCase() + source.slice(1)}</div>
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}
          
          <!-- Vehicle Status -->
          ${Object.keys(vehicleMetrics.byStatus || {}).length > 0 ? `
          <div class="metric-card">
            <div class="metric-title">
              <div class="icon">🚗</div>
              Vehicle Status
            </div>
            <div class="metric-grid">
              ${Object.entries(vehicleMetrics.byStatus).map(([status, count]) => `
                <div class="metric-item">
                  <div class="metric-value">${count}</div>
                  <div class="metric-label">${status.charAt(0).toUpperCase() + status.slice(1)}</div>
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}
        </div>
        
        <!-- Footer -->
        <div class="footer">
          <p>This report was automatically generated based on your schedule settings.</p>
          <p class="next-report">Next ${frequency} report: ${nextScheduleDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>
    </body>
    </html>
  `;
}
