// campaignWorker.js
import { Worker } from 'bullmq';
import { Types } from 'mongoose';
const { ObjectId } = Types;
import dbConnect from '../lib/mongodb.js';
import Campaign from '../models/Campaign.js';
import CampaignLead from '../models/CampaignLead.js';
import User from '../models/User.js';
import EmailAccount from '../models/EmailAccount.js';
import Email from '../models/Email.js';
import Lead from '../models/Lead.js';
import mailgunJs from 'mailgun-js';
import twilio from 'twilio';
import { checkCampaignSend, blockReason, RETRY_UNANSWERED_MS } from '../lib/ai/aiSendCheck.js';
import { getCampaignProcessingQueue } from '../lib/queue.js';

const mailgun = mailgunJs({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN
});

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export const processCampaignLead = async (job) => {
  const { 
    campaignId, 
    campaignLeadId, 
    campaignName,
    messageType, 
    messageSubject, 
    messageBody,
    attachments = [], // Get attachments from job data
    leadName,
    leadEmail,
    leadPhone,
    leadId,
    dealerId
  } = job.data;

  await dbConnect();
  
  try {
    // Convert campaignId to ObjectId if it's a string (from job data)
    // Campaign model still uses ObjectId, but CampaignLead now uses string
    const campaignIdObj = typeof campaignId === 'string' && ObjectId.isValid(campaignId) 
      ? new ObjectId(campaignId) 
      : campaignId;
    
    // Get campaign and campaign lead
    const campaign = await Campaign.findById(campaignIdObj);
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    const campaignLead = await CampaignLead.findById(campaignLeadId);
    if (!campaignLead) {
      throw new Error(`Campaign lead ${campaignLeadId} not found`);
    }

    // Check if already processed (a `held` lead comes back when its time is up)
    if (!['pending', 'held'].includes(campaignLead.status)) {
      console.log(`Campaign lead ${campaignLeadId} already processed with status: ${campaignLead.status}`);
      return { 
        success: true, 
        message: 'Already processed',
        status: campaignLead.status 
      };
    }

    // Get dealer information
    const dealer = await User.findById(dealerId);
    if (!dealer) {
      throw new Error(`Dealer ${dealerId} not found`);
    }

    // Get dealer email account and SMS phone
    const dealerEmailAccount = await EmailAccount.findOne({ dealer_id: dealer._id });
    const dealerEmail = dealerEmailAccount?.email_address || null;
    const dealerSMSPhone = dealer.dealer_account_information?.sms_conversion_phone || null;

    let messageId = null;
    let sentSuccessfully = false;
    let errorMessage = null;
    // Convert leadId to ObjectId if provided (from job data, it might be a string)
    let savedLeadId = leadId ? (ObjectId.isValid(leadId) ? new ObjectId(leadId) : null) : null;
    let parent_message_id = null;
    let parent_conversation = null;
    if(savedLeadId){
      const parentConversation = await Email.findOne({ lead_id: savedLeadId }).sort({ date: -1 });
      if(parentConversation){
        parent_message_id = parentConversation.parent_message_id??parentConversation.message_id??null;
        parent_conversation = parentConversation.message_id??parentConversation.parent_message_id??null;
      }
    }

    // Create or update Lead record BEFORE sending email/SMS
    /*if (!savedLeadId) {
      // Try to find existing lead by email or phone
      
        // Create new lead
        const newLead = new Lead({
          name: leadName || 'N/A',
          email: leadEmail || '',
          phone: leadPhone || '',
          dealer_id: dealerId.toString(),
          source: 'campaign',
          lead_status: 'New',
          fe_lead_status: 'Lead',
          status: 'New',
          lead_source: 'campaign_'+campaign.name
        });
        const savedLead = await newLead.save();
        savedLeadId = savedLead._id;
        console.log(`Created new lead ${savedLeadId} from campaign`);
      

      // Update CampaignLead with the lead_id
      campaignLead.lead_id = savedLeadId;
      await campaignLead.save();
    }*/

    // Process based on message type
    if (messageType === 'email' && leadEmail && dealerEmail) {
      try {
        // Personalize message body with lead name
        const personalizedBody = messageBody.replace(/\{name\}/g, leadName || 'there');
        const personalizedSubject = messageSubject.replace(/\{name\}/g, leadName || '');

        // Determine "from" address for Mailgun
        const fromEmail =
          dealer.dealer_account_information?.email ||
          dealerEmail ||
          process.env.MAILGUN_FROM_EMAIL;

        if (!fromEmail) {
          throw new Error(
            'No from email configured for campaign Mailgun send (dealer email or MAILGUN_FROM_EMAIL required).'
          );
        }

        const fromName = dealer.name || 'Your Dealership';

        // Prepare Mailgun email data with tracking + campaign identifiers
        const emailData = {
          from: `${fromName} <${fromEmail}>`,
          to: leadEmail,
          subject: personalizedSubject || campaignName,
          html: personalizedBody,

          // Enable Mailgun tracking
          'o:tracking': 'yes',
          'o:tracking-clicks': 'yes',
          'o:tracking-opens': 'yes',

          // Custom variables used by Mailgun webhook handler
          'v:campaign_id': campaign._id.toString(),
          'v:campaign_lead_id': campaignLead._id.toString(),
          'v:dealer_id': dealer._id.toString(),

          // Optional tags
          'o:tag': ['campaign', `campaign-${campaign._id}`, campaign.message_type]
        };

        // Add attachments, if any
        if (attachments && attachments.length > 0) {
          emailData.attachment = attachments.map(att => ({
            filename: att.filename,
            data: att.url
          }));
        }

        if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
          throw new Error('MAILGUN_API_KEY and MAILGUN_DOMAIN must be configured for campaign emails.');
        }

        const result = await mailgun.messages().send(emailData);
        messageId = result.id;

        // Update campaign lead with Mailgun message ID
        campaignLead.status = 'sent';
        campaignLead.sent_at = new Date();
        campaignLead.mailgun_message_id = result.id;
        await campaignLead.save();

        // Update campaign stats
        await Campaign.findByIdAndUpdate(campaignIdObj, {
          $inc: { 'stats.sent': 1 }
        });

        sentSuccessfully = true;
        console.log(`Campaign email sent successfully for lead ${campaignLeadId}, Lead ID: ${savedLeadId}`);

        // Update lead followup_preference to 'email'
        /*if (savedLeadId) {
          await Lead.findByIdAndUpdate(savedLeadId, {
            followup_preference: 'email',
            response_mode: 'email'
          });
          console.log(`Updated lead ${savedLeadId} followup_preference to 'email'`);
        }*/

      } catch (err) {
        console.error(`Error sending campaign email for lead ${campaignLeadId}:`, err);
        errorMessage = err.message;
        
        // Create failed Email record with lead_id as ObjectId
        // Include attachments even for failed records
        /*const emailRecord = new Email({
          message_id: `campaign-email-${campaignLeadId}-${Date.now()}`,
          parent_message_id: parent_message_id,
          parent_conversation: parent_conversation,
          sender: dealerEmail,
          recipient: leadEmail,
          subject: messageSubject || campaignName,
          mail_content: messageBody,
          communication_type: 'email',
          status: 'failed',
          lead_source: 'campaign_'+campaign.name,
          dealer_id: dealer._id,
          lead_id: savedLeadId, // Already ObjectId from Lead._id
          date: new Date(),
          timestamp: new Date(),
          attachments: attachments && attachments.length > 0 ? attachments : [] // Save attachments like in processSms.js
        });
        await emailRecord.save();*/

        // Update campaign lead
        campaignLead.status = 'failed';
        campaignLead.error_message = errorMessage;
        await campaignLead.save();
        /*if (savedLeadId) {
          await Lead.findByIdAndUpdate(savedLeadId, {
            followup_preference: 'email',
            response_mode: 'email'
          });
          console.log(`Updated lead ${savedLeadId} followup_preference to 'email'`);
        }*/

        // Update campaign stats
        await Campaign.findByIdAndUpdate(campaignIdObj, {
          $inc: { 'stats.failed': 1 }
        });

        throw err;
      }

    } else if (messageType === 'sms' && leadPhone && dealerSMSPhone) {
      // The send check (MASTER_PLAN_3 decision 66): the AI service decides,
      // the platform still sends. HOLD and no answer yet re-queue this lead;
      // REVIEW and BLOCK mark it blocked with the reason.
      const checkAttempt = job.data.checkAttempt || 0;
      const answer = await checkCampaignSend({
        dealerId, campaignId, campaignLeadId, leadId: savedLeadId || campaignLead.lead_id, phone: leadPhone,
        attempt: checkAttempt,
      });
      if (answer.decision === 'WAITING' || answer.decision === 'HOLD') {
        const held = answer.decision === 'HOLD';
        const until = held && answer.until ? new Date(answer.until) : new Date(Date.now() + RETRY_UNANSWERED_MS);
        if (held) {
          campaignLead.status = 'held';
          campaignLead.held_until = until;
          campaignLead.block_reason = answer.reason || null;
          await campaignLead.save();
        }
        const queue = await getCampaignProcessingQueue();
        await queue.add('processCampaignLead', { ...job.data, checkAttempt: held ? checkAttempt + 1 : checkAttempt }, {
          delay: Math.max(0, until.getTime() - Date.now()),
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        });
        console.log(`Campaign SMS for lead ${campaignLeadId} ${held ? `held until ${until.toISOString()}: ${answer.reason}` : 'waiting for the send check'}`);
        return { success: true, campaignLeadId, status: held ? 'held' : 'awaiting_check', held_until: until };
      }
      if (answer.decision !== 'ALLOW') {
        campaignLead.status = 'blocked';
        campaignLead.held_until = null;
        campaignLead.block_reason = blockReason(answer);
        await campaignLead.save();
        console.log(`Campaign SMS for lead ${campaignLeadId} blocked by the send check: ${campaignLead.block_reason}`);
      } else {
      try {
        // Send SMS using dedicated function
        messageId = await sendCampaignSMS({
          leadPhone,
          messageBody,
          leadName,
          dealer,
          attachments,
          campaignLead,
          campaignId
        });

        sentSuccessfully = true;
        console.log(`Campaign SMS sent successfully for lead ${campaignLeadId}, Lead ID: ${savedLeadId}`);

        // Update lead followup_preference to 'sms'
        /*if (savedLeadId) {
          await Lead.findByIdAndUpdate(savedLeadId, {
            followup_preference: 'sms',
            response_mode: 'sms'
          });
          console.log(`Updated lead ${savedLeadId} followup_preference to 'sms'`);
        }*/

      } catch (err) {
        // Error handling is done inside sendCampaignSMS function
        errorMessage = err.message;
        throw err;
      }
      }

    } else {
      // Missing required information
      const missingInfo = [];
      if (messageType === 'email' && !leadEmail) missingInfo.push('lead email');
      if (messageType === 'email' && !dealerEmail) missingInfo.push('dealer email account');
      if (messageType === 'sms' && !leadPhone) missingInfo.push('lead phone');
      if (messageType === 'sms' && !dealerSMSPhone) missingInfo.push('dealer SMS phone');

      errorMessage = `Missing required information: ${missingInfo.join(', ')}`;
      
      campaignLead.status = 'failed';
      campaignLead.error_message = errorMessage;
      await campaignLead.save();

      await Campaign.findByIdAndUpdate(campaignIdObj, {
        $inc: { 'stats.failed': 1 }
      });

      throw new Error(errorMessage);
    }

    // Check if all leads are processed and update campaign status
    // campaign_id in CampaignLead is now a string, so use campaignId (string) for query
    const remainingPending = await CampaignLead.countDocuments({
      campaign_id: campaignId,
      status: { $in: ['pending', 'held'] }
    });

    if (remainingPending === 0) {
      // All leads processed, mark campaign as completed
      await Campaign.findByIdAndUpdate(campaignIdObj, {
        status: 'completed'
      });
      console.log(`Campaign ${campaignId} completed - all leads processed`);
    }

    // Get final campaign lead to retrieve lead_id
    const finalCampaignLead = await CampaignLead.findById(campaignLeadId);
    
    return {
      success: true,
      campaignLeadId,
      leadId: finalCampaignLead?.lead_id || savedLeadId,
      messageId,
      status: campaignLead.status
    };

  } catch (error) {
    console.error('Campaign lead processing error:', error);
    throw error;
  }
};

/**
 * Send SMS for a campaign lead
 * @param {Object} params - SMS sending parameters
 * @param {string} params.leadPhone - Lead's phone number
 * @param {string} params.messageBody - Message body template
 * @param {string} params.leadName - Lead's name for personalization
 * @param {Object} params.dealer - Dealer user object
 * @param {Array} params.attachments - Array of attachment objects with url property
 * @param {Object} params.campaignLead - CampaignLead document
 * @param {string} params.campaignId - Campaign ID
 * @returns {Promise<string>} - Returns Twilio message SID
 */
async function sendCampaignSMS({ leadPhone, messageBody, leadName, dealer, attachments, campaignLead, campaignId }) {
  try {
    // Validate Twilio credentials
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials not configured');
    }

    // Get dealer's phone number or fallback to default
    const fromNumber = dealer?.dealer_account_information?.sms_conversion_phone 
      || process.env.TWILIO_PHONE_NUMBER;

    if (!fromNumber) {
      throw new Error('No Twilio phone number configured');
    }

    // Personalize message body with lead name
    const personalizedBody = messageBody.replace(/\{name\}/g, leadName || 'there');

    // Format phone number for Twilio (E.164 format)
    let formattedPhone = leadPhone;
    try {
      formattedPhone = formatPhoneForTwilio(leadPhone);
    } catch (e) {
      console.warn('Could not format phone number:', e.message);
      formattedPhone = leadPhone;
    }

    // Ensure body is always a valid string
    let messageBodyText = '';
    if (personalizedBody != null) {
      const bodyStr = String(personalizedBody);
      if (bodyStr.trim()) {
        messageBodyText = bodyStr.trim();
      }
    }

    // Prepare media URLs for MMS if attachments are provided
    const mediaUrls = attachments && attachments.length > 0
      ? attachments.map(att => att.url).filter(url => url && typeof url === 'string').slice(0, 10) // Limit to 10 media items
      : [];

    // Build webhook status callback URL
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const statusCallback = `${baseUrl}/api/webhooks/twilio`;

    // Prepare message options
    const messageOptions = {
      from: fromNumber,
      to: formattedPhone,
      // Webhook status callback for tracking delivery status
      statusCallback: statusCallback,
      statusCallbackMethod: 'POST'
    };

    // Add media URLs for MMS if provided
    if (mediaUrls && mediaUrls.length > 0) {
      messageOptions.mediaUrl = mediaUrls;
      // Include body text with MMS if provided
      if (messageBodyText) {
        messageOptions.body = messageBodyText;
        console.log(`Sending MMS with ${mediaUrls.length} media file(s) and text from ${fromNumber} to ${formattedPhone}`);
      } else {
        console.log(`Sending MMS with ${mediaUrls.length} media file(s) (no text body) from ${fromNumber} to ${formattedPhone}`);
      }
    } else {
      // For SMS, always include body
      messageOptions.body = messageBodyText || '';
      console.log(`Sending SMS from ${fromNumber} to ${formattedPhone}`);
    }

    // Send SMS/MMS via Twilio
    const message = await twilioClient.messages.create(messageOptions);
    const messageId = message.sid;

    const messageType = mediaUrls && mediaUrls.length > 0 ? 'MMS' : 'SMS';
    console.log(`${messageType} sent to ${formattedPhone}. SID: ${messageId}`);

    // Update campaign lead with Twilio message SID for webhook tracking
    campaignLead.status = 'sent';
    campaignLead.sent_at = new Date();
    campaignLead.twilio_message_sid = messageId;
    await campaignLead.save();

    // Convert campaignId to ObjectId for Campaign model (which still uses ObjectId)
    const campaignIdObj = typeof campaignId === 'string' && ObjectId.isValid(campaignId) 
      ? new ObjectId(campaignId) 
      : campaignId;

    // Update campaign stats
    await Campaign.findByIdAndUpdate(campaignIdObj, {
      $inc: { 'stats.sent': 1 }
    });

    console.log(`Campaign SMS sent successfully for lead ${campaignLead._id}, Message SID: ${messageId}`);
    
    return messageId;

  } catch (err) {
    console.error(`Error sending campaign SMS for lead ${campaignLead._id}:`, err);
    
    // Classify Twilio errors
    const code = err?.code;
    if (code === 21610) {
      // Unsubscribed (STOP) — permanent failure
      err.retryable = false;
      err.reason = 'unsubscribed';
    } else if (code === 21408) {
      // Region not enabled — permanent
      err.retryable = false;
      err.reason = 'geo_not_enabled';
    } else if (code === 21211 || err?.code === 'FORMAT') {
      // Invalid phone number
      err.retryable = false;
      err.reason = 'invalid_number';
    } else if (err.message?.includes('credentials not configured') || err.message?.includes('No Twilio phone number')) {
      // Configuration errors
      err.retryable = false;
      err.reason = 'configuration_error';
    } else {
      // Default to retryable transient error
      err.retryable = true;
      err.reason = 'transient';
    }

    const errorMessage = err.message;

    // Update campaign lead with failed status
    campaignLead.status = 'failed';
    campaignLead.error_message = errorMessage;
    await campaignLead.save();

    // Convert campaignId to ObjectId for Campaign model
    const campaignIdObj = typeof campaignId === 'string' && ObjectId.isValid(campaignId) 
      ? new ObjectId(campaignId) 
      : campaignId;

    // Update campaign stats
    await Campaign.findByIdAndUpdate(campaignIdObj, {
      $inc: { 'stats.failed': 1 }
    });

    throw err;
  }
}

function formatPhoneForTwilio(phone) {
  if (!phone || !phone.toString().trim()) {
    return null;
  }

  const cleaned = phone.replace(/\D/g, '');

  if (!cleaned || cleaned.length === 0) {
    return null;
  }

  if (cleaned.length > 10 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  } else if (cleaned.length > 10 && !cleaned.startsWith('1')) {
    return `+${cleaned}`;
  } else if (cleaned.length === 10) {
    return `+1${cleaned}`;
  } else {
    throw new Error('Invalid phone number format');
  }
}

export const setupCampaignWorker = (redis) => {
  const worker = new Worker('campaignProcessingQueue', processCampaignLead, { 
    connection: redis,
    concurrency: 10 // Process 10 campaign leads concurrently
  });

  worker.on('completed', (job) => {
    console.log(`[campaignProcessingQueue] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[campaignProcessingQueue] Job ${job.id} failed:`, err);
  });

  return worker;
};

