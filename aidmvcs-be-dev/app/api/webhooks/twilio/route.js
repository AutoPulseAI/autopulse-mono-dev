import { NextResponse } from "next/server";
import twilio from "twilio";
import { Types } from "mongoose";
const { ObjectId } = Types;
import dbConnect from "@lib/mongodb";
import Campaign from "@models/Campaign";
import CampaignLead from "@models/CampaignLead";
import CampaignTracking from "@models/CampaignTracking";

/**
 * Twilio Status Callback Webhook Handler
 * Receives SMS status updates: queued, sent, delivered, failed, undelivered
 * 
 * Setup when sending SMS:
 * Set statusCallback parameter to: https://yourdomain.com/api/webhooks/twilio
 */
export async function POST(req) {
  try {
    // Twilio sends form data, not JSON
    const formData = await req.formData();
    const data = Object.fromEntries(formData);

    // Verify webhook is from Twilio for security
    const twilioSignature = req.headers.get('x-twilio-signature');
    const url = `${process.env.NEXT_PUBLIC_BASE_URL}/api/webhooks/twilio`;
    
    if (!verifyTwilioWebhook(twilioSignature, url, data)) {
      console.error("❌ Invalid Twilio webhook signature");
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // Extract Twilio data
    const messageSid = data.MessageSid;
    const status = data.MessageStatus; // 'queued', 'sent', 'delivered', 'failed', 'undelivered'
    const to = data.To;
    const from = data.From;
    const errorCode = data.ErrorCode;
    const errorMessage = data.ErrorMessage;

    console.log(`📱 Twilio SMS Status: ${status} for ${to} (SID: ${messageSid})`);

    await dbConnect();

    // Find campaign lead by Twilio message SID
    // Note: You need to store messageSid when sending the SMS
    const campaignLead = await CampaignLead.findOne({
      twilio_message_sid: messageSid
    });

    if (!campaignLead) {
      // Try to find by phone number as fallback (less reliable)
      const recentLead = await CampaignLead.findOne({
        phone: to,
        status: { $in: ['pending', 'sent'] }
      }).sort({ sent_at: -1 });

      if (recentLead) {
        console.log(`⚠️ Found lead by phone fallback: ${recentLead._id}`);
        // Update with message SID for future tracking
        await CampaignLead.findByIdAndUpdate(recentLead._id, {
          twilio_message_sid: messageSid
        });
        await handleTwilioStatus(recentLead, status, errorCode, errorMessage);
      } else {
        console.warn(`⚠️ Campaign lead not found for Twilio webhook. Phone: ${to}, SID: ${messageSid}`);
      }
      
      return NextResponse.json({ success: true });
    }

    // Handle status update
    await handleTwilioStatus(campaignLead, status, errorCode, errorMessage);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("❌ Error processing Twilio webhook:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Verify webhook is from Twilio
 */
function verifyTwilioWebhook(signature, url, params) {
  if (!signature) {
    return false;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("⚠️ TWILIO_AUTH_TOKEN not configured");
    return true; // Allow in development if token not set
  }

  try {
    return twilio.validateRequest(authToken, signature, url, params);
  } catch (error) {
    console.error("Error validating Twilio signature:", error);
    return false;
  }
}

/**
 * Handle different Twilio status updates
 */
async function handleTwilioStatus(campaignLead, status, errorCode, errorMessage) {
  // campaign_id is now stored as string in CampaignLead, but Campaign model expects ObjectId
  const campaignId = campaignLead.campaign_id;
  const campaignIdObj = typeof campaignId === 'string' ? new ObjectId(campaignId) : campaignId;

  switch (status) {
    case 'queued':
      console.log(`📤 SMS queued for Campaign Lead: ${campaignLead._id}`);
      // Don't update status yet, wait for 'sent' or 'delivered'
      break;

    case 'sent':
      console.log(`📤 SMS sent to carrier for Campaign Lead: ${campaignLead._id}`);
      // SMS sent to carrier, but not yet delivered to recipient
      // You might want to track this separately or wait for 'delivered'
      await CampaignLead.findByIdAndUpdate(campaignLead._id, {
        status: 'sent',
        sent_at: new Date()
      });
      break;

    case 'delivered':
      console.log(`✅ SMS delivered to Campaign Lead: ${campaignLead._id}`);
      
      await CampaignLead.findByIdAndUpdate(campaignLead._id, {
        status: 'delivered',
        delivered_at: new Date()
      });

      await Campaign.findByIdAndUpdate(campaignIdObj, {
        $inc: { 'stats.delivered': 1 }
      });
      break;

    case 'failed':
    case 'undelivered':
      console.log(`❌ SMS failed for Campaign Lead: ${campaignLead._id}`);
      console.log(`   Error: ${errorMessage || 'Unknown'} (Code: ${errorCode || 'N/A'})`);
      
      await CampaignLead.findByIdAndUpdate(campaignLead._id, {
        status: 'failed',
        error_message: errorMessage 
          ? `${errorMessage} (Code: ${errorCode})` 
          : `Failed with code: ${errorCode}`
      });

      await Campaign.findByIdAndUpdate(campaignIdObj, {
        $inc: { 'stats.failed': 1 }
      });

      // For carrier-level failures, might want to mark as bounced
      if (errorCode && ['30003', '30004', '30005', '30006', '30007'].includes(errorCode)) {
        // These are permanent failures (invalid number, blocked, etc.)
        await Campaign.findByIdAndUpdate(campaignIdObj, {
          $inc: { 'stats.bounced': 1 }
        });

        // Convert dealer_id to ObjectId if it's a string
        const dealerIdObj = typeof campaignLead.dealer_id === 'string' 
          ? new ObjectId(campaignLead.dealer_id) 
          : campaignLead.dealer_id;

        // Create tracking event
        await CampaignTracking.create({
          campaign_id: campaignIdObj,
          campaign_lead_id: campaignLead._id,
          lead_id: campaignLead.lead_id,
          dealer_id: dealerIdObj,
          email: campaignLead.email,
          phone: campaignLead.phone,
          event_type: 'bounce',
          event_timestamp: new Date()
        });
      }
      break;

    default:
      console.log(`ℹ️ Unhandled Twilio status: ${status}`);
  }
}

/**
 * GET endpoint to check webhook configuration
 */
export async function GET(req) {
  return NextResponse.json({
    message: "Twilio webhook endpoint is active",
    endpoint: "/api/webhooks/twilio",
    expectedMethod: "POST",
    expectedContentType: "application/x-www-form-urlencoded",
    requiredEnvVars: {
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? "✓ Set" : "✗ Missing"
    }
  });
}
