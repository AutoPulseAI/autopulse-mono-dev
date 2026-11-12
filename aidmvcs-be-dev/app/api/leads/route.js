import { contactedLeadIds, repliedLeadIds } from '@lib/contactedLeads';
import { validContactType } from '@lib/leadContactType';
import { bookingDetailsForLeads } from "@lib/bookingCreator";
import { funnelLeadIds } from "@lib/appointmentFunnel";
import { stoppedLeadIds } from "@lib/ai/stopLabels";
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { customerFamily } from "@lib/customerFamily";
import dbConnect from "@lib/mongodb";
import Lead from "@models/Lead";
import Booking from "@models/Booking";
import Customer from "@models/Customer";
import Email from "@models/Email";
import Vehicle from "@models/Vehicle";
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import User from '@models/User';
import { sendSubscriptionExpiryNotification } from '@lib/emailservice';
import { isPackageExpiryValid } from '@lib/isPackageExpiryValid';
import EmailAccount from '@models/EmailAccount.js';
import jwt from 'jsonwebtoken';
import Role from '@models/Role';
import Permission from '@models/Permission';
import moment from 'moment-timezone';
import { isAuthorizedForDealer } from '@lib/customerListing';
import { requireUser, requireDealerAccess } from '@lib/apiGuard';
import { attachAiStages, attachAiAdminLabels } from '@lib/ai/aiStage';
import { loadSettingsEditor } from '@lib/apiAuth';
import { replyCohorts } from '@lib/reporting/replyCohorts';
import { attributeAppointments } from '@lib/reporting/appointmentAttribution';
import { getDealerTimezone } from '@lib/reporting/time';
import { APPT_ATTRIBUTION, REPLY_COHORTS, apptAttributionLeads, apptDrillNote, replyCohortLeads, replyDrillNote,
  reportDrillNote, reportKpiLeads } from '@lib/reporting/drillLeads';
import { evaluateKpi, getKpi, isLeadLinked } from '@lib/reporting/registry';
import { CARD_KPIS } from '@lib/deskLog/cards';
import { REPORTS, parseFilterSpec } from '@lib/reporting/filters';
import { callerSeesFeature, localRange } from '../reports/reply-cohorts/reportAccess.js';

// Helper function to normalize phone numbers for search
// Removes +1, spaces, dashes, parentheses, and other formatting
function normalizePhoneForSearch(phone) {
  if (!phone) return '';
  // Remove all non-digit characters
  return phone.replace(/\D/g, '');
}

// GET: Fetch all leads with filtering
export async function GET(req) {
  try {
    // Connect to MongoDB
    await dbConnect();
    const url = new URL(req.url);
    const format = url.searchParams.get("format"); // 'csv' for export
    
    // Get current user from token for permission-based filtering
    let currentUser = null;
    let userPermissions = [];
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        currentUser = await User.findById(decoded.userId).populate({
          path: "role",
          populate: { path: "permissions" }
        });
        if (currentUser) {
          userPermissions = currentUser?.role?.permissions?.map(p => p.permission_name) || [];
        }else{
          return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
        }
       
      }else{
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
    } catch (err) {
      console.warn("Token verification failed in leads API:", err.message);
      // Return unauthorized if token verification fails
      return new Response(JSON.stringify({ message: "Unauthorized" }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Get all filter parameters
    let dealerId = url.searchParams.get("dealer_id");
    // A dealer_id in the query (list and CSV export) must be the caller's own dealership, a dealer of the caller's
    // agency, or any dealer for a super admin; it used to be trusted as sent.
    if (dealerId && !(await isAuthorizedForDealer(currentUser, dealerId))) {
      return new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (!dealerId && currentUser) {
      dealerId = currentUser.type === "dealer"
        ? currentUser._id.toString()
        : (currentUser.parent_id ? currentUser.parent_id.toString() : null);
    }
    const customerId = url.searchParams.get("customer_id");
    const assignmentFilter = url.searchParams.get("assignment"); // 'my', 'all', 'unassigned'
    const name = url.searchParams.get("name");
    const email = url.searchParams.get("email");
    const phone = url.searchParams.get("phone");
    const status = url.searchParams.get("fe_lead_status");
    const leadSources = url.searchParams.getAll("lead_source");
    const source = url.searchParams.get("source");
    const responseMode = url.searchParams.getAll("response_mode"); // Get all values for multi-select
    const followupPreference = url.searchParams.getAll("followup_preference"); // Get all values for multi-select
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const bookingStartDate = url.searchParams.get("bookingStartDate");
    const bookingEndDate = url.searchParams.get("bookingEndDate");
    // Betsy, 27 Oct 2026 ("if the dashboard says 11, when I click it I should see 11"): the Appointments Made card
    // counts bookings created in the range (app/lib/appointmentFunnel.js); these list exactly those leads.
    const madeStartDate = url.searchParams.get("madeStartDate");
    const madeEndDate = url.searchParams.get("madeEndDate");
    // Betsy, 28 Oct 2026 meeting ("Appointments Showed says 1, click it and there's nothing - Deyvi Lopez should be
    // there"): the Showed and Sold cards' own leads (app/lib/appointmentFunnel.js funnelLeadIds).
    const funnelStep = ['showed', 'sold'].includes(url.searchParams.get("funnel")) ? url.searchParams.get("funnel") : null;
    const funnelStartDate = url.searchParams.get("funnelStartDate");
    const funnelEndDate = url.searchParams.get("funnelEndDate");
    const messageFilter = url.searchParams.get("message_filter"); // 'unread', 'read', or empty
    const vehicleMakes = url.searchParams.getAll("make");
    const vehicleModels = url.searchParams.getAll("model").concat(url.searchParams.getAll("vehicle_model"));
    const vehicleYears = url.searchParams.getAll("year").concat(url.searchParams.getAll("vehicle_year"));
    const vehicleCondition = url.searchParams.get("condition") || url.searchParams.get("car_type");
    const stocks = url.searchParams.getAll("stock")
      .concat(url.searchParams.getAll("stockNumber"))
      .concat(url.searchParams.getAll("stocknumber"));

    let customerFilter = null;
    if (customerId !== null) {
      if (!dealerId || !mongoose.isValidObjectId(customerId)) {
        return new Response(JSON.stringify({ message: "A valid dealer_id and customer_id are required" }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (!(await isAuthorizedForDealer(currentUser, dealerId))) {
        return new Response(JSON.stringify({ message: "Forbidden" }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      customerFilter = await Customer.findOne({
        _id: customerId,
        dealer_id: String(dealerId),
      }).select("_id").lean();

      if (!customerFilter) {
        return new Response(JSON.stringify({ message: "Customer not found" }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Build query object
    let query = { dealer_id: dealerId };
    if (customerFilter) query.customer_id = { $in: await customerFamily(customerFilter._id, dealerId) }; // with merged-in customers (G-008)
    let unassignedFilter = null;
    let orConditions = []; // Collect all $or conditions to combine later
    
    // Handle assignment filter parameter FIRST (it takes precedence)
    if (assignmentFilter === 'my' && currentUser) {
      query.assigned_to = currentUser._id;
    } else if (assignmentFilter === 'unassigned') {
      // Store unassigned condition separately to apply after other filters
      // Check for null or missing field - MongoDB will match both
      unassignedFilter = [
        { assigned_to: null },
        { assigned_to: { $exists: false } }
      ];
    } else if (assignmentFilter === 'all') {
      // Only allow viewing all leads if user has Manage Leads
      if (currentUser && currentUser.parent_id) {
        const hasManageLeads = userPermissions.includes("Manage Leads");
        if (!hasManageLeads) {
          // Restrict to only user's assigned leads
          query.assigned_to = currentUser._id;
        }
      }
    } else {
      // No assignment filter specified - apply permission-based filtering for staff
      if (currentUser && currentUser.parent_id) {
        // User is staff (has parent_id)
        const hasManageLeads = userPermissions.includes("Manage Leads");
        const hasViewAssigned = userPermissions.includes("View Assigned Leads");
        
        if (!hasManageLeads && hasViewAssigned) {
          // Staff can only see assigned leads
          query.assigned_to = currentUser._id;
        }
        // If hasManageLeads, no restriction (can see all)
      }
    }
  
    // 'all' or no filter = no additional restriction
    
    if (name) query.name = { $regex: name, $options: "i" };
    if (email) query.email = { $regex: email, $options: "i" };
    if (phone) {
      // Normalize the search phone number (remove +1, spaces, dashes, etc.)
      const normalizedSearchPhone = normalizePhoneForSearch(phone);
      
      if (normalizedSearchPhone) {
        // Remove leading "1" if present (US country code)
        let searchDigits = normalizedSearchPhone;
        if (searchDigits.startsWith('1') && searchDigits.length > 10) {
          searchDigits = searchDigits.substring(1);
        }
        
        // Create a regex that matches phone numbers with or without +1 prefix
        // This will match:
        // - +11234567890 (matches "1234567890" in search)
        // - 1234567890 (matches "1234567890" in search)
        // - +1-123-456-7890 (matches "1234567890" in search)
        // - (123) 456-7890 (matches "1234567890" in search)
        // The regex allows for optional +1 prefix and any non-digit characters between digits
        const escapedDigits = searchDigits.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match: optional +1, then the digits (with optional non-digit separators)
        query.phone = { 
          $regex: `(\\+?1[^0-9]*)?${escapedDigits.split('').join('[^0-9]*')}`, 
          $options: "i" 
        };
      }
    }
    // "Contacted" = the customer actually talked to us (app/lib/contactedLeads.js), applied once the other filters are in.
    if (status && status !== 'Contacted') query.fe_lead_status = status;
    if (leadSources && leadSources.length > 0) {
      const knownSources = leadSources.filter((s) => s && s.toLowerCase() !== 'unknown');
      const includeUnknown = leadSources.some((s) => s && s.toLowerCase() === 'unknown');

      const sourceMatchConditions = [];
      if (knownSources.length > 0) {
        sourceMatchConditions.push({
          lead_source: { $in: knownSources.map((s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) }
        });
      }
      if (includeUnknown) {
        sourceMatchConditions.push(
          { lead_source: null },
          { lead_source: { $exists: false } },
          { lead_source: '' },
          { lead_source: { $regex: '^unknown$', $options: 'i' } }
        );
      }
      if (sourceMatchConditions.length === 1) {
        Object.assign(query, sourceMatchConditions[0]);
      } else if (sourceMatchConditions.length > 1) {
        orConditions.push(sourceMatchConditions);
      }
    }
    if (source) {
      // Special handling for "Unknown" - match null, undefined, empty string, or literal "Unknown"
      if (source.toLowerCase() === 'unknown') {
        orConditions.push([
          { source: null },
          { source: { $exists: false } },
          { source: '' },
          { source: { $regex: `^${source}$`, $options: "i" } }
        ]);
      } else {
        query.source = { $regex: `^${source}$`, $options: "i" }; // Case-insensitive exact match
      }
    }
    if (responseMode && responseMode.length > 0) {
      query.response_mode = { $in: responseMode.map(mode => new RegExp(`^${mode}$`, 'i')) };
    }
    if (followupPreference && followupPreference.length > 0) {
      query.followup_preference = { $in: followupPreference.map(pref => new RegExp(`^${pref}$`, 'i')) };
    }

    // Inventory search: look up matching vehicles → get VIN(s) → match leads by vin
    const hasInventoryFilter =
      vehicleMakes.length > 0 ||
      vehicleModels.length > 0 ||
      vehicleYears.length > 0 ||
      vehicleCondition ||
      stocks.length > 0;

    if (hasInventoryFilter) {
      const vehicleFilter = { dealerId: dealerId };
      const andClauses = [];

      if (vehicleMakes.length > 0) {
        andClauses.push({
          $or: vehicleMakes.map((make) => ({
            make: { $regex: make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: "i" }
          }))
        });
      }
      if (vehicleModels.length > 0) {
        andClauses.push({
          $or: vehicleModels.map((model) => ({
            model: { $regex: model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: "i" }
          }))
        });
      }
      if (vehicleYears.length > 0) {
        const yearValues = [];
        vehicleYears.forEach((year) => {
          yearValues.push(year);
          const yearNum = Number(year);
          if (!Number.isNaN(yearNum)) yearValues.push(yearNum);
        });
        andClauses.push({ year: { $in: [...new Set(yearValues)] } });
      }
      if (vehicleCondition) {
        const escapedCondition = vehicleCondition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        andClauses.push({
          condition: {
            $regex: `^${escapedCondition}$`,
            $options: "i"
          }
        });
      }
      if (stocks.length > 0) {
        andClauses.push({
          $or: stocks.map((stock) => ({
            stocknumber: { $regex: stock.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: "i" }
          }))
        });
      }

      if (andClauses.length === 1) {
        Object.assign(vehicleFilter, andClauses[0]);
      } else if (andClauses.length > 1) {
        vehicleFilter.$and = andClauses;
      }

      const vehicles = await Vehicle.find(vehicleFilter).select("vin").lean();
      const vins = [...new Set(
        vehicles
          .map((v) => v.vin)
          .filter((vin) => vin && String(vin).trim() !== "")
      )];

      query.vin = vins.length > 0 ? { $in: vins } : { $in: [] };
    }
    
    // Get dealer timezone for date parsing
    let dealerTimezone = 'America/New_York';
    if (dealerId) {
      const dealer = await User.findById(dealerId);
      dealerTimezone = dealer?.dealer_account_information?.time_zone || 'America/New_York';
    }
    
    // Parse date range in dealer timezone (for createdAt filter)
    if (startDate && endDate) {
      // The frontend sends dates as UTC ISO strings where:
      // - startDate is start of day in dealer timezone (converted to UTC)
      // - endDate is end of day in dealer timezone (converted to UTC)
      // IMPORTANT: Convert the UTC dates back to dealer timezone to get the correct calendar date
      // Convert UTC to dealer timezone to get the correct calendar date
      const startMomentInDealer = moment.utc(startDate).tz(dealerTimezone);
      const endMomentInDealer = moment.utc(endDate).tz(dealerTimezone);
      
      // Extract the date strings from dealer timezone
      const startDateStr = startMomentInDealer.format('YYYY-MM-DD');
      const endDateStr = endMomentInDealer.format('YYYY-MM-DD');
      
      // Parse dates in dealer timezone
      const startMoment = moment.tz(startDateStr, 'YYYY-MM-DD', dealerTimezone).startOf('day');
      const endMoment = moment.tz(endDateStr, 'YYYY-MM-DD', dealerTimezone).endOf('day');
      
      query.createdAt = {
        $gte: startMoment.utc().toDate(),
        $lte: endMoment.utc().toDate()
      };
    }
    console.log(query);
    
    const bookingStatus = url.searchParams.get("booking_status");
    // Add booking status filter if provided
    if (bookingStatus && !(madeStartDate && madeEndDate) && !funnelStep) {  // the cards count bookings whatever happened since
        query.booking_status = bookingStatus === "1";
    }
    
    // Add booking date range filter if provided (also in dealer timezone)
    if (bookingStartDate && bookingEndDate) {
        // Convert UTC to dealer timezone to get the correct calendar date
        const bookingStartMomentInDealer = moment.utc(bookingStartDate).tz(dealerTimezone);
        const bookingEndMomentInDealer = moment.utc(bookingEndDate).tz(dealerTimezone);
        
        // Extract the date strings from dealer timezone
        const bookingStartDateStr = bookingStartMomentInDealer.format('YYYY-MM-DD');
        const bookingEndDateStr = bookingEndMomentInDealer.format('YYYY-MM-DD');
        
        const bookingStartMoment = moment.tz(bookingStartDateStr, 'YYYY-MM-DD', dealerTimezone).startOf('day');
        const bookingEndMoment = moment.tz(bookingEndDateStr, 'YYYY-MM-DD', dealerTimezone).endOf('day');
        
        // Use dot notation for nested field query
        query["booking.booking_date"] = {
            $gte: bookingStartMoment.utc().toDate(),
            $lte: bookingEndMoment.utc().toDate()
        };
    }
    
    // Appointments list: sales or service only (SOW Deliverable E, G-030) - leads whose latest booking is that type.
    const apptType = url.searchParams.get("appointment_type");
    if (bookingStatus && (apptType === "sales" || apptType === "service")) {
        const latest = await Booking.aggregate([
            { $match: { dealer_id: String(dealerId) } },
            { $sort: { createdAt: -1 } },
            { $group: { _id: "$lead_id", type: { $first: "$appointment_type" } } },
            { $match: apptType === "service" ? { type: "service" } : { type: { $ne: "service" } } },
        ]);
        const typed = latest.map((b) => String(b._id)).filter((id) => mongoose.isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id));
        (query.$and = query.$and || []).push({ _id: { $in: typed } });
    }

    if (madeStartDate && madeEndDate) {
        // Whole dealer-local days, as the card counts them (app/api/leads/stats: start/end of each day).
        const madeFrom = moment.tz(moment.utc(madeStartDate).tz(dealerTimezone).format('YYYY-MM-DD'), 'YYYY-MM-DD',
          dealerTimezone).startOf('day').utc().toDate();
        const madeTo = moment.tz(moment.utc(madeEndDate).tz(dealerTimezone).format('YYYY-MM-DD'), 'YYYY-MM-DD',
          dealerTimezone).endOf('day').utc().toDate();
        const made = await Booking.find({ dealer_id: String(dealerId),
          createdAt: { $gte: madeFrom, $lte: madeTo } }).select('lead_id').lean();
        const ids = [...new Set(made.map((b) => String(b.lead_id)))].filter((id) => mongoose.isValidObjectId(id));
        query._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    if (url.searchParams.get("stopped") === "1") {
        const stopped = (await stoppedLeadIds(dealerId)).filter((id) => mongoose.isValidObjectId(id));
        query._id = { $in: stopped.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    if (funnelStep) {
        // Whole dealer-local days, as the card counts them.
        const day = (v, edge) => v ? moment.tz(moment.utc(v).tz(dealerTimezone).format('YYYY-MM-DD'), 'YYYY-MM-DD',
          dealerTimezone)[edge]('day').utc().toDate() : null;
        const ids = (await funnelLeadIds({ dealerId, step: funnelStep, start: day(funnelStartDate, 'startOf'),
          end: day(funnelEndDate, 'endOf') })).filter((id) => mongoose.isValidObjectId(id));
        query._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    // The dashboard's "Customer replies by lead age" cards and "Appointments made" split (admin section): exactly the
    // leads behind the number, for the picked dealer-local days (startDate/endDate are then the reply / booking
    // dates, not the lead's). Ignored unless the caller may see those features (same gate as the section).
    const drill = await drillFilter({ req, url, currentUser, dealerId, startDate, endDate });
    let replyDrillOrder = null;
    if (drill) {
        const replyWindow = query.createdAt; // the picked dealer-local days
        delete query.createdAt;
        const allowed = query._id?.$in ? new Set(query._id.$in.map(String)) : null;
        const ids = drill.lead_ids.filter((id) => mongoose.isValidObjectId(id) && (!allowed || allowed.has(String(id))));
        query._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
        if (url.searchParams.get("reply_cohort") && replyWindow) {
          // Betsy, 12 Nov 2026: "all replies TODAY regardless of lead created date, in the order in which they
          // replied" - the reply-age lists are ordered like the Customer Replied list: newest reply in the picked
          // days first, each row with its reply time (they were sorted by lead created date, so a re-engaged older
          // lead looked like an all-time reply).
          const order = await repliedLeadIds(query._id.$in, replyWindow.$gte, replyWindow.$lte);
          const seen = new Set(order.map((r) => String(r._id)));
          replyDrillOrder = [...order, ...query._id.$in.filter((id) => !seen.has(String(id)))
            .map((id) => ({ _id: id, last_reply_at: null }))];
        }
    }

    // Apply unassigned filter if needed
    if (unassignedFilter) {
      orConditions.push(unassignedFilter);
    }
    
    // Combine all $or conditions using $and if there are multiple
    if (orConditions.length > 0) {
      if (orConditions.length === 1) {
        // Only one $or condition - merge it directly into query
        query.$or = orConditions[0];
      } else {
        // Multiple $or conditions - use $and to combine them
        query.$and = orConditions.map(orArray => ({ $or: orArray }));
      }
      console.log('Combined query with OR conditions:', JSON.stringify(query, null, 2));
    }

    // Apply message filter (read/unread) if specified
    if (messageFilter && (messageFilter === 'unread' || messageFilter === 'read')) {
      // Client, 2 Nov 2026 ("Unread Messages not working"): only the customer's messages can be unread - our own
      // AI/staff messages are never opened, so counting them put 12,188 of the 12,068 listed leads under Unread.
      const messageQuery = {
        dealer_id: dealerId,
        lead_id: { $exists: true, $ne: null },
        status: { $in: ['received', 'incoming'] }
      };
      const leadsWithUnread = await Email.distinct('lead_id', { ...messageQuery, read: { $ne: true } });
      let ids = leadsWithUnread;
      if (messageFilter === 'read') {
        // Leads whose customer messages have all been opened
        const unread = new Set(leadsWithUnread.map(String));
        ids = (await Email.distinct('lead_id', messageQuery)).filter((id) => !unread.has(String(id)));
      }
      // Within the other lead-id filters (Stopped, the dashboard cards' lists), not instead of them
      if (query._id?.$in) {
        const allowed = new Set(query._id.$in.map(String));
        ids = ids.filter((id) => allowed.has(String(id)));
      }
      query._id = { $in: ids };
    }

    let repliedOrder = replyDrillOrder;
    const messagesSent = url.searchParams.get("messages") === "sent";
    if ((status === 'Contacted' && query.createdAt) || messagesSent) {
      // Customer Replied for a date range: who replied in it, whenever the lead came in, latest reply first. The
      // Messages card's list (messages=sent): who we messaged in it, latest first (Betsy, 27 Oct 2026 meeting).
      const { $gte: from, $lte: to } = query.createdAt || {};
      delete query.createdAt;
      const candidates = (await Lead.find(query).select('_id').lean()).map((l) => l._id);
      // Betsy, 2 Nov 2026 meeting: "a filter - filter by SMS, filter by email" (replied_by=sms|email; a customer
      // who did both is in both).
      const repliedBy = { sms: 'text', email: 'email' }[url.searchParams.get("replied_by")] || null;
      repliedOrder = await repliedLeadIds(candidates, from, to, { direction: messagesSent ? 'sent' : 'received',
        channel: messagesSent ? url.searchParams.get("channel") : repliedBy });
      query._id = { $in: repliedOrder.map((r) => r._id) };
    } else if (status === 'Contacted') {
      const candidates = (await Lead.find(query).select('_id').lean()).map((l) => l._id);
      let contacted = await contactedLeadIds(candidates);
      const repliedBy = { sms: 'text', email: 'email' }[url.searchParams.get("replied_by")] || null;
      if (repliedBy) {
        const by = new Set((await repliedLeadIds(contacted, null, null, { channel: repliedBy })).map((r) => String(r._id)));
        contacted = contacted.filter((id) => by.has(String(id)));
      }
      query._id = { $in: contacted };
    }

    if (format === 'csv') {
      // Handle CSV export
      const leads = await Lead.find(query)
        .select("name email phone source lead_source fe_lead_status vin booking booking_status createdAt")
        .lean();

      // Convert to CSV
      const csvData = leads.map(lead => {
        // Format booking date
        let bookingDate = 'N/A';
        if (lead.booking?.booking_date) {
          const date = new Date(lead.booking.booking_date);
          bookingDate = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
        }

        // Format appointment time
        let appointmentTime = 'N/A';
        if (lead.booking?.booking_time) {
          appointmentTime = lead.booking.booking_time;
        } else if (lead.booking?.booking_at) {
          const bookingAt = new Date(lead.booking.booking_at);
          appointmentTime = bookingAt.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });
        }

        // Check if there's an appointment
        const hasAppointment = lead.booking_status === true || lead.booking?.booking_date ? 'Yes' : 'No';

        return {
          Name: lead.name || 'N/A',
          Email: lead.email || 'N/A',
          Phone: lead.phone || 'N/A',
          VIN: lead.vin || 'N/A',
          'Source Type': lead.source || 'N/A',
          'Lead Source': lead.lead_source || 'N/A',
          Status: lead.fe_lead_status || 'N/A',
          'Booking Date': bookingDate,
          'Appointment Time': appointmentTime,
          'Has Appointment': hasAppointment,
          'Created At': lead.createdAt ? new Date(lead.createdAt).toLocaleString() : 'N/A'
        };
      });

      const csvHeaders = Object.keys(csvData[0] || {}).join(',');
      const csvRows = csvData.map(row => 
        Object.values(row).map(field => 
          `"${String(field).replace(/"/g, '""')}"`
        ).join(',')
      ).join('\n');

      const csvContent = [csvHeaders, csvRows].join('\n');

      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=leads_export.csv'
        },
        status: 200
      });
    } else {
      // Normal paginated response
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limit = parseInt(url.searchParams.get("limit")) || 10;
      
      const totalLeads = await Lead.countDocuments(query);
      // Betsy, 2 Nov 2026 meeting ("can you sort them by created, newest?"): sort=created_desc | created_asc; the
      // Customer Replied list is otherwise latest reply first, every other list newest lead first.
      const sort = url.searchParams.get("sort");
      if (repliedOrder && (sort === 'created_desc' || sort === 'created_asc')) {
        const created = new Map((await Lead.find({ _id: { $in: repliedOrder.map((r) => r._id) } }).select('createdAt')
          .lean()).map((l) => [String(l._id), new Date(l.createdAt || 0).getTime()]));
        const sign = sort === 'created_asc' ? 1 : -1;
        repliedOrder.sort((a, b) => sign * ((created.get(String(a._id)) || 0) - (created.get(String(b._id)) || 0)));
      }
      let leads;
      if (repliedOrder) {
        const lastReply = new Map(repliedOrder.map((r) => [String(r._id), r.last_reply_at]));
        const pageIds = repliedOrder.slice((page - 1) * limit, page * limit).map((r) => r._id);
        const rows = await Lead.find({ ...query, _id: { $in: pageIds } })
          .populate({ path: 'assigned_to', select: 'name email', strictPopulate: false }).lean();
        const byId = new Map(rows.map((l) => [String(l._id), l]));
        leads = pageIds.map((id) => byId.get(String(id))).filter(Boolean)
          .map((l) => ({ ...l, [messagesSent ? 'last_sent_at' : 'last_reply_at']: lastReply.get(String(l._id)) || null }));
      } else {
        leads = await Lead.find(query)
          .populate({ path: 'assigned_to', select: 'name email', strictPopulate: false })
          .sort({ createdAt: sort === 'created_asc' ? 1 : -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean();
      }
      // The AI's stage per lead, read only (app/lib/ai/aiStage.js).
      await attachAiStages(leads);
      // AutoPulse super admins only: the AI's bucket, stage and next message - never sent to a dealer's users.
      if ((await loadSettingsEditor(req)).superAdmin) await attachAiAdminLabels(leads);
      // Appointments list: "Made by AI" / "Made by Staff" on each one.
      if (bookingStatus) {
        const details = await bookingDetailsForLeads(leads.map((l) => l._id));
        for (const lead of leads) Object.assign(lead, details.get(String(lead._id)) || {});
      }

      return new Response(JSON.stringify({
        data: leads,
        ...(drill ? { drill: drill.meta } : {}),
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalLeads / limit),
          totalItems: totalLeads,
          itemsPerPage: limit,
          hasNextPage: page < Math.ceil(totalLeads / limit),
          hasPreviousPage: page > 1
        }
      }), { status: 200 });
    }
  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}

// ?reply_cohort= / ?appt_attribution= (dashboard admin section): null when absent, unknown or not visible to the
// caller (the list is then exactly as without them); otherwise { lead_ids, meta } - meta is shown on the list.
async function drillFilter({ req, url, currentUser, dealerId, startDate, endDate }) {
  const cohort = url.searchParams.get("reply_cohort");
  const appt = url.searchParams.get("appt_attribution");
  const wantCohort = cohort && Object.hasOwn(REPLY_COHORTS, cohort);
  const wantAppt = appt && Object.hasOwn(APPT_ATTRIBUTION, appt);
  const reportDef = getKpi(url.searchParams.get("report_kpi") || "");
  const wantReport = isLeadLinked(reportDef);
  if (!dealerId || (!wantCohort && !wantAppt && !wantReport)) return null;
  const seeCohort = wantCohort && await callerSeesFeature(req, currentUser, dealerId, "reply_cohorts");
  const seeAppt = wantAppt && await callerSeesFeature(req, currentUser, dealerId, "appointment_attribution");
  // The Desk Log's cards open their Reports numbers too: whoever sees the Desk Log may open those lists.
  const seeReport = wantReport && (await callerSeesFeature(req, currentUser, dealerId, "reports_page")
    || (CARD_KPIS.has(reportDef.id) && await callerSeesFeature(req, currentUser, dealerId, "desk_log")));
  if (!seeCohort && !seeAppt && !seeReport) return null;
  if (seeReport && !seeCohort && !seeAppt) return reportDrill({ url, dealerId, def: reportDef, startDate, endDate });

  const tz = await getDealerTimezone(dealerId);
  const range = localRange(startDate, endDate, tz);
  const meta = { range: range.error ? null : range, filters: [] };
  if (range.error) {
    meta.filters.push({ param: seeCohort ? "reply_cohort" : "appt_attribution",
      label: seeCohort ? REPLY_COHORTS[cohort].label : APPT_ATTRIBUTION[appt], note: `Pick a date range (${range.error})` });
    return { lead_ids: [], meta };
  }
  let ids = null;
  const intersect = (next) => { ids = ids ? next.filter((id) => ids.includes(id)) : next; };
  if (seeCohort) {
    const report = await replyCohorts({ dealerId: String(dealerId), from: range.from, to: range.to, tz });
    const got = replyCohortLeads(report, cohort);
    intersect(got.lead_ids);
    meta.filters.push({ param: "reply_cohort", value: cohort, label: REPLY_COHORTS[cohort].label,
      card_count: got.card_count, lead_count: got.lead_ids.length, not_listed: got.needs_review,
      note: replyDrillNote(got) });
  }
  if (seeAppt) {
    const report = await attributeAppointments({ dealerId: String(dealerId), from: range.from, to: range.to,
      basis: "created", tz });
    const got = apptAttributionLeads(report, appt);
    const oids = got.lead_ids.filter((id) => mongoose.isValidObjectId(id));
    const found = new Set((oids.length ? await Lead.find({ _id: { $in: oids }, dealer_id: dealerId }).select("_id").lean()
      : []).map((l) => String(l._id)));
    const missing = report.rows.filter((r) => r.category === appt && !found.has(String(r.lead_id))).length;
    intersect([...found]);
    meta.filters.push({ param: "appt_attribution", value: appt, label: APPT_ATTRIBUTION[appt],
      card_count: got.card_count, lead_count: found.size, not_listed: missing,
      note: apptDrillNote({ card_count: got.card_count, listed: found.size, missing }) });
  }
  return { lead_ids: ids, meta };
}

// ?report_kpi=<id> (the Reports page, admins): the leads behind that number for the picked dealer-local days, with the
// page's filters (report_filters, the Reports page's own query string), a breakdown group (report_by + report_group)
// and the rate's "out of" part (report_part=denominator). Rows come from the KPI registry, so the list is the number.
async function reportDrill({ url, dealerId, def, startDate, endDate }) {
  const p = url.searchParams;
  const tz = await getDealerTimezone(dealerId);
  const input = new URLSearchParams(p.get("report_filters") || "");
  for (const k of ["from", "to", "basis", "dealer_id"]) input.delete(k);
  if (startDate) input.set("from", startDate);
  if (endDate) input.set("to", endDate);
  const parsed = parseFilterSpec(input, { report: REPORTS.KPI_REPORTS, tz });
  const part = p.get("report_part") === "denominator" && def.kind === "rate" ? "denominator" : "numerator";
  const by = p.get("report_by") && (def.breakdowns || []).includes(p.get("report_by")) ? p.get("report_by") : null;
  const group = by ? (p.get("report_group") ?? "") : null;
  const label = `Report: ${def.label}${part === "denominator" ? ` (out of: ${def.denominatorLabel || "all"})` : ""}`
    + `${by ? ` · ${group}` : ""}`;
  if (!parsed.ok) {
    return { lead_ids: [], meta: { range: null, filters: [{ param: "report_kpi", value: def.id, label,
      note: `Pick a date range (${parsed.errors.join("; ")})` }] } };
  }
  const { spec } = parsed;
  const ev = await evaluateKpi(def.id, { dealerId: String(dealerId), from: spec.from, to: spec.to, tz, spec });
  let rows = part === "denominator" ? ev.denominatorRows || [] : ev.rows;
  if (by) rows = rows.filter((r) => String(r._g?.[by] ?? "Unknown") === group);
  const got = reportKpiLeads(rows);
  const oids = got.lead_ids.filter((id) => mongoose.isValidObjectId(id));
  const found = new Set((oids.length ? await Lead.find({ _id: { $in: oids }, dealer_id: dealerId }).select("_id").lean()
    : []).map((l) => String(l._id)));
  const missing = rows.filter((r) => {
    const own = r.lead_id ? [String(r.lead_id)] : String(r.lead_ids || "").split(/\s+/).filter(Boolean);
    return !own.some((id) => found.has(id));
  }).length;
  const note = reportDrillNote({ grain: def.grain, card_count: got.card_count, listed: found.size, missing });
  return { lead_ids: [...found], meta: { range: { from: spec.from, to: spec.to }, filters: [{ param: "report_kpi",
    value: def.id, label, where: "report", card_count: got.card_count, lead_count: found.size, not_listed: missing,
    note }] } };
}

// POST: Create a new lead
export async function POST(req) {
    try {
      let data = await req.json();
      await dbConnect();
  
      // Validate required fields
      if (!data.dealer_id) {
        throw new Error('Dealer ID is required');
      }
      if (!data.name) {
        throw new Error('Name is required');
      }
      if (!data.email && !data.phone) {
        throw new Error('Either email or phone is required');
      }
  
      // Check dealer subscription
      const dealer = await User.findById(data.dealer_id);
      if (!dealer) {
        throw new Error('Dealer not found');
      }
      // Security fix (Nov 2026): a bad or expired token fell through (the catch below only warns), so anyone could
      // add a lead to any dealer, which queues the first message to that customer. Now that dealer, its agency or a
      // super admin.
      const dealerGuard = await requireDealerAccess(req, String(dealer._id));
      if (dealerGuard.response) return dealerGuard.response;
      try {
        const authHeader = req.headers.get("Authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
          const token = authHeader.split(" ")[1];
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          currentUser = await User.findById(decoded.userId).populate({
            path: "role",
            populate: { path: "permissions" }
          });
          if (currentUser) {
            userPermissions = currentUser?.role?.permissions?.map(p => p.permission_name) || [];
          }else{
            return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
          }
         
        }else{
          return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
        }
      } catch (err) {
        console.warn("Token verification failed in leads API:", err.message);
      }
      const dealerEmailAccount = await EmailAccount.findOne({ dealer_id: dealer._id });
  
      // Check subscription validity
      let subscriptionValid = false;
      if (dealer.vendor_id) {
        const agency = await User.findById(dealer.vendor_id);
       
        subscriptionValid = Boolean(agency && isPackageExpiryValid(agency.package_expiry));
      } else {
        subscriptionValid = isPackageExpiryValid(dealer.package_expiry);
      }
     
      if (!subscriptionValid) {
        await sendSubscriptionExpiryNotification({
          account: dealer.vendor_id ? await User.findById(dealer.vendor_id) : dealer,
          dealer: dealer.vendor_id ? dealer : null
        });
        return new Response(JSON.stringify({ 
          message: 'Subscription expired or invalid',
          error: 'Payment Required'
        }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Prioritize phone (SMS) if phone number exists and is valid, even when
      // an email is also present.
      if (data.phone && data.phone.length >= 10) {
        data.followup_preference = 'sms';
      } else if (!data.followup_preference) {
        // Default to email if no preference set and no valid phone
        data.followup_preference = 'email';
      }

      // Determine sender and recipient based on followup_preference
      const sender = data.followup_preference === 'sms' 
      ? dealer.dealer_account_information?.sms_conversion_phone 
      : dealerEmailAccount?.email_address;
      const recipient = data.followup_preference === 'sms' ? data.phone : data.email;
  
      // Prepare lead data
      const leadData = {
        name: data.name,
        email: data.email || null,
        phone: data.phone ? formatPhoneForTwilio(data.phone) : null,
        followup_preference: data.followup_preference || 'email',
        vehicle_make: data.vehicle_make,
        vehicle_model: data.vehicle_model,
        vehicle_year: data.vehicle_year,
        vin: data.vin,
        comments: data.comments,
        dealer_id: data.dealer_id,
        source: data.source || data.followup_preference || 'email',
        contact_type: validContactType(data.contact_type),
      };
      
      const jobData = {
     
        currentSMS:{
          contact_type: validContactType(data.contact_type),
          message_id: null,
          parent_conversation: null,
          sender,
          recipient,
          subject:null,
          name: data.name,
          email: data.email,
          phone: data.phone ? formatPhoneForTwilio(data.phone) : null,
          date: new Date(),
          mail_content:data.comments,
          vehicle_make: data.vehicle_make,
          vehicle_model: data.vehicle_model,
          vehicle_year: data.vehicle_year,
          vin: data.vin,
          followup_preference: data.followup_preference || '',
          dealer_id: data.dealer_id,
          communication_type: data.followup_preference || '',
        }
        
      };
  
      // Create Redis connection
      const redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        db: Number(process.env.REDIS_DB || 0),
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
      });
  
      // Create queue for processing
      const leadQueue = new Queue('leadProcessingQueue', { connection: redis });
  
      // Add job to queue
      await leadQueue.add('processLead', {
        leadData,
        action: 'create',
        dealer: dealer,
        jobData
      }, {
        attempts: 1,
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      });
  
      // Return immediate response
      return new Response(JSON.stringify({ 
        message: 'Lead processing started',
        status: 'queued'
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
  
    } catch (error) {
      console.error('Error processing lead:', error);
      return new Response(JSON.stringify({ 
        message: 'Internal Server Error',
        error: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
}

// DELETE: Remove a lead by ID
export async function DELETE(req) {
    // Security fix (Nov 2026): this deleted any lead by id with no sign-in. Now the lead's own dealer (owner or
    // staff), its agency or a super admin.
    const signedIn = await requireUser(req);
    if (signedIn.response) return signedIn.response;
    try {
        await dbConnect();
        const { id } = await req.json();
        if (!mongoose.isValidObjectId(id)) return NextResponse.json({ error: "Invalid lead id" }, { status: 400 });
        const lead = await Lead.findById(id).select("dealer_id").lean();
        if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
        const guard = await requireDealerAccess(req, String(lead.dealer_id));
        if (guard.response) return guard.response;
        await Lead.findByIdAndDelete(id);
        return NextResponse.json({ message: "Lead deleted successfully" }, { status: 200 });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

function formatPhoneForTwilio(phone) {
  // If phone is empty, undefined, or null, return null
  if (!phone || !phone.toString().trim()) {
    return null;
  }

  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');

  // If no digits found, return null
  if (!cleaned || cleaned.length === 0) {
    return null;
  }

  // If the number starts with a country code (e.g., 91 for India), keep it
  if (cleaned.length > 10 && cleaned.startsWith('1')) {
    return `+${cleaned}`; // US numbers with country code
  } else if (cleaned.length > 10 && !cleaned.startsWith('1')) {
    return `+${cleaned}`; // Other countries (e.g., India: +919876543210)
  } else if (cleaned.length === 10) {
    return `+1${cleaned}`; // Default to US (+1) if 10 digits
  } else {
    throw new Error('Invalid phone number format');
  }
}
