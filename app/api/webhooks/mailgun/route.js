import { NextResponse } from "next/server";
import crypto from "crypto";
import { Types } from "mongoose";
const { ObjectId } = Types;
import dbConnect from "@lib/mongodb";
import Campaign from "@models/Campaign";
import CampaignLead from "@models/CampaignLead";
import CampaignTracking from "@models/CampaignTracking";
import Lead from "@models/Lead";

/**
 * Mailgun Webhook Handler
 * Receives events: delivered, opened, clicked, bounced, failed, unsubscribed, complained
 * 
 * Setup in Mailgun Dashboard:
 * 1. Go to Sending > Webhooks
 * 2. Add webhook URL: https://yourdomain.com/api/webhooks/mailgun
 * 3. Enable events: delivered, opened, clicked, bounced, failed, unsubscribed, complained
 */
export async function POST(req) {
  try {
    const body = await req.json();
    
    // Verify webhook signature for security
    const signature = body.signature;
    if (!verifyMailgunWebhook(signature)) {
      console.error("❌ Invalid Mailgun webhook signature");
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    const eventData = body['event-data'];
    const eventType = eventData.event;
    
    // Get custom variables we sent with the email
    const campaignId = eventData['user-variables']?.campaign_id;
    const campaignLeadId = eventData['user-variables']?.campaign_lead_id;
    const dealerId = eventData['user-variables']?.dealer_id;
    
    if (!campaignId || !campaignLeadId) {
      console.warn("⚠️ Mailgun webhook missing campaign identifiers");
      return NextResponse.json({ success: true }); // Still return 200 to avoid retries
    }

    await dbConnect();

    console.log(`📧 Mailgun Event: ${eventType} for Campaign Lead: ${campaignLeadId}`);

    // Handle different event types
    switch (eventType) {
      case 'delivered':
        await handleDelivered(campaignId, campaignLeadId, eventData);
        break;
        
      case 'opened':
        await handleOpened(campaignId, campaignLeadId, dealerId, eventData);
        break;
        
      case 'clicked':
        await handleClicked(campaignId, campaignLeadId, dealerId, eventData);
        break;
        
      case 'bounced':
      case 'failed':
        await handleBounced(campaignId, campaignLeadId, dealerId, eventData);
        break;
        
      case 'unsubscribed':
        await handleUnsubscribed(campaignId, campaignLeadId, dealerId, eventData);
        break;
        
      case 'complained':
        await handleComplaint(campaignId, campaignLeadId, eventData);
        break;
        
      default:
        console.log(`ℹ️ Unhandled event type: ${eventType}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("❌ Error processing Mailgun webhook:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Verify webhook signature from Mailgun
 */
function verifyMailgunWebhook(signature) {
  if (!signature || !signature.timestamp || !signature.token || !signature.signature) {
    return false;
  }

  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    console.error("⚠️ MAILGUN_WEBHOOK_SIGNING_KEY not configured");
    return true; // Allow in development if key not set
  }

  const encodedToken = crypto
    .createHmac('sha256', signingKey)
    .update(signature.timestamp + signature.token)
    .digest('hex');

  return encodedToken === signature.signature;
}

/**
 * Handle 'delivered' event
 */
async function handleDelivered(campaignId, campaignLeadId, eventData) {
  console.log(`✅ Email delivered to Campaign Lead: ${campaignLeadId}`);
  
  // Convert campaignId to ObjectId if it's a string (from Mailgun variables)
  const campaignIdObj = typeof campaignId === 'string' ? new ObjectId(campaignId) : campaignId;
  
  await CampaignLead.findByIdAndUpdate(campaignLeadId, {
    status: 'delivered',
    delivered_at: new Date(eventData.timestamp * 1000)
  });

  await Campaign.findByIdAndUpdate(campaignIdObj, {
    $inc: { 'stats.delivered': 1 }
  });
}

/**
 * Handle 'opened' event
 */
async function handleOpened(campaignId, campaignLeadId, dealerId, eventData) {
  const lead = await CampaignLead.findById(campaignLeadId);
  if (!lead) {
    console.error(`Campaign lead not found: ${campaignLeadId}`);
    return;
  }

  const isFirstOpen = !lead.opened;
  const timestamp = new Date(eventData.timestamp * 1000);

  console.log(`👁️ Email opened by Campaign Lead: ${campaignLeadId} (First: ${isFirstOpen})`);

  // Update campaign lead
  await CampaignLead.findByIdAndUpdate(campaignLeadId, {
    opened: true,
    opened_at: isFirstOpen ? timestamp : lead.opened_at,
    $inc: { open_count: 1 }
  });

  // Convert IDs to ObjectId if they're strings (from Mailgun variables)
  // CampaignTracking stores campaign_id, campaign_lead_id, dealer_id as ObjectId
  const campaignIdObj = typeof campaignId === 'string' ? new ObjectId(campaignId) : campaignId;
  const campaignLeadIdObj = typeof campaignLeadId === 'string' ? new ObjectId(campaignLeadId) : campaignLeadId;
  const dealerIdObj = typeof dealerId === 'string' ? new ObjectId(dealerId) : dealerId;

  // Track event in CampaignTracking collection
  await CampaignTracking.create({
    campaign_id: campaignIdObj, // Must be ObjectId
    campaign_lead_id: campaignLeadIdObj, // Must be ObjectId
    lead_id: lead.lead_id,
    dealer_id: dealerIdObj, // Must be ObjectId
    email: lead.email,
    phone: lead.phone,
    event_type: 'open',
    ip_address: eventData.geolocation?.ip || null,
    user_agent: eventData['client-info']?.['user-agent'] || null,
    is_bot: eventData['client-info']?.['client-type'] === 'bot',
    event_timestamp: timestamp
  });

  // Update campaign stats
  await Campaign.findByIdAndUpdate(campaignIdObj, {
    $inc: {
      'stats.unique_opens': isFirstOpen ? 1 : 0,
      'stats.total_opens': 1
    }
  });
}

/**
 * Handle 'clicked' event
 */
async function handleClicked(campaignId, campaignLeadId, dealerId, eventData) {
  const lead = await CampaignLead.findById(campaignLeadId);
  if (!lead) {
    console.error(`Campaign lead not found: ${campaignLeadId}`);
    return;
  }

  const isFirstClick = !lead.clicked;
  const timestamp = new Date(eventData.timestamp * 1000);
  const clickedUrl = eventData.url;

  console.log(`🖱️ Link clicked by Campaign Lead: ${campaignLeadId} (First: ${isFirstClick})`);
  console.log(`   URL: ${clickedUrl}`);

  // Update campaign lead
  await CampaignLead.findByIdAndUpdate(campaignLeadId, {
    clicked: true,
    clicked_at: isFirstClick ? timestamp : lead.clicked_at,
    $inc: { click_count: 1 }
  });

  // Convert IDs to ObjectId if they're strings (from Mailgun variables)
  // CampaignTracking stores campaign_id, campaign_lead_id, dealer_id as ObjectId
  const campaignIdObj = typeof campaignId === 'string' ? new ObjectId(campaignId) : campaignId;
  const campaignLeadIdObj = typeof campaignLeadId === 'string' ? new ObjectId(campaignLeadId) : campaignLeadId;
  const dealerIdObj = typeof dealerId === 'string' ? new ObjectId(dealerId) : dealerId;

  // Track event in CampaignTracking collection
  await CampaignTracking.create({
    campaign_id: campaignIdObj, // Must be ObjectId
    campaign_lead_id: campaignLeadIdObj, // Must be ObjectId
    lead_id: lead.lead_id,
    dealer_id: dealerIdObj, // Must be ObjectId
    email: lead.email,
    phone: lead.phone,
    event_type: 'click',
    clicked_url: clickedUrl,
    ip_address: eventData.geolocation?.ip || null,
    user_agent: eventData['client-info']?.['user-agent'] || null,
    is_bot: eventData['client-info']?.['client-type'] === 'bot',
    event_timestamp: timestamp
  });

  // Update campaign stats
  await Campaign.findByIdAndUpdate(campaignIdObj, {
    $inc: {
      'stats.unique_clicks': isFirstClick ? 1 : 0,
      'stats.total_clicks': 1
    }
  });
}

/**
 * Handle 'bounced' or 'failed' event
 */
async function handleBounced(campaignId, campaignLeadId, dealerId, eventData) {
  const timestamp = new Date(eventData.timestamp * 1000);
  const reason = eventData.reason || eventData['delivery-status']?.message || 'Unknown';
  const errorCode = eventData['delivery-status']?.code || null;

  console.log(`❌ Email bounced for Campaign Lead: ${campaignLeadId}`);
  console.log(`   Reason: ${reason}`);

  const lead = await CampaignLead.findById(campaignLeadId);
  
  // Update campaign lead
  await CampaignLead.findByIdAndUpdate(campaignLeadId, {
    status: 'bounced',
    error_message: `${reason}${errorCode ? ` (Code: ${errorCode})` : ''}`
  });

  // Convert IDs to ObjectId if they're strings (from Mailgun variables)
  // CampaignTracking stores campaign_id, campaign_lead_id, dealer_id as ObjectId
  const campaignIdObj = typeof campaignId === 'string' ? new ObjectId(campaignId) : campaignId;
  const campaignLeadIdObj = typeof campaignLeadId === 'string' ? new ObjectId(campaignLeadId) : campaignLeadId;
  const dealerIdObj = typeof dealerId === 'string' ? new ObjectId(dealerId) : dealerId;

  // Track event
  if (lead) {
    await CampaignTracking.create({
      campaign_id: campaignIdObj, // Must be ObjectId
      campaign_lead_id: campaignLeadIdObj, // Must be ObjectId
      lead_id: lead.lead_id,
      dealer_id: dealerIdObj, // Must be ObjectId
      email: lead.email,
      phone: lead.phone,
      event_type: 'bounce',
      event_timestamp: timestamp
    });
  }

  // Update campaign stats
  await Campaign.findByIdAndUpdate(campaignIdObj, {
    $inc: { 'stats.bounced': 1 }
  });
}

/**
 * Handle 'unsubscribed' event
 */
async function handleUnsubscribed(campaignId, campaignLeadId, dealerId, eventData) {
  const timestamp = new Date(eventData.timestamp * 1000);

  console.log(`🚫 User unsubscribed: Campaign Lead ${campaignLeadId}`);

  const lead = await CampaignLead.findById(campaignLeadId);
  if (!lead) {
    console.error(`Campaign lead not found: ${campaignLeadId}`);
    return;
  }

  // Update campaign lead
  await CampaignLead.findByIdAndUpdate(campaignLeadId, {
    unsubscribed: true,
    unsubscribed_at: timestamp
  });

  // Convert IDs to ObjectId if they're strings (from Mailgun variables)
  // CampaignTracking stores campaign_id, campaign_lead_id, dealer_id as ObjectId
  const campaignIdObj = typeof campaignId === 'string' ? new ObjectId(campaignId) : campaignId;
  const campaignLeadIdObj = typeof campaignLeadId === 'string' ? new ObjectId(campaignLeadId) : campaignLeadId;
  const dealerIdObj = typeof dealerId === 'string' ? new ObjectId(dealerId) : dealerId;

  // Track event
  await CampaignTracking.create({
    campaign_id: campaignIdObj, // Must be ObjectId
    campaign_lead_id: campaignLeadIdObj, // Must be ObjectId
    lead_id: lead.lead_id,
    dealer_id: dealerIdObj, // Must be ObjectId
    email: lead.email,
    phone: lead.phone,
    event_type: 'unsubscribe',
    event_timestamp: timestamp
  });

  // Update campaign stats
  await Campaign.findByIdAndUpdate(campaignIdObj, {
    $inc: { 'stats.unsubscribed': 1 }
  });

  // Update the actual Lead record to prevent future campaigns
  if (lead.lead_id) {
    await Lead.findByIdAndUpdate(lead.lead_id, {
      followup_preference: 'no_follow_up'
    });
    console.log(`   Updated Lead ${lead.lead_id} to no_follow_up`);
  }
}

/**
 * Handle 'complained' event (spam complaint)
 */
async function handleComplaint(campaignId, campaignLeadId, eventData) {
  const timestamp = new Date(eventData.timestamp * 1000);

  console.log(`⚠️ Spam complaint received for Campaign Lead: ${campaignLeadId}`);

  const lead = await CampaignLead.findById(campaignLeadId);
  if (!lead) {
    return;
  }

  // Mark as unsubscribed
  await CampaignLead.findByIdAndUpdate(campaignLeadId, {
    unsubscribed: true,
    unsubscribed_at: timestamp,
    error_message: 'Spam complaint'
  });

  // Also mark in Lead record
  if (lead.lead_id) {
    await Lead.findByIdAndUpdate(lead.lead_id, {
      followup_preference: 'no_follow_up'
    });
  }
}
