// app/api/admin/message-stats/route.js
import dbConnect from "@lib/mongodb";
import Email from "@models/Email";
import User from "@models/User";
import moment from "moment-timezone";


export async function GET(request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const start_date = searchParams.get('start_date');
    const end_date = searchParams.get('end_date');
    const dealer_id = searchParams.get('dealer_id');
    
    // Get dealer timezone if dealer_id is provided
    let dealerTimezone = 'America/New_York';
    if (dealer_id) {
      const dealer = await User.findById(dealer_id);
      dealerTimezone = dealer?.dealer_account_information?.time_zone || 'America/New_York';
    }
    
    // Only apply date filter if both start_date and end_date are provided
    // If not provided, return all messages without date filtering
    let dateQuery = {};
    if (dealer_id) {
      dateQuery.dealer_id = dealer_id;
    }
    
    let startDate = null;
    let endDate = null;
    let dailyStats = [];
    
    if (start_date && end_date) {
      // IMPORTANT: Convert UTC dates back to dealer timezone first to get correct calendar dates
      const startMomentInDealer = moment.utc(start_date).tz(dealerTimezone);
      const endMomentInDealer = moment.utc(end_date).tz(dealerTimezone);
      
      // Extract date part (YYYY-MM-DD) from dealer timezone
      const startDateStr = startMomentInDealer.format('YYYY-MM-DD');
      const endDateStr = endMomentInDealer.format('YYYY-MM-DD');
      
      // Create moment objects in dealer's timezone at start/end of day
      const startMoment = moment.tz(startDateStr, 'YYYY-MM-DD', dealerTimezone).startOf('day');
      const endMoment = moment.tz(endDateStr, 'YYYY-MM-DD', dealerTimezone).endOf('day');
      
      // Convert to UTC for MongoDB query
      startDate = startMoment.utc().toDate();
      endDate = endMoment.utc().toDate();

      // Add date range to query - use $lte to include the entire end date
      dateQuery.date = {
        $gte: startDate,
        $lte: endDate
      };
      
      // Get daily stats with date range
      dailyStats = await getDailyMessageStats(startDate, endDate, dealer_id, dealerTimezone);
    } else {
      // When no date range provided, get daily stats for all messages
      // Find the earliest and latest message dates for this dealer
      const dateRangeQuery = dealer_id ? { dealer_id } : {};
      const dateBounds = await Email.aggregate([
        { $match: dateRangeQuery },
        {
          $group: {
            _id: null,
            minDate: { $min: '$date' },
            maxDate: { $max: '$date' }
          }
        }
      ]);
      
      if (dateBounds.length > 0 && dateBounds[0].minDate && dateBounds[0].maxDate) {
        // Use the actual date range from the data
        startDate = dateBounds[0].minDate;
        endDate = dateBounds[0].maxDate;
        dailyStats = await getDailyMessageStats(startDate, endDate, dealer_id, dealerTimezone);
      } else {
        // No messages found, return empty daily stats
        dailyStats = [];
      }
    }

    // Get total counts (with or without date filter)
    const [emailCount, smsCount] = await Promise.all([
      Email.countDocuments({ ...dateQuery, communication_type: 'email' }),
      Email.countDocuments({ ...dateQuery, communication_type: 'sms' })
    ]);

    // Get min/max dates from dailyStats for date range info
    let messageMinDate = null;
    let messageMaxDate = null;
    
    if (dailyStats && dailyStats.length > 0) {
      const dates = dailyStats.map(s => s.date).filter(Boolean).sort();
      if (dates.length > 0) {
        messageMinDate = new Date(dates[0] + 'T00:00:00');
        messageMaxDate = new Date(dates[dates.length - 1] + 'T00:00:00');
      }
    }
    
    return new Response(JSON.stringify({ 
      emailCount,
      smsCount,
      dailyStats,
      date_range: {
        min_date: messageMinDate,
        max_date: messageMaxDate
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error fetching message stats:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch message stats' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function getDailyMessageStats(startDate, endDate, dealer_id, dealerTimezone) {
  // Get dealer timezone if not provided
  if (!dealerTimezone) {
    const User = (await import('@models/User')).default;
    if (dealer_id) {
      const dealer = await User.findById(dealer_id);
      dealerTimezone = dealer?.dealer_account_information?.time_zone || 'America/New_York';
    } else {
      dealerTimezone = 'America/New_York';
    }
  }

  // Extract the actual date range from UTC dates
  // endDate is end of day in UTC (23:59:59), so we can extract the date directly
  const startMoment = moment(startDate).tz(dealerTimezone);
  const endMoment = moment(endDate).tz(dealerTimezone); // This is end of day
  
  // Extract date strings directly (no need to subtract since endDate is already end of the correct day)
  const startDateStr = startMoment.format('YYYY-MM-DD');
  const endDateStr = endMoment.format('YYYY-MM-DD');
  
  // Generate date array based on dealer's timezone - ONLY dates from startDateStr to endDateStr
  const dateArray = [];
  let currentMoment = moment.tz(startDateStr, 'YYYY-MM-DD', dealerTimezone).startOf('day');
  const endMomentDay = moment.tz(endDateStr, 'YYYY-MM-DD', dealerTimezone).startOf('day');
  
  while (currentMoment.isSameOrBefore(endMomentDay, 'day')) {
    const dateStr = currentMoment.format('YYYY-MM-DD');
    // Only include dates up to endDateStr
    if (dateStr <= endDateStr) {
      dateArray.push(dateStr);
    }
    currentMoment.add(1, 'day');
    // Safety check: break if we've exceeded the end date
    if (currentMoment.isAfter(endMomentDay, 'day')) {
      break;
    }
  }
  
  // Final safety check: ensure dateArray only contains dates <= endDateStr
  const finalDateArray = dateArray.filter(dateStr => dateStr <= endDateStr);
  
  // Use $lte for endDate since it's end of day
  const baseMatch = {
    date: { $gte: startDate, $lte: endDate }
  };

  // Add dealer_id if provided
  if (dealer_id) {
    baseMatch.dealer_id = dealer_id;
  }

  // Get email counts by day - group by dealer timezone directly
  const emailStats = await Email.aggregate([
    {
      $match: {
        ...baseMatch,
        communication_type: 'email'
      }
    },
    {
      $addFields: {
        // Convert date to dealer timezone date string for filtering
        dealerDateStr: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$date",
            timezone: dealerTimezone
          }
        }
      }
    },
    {
      $match: {
        // CRITICAL: Filter by dealer timezone date to exclude dates beyond endDateStr
        // Use $in with finalDateArray to ensure only selected dates are included
        dealerDateStr: { $in: finalDateArray }
      }
    },
    {
      $group: {
        _id: "$dealerDateStr",  // Group by dealer timezone date
        count: { $sum: 1 }
      }
    }
  ]);

  // Get SMS counts by day - group by dealer timezone directly
  const smsStats = await Email.aggregate([
    {
      $match: {
        ...baseMatch,
        communication_type: 'sms'
      }
    },
    {
      $addFields: {
        // Convert date to dealer timezone date string for filtering
        dealerDateStr: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$date",
            timezone: dealerTimezone
          }
        }
      }
    },
    {
      $match: {
        // CRITICAL: Filter by dealer timezone date to exclude dates beyond endDateStr
        // Use $in with finalDateArray to ensure only selected dates are included
        dealerDateStr: { $in: finalDateArray }
      }
    },
    {
      $group: {
        _id: "$dealerDateStr",  // Group by dealer timezone date
        count: { $sum: 1 }
      }
    }
  ]);

  // MongoDB now returns dates already in dealer timezone, so no conversion needed
  // Filter results to only include dates in finalDateArray (double-check)
  const filteredEmailStats = emailStats.filter(entry => {
    const dateStr = String(entry._id || '');
    return finalDateArray.includes(dateStr) && dateStr >= startDateStr && dateStr <= endDateStr;
  });
  
  const filteredSmsStats = smsStats.filter(entry => {
    const dateStr = String(entry._id || '');
    return finalDateArray.includes(dateStr) && dateStr >= startDateStr && dateStr <= endDateStr;
  });

  // Combine into a single array with all dates (using dealer timezone dates)
  // IMPORTANT: Only return dates that are in finalDateArray (the selected range)
  return finalDateArray
    .filter(dateStr => dateStr >= startDateStr && dateStr <= endDateStr)  // Final filter
    .map(dateStr => {
      const emailEntry = filteredEmailStats.find(e => String(e._id) === dateStr);
      const smsEntry = filteredSmsStats.find(e => String(e._id) === dateStr);
      
      return {
        date: dateStr,
        emailCount: emailEntry?.count || 0,
        smsCount: smsEntry?.count || 0
      };
    });
}