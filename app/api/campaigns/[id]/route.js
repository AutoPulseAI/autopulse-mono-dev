import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Campaign from "@models/Campaign";
import CampaignLead from "@models/CampaignLead";
import Lead from "@models/Lead";
import jwt from "jsonwebtoken";
import User from "@models/User";
import moment from "moment-timezone";

// GET: Fetch a single campaign by ID
export async function GET(req, { params }) {
  try {
    await dbConnect();
    const { id } = await params;

    const campaign = await Campaign.findById(id)
      .populate({ path: 'dealer_id', select: 'name email', strictPopulate: false })
      .populate({ path: 'created_by', select: 'name email', strictPopulate: false })
      .lean();

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ campaign }, { status: 200 });
  } catch (error) {
    console.error("Error fetching campaign:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch campaign" },
      { status: 500 }
    );
  }
}

// PUT: Update a campaign
export async function PUT(req, { params }) {
  try {
    await dbConnect();
    const { id } = await params;
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

    const campaign = await Campaign.findById(id);

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    // Check if campaign can be edited
    // MOST IMPORTANT: Cannot edit if any messages have been sent
    if (campaign.stats?.sent > 0) {
      return NextResponse.json(
        { error: "Cannot edit a campaign that has already sent messages. This is kept for audit purposes." },
        { status: 400 }
      );
    }

    // Cannot edit completed campaigns
    if (campaign.status === 'completed') {
      return NextResponse.json(
        { error: "Cannot edit a completed campaign. Completed campaigns are locked for record-keeping." },
        { status: 400 }
      );
    }

    // Allow editing if status is "active" but no messages sent yet
    // (This happens when cron sets status to active but worker hasn't started sending)
    if (campaign.status === 'active' && campaign.stats?.sent === 0) {
      console.log(`⚠️ Allowing edit of active campaign ${campaign._id} because no messages sent yet (0/${campaign.stats?.total_leads || 0})`);
      // Allow the edit to proceed
    }

    // Cannot edit active campaigns that have started sending
    if (campaign.status === 'active' && campaign.stats?.sent > 0) {
      return NextResponse.json(
        { error: "Cannot edit an active campaign that has started sending messages." },
        { status: 400 }
      );
    }

    // Update fields
    if (data.name !== undefined) campaign.name = data.name.trim();
    if (data.description !== undefined) campaign.description = data.description?.trim() || "";
    if (data.message_type !== undefined) campaign.message_type = data.message_type;
    if (data.scheduled_date !== undefined) {
      // User's input comes as "YYYY-MM-DDTHH:mm:ss" (interpreted as dealer timezone)
      // We need to convert it to UTC for storage
      if (data.scheduled_date) {
        // Get dealer timezone
        const dealer = await User.findById(campaign.dealer_id);
        const dealerTimezone = dealer?.dealer_account_information?.time_zone || "America/New_York";
        
        // scheduled_date comes as string "YYYY-MM-DDTHH:mm:ss" (no timezone, interpreted as dealer timezone)
        let dateTimeStr = data.scheduled_date;
        
        // If it's an ISO string with Z or timezone, extract just the date/time part
        if (dateTimeStr.includes('T') && (dateTimeStr.includes('Z') || dateTimeStr.includes('+'))) {
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
        
        // Create a moment in dealer's timezone (user's input is in dealer timezone)
        let momentDate;
        if (dateTimeStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
          momentDate = moment.tz(dateTimeStr, "YYYY-MM-DD HH:mm:ss", dealerTimezone);
        } else if (dateTimeStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)) {
          momentDate = moment.tz(dateTimeStr, "YYYY-MM-DD HH:mm", dealerTimezone);
        } else {
          momentDate = moment.tz(dateTimeStr, dealerTimezone);
        }
        
        if (momentDate.isValid()) {
          // Both scheduled_date and actual_scheduled_date should be in UTC
          // Convert user's input (dealer timezone) to UTC for storage
          const utcDate = momentDate.utc().toDate();
          campaign.scheduled_date = utcDate;
          campaign.actual_scheduled_date = utcDate;
          console.log("Updated scheduled_date and actual_scheduled_date:", {
            scheduled_date: utcDate,
            actual_scheduled_date: utcDate,
            dealer_timezone: dealerTimezone
          });
        } else {
          campaign.scheduled_date = null;
          campaign.actual_scheduled_date = null;
        }
      } else {
        campaign.scheduled_date = null;
        campaign.actual_scheduled_date = null;
      }
    }
    
    // Update status - important: do this AFTER updating scheduled_date
    if (data.status !== undefined && data.status !== null) {
      campaign.status = data.status;
      console.log("✅ Updated campaign status to:", data.status);
    } else if (campaign.scheduled_date) {
      // Auto-update status to "scheduled" if scheduled_date exists but status wasn't explicitly set
      campaign.status = "scheduled";
      console.log("✅ Auto-updated campaign status to 'scheduled' because scheduled_date exists");
    }
    
    console.log("📊 Campaign update summary:", {
      campaignId: campaign._id,
      name: campaign.name,
      status: campaign.status,
      hasScheduledDate: !!campaign.scheduled_date,
      scheduledDate: campaign.scheduled_date,
      statusFromRequest: data.status
    });
    
    // Update message content
    if (data.message_content !== undefined) {
      campaign.message_content = {
        subject: data.message_content.subject || campaign.message_content?.subject || "",
        body: data.message_content.body || campaign.message_content?.body || ""
      };
    }
    
    // Update attachments
    if (data.attachments !== undefined) {
      campaign.attachments = data.attachments;
    }
    
    // Update settings
    if (data.settings !== undefined) {
      campaign.settings = {
        lead_handling: data.settings.lead_handling || campaign.settings?.lead_handling || "create_new",
        use_replies_for_ai: data.settings.use_replies_for_ai ?? campaign.settings?.use_replies_for_ai ?? false
      };
    }
    
    // Update leads in separate collection if provided
    if (data.leads !== undefined && Array.isArray(data.leads)) {
      // Delete existing campaign leads
      const campaignId = campaign._id.toString();
      await CampaignLead.deleteMany({ campaign_id: campaignId });
      
      // Insert new leads with lead_id lookup
      if (data.leads.length > 0) {
        const dealerId = campaign.dealer_id.toString();
        
        // Helper function to normalize phone numbers for comparison
        const normalizePhone = (phone) => {
          if (!phone) return '';
          // Remove all non-digit characters
          return phone.replace(/\D/g, '');
        };
        
        // Process each lead and check if it exists in Lead table
        const campaignLeads = await Promise.all(
          data.leads.map(async (lead) => {
            let existingLeadId = lead.lead_id || null;
            
            // If lead_id is not provided, try to find existing lead by email or phone
            if (!existingLeadId) {
              // Try to find by email first (case-insensitive exact match)
              if (lead.email && lead.email.trim()) {
                const emailMatch = await Lead.findOne({
                  dealer_id: dealerId,
                  email: { $regex: `^${lead.email.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
                }).select('_id');
                
                if (emailMatch) {
                  existingLeadId = emailMatch._id;
                  console.log(`Found existing lead ${existingLeadId} by email: ${lead.email}`);
                }
              }
              
              // If not found by email, try to find by phone (normalize and compare)
              if (!existingLeadId && lead.phone && lead.phone.trim()) {
                const normalizedSearchPhone = normalizePhone(lead.phone);
                if (normalizedSearchPhone) {
                  // Fetch leads with phone numbers for this dealer
                  const leadsWithPhone = await Lead.find({ 
                    dealer_id: dealerId,
                    phone: { $exists: true, $ne: '' }
                  }).select('_id phone').lean();
                  
                  // Check each lead's phone (normalized) against search phone
                  for (const existingLead of leadsWithPhone) {
                    if (existingLead.phone) {
                      const normalizedExistingPhone = normalizePhone(existingLead.phone);
                      if (normalizedExistingPhone === normalizedSearchPhone) {
                        existingLeadId = existingLead._id;
                        console.log(`Found existing lead ${existingLeadId} by phone: ${lead.phone} (normalized: ${normalizedSearchPhone})`);
                        break;
                      }
                    }
                  }
                }
              }
            }
            
            return {
              campaign_id: campaignId,
              name: lead.name,
              dealer_id: dealerId,
              email: lead.email || "",
              phone: lead.phone || "",
              lead_id: existingLeadId,
              status: "pending"
            };
          })
        );
        
        await CampaignLead.insertMany(campaignLeads);
      }
      
      campaign.stats.total_leads = data.leads.length;
    }

    await campaign.save();

    // Populate references for response
    await campaign.populate([
      { path: 'dealer_id', select: 'name email', strictPopulate: false },
      { path: 'created_by', select: 'name email', strictPopulate: false }
    ]);

    return NextResponse.json(
      { 
        message: "Campaign updated successfully",
        campaign: campaign
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating campaign:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update campaign" },
      { status: 500 }
    );
  }
}

// DELETE: Delete a campaign
export async function DELETE(req, { params }) {
  try {
    await dbConnect();
    const { id } = await params;

    const campaign = await Campaign.findById(id);

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    // MOST IMPORTANT: Prevent deletion if any messages have been sent
    if (campaign.stats?.sent > 0) {
      return NextResponse.json(
        { error: "Cannot delete a campaign that has already sent messages. This is kept for audit purposes." },
        { status: 400 }
      );
    }

    // Prevent deletion of completed campaigns
    if (campaign.status === 'completed') {
      return NextResponse.json(
        { error: "Cannot delete a completed campaign. Completed campaigns are kept for record-keeping purposes." },
        { status: 400 }
      );
    }

    // Allow deletion if status is "active" but no messages sent yet
    // (This happens when cron sets status to active but worker hasn't started sending)
    if (campaign.status === 'active' && campaign.stats?.sent === 0) {
      console.log(`⚠️ Allowing deletion of active campaign ${campaign._id} because no messages sent yet (0/${campaign.stats?.total_leads || 0})`);
      // Allow the deletion to proceed
    }

    // Prevent deletion of active campaigns that have started sending
    if (campaign.status === 'active' && campaign.stats?.sent > 0) {
      return NextResponse.json(
        { error: "Cannot delete an active campaign that has started sending messages." },
        { status: 400 }
      );
    }

    console.log(`🗑️ Deleting campaign: ${campaign.name} (ID: ${id}, Status: ${campaign.status})`);

    // Delete all associated campaign leads first
    const campaignIdStr = id.toString();
    await CampaignLead.deleteMany({ campaign_id: campaignIdStr });

    // Then delete the campaign
    await Campaign.findByIdAndDelete(id);

    console.log(`✅ Campaign deleted successfully: ${campaign.name}`);

    return NextResponse.json(
      { message: "Campaign deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting campaign:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete campaign" },
      { status: 500 }
    );
  }
}

