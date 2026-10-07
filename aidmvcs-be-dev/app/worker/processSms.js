import axios from 'axios';
import dbConnect from '../lib/mongodb.js';
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Email from '../models/Email.js'; 
import { sendEmail } from '../lib/email.js'; // For sending emails
import EmailAccount from '../models/EmailAccount.js'; 
import FollowUpJob from '../models/FollowUpJob.js'; // Using same Email model for SMS too
import { sendSMS, normalizeSmsPhone } from '../lib/sms.js'; // Assume you have an SMS sending function
import { processAndUploadMedia } from '../lib/aws-s3.js'; // For sending emails

import { onLeadStatusChange ,onFollowUpEvent} from '../lib/followupService.js';
import { checkLeadByIdentifiers } from '../lib/dealersocket-worknote.js';
import { cancelAllRemindersForLead,createAppointmentReminders, createManagerialReviewMessages } from '../lib/appointmentReminderService.js';
import moment from 'moment-timezone';
import { linkCustomerToLead, isEmailSentinel } from '../lib/customerResolver.js';
import { getDealerAiMode } from '../lib/ai/aiMode.js';
import { notifyAiOfInbound, notifyAiOfNewLead } from '../lib/ai/aiDispatch.js';
import { handleInboundSmsLive } from '../lib/ai/aiInbound.js';

// import OpenAI from 'openai'; // Unused - kept for reference
//import EmailConversations from 'app/agency/conversations/page.js';
// Connect to the database
await dbConnect();
// const openai = new OpenAI({
//     apiKey: process.env.OPENAPI_KEY
// });


// Function to process an SMS
export async function processSMS(job) {
   
  const {  currentSMS } = job.data;
    
  try {

    let attachments = [];
    if (currentSMS.NumMedia > 0 && currentSMS.media) {
      console.log(`Processing ${currentSMS.NumMedia} media attachments`);
      
      for (const mediaItem of currentSMS.media) {
        const processedMedia = await processAndUploadMedia(
          mediaItem,
          currentSMS.message_id,
          currentSMS.dealer_id
        );
        
        if (processedMedia) {
          attachments.push(processedMedia);
        }
      }
    }
    currentSMS.attachments = attachments;
    //return ;
    // Extract details from the current SMS
    let { recipient, sender, dealer_id } = currentSMS;
    const emailAccount = await EmailAccount.findOne({ 
      dealer_id: dealer_id 
    }).collation({ locale: 'en', strength: 2 });
    const dealer = await User.findOne({
        '_id': dealer_id
    });
    let autreply =true;
    if(dealer?.setting){
        if(dealer?.setting?.autoReplyEnabled === false){
           autreply =false;
        }
    }
    // AI mode (app/lib/ai/aiMode.js). `live`: the AI service owns this
    // conversation - no n8n, no auto-reply, no follow-up jobs.
    const aiMode = await getDealerAiMode(dealer_id);
    if (aiMode === 'live') {
      return await handleInboundSmsLive({ currentSMS, dealer });
    }

    const result = await callOllama(currentSMS);
   console.log('olamm response', result);

    // The webhook can deterministically associate a reply from prior SMS
    // history. Preserve that association even when n8n fails or omits a parent.
    let leadId = currentSMS.lead_id || null;
    let recipientphone;
    let smsText;
    let sms =true;
    let aiNewLead = null; // set when this SMS creates a lead (for the shadow event)

    // Extract the response data
    let { 
      create_lead, 
      lead_name, 
    
      lead_source, 
      response ,
      Response ,
      
      parent_message_id,
      parent_id,
      fe_lead_status,
      lead_status,
      update_lead,
      booking_status,
      booking_date,
      booking_time,
      vin,make,model,year} = result;
    

    let {lead_phone, lead_mail,response_mode, appointment_cancellation_requested = false, user_language = 'english' } = result;
    
    if(result.preferred_communication_mode_selected){
        if(result.preferred_communication_mode){
          response_mode =result.preferred_communication_mode
        }
    }
    if(lead_mail=='johndoe@email.com'){
        lead_mail ='';
    }
    // The AI extraction pipeline also emits literal placeholder strings
    // (e.g. "NA") when it can't find an email in the source text.
    if (isEmailSentinel(lead_mail)) {
      lead_mail = undefined;
    }
    if (lead_phone) {
      try {
        lead_phone = normalizeSmsPhone(lead_phone);
      } catch {
        // Preserve existing invalid-number handling in sendSMS.
      }
    }

    const resolvedParentId = parent_message_id ?? parent_id
      ?? currentSMS.parent_message_id ?? currentSMS.parent_conversation ?? null;
    let baseParentId = resolvedParentId ?? currentSMS.message_id;
    let statusJustChanged = false;
    parent_message_id = resolvedParentId;
    console.log(parent_message_id);
    if (parent_message_id) {
        try {
            // Find the lead associated with this conversation
            const existingparent = await Email.findOne({ 
                $or: [
                    
                    { 'message_id': parent_message_id }
                ] 
            });
            
            
            if (existingparent) {
              console.log(existingparent);
                const existingLead = await Lead.findById(existingparent.lead_id);
                if(existingLead){
                  leadId = existingLead._id;
                
                  // Always update lead_status if present in response
                  const updates = {};
                  if (lead_status) {
                      updates.lead_status = lead_status;
                      updates.frontend_lead_status = lead_status;
                  }
                  
                  // Always update fe_lead_status if present (independent of lead_status or update_lead)
                  if (fe_lead_status) {
                      updates.fe_lead_status = fe_lead_status;
                  }
                  
                  if (fe_lead_status && fe_lead_status !== existingLead.fe_lead_status) {
                    statusJustChanged = true;
                    // Set statusChangedAt when status changes (needed for followups)
                    updates.statusChangedAt = new Date();
                    if(existingLead.fe_lead_status === 'Managerial Review' || existingLead.fe_lead_status === 'Appointment Booked'){
                        cancelAllRemindersForLead(existingLead._id);  
                    }
                  }
                  
                  // Only update other fields if update_lead is true
                  if (update_lead) {
                      if (lead_name) updates.name = lead_name;
                      if (lead_mail) updates.email = lead_mail;
                      if (lead_phone) updates.phone = lead_phone??'';
                      if (lead_source) updates.source = lead_source;
                  }
                  
                  // Always update user_language (add or update in all cases)
                  if (user_language) {
                      updates.user_language = user_language.toLowerCase();
                  }
                  
                  // Store original booking_date string before converting to Date (for reminder creation)
                  let originalBookingDateStr = null;
                  
                  // Handle appointment cancellation
                  if (appointment_cancellation_requested === true) {
                    // Cancel all reminders for this lead
                    try {
                      await cancelAllRemindersForLead(existingLead._id);
                      console.log('Appointment reminders cancelled for lead:', existingLead._id);
                    } catch (cancelError) {
                      console.error('Error cancelling appointment reminders:', cancelError);
                    }
                    
                    // Clear booking date and time
                    updates.booking = {
                      booking_date: null,
                      booking_time: null
                    };
                    if (booking_status !== undefined) {
                      updates.booking_status = booking_status;
                    }
                  } else if (booking_status !== undefined) {
                    updates.booking_status = booking_status;
                    
                    if (booking_date || booking_time) {
                      updates.booking = updates.booking || {};
                      
                      // Process booking date
                      if (booking_date) {
                        // Store original string (already in dealer timezone) before converting
                        originalBookingDateStr = String(booking_date).split('T')[0]; // Extract date part if it includes time
                        const dateObj = new Date(booking_date);
                        if (isNaN(dateObj.getTime())) {
                          
                        }else{
                        updates.booking.booking_date = dateObj;
                        }
                      }
                      
                      // Process booking time
                      if (booking_time) {
                        // Convert time to 24-hour format if needed (e.g., "4 PM" -> "16:00")
                        let formattedTime = booking_time;
                        if (booking_time.match(/^\d{1,2}\s?(AM|PM)$/i)) {
                          const [hour, period] = booking_time.split(/(?=[AP]M)/i);
                          let hours = parseInt(hour);
                          const isPM = period.trim().toUpperCase() === 'PM';
                          
                          if (isPM && hours < 12) hours += 12;
                          if (!isPM && hours === 12) hours = 0;
                          
                          formattedTime = `${hours.toString().padStart(2, '0')}:00`;
                        }
                        updates.booking.booking_time = formattedTime;
                      }
                    }
                  }
                  
                  if (Object.keys(updates).length > 0) {
                      await Lead.findByIdAndUpdate(existingLead._id, updates);
                      console.log('Lead updated successfully:', updates);
                      
                      // Create appointment reminders if booking was created/updated (only if not cancelled)
                      // Use original booking_date string (in dealer timezone) instead of Date object
                      if (!appointment_cancellation_requested && updates.booking && (updates.booking.booking_date || updates.booking.booking_time)) {
                        try {
                          const bookingData = {
                            _id: existingLead._id,
                            customer_name: existingLead.name,
                            customer_email: existingLead.email,
                            customer_phone: existingLead.phone,
                            // Pass original string (in dealer timezone) instead of Date object
                            booking_date: originalBookingDateStr || (existingLead.booking?.booking_date 
                              ? (existingLead.booking.booking_date instanceof Date 
                                  ? moment(existingLead.booking.booking_date).tz(dealer.dealer_account_information?.time_zone || 'America/New_York').format('YYYY-MM-DD')
                                  : String(existingLead.booking.booking_date).split('T')[0])
                              : null),
                            time: updates.booking.booking_time || existingLead.booking?.booking_time
                          };
                          const reminderResult = await createAppointmentReminders(bookingData, dealer_id);
                          console.log('Appointment reminders created from SMS:', reminderResult);
                        } catch (reminderError) {
                          console.error('Error creating appointment reminders from SMS:', reminderError);
                        }
                      }
                      
                      // Create managerial review messages if status changed to "Managerial Review"
                      if ( fe_lead_status === 'Managerial Review' && leadId) {
                        try {
                          const reviewResult = await createManagerialReviewMessages(leadId, dealer_id);
                          console.log('Managerial review messages created from SMS:', reviewResult);
                        } catch (reviewError) {
                          console.error('Error creating managerial review messages from SMS:', reviewError);
                        }
                      }
                      
                      // Trigger DealerSocket work note after successful lead update
                      try {
                        console.log('Triggering DealerSocket work note for existing lead update...');
                        
                        
                      } catch (workNoteError) {
                        console.error('Error triggering DealerSocket work note:', workNoteError);
                        // Don't throw error - work note failure shouldn't stop SMS processing
                      }
                  }
                }
            }
        } catch (error) {
            console.error('Error updating lead:', error);
        }
    }
    if (create_lead && !leadId) {
      // Create new lead if required
      if (response_mode?.toLowerCase()=='email' && lead_mail) {
            recipient  =emailAccount.email_address;
            sms=false;
      }
     
       
      
      const newLead = new Lead({
        name: lead_name,
        email: lead_mail,
        sender:sender,
        recipient:recipient,
        phone: lead_phone || sender, // Use sender's phone if no phone in response
        source: lead_source || 'sms',
        dealer_id: dealer_id,
        lead_status:lead_status,
        fe_lead_status,
        status:lead_status,
        lead_source:result.Lead_Source,
        vin:vin||null,
        sourcemail:parent_id,
        followup_preference:response_mode ,
        vehicle_make: make,
        vehicle_model: model,
        vehicle_year: year,
        vin: result.vin,
        user_language: user_language.toLowerCase()

        
      });

      const savedLead = await newLead.save();
      leadId = savedLead._id;

      // This lead's phone number is the sender of the inbound SMS itself —
      // a self-initiated text is a real (if narrow) signal that the number
      // is live and reachable, unlike the email/web-form paths where there's
      // no phone-channel evidence at all.
      await linkCustomerToLead(savedLead, { source: 'sms', smsOptIn: true });
      aiNewLead = savedLead;

      statusJustChanged = true;
      recipientphone = lead_phone || sender;
      smsText = response ||Response|| 'Thank you for contacting us!';
      //baseParentId = null; // New conversation for new lead
      
      // Create managerial review messages if new lead is created with "Managerial Review" status
      if (fe_lead_status === 'Managerial Review' && leadId) {
        try {
          const reviewResult = await createManagerialReviewMessages(leadId, dealer_id);
          console.log('Managerial review messages created for new lead from SMS:', reviewResult);
        } catch (reviewError) {
          console.error('Error creating managerial review messages for new lead from SMS:', reviewError);
        }
      }
    } else {
      // Continue existing conversation
      recipientphone = sender;
      smsText =  response ||Response||'We received your message and will get back to you soon.';
    }

    // Check for managerial review FIRST - before sending normal SMS/email
    const isManagerialReview = fe_lead_status === 'Managerial Review';
    currentSMS.lead_id= leadId;
  
    if (parent_message_id !== undefined && parent_message_id !== null) {
      currentSMS.parent_message_id = parent_message_id;
      currentSMS.parent_conversation = parent_message_id;
      currentSMS.sourcemail=currentSMS.message_id;
    }else{
      currentSMS.parent_message_id = null;
    }
   
    const incomingRecord = new Email({
      ...currentSMS,
      user_language: user_language.toLowerCase(),
      ...(result.campaign_id !== undefined && result.campaign_id !== null && { campaign_id: result.campaign_id }),
      ...(result.campaign_name !== undefined && result.campaign_name !== null && { campaign_name: result.campaign_name }),
      ...(result.use_replies_for_ai !== undefined && result.use_replies_for_ai !== null && { use_replies_for_ai: result.use_replies_for_ai })
    });
    await incomingRecord.save();

    // AI shadow mode: n8n still handles this message; the AI service also
    // drafts a reply it never sends. Never throws.
    if (aiMode === 'shadow') {
      if (aiNewLead) {
        await notifyAiOfNewLead({ lead: aiNewLead, dealerId: dealer_id, channel: 'sms', mode: aiMode });
      } else if (leadId) {
        await notifyAiOfInbound({
          emailRecord: incomingRecord, lead: await Lead.findById(leadId), dealerId: dealer_id,
          channel: 'sms', text: currentSMS.mail_content, mode: aiMode,
        });
      }
    }

    if(autreply && isManagerialReview) {
      // Handle managerial review case - send to manager and return early
      if (dealer && autreply) {
        // Send email to store contact email if available
        if (dealer.dealer_account_information.general_manager_email) {
          const managerSubject = `Managerial Review Required for Lead: ${lead_name || sender}`;
          const managerContent = `A new email requires managerial review:\n\n` +
                               `From: ${sender}\n` +
                               `Subject: ${managerSubject}\n` +
                               `Content: ${currentSMS?.mail_content}\n\n` +
                               `Please review and take appropriate action.`;
              
          try {
            try {
                await sendEmail(
                  dealer.dealer_account_information.general_manager_email, 
                  managerSubject, 
                  managerContent, 
                  emailAccount.email_address,
                  null,
                  dealer
                );
              } catch (error) {
                console.error('Error sending managerial review email:', error);
              }
        
            if(result.send_manager_sms){
              const msg_content = result.manager_sms;
              try {
                await sendSMS(dealer.dealer_account_information.store_contact_number, msg_content,dealer);
                console.log('Managerial review SMS sent successfully');
              } catch (smsError) {
                console.error('Error sending managerial review SMS:', smsError.message);
                // Continue processing even if SMS fails
              }
            }
            if(result.send_user_response){
              try {
                const updatedsentMessageId = await sendSMS(recipientphone, result.user_response,dealer);
                const updatedemailStatus = 'sent';
                const emailRecord = new Email({
                  message_id: updatedsentMessageId , // Use sentMessageId if available
                  parent_message_id:baseParentId, // Use current email's message_id as parent (null for new mail)
                  parent_conversation: currentSMS.message_id, // Use base parent ID for the conversation (null for new mail)
                  sender: recipient,
                  recipient: recipientphone, // Save the correct recipient
                  subject: 'SMS Conversation',
                  mail_content: result.user_response,
                  communication_type:sms?'sms':'email',
                  status: updatedemailStatus,
                  dealer_id: dealer_id,
                  lead_id: leadId,
                  sourcemail:currentSMS.message_id,
                  date: new Date(),
                  user_language: user_language.toLowerCase(),
                  ...(result.campaign_id !== undefined && result.campaign_id !== null && { campaign_id: result.campaign_id }),
                  ...(result.campaign_name !== undefined && result.campaign_name !== null && { campaign_name: result.campaign_name }),
                  ...(result.use_replies_for_ai !== undefined && result.use_replies_for_ai !== null && { use_replies_for_ai: result.use_replies_for_ai })
                });
                await emailRecord.save();
              } catch (smsError) {
                console.error('Error sending user response SMS:', smsError.message);
                // Continue processing even if SMS fails
                const updatedsentMessageId = `sms-${Date.now()}`;
                const emailRecord = new Email({
                  message_id: updatedsentMessageId , // Use sentMessageId if available
                  parent_message_id:baseParentId, // Use current email's message_id as parent (null for new mail)
                  parent_conversation: currentSMS.message_id, // Use base parent ID for the conversation (null for new mail)
                  sender: recipient,
                  recipient: recipientphone, // Save the correct recipient
                  subject: 'SMS Conversation',
                  mail_content: result.user_response,
                  communication_type:sms?'sms':'email',
                  status: 'failed',
                  dealer_id: dealer_id,
                  lead_id: leadId,
                  sourcemail:currentSMS.message_id,
                  date: new Date(),
                  user_language: user_language.toLowerCase(),
                  ...(result.campaign_id !== undefined && result.campaign_id !== null && { campaign_id: result.campaign_id }),
                  ...(result.campaign_name !== undefined && result.campaign_name !== null && { campaign_name: result.campaign_name }),
                  ...(result.use_replies_for_ai !== undefined && result.use_replies_for_ai !== null && { use_replies_for_ai: result.use_replies_for_ai })
                });
                await emailRecord.save();
              }
            }
            console.log('Managerial review email sent to store contact');
          } catch (error) {
            console.error('Error sending managerial review email:', error);
          }
        }
        
        // TODO: Add SMS sending logic here for store_contact_number
        // You would need to implement your SMS sending function
        if (dealer.dealer_account_information.store_contact_number) {
          console.log('SMS should be sent to:', dealer.store_contact_number);
          // Implement SMS sending logic here
        }
      }
      
      // Don't proceed with normal SMS processing for managerial review
      return;
    }

    let smsStatus = 'pending';
    let sentMessageId = null;
    const leadetail =  await Lead.findById(leadId);
    try {
      // Send the SMS response
      if(autreply){
      
        if (response_mode?.toLowerCase()=='email' && leadetail.email) {
              const emailSubject ='Thanks you for subject transfer';
              if (response_mode?.toLowerCase()=='email' && leadetail.email) {
                    sender= recipient =emailAccount.email_address;
                    sms=false;
                    recipientphone  = leadetail.email;
                    sentMessageId = await sendEmail(leadetail.email, emailSubject, response, sender, '',dealer);
                    smsStatus = 'sent';
              }else{
                  
              }
              
                 
          }else{
            if(smsText !=='null' && smsText !=='undefined' && smsText !==null && smsText !==undefined){
              try {
                sentMessageId = await sendSMS(recipientphone, smsText,dealer);
                smsStatus = 'sent';
                console.log('SMS sent successfully. Message ID:', sentMessageId);
              } catch (smsError) {
                console.error('Error sending SMS to recipient:', smsError.message);
                smsStatus = 'failed';
                // Continue processing even if SMS fails
              }
            }
          }
       
      }else{
        smsStatus = 'draft';
      }
    } catch (error) {
      smsStatus = 'failed';
      console.error('Error sending SMS:', error);
    }
    console.log('lead_status',parent_message_id,lead_status,update_lead);
    

    // Schedule followups regardless of auto-reply setting (followups are about maintaining communication)
    if (leadId && statusJustChanged) {
      console.log('onleadstatus change',leadId);
      try {
        await onLeadStatusChange(leadId);
      } catch (followupError) {
        console.error('Error scheduling followups from SMS:', followupError);
      }
    } else if (leadId) {
      const job = await FollowUpJob.findOne({ leadId });
      if (job) {
        console.log('on folowup event change');
        try {
          await onFollowUpEvent(job);
        } catch (followupError) {
          console.error('Error scheduling followup event from SMS:', followupError);
        }
      } else {
        try {
          await onLeadStatusChange(leadId);
        } catch (followupError) {
          console.error('Error scheduling followups from SMS:', followupError);
        }
      }
    }
    
   
      sentMessageId =sentMessageId || `sms-${Date.now()}`;
      console.log(sender,recipientphone);
      const email_content = await stripTagsRegex(smsText);
      const smsRecord = new Email({
        message_id: sentMessageId , // Generate ID if not available
        parent_conversation: currentSMS.message_id,
        sender: recipient, // Your Twilio number
        recipient: recipientphone,
        subject: 'SMS Conversation',
        mail_content: email_content,
        status: smsStatus,
        dealer_id: dealer_id,
        lead_id: leadId,
        date: new Date(),
        communication_type:sms?'sms':'email',
        parent_message_id:baseParentId,
        sourcemail:currentSMS.message_id,
        user_language: user_language.toLowerCase(),
        ...(result.campaign_id !== undefined && result.campaign_id !== null && { campaign_id: result.campaign_id }),
        ...(result.campaign_name !== undefined && result.campaign_name !== null && { campaign_name: result.campaign_name }),
        ...(result.use_replies_for_ai !== undefined && result.use_replies_for_ai !== null && { use_replies_for_ai: result.use_replies_for_ai })
        
       });
      console.log(statusJustChanged,leadId);
      await smsRecord.save();

      if(result.preferred_communication_mode_selected){
        let newParentId
        if(!parent_message_id){
          newParentId = parent_message_id;
        }else{
          newParentId = result.preferred_communication_mode_old_messageID;
        }
      
        await Email.findOneAndUpdate(
          { message_id: parent_message_id },  // Query by message_id field
          { $addToSet: { attached_parents: newParentId } },  // Update operation
          { new: true }  // Optional: return the updated document
        );
      }
      if (leadId) {
        const newUpdate = {
          parent_message_id: parent_message_id||sentMessageId,
          response_mode: response_mode,
          lead_source: result.Lead_Source,
          user_language: user_language.toLowerCase()
        };
      
        // Conditionally add preferred_communication_mode fields if they exist
        if (result.preferred_communication_mode_selected != null) {
          newUpdate.preferred_communication_mode_selected = result.preferred_communication_mode_selected;
          newUpdate.preferred_communication_mode = result.preferred_communication_mode;
        }
      
        // Single update operation for efficiency
        await Lead.findByIdAndUpdate(leadId, newUpdate);
      
        // Only update `attached_parents` if `preferred_communication_mode_old_messageID` exists
        if (result.preferred_communication_mode_old_messageID != null) {
          await Lead.findByIdAndUpdate(
            leadId,
            { $addToSet: { attached_parents: result.preferred_communication_mode_old_messageID } }
          );
        }
      
        console.log('Lead updated successfully:', newUpdate);
        
        // Trigger DealerSocket work note after successful lead update
        try {
          console.log('Triggering DealerSocket work note for lead update...');
          
          // Get the updated lead to extract necessary information
          const updatedLead = await Lead.findById(leadId);
          const updateddealer = await User.findById(dealer_id);
          if (updatedLead && updateddealer && updateddealer.dealer_account_information.dealersocket_dealerid) {
            const workNoteCriteria = {
              lead_id: leadId.toString(),
              dealer_id: updateddealer.dealer_account_information.dealersocket_dealerid,
              frenchise_id: updateddealer.dealer_account_information.dealersocket_frenchiseid,
              entity_email: updatedLead.email || sender,
              entity_phone: updatedLead.phone || lead_phone,
              vin: updatedLead.vin || null,
              auto_insert_work_note: true,
              vendor_name: 'AutoPulse'
            };
            
            console.log('DealerSocket work note criteria:', workNoteCriteria);
            
            const workNoteResult = await checkLeadByIdentifiers(workNoteCriteria);
            
            if (workNoteResult.success && workNoteResult.found) {
              console.log('DealerSocket work note inserted successfully:', workNoteResult.work_notes);
            } else {
              console.log('DealerSocket work note not inserted - no matching leads found or error occurred');
            }
          } else {
            console.log('Could not find updated lead or dealer with dealersocket_dealerid for DealerSocket work note');
          }
        } catch (workNoteError) {
          console.error('Error triggering DealerSocket work note:', workNoteError);
          // Don't throw error - work note failure shouldn't stop SMS processing
        }
      }
    

    console.log('SMS record saved successfully');

  } catch (error) {
    console.error('Error processing SMS:', error);
    // You might want to implement retry logic here
  }
}


async function stripTagsRegex(html) {
  if (typeof html !== 'string') return '';
  return html.replace(/<\/?[^>]+(>|$)/g, '');
}
// Similar Ollama call function adapted for SMS
async function callOllama( currentSMS) {
  const url =  process.env.N8N_SMS_API;
  
  // Format data for SMS processing
  const payload = {
   
    currentMessage: {
      ...currentSMS,
      content: currentSMS.mail_content || currentSMS.body,
      isSMS: true
    }
  };

  console.log('Calling Ollama with SMS data:');
  
  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error calling Ollama:', error);
    // Return a default response if API fails
    return {
      create_lead: false,
      Response: 'We received your message. Our team will contact you soon.',
      new_message: false
    };
  }
}



// Example SMS sending function (to be implemented in lib/sms.js)
