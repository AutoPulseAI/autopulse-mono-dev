import { contactedLeadIds, repliedLeadIds, repliedSplit } from '@lib/contactedLeads';
import dbConnect from "@lib/mongodb";
import Lead from "@models/Lead";
import Email from "@models/Email";
import User from "@models/User";
import moment from "moment-timezone";
import { bookingCreatorSplit } from "@lib/bookingCreator";
import { appointmentFunnel } from "@lib/appointmentFunnel";
import { requireDealerOrSuperAdmin } from '@lib/apiGuard';
import { dashboardCacheKey, getCached, setCached } from '@lib/dashboardCache';
import { departmentMatch } from '@lib/departmentNames';
import { departmentLeadIds } from '@lib/departments';

export async function GET(request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const dealer_id = searchParams.get('dealer_id');
    // Signed-in users only, for their own dealership (super admin: any; no dealer_id: super admin only).
    const access = await requireDealerOrSuperAdmin(request, dealer_id);
    if (access.response) return access.response;
    let start_date = searchParams.get('start_date');
    let end_date = searchParams.get('end_date');
    const managerial_review_only = searchParams.get('managerial_review_only') === 'true';
    const all_appointment_booked = searchParams.get('all_appointment_booked') === 'true';
    const new_this_week_only = searchParams.get('new_this_week_only') === 'true';
    const month_till_date = searchParams.get('month_till_date') === 'true';
    const fe_lead_status = searchParams.get('fe_lead_status');
    const use_booking_date = searchParams.get('use_booking_date') === 'true';
    // Appointment cards show who booked (Betsy, 21 Oct 2026): AI vs staff, from the lead's latest booking.
    const split_by_creator = searchParams.get('split_by') === 'created_by';
    // 13 Nov 2026 meeting (6.4, 9.2): the dashboard for one department - Sales is not counted for service leads.
    // Spread into every lead query; empty = every department.
    const department = searchParams.get('department');
    const dept = departmentMatch(department) || {};
    
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
        dealer_id, ...dept,
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
        dealer_id, ...dept,
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
        dealer_id, ...dept,
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

    // The dashboard's appointment funnel, from the bookings themselves (Betsy, 23 Oct 2026).
    if (searchParams.get('appointment_funnel') === 'true') {
      let start = null;
      let end = null;
      if (start_date && end_date) {
        const s = moment.utc(start_date).tz(dealerTimezone).format('YYYY-MM-DD');
        const e = moment.utc(end_date).tz(dealerTimezone).format('YYYY-MM-DD');
        start = moment.tz(s, 'YYYY-MM-DD', dealerTimezone).startOf('day').utc().toDate();
        end = moment.tz(e, 'YYYY-MM-DD', dealerTimezone).endOf('day').utc().toDate();
      }
      return new Response(JSON.stringify(await appointmentFunnel({ dealerId: dealer_id, start, end,
        leadIds: await departmentLeadIds(dealer_id, department) })), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    // If fe_lead_status filter is provided, return that status count (optionally date-filtered)
    if (fe_lead_status) {
      const statusQuery = { dealer_id, ...dept, fe_lead_status };

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
      let replied_by = null;
      if (fe_lead_status === 'Contacted' && statusQuery.createdAt) {
        // Betsy, 27 Oct 2026 meeting: who replied in the range, whenever the lead came in (app/lib/contactedLeads.js).
        const { fe_lead_status: _ignored, createdAt: range, ...dealerLeads } = statusQuery;
        const leads = await Lead.find(dealerLeads).select('_id createdAt').lean();
        status_count = (await repliedLeadIds(leads.map((l) => l._id), range.$gte, range.$lte)).length;
        // Betsy, 2 Nov 2026 meeting: by text and by email, and today's leads vs older ones.
        replied_by = await repliedSplit(leads, range.$gte, range.$lte, { tz: dealerTimezone });
      } else if (fe_lead_status === 'Contacted') {
        const { fe_lead_status: _ignored, ...inRange } = statusQuery;
        const ids = (await Lead.find(inRange).select('_id').lean()).map((l) => l._id);
        status_count = (await contactedLeadIds(ids)).length;
      } else {
        status_count = await Lead.countDocuments(statusQuery);
      }

      if (split_by_creator) {
        const ids = (await Lead.find(statusQuery).select('_id').lean()).map((l) => String(l._id));
        const split = await bookingCreatorSplit(ids);
        return new Response(JSON.stringify({ total_leads: status_count, ...split }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        total_leads: status_count,
        ...(replied_by ? { replied_by } : {}),
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

    // Dashboard stats cache (DB-SCALING #4): this main path runs ~11 aggregate/count ops over the leads.
    // Its output depends only on dealer_id + the (now MTD-resolved) date range, so cache it briefly. The
    // lightweight single-count branches above already returned and are never cached. Fail-safe: if Redis
    // is down the helper returns null and we compute as normal. Disable with DASHBOARD_CACHE=off.
    const statsCacheKey = dashboardCacheKey('leads:stats', {
      dealer_id, start_date: start_date || null, end_date: end_date || null,
    });
    const statsCached = await getCached(statsCacheKey);
    if (statsCached) {
      return new Response(JSON.stringify(statsCached), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create base query with dealer_id
    const baseQuery = { dealer_id, ...dept };
    
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
    
    // Get counts for different stats.
    // DB-SCALING #2 (B1): fold sources + lead_sources + statuses into ONE $facet over baseQuery (one pass
    // instead of three), and DERIVE the five status-based counts from the `statuses` group in JS instead of
    // five separate countDocuments. Byte-identical to the previous 9-op version:
    //   - total_leads      = sum of every status bucket (every doc lands in exactly one bucket, incl. null)
    //   - visit_requested  = the 'Contacted' bucket        (== countDocuments fe_lead_status:'Contacted')
    //   - converted        = the 'visited' bucket
    //   - managerial_review= the 'Managerial Review' bucket
    //   - appointment_booked = the 'Appointment Booked' bucket
    // new_this_week keeps its OWN query (a different date window), so it stays a separate pass. Net: 9 -> 2.
    const [facetResult, new_this_week] = await Promise.all([
      Lead.aggregate([
        { $match: baseQuery },
        { $facet: {
          sources: [{ $group: { _id: '$source', count: { $sum: 1 } } }],
          lead_sources: [{ $group: { _id: '$lead_source', count: { $sum: 1 } } }],
          statuses: [{ $group: { _id: '$fe_lead_status', count: { $sum: 1 } } }],
        } },
      ]),
      Lead.countDocuments(newThisWeekQuery),
    ]);

    const sources = facetResult[0]?.sources || [];
    const lead_sources = facetResult[0]?.lead_sources || [];
    const statuses = facetResult[0]?.statuses || [];
    const statusBucket = (value) => statuses.find((s) => s._id === value)?.count || 0;
    const total_leads = statuses.reduce((sum, s) => sum + s.count, 0);
    const visit_requested = statusBucket('Contacted');
    const converted = statusBucket('visited');
    const managerial_review = statusBucket('Managerial Review');
    const appointment_booked = statusBucket('Appointment Booked');

    // Get communication types
    const { department: _deptOnLeads, ...emailQuery } = baseQuery; // messages carry no department; theirs is the lead's
    const deptIds = department ? await departmentLeadIds(dealer_id, department) : null;
    const communication_types = await Email.aggregate([
      { $match: { ...emailQuery, ...(deptIds ? { lead_id: { $in: deptIds } } : {}) } },
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
            dealer_id, ...dept,
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
        { $match: { dealer_id, ...dept } },
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
          { $match: { dealer_id, ...dept } },
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

    const payload = {
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
    };

    // Cache this computed result for the short TTL (fail-safe: a Redis error just skips the write).
    await setCached(statsCacheKey, payload);

    return new Response(JSON.stringify(payload), {
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