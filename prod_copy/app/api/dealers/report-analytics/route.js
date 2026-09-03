import dbConnect from "@lib/mongodb";
import User from "@models/User";
import Lead from "@models/Lead";
import Email from "@models/Email";
import Vehicle from "@models/Vehicle";
import ReportSchedule from "@models/ReportSchedule";
import moment from "moment-timezone";

export async function GET(req) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(req.url);
    const dealerId = searchParams.get("dealer_id");
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    
    console.log('🚀 Report Analytics API called with:', { dealerId, startDate, endDate });
    
    if (!dealerId) {
      return new Response(JSON.stringify({ message: "Dealer ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if dealer exists
    const dealer = await User.findById(dealerId);
    if (!dealer) {
      return new Response(JSON.stringify({ message: "Dealer not found" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    console.log('✅ Dealer found:', dealer.name);

    // Get dealer timezone
    const dealerTimezone = dealer?.dealer_account_information?.time_zone || 'America/New_York';
    console.log('🌍 Using dealer timezone:', dealerTimezone);

    // Only apply date filter if both startDate and endDate are provided
    // If not provided, return all data without date filtering
    let periodStart = null;
    let periodEnd = null;
    
    if (startDate && endDate) {
      // IMPORTANT: Convert UTC dates back to dealer timezone first to get correct calendar dates
      const startMomentInDealer = moment.utc(startDate).tz(dealerTimezone);
      const endMomentInDealer = moment.utc(endDate).tz(dealerTimezone);
      
      // Extract date part (YYYY-MM-DD) from dealer timezone
      const startDateStr = startMomentInDealer.format('YYYY-MM-DD');
      const endDateStr = endMomentInDealer.format('YYYY-MM-DD');
      
      // Create moment objects in dealer's timezone at start/end of day
      const startMoment = moment.tz(startDateStr, 'YYYY-MM-DD', dealerTimezone).startOf('day');
      const endMoment = moment.tz(endDateStr, 'YYYY-MM-DD', dealerTimezone).endOf('day');
      
      // Convert to UTC for MongoDB query
      periodStart = startMoment.utc().toDate();
      periodEnd = endMoment.utc().toDate();
    }
    
    console.log('📅 Date range set to (UTC):', { periodStart, periodEnd, hasDateFilter: !!(periodStart && periodEnd) });

    // Get previous period for comparison (only if date filter is applied)
    let prevPeriodStart = null;
    let prevPeriodEnd = null;
    
    if (periodStart && periodEnd) {
      const periodDuration = periodEnd.getTime() - periodStart.getTime();
      prevPeriodStart = new Date(periodStart.getTime() - periodDuration);
      prevPeriodEnd = new Date(periodStart.getTime() - 1);
    }

    // Test query to see if there are any leads at all
    const totalLeadsInDB = await Lead.countDocuments({ dealer_id: dealerId });
    console.log('🔍 Total leads in database for dealer:', totalLeadsInDB);
    
    // Get email metrics
    const emailMetrics = await getEmailMetrics(dealerId, periodStart, periodEnd, prevPeriodStart, prevPeriodEnd);
    
    // Get lead metrics
    const leadMetrics = await getLeadMetrics(dealerId, periodStart, periodEnd);
    
    // Get vehicle metrics
    const vehicleMetrics = await getVehicleMetrics(dealerId, periodStart, periodEnd);
    
    // Get recent reports from ReportSchedule
    const recentReports = await getRecentReports(dealerId, dealerTimezone);

    // Determine period label (only if dates are provided)
    const periodLabel = (periodStart && periodEnd) ? getPeriodLabel(periodStart, periodEnd) : 'All Time';
    
    const response = {
      emailMetrics,
      leadMetrics,
      vehicleMetrics,
      recentReports,
      period: {
        start: periodStart,
        end: periodEnd,
        label: periodLabel
      }
    };
    
    console.log('📤 Final response:', JSON.stringify(response, null, 2));

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Report analytics error:", error);
    return new Response(JSON.stringify({ 
      message: "Failed to fetch report analytics",
      error: error.message 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function getEmailMetrics(dealerId, periodStart, periodEnd, prevPeriodStart, prevPeriodEnd) {
  try {
    // Build query for current period
    const currentQuery = { dealer_id: dealerId };
    if (periodStart && periodEnd) {
      // periodEnd is end of day, so use $lte to include it
      currentQuery.date = { $gte: periodStart, $lte: periodEnd };
    }
    
    // Get current period emails
    const currentEmails = await Email.find(currentQuery);

    // Get previous period emails for comparison (only if date filter is applied)
    let prevEmails = [];
    if (prevPeriodStart && prevPeriodEnd) {
      // prevPeriodEnd is end of day, so use $lte to include it
      prevEmails = await Email.find({
        dealer_id: dealerId,
        date: { $gte: prevPeriodStart, $lte: prevPeriodEnd }
      });
    }

    // Calculate metrics using communication_type and status fields
    const emailSent = currentEmails.filter(e => e.communication_type === 'email' && e.status === 'sent');
    const emailReceived = currentEmails.filter(e => e.communication_type === 'email' && e.status === 'incoming');
    const smsSent = currentEmails.filter(e => e.communication_type === 'sms' && e.status === 'sent');
    const smsReceived = currentEmails.filter(e => e.communication_type === 'sms' && e.status === 'received');

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
      total: currentEmails.length,
      unread: currentEmails.filter(e => e.status === 'incoming').length
    };
  } catch (error) {
    console.error('Error getting email metrics:', error);
    return {
      email: { sent: 0, received: 0, change: 0 },
      sms: { sent: 0, received: 0, change: 0 },
      total: 0,
      unread: 0
    };
  }
}

async function getLeadMetrics(dealerId, periodStart, periodEnd) {
  try {
    console.log('🔍 Getting lead metrics for dealer:', dealerId);
    console.log('📅 Period:', periodStart, 'to', periodEnd);
    
    // Build query - only apply date filter if dates are provided
    const leadsQuery = { dealer_id: dealerId };
    if (periodStart && periodEnd) {
      // periodEnd is end of day, so use $lte to include it
      leadsQuery.createdAt = { $gte: periodStart, $lte: periodEnd };
    }
    
    // Get leads in period - use createdAt (Mongoose timestamps)
    const leads = await Lead.find(leadsQuery);
    
    //console.log('📊 Found leads:', leads.length);
    if (leads.length > 0) {
      //console.log('🔍 Sample lead structure:', JSON.stringify(leads[0], null, 2));
    }

    // Build match stage for aggregation - only apply date filter if dates are provided
    const matchStage = { dealer_id: dealerId };
    if (periodStart && periodEnd) {
      // periodEnd is end of day, so use $lte to include it
      matchStage.createdAt = { $gte: periodStart, $lte: periodEnd };
    }
    
    // Get lead status distribution - check multiple possible status fields
    // IMPORTANT: Filter by date range to match total_leads calculation
    const statusAggregation = await Lead.aggregate([
      { $match: matchStage },
      { $group: { _id: '$fe_lead_status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    // Also try alternative status fields if fe_lead_status aggregation is empty
    let alternativeStatusAggregation = [];
    if (statusAggregation.length === 0) {
      alternativeStatusAggregation = await Lead.aggregate([
        { $match: matchStage },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);
      console.log('📈 Alternative status aggregation (status field):', alternativeStatusAggregation);
    }
    
    // Use alternative aggregation if primary is empty
    const finalStatusAggregation = statusAggregation.length > 0 ? statusAggregation : alternativeStatusAggregation;
    console.log('📈 Final status aggregation:', finalStatusAggregation);

    // Get new leads in period - check multiple possible status fields
    const newLeads = leads.filter(lead => {
      // Only check date range if dates are provided
      if (periodStart && periodEnd) {
        const leadDate = new Date(lead.createdAt);
        // periodEnd is start of next day, so use < instead of <=
        const isInPeriod = leadDate >= periodStart && leadDate < periodEnd;
        const isNewLead = lead.fe_lead_status === 'Lead' || lead.status === 'Lead' || lead.data?.fe_lead_status === 'Lead';
        return isInPeriod && isNewLead;
      } else {
        // No date filter - just check if it's a new lead
        const isNewLead = lead.fe_lead_status === 'Lead' || lead.status === 'Lead' || lead.data?.fe_lead_status === 'Lead';
        return isNewLead;
      }
    });
    
    console.log('🆕 New leads found:', newLeads.length);

    // Check status fields - match the EXACT logic from /api/leads/stats for consistency
    // Contacted: Only check fe_lead_status (matches visit_requested: fe_lead_status: 'Contacted')
    const contactedLeads = leads.filter(lead => 
      lead.fe_lead_status === 'Contacted'
    ).length;
    
    // Appointment: Check booking_status (matches appointment_booked: booking_status: true)
    const appointmentLeads = leads.filter(lead => 
      lead.booking_status === true
    ).length;
    
    // Managerial Review: ALWAYS fetch total count without date filter
    // This ensures managerial review count is not affected by date range selection
    const managerialReviewLeads = await Lead.countDocuments({ 
      dealer_id: dealerId, 
      fe_lead_status: 'Managerial Review' 
    });
    
    console.log('📊 Lead counts:', {
      total: leads.length,
      new: newLeads.length,
      contacted: contactedLeads,
      appointment: appointmentLeads,
      managerial: managerialReviewLeads
    });

    return {
      total_leads: leads.length,
      new_leads: newLeads.length,
      statuses: finalStatusAggregation,
      // Additional lead metrics based on fe_lead_status
      contacted_leads: contactedLeads,
      appointment_leads: appointmentLeads,
      managerial_review_leads: managerialReviewLeads
    };
  } catch (error) {
    console.error('Error getting lead metrics:', error);
    return {
      total_leads: 0,
      new_leads: 0,
      statuses: []
    };
  }
}

async function getVehicleMetrics(dealerId, periodStart, periodEnd) {
  try {
    // Build query - only apply date filter if dates are provided
    const vehiclesQuery = { dealer_id: dealerId };
    if (periodStart && periodEnd) {
      vehiclesQuery.created_at = { $gte: periodStart, $lte: periodEnd };
    }
    
    const vehicles = await Vehicle.find(vehiclesQuery);

    return {
      total_vehicles: vehicles.length,
      available: vehicles.filter(v => v.status === 'available').length,
      sold: vehicles.filter(v => v.status === 'sold').length,
      reserved: vehicles.filter(v => v.status === 'reserved').length
    };
  } catch (error) {
    console.error('Error getting vehicle metrics:', error);
    return {
      total_vehicles: 0,
      available: 0,
      sold: 0,
      reserved: 0
    };
  }
}

async function getRecentReports(dealerId, dealerTimezone) {
  try {
    // Fetch only pending scheduled reports from ReportSchedule
    const scheduledReports = await ReportSchedule.find({ 
      dealer_id: dealerId,
      status: 'pending' // Only show pending reports
    })
    .sort({ scheduledAt: -1 })
    .limit(20)
    .lean();

    if (!scheduledReports || scheduledReports.length === 0) {
      return [];
    }

    // Get user to access schedule settings for frequency type
    const dealer = await User.findById(dealerId).select('report_schedule_settings');
    const schedules = dealer?.report_schedule_settings?.schedules || [];

    // Map ReportSchedule entries to display format with calculated metrics
    const reports = await Promise.all(scheduledReports.map(async (report) => {
      // Find the corresponding schedule to get frequency type
      const schedule = schedules.find(s => s.id === report.schedule_id);
      const frequencyType = schedule?.frequency || report.frequency || 'unknown';
      
      // Format frequency for display
      const typeMap = {
        'daily': 'Daily',
        'weekly': 'Weekly',
        'monthly': 'Monthly',
        'yearly': 'Yearly'
      };
      const type = typeMap[frequencyType] || frequencyType.charAt(0).toUpperCase() + frequencyType.slice(1);

      // Convert scheduledAt to dealer timezone for display
      const scheduledAtMoment = moment(report.scheduledAt).tz(dealerTimezone);
      
      // Convert sentAt to dealer timezone if it exists
      let sentAtDisplay = null;
      if (report.sentAt) {
        const sentAtMoment = moment(report.sentAt).tz(dealerTimezone);
        sentAtDisplay = sentAtMoment.format('MMM DD, YYYY h:mm A');
      }
      
      // Calculate the report period based on frequency and scheduledAt date
      const reportPeriod = calculateReportPeriodForDate(frequencyType, report.scheduledAt, dealerTimezone);
      
      // Calculate metrics for this report period
      const metrics = await calculateReportMetrics(dealerId, reportPeriod);
      
      return {
        id: report._id.toString(),
        scheduledAt: report.scheduledAt, // Keep UTC date for sorting
        scheduledAtFormatted: scheduledAtMoment.format('YYYY-MM-DD HH:mm:ss'),
        scheduledAtDisplay: scheduledAtMoment.format('MMM DD, YYYY h:mm A'),
        timezone: dealerTimezone,
        type: type,
        frequency: frequencyType,
        status: report.status || 'pending',
        sentAt: report.sentAt || null,
        sentAtDisplay: sentAtDisplay,
        metrics: {
          leads: metrics.leads,
          emails: metrics.emails,
          sms: metrics.sms,
          vehicles: metrics.vehicles
        }
      };
    }));

    return reports;
  } catch (error) {
    console.error('Error getting recent reports:', error);
    return [];
  }
}

// Calculate report period based on frequency and a reference date
function calculateReportPeriodForDate(frequency, referenceDate, dealerTimezone) {
  // Convert reference date to dealer timezone
  const refMoment = moment(referenceDate).tz(dealerTimezone);
  const refDate = refMoment.toDate();
  
  let startDate, endDate;
  
  switch (frequency) {
    case 'daily':
      // Last 1 day (from day before reference date to reference date)
      startDate = moment(refDate).tz(dealerTimezone).subtract(1, 'day').startOf('day').utc().toDate();
      endDate = moment(refDate).tz(dealerTimezone).endOf('day').utc().toDate();
      break;
      
    case 'weekly':
      // Last 7 days
      startDate = moment(refDate).tz(dealerTimezone).subtract(7, 'days').startOf('day').utc().toDate();
      endDate = moment(refDate).tz(dealerTimezone).endOf('day').utc().toDate();
      break;
      
    case 'monthly':
      // Last 30 days
      startDate = moment(refDate).tz(dealerTimezone).subtract(30, 'days').startOf('day').utc().toDate();
      endDate = moment(refDate).tz(dealerTimezone).endOf('day').utc().toDate();
      break;
      
    case 'yearly':
      // Last 365 days
      startDate = moment(refDate).tz(dealerTimezone).subtract(365, 'days').startOf('day').utc().toDate();
      endDate = moment(refDate).tz(dealerTimezone).endOf('day').utc().toDate();
      break;
      
    default:
      // Fallback to daily
      startDate = moment(refDate).tz(dealerTimezone).subtract(1, 'day').startOf('day').utc().toDate();
      endDate = moment(refDate).tz(dealerTimezone).endOf('day').utc().toDate();
      break;
  }
  
  return { startDate, endDate };
}

// Calculate metrics for a specific report period
async function calculateReportMetrics(dealerId, period) {
  try {
    const { startDate, endDate } = period;
    
    // Get leads count
    const leadsCount = await Lead.countDocuments({
      dealer_id: dealerId,
      createdAt: { $gte: startDate, $lte: endDate }
    });
    
    // Get email and SMS counts
    const emailSent = await Email.countDocuments({
      dealer_id: dealerId,
      date: { $gte: startDate, $lte: endDate },
      communication_type: 'email',
      status: 'sent'
    });
    
    const smsSent = await Email.countDocuments({
      dealer_id: dealerId,
      date: { $gte: startDate, $lte: endDate },
      communication_type: 'sms',
      status: 'sent'
    });
    
    // Get vehicles count (vehicles added to inventory in this period)
    // Use same pattern as existing getVehicleMetrics function
    // Vehicle model has strict: false and timestamps: true, so it uses createdAt
    // Match the existing pattern: use dealer_id and created_at (as in getVehicleMetrics)
    const vehiclesCount = await Vehicle.countDocuments({
      $or: [
        { dealerId: dealerId.toString(), createdAt: { $gte: startDate, $lte: endDate } },
        { dealer_id: dealerId, created_at: { $gte: startDate, $lte: endDate } }
      ]
    });
    
    return {
      leads: leadsCount,
      emails: emailSent,
      sms: smsSent,
      vehicles: vehiclesCount
    };
  } catch (error) {
    console.error('Error calculating report metrics:', error);
    return {
      leads: 0,
      emails: 0,
      sms: 0,
      vehicles: 0
    };
  }
}

function calculatePercentageChange(previous, current) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function getPeriodLabel(start, end) {
  if (!start || !end) {
    return 'All Time';
  }
  
  const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  
  if (startMonth === endMonth && startYear === endYear) {
    return `${startMonth} ${startYear}`;
  } else if (startYear === endYear) {
    return `${startMonth} - ${endMonth} ${startYear}`;
  } else {
    return `${startMonth} ${startYear} - ${endMonth} ${endYear}`;
  }
}
