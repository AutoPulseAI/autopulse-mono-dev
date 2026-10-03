import dbConnect from "@lib/mongodb";
import Email from '@models/Email'; // This stores both email and SMS
import WebhookLog from '@models/WebhookLog';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import User from '@models/User'; 
import { sendSubscriptionExpiryNotification } from '@lib/emailservice';
import { isPackageExpiryValid } from '@lib/isPackageExpiryValid';

// Handle POST requests for SMS webhook
export async function POST(req) {
  try {
    // Static dealer_id as requested
   
    
    // Parse the Twilio SMS webhook (form-urlencoded)
    const formData = await req.formData();
    //console.log('Received form data:', formData);
    const data = Object.fromEntries(formData.entries());
    
    // Log the incoming data for debugging
    
    await dbConnect();
   
    const webhookLog = new WebhookLog({
      data: data,
      communication_type: 'sms'
    });
    await webhookLog.save();
    const dealer = await User.findOne({
      'dealer_account_information.sms_conversion_phone': data.To
    });
    //console.log(dealer);
    
    // If no dealer found, return error
    if (!dealer) {
      console.error('No dealer found for SMS number:', data.To);
      return new Response(JSON.stringify({ 
        message: 'Dealer not found for this SMS number',
        error: 'Invalid SMS recipient'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    let subscriptionValid = false;
    let notificationSent = false;
    let subscriptionOwner = dealer;

    if (dealer.vendor_id) {
          // Check agency subscription for dealer under an agency
          const agency = await User.findById(dealer.vendor_id);
          if (agency && isPackageExpiryValid(agency.package_expiry)) {
            subscriptionValid = true;
            subscriptionOwner = agency;
          } else {
            // Agency subscription is invalid or expired
            subscriptionValid = false;
            if (agency) {
              subscriptionOwner = agency;
            }
          }
        } else {
          // Check independent dealer's subscription
          if (isPackageExpiryValid(dealer.package_expiry)) {
            subscriptionValid = true;
          } else {
            subscriptionValid = false;
          }
        }
        if (!subscriptionValid) {
            await sendSubscriptionExpiryNotification({
              account: subscriptionOwner,
              dealer: dealer.vendor_id ? dealer : null
            });
            // Return error response
          
          return new Response(JSON.stringify({ 
            message: notificationSent 
              ? 'Subscription expired. Notification sent.' 
              : 'Subscription expired. ',
            error: 'Subscription expired or invalid'
          }), {
            status: 402, // Payment Required status code
            headers: { 'Content-Type': 'application/json' },
          });
        }

    // Prepare the communication document
    const communicationDoc = {
      method: 'POST',
      headers: Object.fromEntries(req.headers),
      sender: data.From,
      recipient: data.To,
      subject: 'SMS Conversation',
      message_id: data.MessageSid,
      mail_content: data.Body,
      status: 'received',
      dealer_id: dealer?._id || null,
      communication_type: 'sms',
      date: new Date(),
      parent_conversation: null,
      sms_status: data.SmsStatus,
      num_segments: data.NumSegments,
      from_state: data.FromState,
      from_city: data.FromCity,
      from_zip: data.FromZip,
      from_country: data.FromCountry,
      to_state: data.ToState,
      to_city: data.ToCity,
      to_zip: data.ToZip,
      to_country: data.ToCountry,
      account_sid: data.AccountSid
    };

    // Handle MMS attachments if present
    if (parseInt(data.NumMedia) > 0) {
      communicationDoc.has_attachments = true;
      communicationDoc.media = Array.from(
        { length: parseInt(data.NumMedia) },
        (_, i) => ({
          url: data[`MediaUrl${i}`],
          contentType: data[`MediaContentType${i}`],
          mediaSid: `${data.MessageSid}_${i}`,
          status: 'pending',
          created_at: new Date()
        })
      );

      // If no text body but has media, set appropriate content
      if (!data.Body) {
        communicationDoc.mail_content = `Received ${data.NumMedia} media file${parseInt(data.NumMedia) > 1 ? 's' : ''}.`;
      }
    }

    // Resolve an inbound reply from existing SMS history. Email records use
    // sender/recipient (not from/to), and the direction is reversed for the
    // usual outbound-then-inbound sequence. Only a previously linked message
    // is deterministic enough to associate this inbound SMS with a Lead.
    const parentMessage = await Email.findOne({
      dealer_id: String(dealer._id),
      communication_type: 'sms',
      lead_id: { $exists: true, $ne: null },
      $or: [
        { sender: data.To, recipient: data.From },
        { sender: data.From, recipient: data.To }
      ]
    }).sort({ timestamp: -1, _id: -1 });

    if (parentMessage) {
      const conversationRoot = parentMessage.parent_message_id
        || parentMessage.parent_conversation
        || parentMessage.message_id;
      communicationDoc.lead_id = parentMessage.lead_id;
      communicationDoc.parent_message_id = conversationRoot;
      communicationDoc.parent_conversation = conversationRoot;
    }

    // Create and save the communication document
    //const newCommunication = new Email(communicationDoc);
    //await newCommunication.save();
   
    // Build conversation thread
    

    // Create Redis connection for BullMQ
    console.log('Connecting to Redis...');
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: Number(process.env.REDIS_DB || 0),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
    });
   
    const communicationQueue = new Queue('communicationQueue', {
      connection: redis,
    });

    // Prepare job data
    const jobData = {
     
      currentSMS: {
        message_id: communicationDoc.message_id,
        lead_id: communicationDoc.lead_id,
        parent_message_id: communicationDoc.parent_message_id,
        parent_conversation: communicationDoc.parent_conversation,
        sender: communicationDoc.sender,
        recipient: communicationDoc.recipient,
        subject: communicationDoc.subject,
        date: communicationDoc.date,
        mail_content:communicationDoc.mail_content,
        status: communicationDoc.status,
        dealer_id: communicationDoc.dealer_id,
        communication_type: communicationDoc.communication_type,
        attachments: communicationDoc.attachments ?? [],
        has_attachments: communicationDoc.has_attachments,
        media: communicationDoc.media,
        NumMedia: data.NumMedia || 0,
        raw_webhook: {
          MessageSid: data.MessageSid,
          AccountSid: data.AccountSid,
          From: data.From,
          To: data.To
        }
      
      }
    };

    
    await communicationQueue.add('processCommunication', jobData);
    console.log('Job added to queue.');

    // Return success response (Twilio expects empty 200 for SMS webhooks)
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    });

  } catch (error) {
    console.error('Error processing SMS:', error);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Error processing SMS</Message></Response>`,
      {
        status: 500,
        headers: {
          'Content-Type': 'text/xml',
        },
      }
    );
  }
}
