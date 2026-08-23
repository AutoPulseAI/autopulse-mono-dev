import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Campaign from "@models/Campaign";
import CampaignLead from "@models/CampaignLead";
import jwt from "jsonwebtoken";
import User from "@models/User";
import moment from "moment-timezone";

// GET: Fetch all campaigns with filtering
export async function GET(req) {
  try {
    await dbConnect();
    const url = new URL(req.url);
    
    // Get current user from token
    let currentUser = null;
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        currentUser = await User.findById(decoded.userId);
      }
    } catch (err) {
      console.warn("Token verification failed in campaigns API:", err.message);
    }

    const dealerId = url.searchParams.get("dealer_id");
    const status = url.searchParams.get("status");
    const page = parseInt(url.searchParams.get("page")) || 1;
    const limit = parseInt(url.searchParams.get("limit")) || 10;

    // Build query
    let query = {};
    
    if (dealerId) {
      query.dealer_id = dealerId;
    } else if (currentUser) {
      // If no dealer_id provided, use current user's dealer_id
      const activeDealerId = currentUser.parent_id || currentUser._id;
      query.dealer_id = activeDealerId;
    }

    if (status) {
      query.status = status;
    }

    const totalCampaigns = await Campaign.countDocuments(query);
    const campaigns = await Campaign.find(query)
      .populate({ path: 'dealer_id', select: 'name email', strictPopulate: false })
      .populate({ path: 'created_by', select: 'name email', strictPopulate: false })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Ensure actual_scheduled_date is included in response (even if null)
    const campaignsWithActualDate = campaigns.map(campaign => ({
      ...campaign,
      actual_scheduled_date: campaign.actual_scheduled_date || null
    }));

    return NextResponse.json({
      data: campaignsWithActualDate,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCampaigns / limit),
        totalItems: totalCampaigns,
        itemsPerPage: limit,
        hasNextPage: page < Math.ceil(totalCampaigns / limit),
        hasPreviousPage: page > 1
      }
    }, { status: 200 });
  } catch (error) {
    console.error("Error fetching campaigns:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch campaigns" },
      { status: 500 }
    );
  }
}

// POST: Create a new campaign
export async function POST(req) {
  try {
    await dbConnect();
    const data = await req.json();

    // Get current user from token
    let currentUser = null;
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        currentUser = await User.findById(decoded.userId);
      }
    } catch (err) {
      console.warn("Token verification failed:", err.message);
    }

    // Validate required fields
    if (!data.name) {
      return NextResponse.json(
        { error: "Campaign name is required" },
        { status: 400 }
      );
    }

    if (!data.dealer_id) {
      return NextResponse.json(
        { error: "Dealer ID is required" },
        { status: 400 }
      );
    }

    if (!data.message_type || !["email", "sms"].includes(data.message_type)) {
      return NextResponse.json(
        { error: "Valid message type (email or sms) is required" },
        { status: 400 }
      );
    }

    // For draft campaigns, leads are optional. For scheduled/active campaigns, require at least one lead.
    const isDraft = data.status === "draft";
    
    if (!isDraft && (!data.leads || !Array.isArray(data.leads) || data.leads.length === 0)) {
      return NextResponse.json(
        { error: "At least one lead is required for non-draft campaigns" },
        { status: 400 }
      );
    }

    // Check if strict validation is enabled via environment variable
    // Set CAMPAIGN_STRICT_VALIDATION=false in .env to disable strict validation
    // When disabled: only requires email or phone (name becomes optional, defaults to "N/A")
    // When enabled (default): requires both name and at least one contact method
    // Default to true (strict validation) if not set
    const strictValidation = process.env.CAMPAIGN_STRICT_VALIDATION !== 'false';
    
    let validLeads = [];
    
    // Only validate leads if they are provided (for draft campaigns, leads can be empty)
    if (data.leads && Array.isArray(data.leads) && data.leads.length > 0) {
      if (strictValidation) {
        // Strict validation: require name and at least one contact method
        validLeads = data.leads
          .filter(lead => {
            // Ensure name exists and is not empty
            const hasName = lead.name && lead.name.toString().trim().length > 0;
            // Ensure at least email or phone exists
            const hasContact = (lead.email && lead.email.toString().trim().length > 0) || 
                              (lead.phone && lead.phone.toString().trim().length > 0);
            return hasName && hasContact;
          })
          .map(lead => ({
            name: lead.name.toString().trim(),
            email: (lead.email || "").toString().trim(),
            phone: (lead.phone || "").toString().trim(),
            lead_id: lead.lead_id || null
          }));

        if (!isDraft && validLeads.length === 0) {
          return NextResponse.json(
            { error: "All leads must have a name and at least one contact method (email or phone)" },
            { status: 400 }
          );
        }

        if (!isDraft && validLeads.length < data.leads.length) {
          return NextResponse.json(
            { error: `${data.leads.length - validLeads.length} lead(s) were invalid and removed. All leads must have a name and at least one contact method.` },
            { status: 400 }
          );
        }
      } else {
        // Lenient validation: only require at least one contact method, name is optional
        validLeads = data.leads
          .filter(lead => {
            // Ensure at least email or phone exists
            const hasContact = (lead.email && lead.email.toString().trim().length > 0) || 
                              (lead.phone && lead.phone.toString().trim().length > 0);
            return hasContact;
          })
          .map(lead => ({
            name: (lead.name || "").toString().trim() || "N/A",
            email: (lead.email || "").toString().trim(),
            phone: (lead.phone || "").toString().trim(),
            lead_id: lead.lead_id || null
          }));

        if (!isDraft && validLeads.length === 0) {
          return NextResponse.json(
            { error: "All leads must have at least one contact method (email or phone)" },
            { status: 400 }
          );
        }
      }
    }

    // Get dealer timezone for calculating actual_scheduled_date
    const dealer = await User.findById(data.dealer_id);
    const dealerTimezone = dealer?.dealer_account_information?.time_zone || "America/New_York";
    
    // Calculate actual_scheduled_date (UTC) from scheduled_date (dealer timezone)
    let actualScheduledDate = null;
    let scheduledDate = null;
    
    if (data.scheduled_date) {
      // scheduled_date comes as string "YYYY-MM-DDTHH:mm:ss" (local time, no timezone)
      // or as ISO string. Parse it and interpret in dealer's timezone
      let dateTimeStr = data.scheduled_date;
      
      // If it's an ISO string with Z or timezone, extract just the date/time part
      if (dateTimeStr.includes('T') && (dateTimeStr.includes('Z') || dateTimeStr.includes('+'))) {
        // Extract date and time components from ISO string
        const isoDate = new Date(dateTimeStr);
        const year = isoDate.getUTCFullYear();
        const month = String(isoDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(isoDate.getUTCDate()).padStart(2, '0');
        const hours = String(isoDate.getUTCHours()).padStart(2, '0');
        const minutes = String(isoDate.getUTCMinutes()).padStart(2, '0');
        const seconds = String(isoDate.getUTCSeconds()).padStart(2, '0');
        dateTimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      } else if (dateTimeStr.includes('T')) {
        // Format: "YYYY-MM-DDTHH:mm:ss" - convert to space-separated format
        dateTimeStr = dateTimeStr.replace('T', ' ');
      }
      
      // Create a moment in dealer's timezone with this date/time
      // Try different formats
      let momentDate;
      if (dateTimeStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        momentDate = moment.tz(dateTimeStr, "YYYY-MM-DD HH:mm:ss", dealerTimezone);
      } else if (dateTimeStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)) {
        momentDate = moment.tz(dateTimeStr, "YYYY-MM-DD HH:mm", dealerTimezone);
      } else {
        // Fallback: try parsing as-is
        momentDate = moment.tz(dateTimeStr, dealerTimezone);
      }
      
      if (!momentDate.isValid()) {
        return NextResponse.json(
          { error: "Invalid scheduled date format" },
          { status: 400 }
        );
      }
      
      // Both scheduled_date and actual_scheduled_date should be in UTC
      // scheduled_date: UTC representation of user's input (in dealer timezone)
      // actual_scheduled_date: Same UTC value (used by cron jobs)
      // When displaying, we'll convert back to dealer timezone
      scheduledDate = momentDate.utc().toDate();
      actualScheduledDate = momentDate.utc().toDate();
    }

    // Create campaign (without leads - they'll be saved separately)
    // Determine status: use explicit status from frontend if provided, otherwise auto-determine
    let campaignStatus;
    if (data.status !== undefined && data.status !== null) {
      // Explicit status provided from frontend
      campaignStatus = data.status;
    } else {
      // Auto-determine: if has scheduled date, set to "scheduled", otherwise "draft"
      campaignStatus = scheduledDate ? "scheduled" : "draft";
    }
    
    const campaignData = {
      name: data.name.trim(),
      description: data.description?.trim() || "",
      message_type: data.message_type,
      dealer_id: data.dealer_id,
      scheduled_date: scheduledDate,
      actual_scheduled_date: actualScheduledDate, // UTC time for cron jobs
      status: campaignStatus, // Use explicit status or auto-determined
      message_content: {
        subject: data.message_content?.subject || "",
        body: data.message_content?.body || ""
      },
      attachments: data.attachments || [], // Save attachments
      stats: {
        total_leads: validLeads.length,
        sent: 0,
        delivered: 0,
        failed: 0
      },
      created_by: currentUser?._id || null,
      settings: {
        lead_handling: data.settings?.lead_handling || "create_new",
        use_replies_for_ai: data.settings?.use_replies_for_ai || false
      }
    };

    // Debug log to verify status and scheduled date
    console.log("Creating campaign:", {
      status: campaignStatus,
      scheduled_date: scheduledDate,
      actual_scheduled_date: actualScheduledDate,
      dealer_timezone: dealerTimezone,
      explicit_status_provided: data.status !== undefined
    });

    const campaign = new Campaign(campaignData);
    await campaign.save();
    
    // Verify the field was saved
    console.log("Campaign saved with actual_scheduled_date:", campaign.actual_scheduled_date);

    // Save leads to separate CampaignLead collection (better for large datasets)
    if (validLeads.length > 0) {
      const dealerId = campaign.dealer_id.toString();
      const campaignId = campaign._id.toString();
      const campaignLeads = validLeads.map(lead => ({
        campaign_id: campaignId,
        dealer_id: dealerId,
        name: lead.name,
        email: lead.email || "",
        phone: lead.phone || "",
        lead_id: lead.lead_id || null,
        status: "pending"
      }));

      // Use insertMany for better performance with large datasets
      await CampaignLead.insertMany(campaignLeads);
    }

    // Populate references for response
    await campaign.populate([
      { path: 'dealer_id', select: 'name email', strictPopulate: false },
      { path: 'created_by', select: 'name email', strictPopulate: false }
    ]);

    return NextResponse.json(
      { 
        message: "Campaign created successfully",
        campaign: campaign
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating campaign:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create campaign" },
      { status: 500 }
    );
  }
}

