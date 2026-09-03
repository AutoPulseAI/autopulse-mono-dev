import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Campaign from "@models/Campaign";
import CampaignLead from "@models/CampaignLead";
import CampaignTracking from "@models/CampaignTracking";
import jwt from "jsonwebtoken";
import User from "@models/User";

/**
 * GET /api/campaigns/[id]/report
 * Get detailed report for a campaign with all metrics
 */
export async function GET(req, { params }) {
  try {
    await dbConnect();

    // Authenticate user
    let currentUser = null;
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        currentUser = await User.findById(decoded.userId);
      }
    } catch (err) {
      console.warn("Token verification failed in campaign report API:", err.message);
    }

    if (!currentUser) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const { id: campaignId } = await params;

    // Get campaign details
    const campaign = await Campaign.findById(campaignId)
      .populate("dealer_id", "name email dealer_account_information")
      .populate("created_by", "name email")
      .lean();

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    // Authorization check - only dealer/agency/admin can view their campaigns
    const dealerId = campaign.dealer_id?._id?.toString() || campaign.dealer_id?.toString();
    const userDealerId = currentUser.parent_id?.toString() || currentUser._id.toString();
    
    if (
      currentUser.role !== "admin" &&
      currentUser.role !== "agency" &&
      userDealerId !== dealerId
    ) {
      return NextResponse.json(
        { error: "Unauthorized to view this campaign" },
        { status: 403 }
      );
    }

    // Convert campaign_id to string for queries
    const campaignIdStr = campaign._id.toString();

    // Get all campaign leads with their stats
    const campaignLeads = await CampaignLead.find({
      campaign_id: campaignIdStr
    }).lean();

    // Get tracking events breakdown and calculate actual stats from CampaignTracking FIRST
    // Note: CampaignTracking uses ObjectId for campaign_id, not string
    // This is the source of truth for engagement metrics
    const trackingStats = await CampaignTracking.aggregate([
      {
        $match: { campaign_id: campaign._id }
      },
      {
        $group: {
          _id: "$event_type",
          count: { $sum: 1 },
          unique_leads: { $addToSet: "$campaign_lead_id" }
        }
      },
      {
        $project: {
          event_type: "$_id",
          total_events: "$count",
          unique_leads: { $size: "$unique_leads" }
        }
      }
    ]);

    // Extract actual stats from CampaignTracking (source of truth)
    const openEvent = trackingStats.find(e => e.event_type === 'open');
    const clickEvent = trackingStats.find(e => e.event_type === 'click');
    const bounceEvent = trackingStats.find(e => e.event_type === 'bounce');
    const unsubscribeEvent = trackingStats.find(e => e.event_type === 'unsubscribe');

    const actualTotalOpens = openEvent?.total_events || 0;
    const actualUniqueOpens = openEvent?.unique_leads || 0;
    const actualTotalClicks = clickEvent?.total_events || 0;
    const actualUniqueClicks = clickEvent?.unique_leads || 0;
    const actualBounced = bounceEvent?.total_events || 0;
    const actualUnsubscribed = unsubscribeEvent?.total_events || 0;

    // Use trackingBreakdown for the response (same data, just renamed)
    const trackingBreakdown = trackingStats;

    // Calculate detailed stats
    // Use CampaignTracking as source of truth for engagement metrics
    const stats = {
      // Basic stats (from campaign.stats)
      total_leads: campaign.stats.total_leads || 0,
      sent: campaign.stats.sent || 0,
      delivered: campaign.stats.delivered || 0,
      failed: campaign.stats.failed || 0,
      bounced: actualBounced || campaign.stats.bounced || 0, // Prefer CampaignTracking
      
      // Engagement stats (from CampaignTracking - source of truth)
      unique_opens: actualUniqueOpens,
      total_opens: actualTotalOpens,
      unique_clicks: actualUniqueClicks,
      total_clicks: actualTotalClicks,
      unsubscribed: actualUnsubscribed || campaign.stats.unsubscribed || 0, // Prefer CampaignTracking
      
      // Calculated rates
      delivery_rate: 0,
      bounce_rate: 0,
      open_rate: 0,
      click_rate: 0,
      click_through_rate: 0, // Clicks / Delivered (CTR)
      click_to_open_rate: 0, // Clicks / Opens (CTOR)
      unsubscribe_rate: 0,
      
      // Processing status
      pending: campaignLeads.filter(l => l.status === "pending").length,
      processed: campaignLeads.filter(l => l.status !== "pending").length
    };

    // Calculate rates (avoid division by zero)
    if (stats.sent > 0) {
      stats.delivery_rate = parseFloat(((stats.delivered / stats.sent) * 100).toFixed(2));
      stats.bounce_rate = parseFloat(((stats.bounced / stats.sent) * 100).toFixed(2));
      stats.unsubscribe_rate = parseFloat(((stats.unsubscribed / stats.sent) * 100).toFixed(2));
    }

    if (stats.delivered > 0) {
      stats.open_rate = parseFloat(((stats.unique_opens / stats.delivered) * 100).toFixed(2));
      stats.click_rate = parseFloat(((stats.unique_clicks / stats.delivered) * 100).toFixed(2));
      // Click-through rate: unique clicks / delivered
      stats.click_through_rate = parseFloat(((stats.unique_clicks / stats.delivered) * 100).toFixed(2));
    }

    if (stats.unique_opens > 0) {
      // Click-to-open rate: unique clicks / unique opens
      stats.click_to_open_rate = parseFloat(((stats.unique_clicks / stats.unique_opens) * 100).toFixed(2));
    }

    // Get top clicked links (for email campaigns)
    let topLinks = [];
    if (campaign.message_type === "email") {
      topLinks = await CampaignTracking.aggregate([
        {
          $match: {
            campaign_id: campaign._id, // ObjectId, not string
            event_type: "click"
          }
        },
        {
          $group: {
            _id: "$clicked_url",
            clicks: { $sum: 1 },
            unique_clicks: { $addToSet: "$campaign_lead_id" }
          }
        },
        {
          $project: {
            url: "$_id",
            total_clicks: "$clicks",
            unique_clicks: { $size: "$unique_clicks" }
          }
        },
        {
          $sort: { total_clicks: -1 }
        },
        {
          $limit: 10
        }
      ]);
    }

    // Get engagement timeline (opens/clicks over time)
    const engagementTimeline = await CampaignTracking.aggregate([
      {
        $match: {
          campaign_id: campaign._id, // ObjectId, not string
          event_type: { $in: ["open", "click"] }
        }
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$event_timestamp"
              }
            },
            event_type: "$event_type"
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.date": 1 }
      }
    ]);

    // Build response
    const report = {
      // Campaign info
      campaign: {
        id: campaign._id.toString(),
        name: campaign.name,
        description: campaign.description,
        message_type: campaign.message_type,
        status: campaign.status,
        created_at: campaign.createdAt,
        updated_at: campaign.updatedAt,
        scheduled_date: campaign.scheduled_date,
        actual_scheduled_date: campaign.actual_scheduled_date,
        dealer: {
          id: campaign.dealer_id?._id?.toString(),
          name: campaign.dealer_id?.name,
          timezone: campaign.dealer_id?.dealer_account_information?.time_zone || "America/New_York"
        },
        created_by: {
          id: campaign.created_by?._id?.toString(),
          name: campaign.created_by?.name,
          email: campaign.created_by?.email
        }
      },
      
      // Statistics
      stats: stats,
      
      // Tracking breakdown
      tracking_breakdown: trackingBreakdown,
      
      // Top links (for email)
      top_links: topLinks,
      
      // Engagement timeline
      engagement_timeline: engagementTimeline,
      
      // Lead details (all leads for the leads tab)
      leads: campaignLeads.map(lead => ({
        id: lead._id.toString(),
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        lead_id: lead.lead_id ? lead.lead_id.toString() : null,
        is_system_lead: lead.lead_id ? true : false,
        status: lead.status,
        sent_at: lead.sent_at,
        delivered_at: lead.delivered_at,
        opened: lead.opened,
        opened_at: lead.opened_at,
        open_count: lead.open_count || 0,
        clicked: lead.clicked,
        clicked_at: lead.clicked_at,
        click_count: lead.click_count || 0,
        unsubscribed: lead.unsubscribed,
        unsubscribed_at: lead.unsubscribed_at,
        error_message: lead.error_message
      }))
    };

    return NextResponse.json({
      success: true,
      report: report
    });
  } catch (error) {
    console.error("Error generating campaign report:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate report" },
      { status: 500 }
    );
  }
}
