import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Lead from "@models/Lead";
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
    const dealerId = url.searchParams.get("dealer_id");
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
    const messageFilter = url.searchParams.get("message_filter"); // 'unread', 'read', or empty
    const vehicleMakes = url.searchParams.getAll("make");
    const vehicleModels = url.searchParams.getAll("model").concat(url.searchParams.getAll("vehicle_model"));
    const vehicleYears = url.searchParams.getAll("year").concat(url.searchParams.getAll("vehicle_year"));
    const vehicleCondition = url.searchParams.get("condition") || url.searchParams.get("car_type");
    const stocks = url.searchParams.getAll("stock")
      .concat(url.searchParams.getAll("stockNumber"))
      .concat(url.searchParams.getAll("stocknumber"));

    // Build query object
    let query = { dealer_id: dealerId };
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
    if (status) query.fe_lead_status = status;
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
    if (bookingStatus) {
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
      // Find lead IDs based on message read status
      // Count ALL messages with lead_id (both incoming and sent)
      const messageQuery = {
        dealer_id: dealerId,
        lead_id: { $exists: true, $ne: null }
      };

      if (messageFilter === 'unread') {
        // Find leads with unread messages
        messageQuery.read = { $ne: true };
        const leadsWithUnread = await Email.distinct('lead_id', messageQuery);
        
        if (leadsWithUnread.length > 0) {
          query._id = { $in: leadsWithUnread };
        } else {
          // No leads with unread messages - return empty result
          query._id = { $in: [] };
        }
      } else if (messageFilter === 'read') {
        // Find leads with ONLY read messages (no unread)
        // First, get all leads that have unread messages
        const unreadQuery = { ...messageQuery, read: { $ne: true } };
        const leadsWithUnread = await Email.distinct('lead_id', unreadQuery);
        
        // Then get all leads that have messages
        const leadsWithMessages = await Email.distinct('lead_id', messageQuery);
        
        // Leads with messages but NOT in unread list = only read messages
        const onlyReadLeads = leadsWithMessages.filter(
          leadId => !leadsWithUnread.some(unreadId => unreadId.equals(leadId))
        );
        
        if (onlyReadLeads.length > 0) {
          query._id = { $in: onlyReadLeads };
        } else {
          // No leads with only read messages - return empty result
          query._id = { $in: [] };
        }
      }
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
      const leads = await Lead.find(query)
        .populate({ path: 'assigned_to', select: 'name email', strictPopulate: false })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      return new Response(JSON.stringify({
        data: leads,
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

// POST: Create a new lead
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
      // Prioritize phone (SMS) if phone number exists and is valid
      if(!data.email && (data.phone && data.phone.length >= 10)){
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
        source: data.followup_preference || 'email',
       
      };
      
      const jobData = {
     
        currentSMS:{
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
    try {
        const { id } = await req.json();
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