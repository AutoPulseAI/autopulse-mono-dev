import { contactedLeadIds } from '@lib/contactedLeads';
import dbConnect from "@lib/mongodb";
import Lead from "@models/Lead";
import Email from "@models/Email";
import User from "@models/User";
import moment from "moment-timezone";

export async function GET(request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const dealer_id = searchParams.get('dealer_id');
    let start_date = searchParams.get('start_date');
    let end_date = searchParams.get('end_date');
    const managerial_review_only = searchParams.get('managerial_review_only') === 'true';
    const all_appointment_booked = searchParams.get('all_appointment_booked') === 'true';
    const new_this_week_only = searchParams.get('new_this_week_only') === 'true';
    const month_till_date = searchParams.get('month_till_date') === 'true';
    const fe_lead_status = searchParams.get('fe_lead_status');
    const use_booking_date = searchParams.get('use_booking_date') === 'true';
    
    if (!dealer_id) {
      return new Response(JSON.stringify({ error: 'Dealer ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get dealer timezone
    const dealer = await User.findById(dealer_id);
    const dealerTimezone = dealer?.dealer_account_information?.time_zone || 'America/New_York';

    // If only managerial review is requested, return just that count without date filter
    if (managerial_review_only) {
      const managerial_review_count = await Lead.countDocuments({ 
        dealer_id, 
        fe_lead_status: 'Managerial Review' 
      });
      
      return new Response(JSON.stringify({
        managerial_review: managerial_review_count
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (all_appointment_booked) {
      const all_appointment_booked_count = await Lead.countDocuments({ 
        dealer_id, 
        booking_status: true 
      });
      return new Response(JSON.stringify({
        total_leads: all_appointment_booked_count
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // If only new_this_week is requested, return just that count for current week (no date filter)
    if (new_this_week_only) {
      // Calculate start of current week in dealer timezone
      const nowInDealerTz = moment.tz(dealerTimezone);
      const startOfWeek = nowInDealerTz.clone().startOf('isoWeek'); // isoWeek starts on Monday
      const startOfWeekUTC = startOfWeek.utc().toDate();
      
      const new_this_week_count = await Lead.countDocuments({ 
        dealer_id,
        createdAt: { 
          $gte: startOfWeekUTC
        }
      });
      
      return new Response(JSON.stringify({
        new_this_week: new_this_week_count
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // If fe_lead_status filter is provided, return that status count (optionally date-filtered)
    if (fe_lead_status) {
      const statusQuery = { dealer_id, fe_lead_status };

      if (start_date && end_date) {
        const startMomentInDealer = moment.utc(start_date).tz(dealerTimezone);
        const endMomentInDealer = moment.utc(end_date).tz(dealerTimezone);
        const startDateStr = startMomentInDealer.format('YYYY-MM-DD');
        const endDateStr = endMomentInDealer.format('YYYY-MM-DD');
        const startMoment = moment.tz(startDateStr, 'YYYY-MM-DD', dealerTimezone).startOf('day');
        const endMoment = moment.tz(endDateStr, 'YYYY-MM-DD', dealerTimezone).endOf('day');

        const dateRangeFilter = {
          $gte: startMoment.utc().toDate(),
          $lte: endMoment.utc().toDate()
        };

        // Appointments: filter by scheduled booking date; other statuses: by createdAt
        if (use_booking_date) {
          statusQuery['booking.booking_date'] = dateRangeFilter;
        } else {
          statusQuery.createdAt = dateRangeFilter;
        }
      }

      // "Contacted" = the customer actually talked to us (app/lib/contactedLeads.js), not a status that was set.
      let status_count;
      if (fe_lead_status === 'Contacted') {
        const { fe_lead_status: _ignored, ...inRange } = statusQuery;
        const ids = (await Lead.find(inRange).select('_id').lean()).map((l) => l._id);
        status_count = (await contactedLeadIds(ids)).length;
      } else {
        status_count = await Lead.countDocuments(statusQuery);
      }

      return new Response(JSON.stringify({
        total_leads: status_count
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // If month_till_date flag is set, calculate MTD range based on end_date
    // IMPORTANT: All date comparisons and calculations are done in DEALER TIMEZONE
    // MTD ONLY applies when start and end dates are THE SAME DAY (single day selection)
    // If different dates (date range), use the exact range provided
    if (month_till_date && end_date) {
      // Parse the end_date in dealer timezone (convert UTC to dealer TZ)
      const endMomentInDealer = moment.utc(end_date).tz(dealerTimezone);
      
      // If start_date is provided, check if it's the SAME DAY (in dealer timezone)
      if (start_date) {
        const startMomentInDealer = moment.utc(start_date).tz(dealerTimezone);
        
        // ONLY calculate MTD if start and end are THE SAME DAY (single day selection)
        // If it's a date range (different days), use the range as-is
        if (startMomentInDealer.isSame(endMomentInDealer, 'day')) {
          // Same day: Calculate from 1st of the month to the selected date
          const monthStart = endMomentInDealer.clone().startOf('month');
          start_date = monthStart.utc().toISOString();
          // end_date remains the same
        }
        // If different days (date range), use the range as-is (no modification)
      } else {
        // No start_date provided, default to 1st of the month of end_date (in dealer timezone)
        const monthStart = endMomentInDealer.clone().startOf('month');
        start_date = monthStart.utc().toISOString();
      }
    }

    // Create base query with dealer_id
    const baseQuery = { dealer_id };
    
    // Only apply date filter if both start_date and end_date are provided
    // If not provided, return all leads without date filtering
    let dateFilterApplied = false;
    let startDate = null;
    let endDate = null;
    let startDateStr = null;
    let endDateStr = null;
    
    if (start_date && end_date) {
      dateFilterApplied = true;
      // IMPORTANT: All date operations are performed in DEALER TIMEZONE
      // Step 1: Convert UTC dates back to dealer timezone to get correct calendar dates
      const startMomentInDealer = moment.utc(start_date).tz(dealerTimezone);
      const endMomentInDealer = moment.utc(end_date).tz(dealerTimezone);
      
      // Step 2: Extract date part (YYYY-MM-DD) from dealer timezone
      startDateStr = startMomentInDealer.format('YYYY-MM-DD');
      endDateStr = endMomentInDealer.format('YYYY-MM-DD');
      
      // Step 3: Create moment objects in dealer's timezone at start/end of day
      // This ensures "today" means "today in dealer's location"
      const startMoment = moment.tz(startDateStr, 'YYYY-MM-DD', dealerTimezone).startOf('day');
      const endMoment = moment.tz(endDateStr, 'YYYY-MM-DD', dealerTimezone).endOf('day');
      
      // Step 4: Convert to UTC for MongoDB query (DB stores in UTC)
      startDate = startMoment.utc().toDate();
      endDate = endMoment.utc().toDate();
      
      // Use $lte to include the entire end date
      baseQuery.createdAt = {
        $gte: startDate,
        $lte: endDate
      };
    }

    // Calculate start of current week in dealer timezone
    const nowInDealerTz = moment.tz(dealerTimezone);
    const startOfWeek = nowInDealerTz.clone().startOf('isoWeek'); // isoWeek starts on Monday
    const startOfWeekUTC = startOfWeek.utc().toDate();
    
    // Build new_this_week query - always filter by week start, but respect date filter if applied
    const newThisWeekQuery = { 
      ...baseQuery,
      createdAt: { 
        $gte: startOfWeekUTC,
        ...(dateFilterApplied && baseQuery.createdAt ? { $lte: baseQuery.createdAt.$lte } : {})
      }
    };
    
    // Get counts for different stats
    const [total_leads, new_this_week, visit_requested, converted,managerial_review, appointment_booked, sources, lead_sources, statuses] = await Promise.all([
      Lead.countDocuments(baseQuery),
      Lead.countDocuments(newThisWeekQuery),
      Lead.countDocuments({ ...baseQuery, fe_lead_status: 'Contacted' }),
      Lead.countDocuments({ ...baseQuery, fe_lead_status: 'visited' }),
      Lead.countDocuments({ ...baseQuery, fe_lead_status: 'Managerial Review' }),
      Lead.countDocuments({ ...baseQuery, fe_lead_status: 'Appointment Booked' }),
     // Lead.countDocuments({ ...baseQuery, booking_status: true }),
      Lead.aggregate([
        { $match: baseQuery },
        { $group: { _id: '$source', count: { $sum: 1 } } }
      ]),
      Lead.aggregate([
        { $match: baseQuery },
        { $group: { _id: '$lead_source', count: { $sum: 1 } } }
      ]),
      Lead.aggregate([
        { $match: baseQuery },
        { $group: { _id: '$fe_lead_status', count: { $sum: 1 } } }
      ])
    ]);

    // Get communication types
    const communication_types = await Email.aggregate([
      { $match: baseQuery },
      { $group: { _id: '$communication_type', count: { $sum: 1 } } }
    ]);

    // Get activity over time
    let activity_over_time = [];
    let minDate = null;
    let maxDate = null;
    
    if (dateFilterApplied) {
      const dateRangeForActivity = {
        $gte: baseQuery.createdAt.$gte,
        $lte: baseQuery.createdAt.$lte  // Use $lte to match the baseQuery
      };

      // Generate date array in dealer timezone
      const chartDateArray = [];
      let chartCurrentMoment = moment.tz(startDateStr, 'YYYY-MM-DD', dealerTimezone);
      const chartEndMomentDay = moment.tz(endDateStr, 'YYYY-MM-DD', dealerTimezone);
      
      minDate = chartCurrentMoment.toDate();
      maxDate = chartEndMomentDay.toDate();
      
      while (chartCurrentMoment.isSameOrBefore(chartEndMomentDay, 'day')) {
        chartDateArray.push(chartCurrentMoment.format('YYYY-MM-DD'));
        chartCurrentMoment.add(1, 'day');
      }

      // Use MongoDB's timezone option to group by dealer timezone directly
      // This ensures leads are grouped by the date in dealer timezone, not UTC
      const activity_over_time_raw = await Lead.aggregate([
        { 
          $match: { 
            dealer_id,
            createdAt: dateRangeForActivity
          } 
        },
        {
          $addFields: {
            // Convert createdAt to dealer timezone date string for filtering
            dealerDateStr: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
                timezone: dealerTimezone
              }
            }
          }
        },
        {
          $match: {
            // CRITICAL: Filter by dealer timezone date to exclude dates beyond endDateStr
            // This prevents leads from being grouped as the next day
            dealerDateStr: {
              $gte: startDateStr,
              $lte: endDateStr
            }
          }
        },
        { 
          $group: { 
            _id: "$dealerDateStr", 
            count: { $sum: 1 } 
          } 
        },
        { $sort: { _id: 1 } }
      ]);

      // Filter results to ensure ONLY dates in chartDateArray are included (double-check)
      const filteredResults = activity_over_time_raw.filter(entry => {
        const dateStr = String(entry._id || '');
        return chartDateArray.includes(dateStr) && dateStr >= startDateStr && dateStr <= endDateStr;
      });

      // Map results to ensure ONLY dates in range are included (fill missing dates with 0)
      // Use 'date' as the key to match the chart component's dataKey
      // IMPORTANT: Only return dates that are in chartDateArray (the selected range)
      activity_over_time = chartDateArray.map(dateStr => {
        const entry = filteredResults.find(e => e._id === dateStr);
        return {
          date: dateStr, // Use 'date' key for chart component
          count: entry?.count || 0
        };
      });
    } else {
      // No date filter - get all leads and find min/max dates
      const dateBounds = await Lead.aggregate([
        { $match: { dealer_id } },
        {
          $group: {
            _id: null,
            minDate: { $min: '$createdAt' },
            maxDate: { $max: '$createdAt' }
          }
        }
      ]);
      
      if (dateBounds.length > 0 && dateBounds[0].minDate && dateBounds[0].maxDate) {
        minDate = dateBounds[0].minDate;
        maxDate = dateBounds[0].maxDate;
        
        // Convert to dealer timezone for date array generation
        const minMoment = moment(minDate).tz(dealerTimezone).startOf('day');
        const maxMoment = moment(maxDate).tz(dealerTimezone).endOf('day');
        
        // Generate date array from min to max
        const chartDateArray = [];
        let chartCurrentMoment = minMoment.clone();
        
        while (chartCurrentMoment.isSameOrBefore(maxMoment, 'day')) {
          chartDateArray.push(chartCurrentMoment.format('YYYY-MM-DD'));
          chartCurrentMoment.add(1, 'day');
        }
        
        // Get activity data for all dates - group by dealer timezone
        const activity_over_time_raw = await Lead.aggregate([
          { $match: { dealer_id } },
          { 
            $group: { 
              _id: { 
                $dateToString: { 
                  format: "%Y-%m-%d", 
                  date: "$createdAt",
                  timezone: dealerTimezone // Group by dealer timezone, not UTC
                } 
              }, 
              count: { $sum: 1 } 
            } 
          },
          { $sort: { _id: 1 } }
        ]);
        
        // MongoDB now returns dates already in dealer timezone, so no conversion needed
        // Map to include all dates in range
        activity_over_time = chartDateArray.map(dateStr => {
          const entry = activity_over_time_raw.find(e => e._id === dateStr);
          return {
            date: dateStr,
            count: entry?.count || 0
          };
        });
      }
    }

    return new Response(JSON.stringify({
      total_leads,
      new_this_week,
      visit_requested,
      converted,
      managerial_review,
      appointment_booked,
      sources,
      lead_sources,
      statuses,
      communication_types,
      activity_over_time,
      date_range: {
        min_date: minDate,
        max_date: maxDate
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error fetching lead stats:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch lead statistics' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}