/**
 * Campaign Worker Example
 * 
 * This file shows how to send campaign messages using Mailgun (EMAIL) and Twilio (SMS)
 * with automatic tracking via webhooks.
 * 
 * IMPORTANT: Install required packages:
 * npm install mailgun-js twilio
 */

import Campaign from '@models/Campaign';
import CampaignLead from '@models/CampaignLead';
import User from '@models/User';

// Initialize Mailgun
const mailgun = require('mailgun-js')({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN
});

// Initialize Twilio
const twilio = require('twilio');
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Process a single campaign lead
 * This function is called by the queue worker for each lead
 */
export async function processCampaignLead(job) {
  const { campaignId, campaignLeadId } = job.data;

  console.log(`\n📤 Processing Campaign Lead: ${campaignLeadId}`);

  try {
    // Get campaign and lead details
    const campaign = await Campaign.findById(campaignId);
    const campaignLead = await CampaignLead.findById(campaignLeadId);

    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    if (!campaignLead) {
      throw new Error(`Campaign lead not found: ${campaignLeadId}`);
    }

    // Get dealer information for sending
    const dealer = await User.findById(campaign.dealer_id);
    if (!dealer) {
      throw new Error(`Dealer not found: ${campaign.dealer_id}`);
    }

    // Send based on message type
    if (campaign.message_type === 'email') {
      await sendCampaignEmail(campaign, campaignLead, dealer);
    } else if (campaign.message_type === 'sms') {
      await sendCampaignSMS(campaign, campaignLead, dealer);
    } else {
      throw new Error(`Unknown message type: ${campaign.message_type}`);
    }

    console.log(`✅ Successfully processed Campaign Lead: ${campaignLeadId}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Error processing Campaign Lead ${campaignLeadId}:`, error);

    // Update lead as failed
    await CampaignLead.findByIdAndUpdate(campaignLeadId, {
      status: 'failed',
      error_message: error.message
    });

    // Update campaign stats
    await Campaign.findByIdAndUpdate(campaignId, {
      $inc: { 'stats.failed': 1 }
    });

    throw error; // Re-throw for queue to handle retries
  }
}

/**
 * Send campaign email via Mailgun
 * Mailgun automatically handles tracking (opens, clicks, unsubscribes)
 */
async function sendCampaignEmail(campaign, campaignLead, dealer) {
  console.log(`📧 Sending email to: ${campaignLead.email}`);

  // Get dealer's email settings
  const fromEmail = dealer.dealer_account_information?.email || 
                   process.env.MAILGUN_FROM_EMAIL || 
                   'noreply@yourdomain.com';
  
  const fromName = dealer.name || 'Your Dealership';

  // Prepare email data
  const emailData = {
    from: `${fromName} <${fromEmail}>`,
    to: campaignLead.email,
    subject: campaign.message_content.subject,
    html: campaign.message_content.body, // Send as-is, Mailgun handles tracking
    
    // Enable Mailgun tracking - THIS IS THE KEY!
    'o:tracking': 'yes',           // Enable all tracking
    'o:tracking-clicks': 'yes',    // Mailgun will wrap all links automatically
    'o:tracking-opens': 'yes',     // Mailgun will add tracking pixel automatically
    
    // Custom variables to identify this email in webhooks
    'v:campaign_id': campaign._id.toString(),
    'v:campaign_lead_id': campaignLead._id.toString(),
    'v:dealer_id': dealer._id.toString(),
    
    // Optional: Add tags for organization
    'o:tag': ['campaign', `campaign-${campaign._id}`, campaign.message_type]
  };

  // Add attachments if any
  if (campaign.attachments && campaign.attachments.length > 0) {
    emailData.attachment = campaign.attachments.map(att => ({
      filename: att.filename,
      data: att.url // Or Buffer if you have the file data
    }));
  }

  try {
    // Send via Mailgun
    const result = await mailgun.messages().send(emailData);
    
    console.log(`✅ Email sent successfully. Mailgun ID: ${result.id}`);

    // Update campaign lead
    await CampaignLead.findByIdAndUpdate(campaignLead._id, {
      status: 'sent',
      sent_at: new Date(),
      mailgun_message_id: result.id
    });

    // Update campaign stats
    await Campaign.findByIdAndUpdate(campaign._id, {
      $inc: { 'stats.sent': 1 }
    });

    // Note: Delivery, opens, clicks will be tracked via Mailgun webhooks
    // at /api/webhooks/mailgun

    return result;
  } catch (error) {
    console.error('Mailgun send error:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

/**
 * Send campaign SMS via Twilio
 * Twilio handles delivery tracking via status callbacks
 */
async function sendCampaignSMS(campaign, campaignLead, dealer) {
  console.log(`📱 Sending SMS to: ${campaignLead.phone}`);

  // Get dealer's phone number
  const fromPhone = dealer.dealer_account_information?.phone || 
                   process.env.TWILIO_FROM_PHONE || 
                   '+1234567890';

  // Prepare SMS body - send as-is
  const smsBody = campaign.message_content.body;

  // Prepare SMS data
  const smsData = {
    body: smsBody, // Send as-is, no modification needed
    from: fromPhone,
    to: campaignLead.phone,
    
    // Status callback - THIS IS THE KEY for tracking!
    statusCallback: `${process.env.NEXT_PUBLIC_BASE_URL}/api/webhooks/twilio`
  };

  try {
    // Send via Twilio
    const result = await twilioClient.messages.create(smsData);
    
    console.log(`✅ SMS sent successfully. Twilio SID: ${result.sid}`);
    console.log(`   Status: ${result.status}`);

    // Update campaign lead
    await CampaignLead.findByIdAndUpdate(campaignLead._id, {
      status: 'sent',
      sent_at: new Date(),
      twilio_message_sid: result.sid // IMPORTANT: Store this for webhook tracking
    });

    // Update campaign stats
    await Campaign.findByIdAndUpdate(campaign._id, {
      $inc: { 'stats.sent': 1 }
    });

    // Note: Delivery status will be tracked via Twilio webhooks
    // at /api/webhooks/twilio

    return result;
  } catch (error) {
    console.error('Twilio send error:', error);
    throw new Error(`Failed to send SMS: ${error.message}`);
  }
}

/**
 * Example: How to queue campaign leads (called by cron job)
 */
export async function queueCampaignLeads(campaignId) {
  const campaign = await Campaign.findById(campaignId);
  const pendingLeads = await CampaignLead.find({
    campaign_id: campaignId,
    status: 'pending'
  });

  console.log(`📋 Queueing ${pendingLeads.length} leads for Campaign: ${campaign.name}`);

  // Import your queue
  const { getQueue } = require('@lib/bullmq');
  const campaignQueue = await getQueue('campaignProcessingQueue');

  // Queue each lead
  for (const lead of pendingLeads) {
    await campaignQueue.add(
      'process-campaign-lead',
      {
        campaignId: campaign._id.toString(),
        campaignLeadId: lead._id.toString()
      },
      {
        attempts: 3, // Retry 3 times on failure
        backoff: {
          type: 'exponential',
          delay: 5000 // 5 seconds, 25 seconds, 125 seconds
        }
      }
    );
  }

  // Update campaign status to active
  await Campaign.findByIdAndUpdate(campaignId, {
    status: 'active'
  });

  console.log(`✅ Queued ${pendingLeads.length} leads`);
}

// Export for use in worker
module.exports = {
  processCampaignLead,
  queueCampaignLeads
};
