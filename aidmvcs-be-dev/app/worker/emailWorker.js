import axios from 'axios'; // For making HTTP requests
import dbConnect from '../lib/mongodb.js'; // For database operations
import Lead from '../models/Lead.js'; // Lead model
import Email from '../models/Email.js'; // Email model
import { sendEmail } from '../lib/email.js'; // For sending emails
import User from '../models/User.js';
import { sendSMS } from '../lib/sms.js'; // Assume you have an SMS sending function

import JSON5 from 'json5';
import FollowUpJob from '../models/FollowUpJob.js'; // Using same Email model for SMS too
import { onLeadStatusChange ,onFollowUpEvent} from '../lib/followupService.js';
import { checkLeadByIdentifiers } from '../lib/dealersocket-worknote.js';
import { cancelAllRemindersForLead, createAppointmentReminders, createManagerialReviewMessages } from '../lib/appointmentReminderService.js';
import moment from 'moment-timezone';
import { linkCustomerToLead } from '../lib/customerResolver.js';

// Connect to the database
await dbConnect();

// Function to process an email
export async function processEmail(job) {
  

  const { conversationThread, currentEmail } = job.data;
  
  try {
    // Extract details from the current email
    let { emailBody, emailId, recipient, sender, subject, dealer_id,parent_message_id } = currentEmail;
   
    const dealer = await User.findOne({
        '_id': dealer_id
    });
    let sourcemail='';
    let autreply =true;
    let existingparent=null;
    if(dealer?.setting){
        if(dealer?.setting?.autoReplyEnabled ===false ){
           autreply =false;
        }
    }
    let sms =false;
    const result = await callOllama(conversationThread,currentEmail);

    console.log('Third-party API response:', result);
    let leadId = null;
    let recipientEmail;
    let emailSubject=`${subject}`;
    // Extract the response data
    const { create_lead,lead_name,lead_mail,lead_source, response , update_lead,
      lead_status,
      booking_status,
      booking_date,
      booking_time,request,fe_lead_status,vin,make,model,year} = result;

    let { lead_phone,response_mode, appointment_cancellation_requested = false, user_language = 'english', campaign_id, campaign_name, use_replies_for_ai } = result;
    
    if(result.preferred_communication_mode_selected){
        if(result.preferred_communication_mode){
          response_mode =result.preferred_communication_mode
        }
    }
   
    try {
      lead_phone = formatPhoneForTwilio(lead_phone);
      console.log('Formatted phone:', lead_phone); // +14155552671 or +919876543210
    } catch (err) {
      console.error('Error formatting phone:', err.message);
    }
    let baseParentId = currentEmail.parent_conversation || currentEmail.message_id;
    let statusJustChanged = false;

    if (parent_message_id) {
        try {
            // Find the lead associated with this conversation
            existingparent = await Email.findOne({ 
                $or: [
                   
                    { 'message_id': parent_message_id }
                ] 
            });
            console.log('existingparent');
          


            
            if (existingparent) {
                const existingLead = await Lead.findOne({ 
                    $or: [
                        
                      { _id: existingparent.lead_id }
                    ] 
                });
                console.log('existingLead',existingLead);
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
                      if(existingLead.fe_lead_status == 'Managerial Review' || existingLead.fe_lead_status == 'Appointment Booked'){
                        cancelAllRemindersForLead(existingLead._id);
                      }
                  }
                  
                  // Only update other fields if update_lead is true
                  if (update_lead) {
                      if (lead_name) updates.name = lead_name;
                      if (lead_mail) updates.email = lead_mail;
                      if (lead_phone) updates.phone = lead_phone;
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
                          console.log('📅 Creating appointment reminders from email with booking data:', {
                            booking_date: bookingData.booking_date,
                            time: bookingData.time,
                            dealer_id: dealer_id
                          });
                          const reminderResult = await createAppointmentReminders(bookingData, dealer_id);
                          console.log('✅ Appointment reminders created from email:', reminderResult);
                        } catch (reminderError) {
                          console.error('❌ Error creating appointment reminders from email:', reminderError);
                        }
                      } else {
                        console.log('⚠️ Skipping appointment reminder creation - no booking date/time in updates:', {
                          hasBooking: !!updates.booking,
                          hasBookingDate: !!(updates.booking?.booking_date),
                          hasBookingTime: !!(updates.booking?.booking_time),
                          appointmentCancelled: appointment_cancellation_requested
                        });
                      }
                      
                      // Create managerial review messages if status changed to "Managerial Review"
                      if (statusJustChanged && fe_lead_status === 'Managerial Review' && leadId) {
                        try {
                          const reviewResult = await createManagerialReviewMessages(leadId, dealer_id);
                          console.log('Managerial review messages created from email:', reviewResult);
                        } catch (reviewError) {
                          console.error('Error creating managerial review messages from email:', reviewError);
                        }
                      }
                  }
                }
            }
        } catch (error) {
            console.error('Error updating lead:', error);
        }
    }
    if (create_lead) {

      if (response_mode?.toLowerCase()=='email' && lead_mail) {
       
      }else if (response_mode?.toLowerCase()=='sms' && lead_phone) {
        recipient= dealer.dealer_account_information.sms_conversion_phone
        sms=true;
        
      }
      const newLead = new Lead({
        name: lead_name,
        email: lead_mail,
        sender:recipient ,
        recipient:sms?lead_phone:lead_mail,
        lead_status:lead_status,
        fe_lead_status,
        status:lead_status,
        phone: lead_phone,
        source: lead_source || 'email',
        dealer_id: dealer_id,
        sourcemail:emailId,
        lead_source:result.Lead_Source,
       
        followup_preference:response_mode ,
        vehicle_make: make,
        vehicle_model: model,
        vehicle_year: year,
        vin: result.vin,
        user_language: user_language.toLowerCase()
      });
      baseParentId=null;

      const savedLead = await newLead.save();
      leadId = savedLead._id;

      await linkCustomerToLead(savedLead, { source: 'email' });
      console.log('Lead created successfully:', newLead);
      recipientEmail = (lead_mail && lead_mail !== 'NA') ? lead_mail : sender;
      emailId = null; // No parent for a new email
      baseParentId = null; // No base parent ID for a new conversation
       emailSubject = `Thank you response`;
       statusJustChanged = true;
       
       // Create managerial review messages if new lead is created with "Managerial Review" status
       if (fe_lead_status === 'Managerial Review' && leadId) {
         try {
           const reviewResult = await createManagerialReviewMessages(leadId, dealer_id);
           console.log('Managerial review messages created for new lead from email:', reviewResult);
         } catch (reviewError) {
           console.error('Error creating managerial review messages for new lead from email:', reviewError);
         }
       }
    }else{
      recipientEmail = sender;
      emailId = currentEmail.message_id;
      emailSubject = `${subject}`;
    }

    console.log('emailid',emailId);
    if(emailId){
      // Find the latest email record with this message_id (sorted by date descending)
      const originalparent = await Email.findOne({ 
          message_id: emailId
      }).sort({ date: -1, createdAt: -1 });
      console.log('originalparent',originalparent,request);
      if(originalparent){
        originalparent.mail_content = request;
        originalparent.user_language = user_language.toLowerCase();
        // Update campaign fields if they exist
        if (result.campaign_id !== undefined && result.campaign_id !== null) {
          originalparent.campaign_id = result.campaign_id;
        }
        if (result.campaign_name !== undefined && result.campaign_name !== null) {
          originalparent.campaign_name = result.campaign_name;
        }
        if (result.use_replies_for_ai !== undefined && result.use_replies_for_ai !== null) {
          originalparent.use_replies_for_ai = result.use_replies_for_ai;
        }
        await originalparent.save();
      }
    }

    let emailStatus = 'pending';
    let sentMessageId = null; // To store the message_id of the sent email
    
  
    const emailText = response ? response : 'Thank you for your email. We will get back to you shortly.'; // Default response

    // Determine the base parent ID for the conversation
    

    // Check for managerial review FIRST - before sending normal email/SMS
    const isManagerialReview = fe_lead_status === 'Managerial Review';
    const isDnd = fe_lead_status === 'DND';
    if(autreply && (isManagerialReview || isDnd)) {
      // Handle managerial review case - send to manager and return early
      if (dealer && autreply) {
        // Send email to store contact email if available
        if (dealer.dealer_account_information.general_manager_email) {
          const managerSubject = `Managerial Review Required for Lead: ${lead_name || sender}`;
          const managerContent = `A new email requires managerial review:\n\n` +
                               `From: ${sender}\n` +
                               `Subject: ${subject}\n` +
                               `Content: ${emailBody}\n\n` +
                               `Please review and take appropriate action.`;
          
          try {
            if(isManagerialReview){
              await sendEmail(
                dealer.dealer_account_information.general_manager_email, 
                managerSubject, 
                managerContent, 
                recipient,
                null,
                dealer
                
              );
              if(result.send_manager_sms){
                const msg_content = result.manager_sms;
                try {
                  await sendSMS(dealer.dealer_account_information.general_manager_phone, msg_content,dealer);
                  console.log('Managerial review SMS sent successfully');
                } catch (smsError) {
                  console.error('Error sending managerial review SMS:', smsError.message);
                  // Continue processing even if SMS fails
                }
              }
            }
            console.log('result.send_user_response',result.send_user_response);
            if(result.send_user_response==true){
              const updatedsentMessageId = await sendEmail(recipientEmail, emailSubject, result.user_response, recipient, emailId,dealer);
              const updatedemailStatus = 'sent';
              const emailRecord = new Email({
                message_id: updatedsentMessageId , // Use sentMessageId if available
                parent_message_id:parent_message_id, // Use current email's message_id as parent (null for new mail)
                parent_conversation: emailId, // Use base parent ID for the conversation (null for new mail)
                sender: recipient,
                recipient: recipientEmail, // Save the correct recipient
                subject: emailSubject,
                mail_content: result.user_response,
                communication_type:sms?'sms':'email',
                status: updatedemailStatus,
                dealer_id: dealer_id,
                lead_id: leadId,
                sourcemail:currentEmail.emailId,
                date: new Date(),
                user_language: user_language.toLowerCase(),
                ...(result.campaign_id !== undefined && result.campaign_id !== null && { campaign_id: result.campaign_id }),
                ...(result.campaign_name !== undefined && result.campaign_name !== null && { campaign_name: result.campaign_name }),
                ...(result.use_replies_for_ai !== undefined && result.use_replies_for_ai !== null && { use_replies_for_ai: result.use_replies_for_ai })
               
              });
              await emailRecord.save();
            }
            console.log('Managerial review email sent to store contact');
          } catch (error) {
            console.error('Error sending managerial review email:', error);
          }
        }
        
        // TODO: Add SMS sending logic here for store_contact_number
        // You would need to implement your SMS sending function
        
      }
      
      // Don't proceed with normal email processing for managerial review
      return;
    }

    try {
      // Send the email and capture the message_id
      if(autreply){
        if (response_mode?.toLowerCase()=='email' && lead_mail) {
          sentMessageId = await sendEmail(lead_mail, emailSubject, emailText, recipient, emailId,dealer);
          emailStatus = 'sent';
        }
        else if (response_mode?.toLowerCase()=='sms' && lead_phone) {
          recipientEmail =lead_phone;
          recipient= dealer.dealer_account_information.sms_conversion_phone
          try {
            sentMessageId = await sendSMS(lead_phone, emailText,dealer);
            emailStatus = 'sent';
            sms=true;
          } catch (smsError) {
            console.error('Error sending SMS to lead:', smsError.message);
            emailStatus = 'failed';
            // Continue processing even if SMS fails
          }
        }else if (create_lead && lead_mail) {
          sentMessageId = await sendEmail(lead_mail, emailSubject, emailText, recipient, emailId,dealer);
          emailStatus = 'sent';
        }else{
          
          sentMessageId = await sendEmail(recipientEmail, emailSubject, emailText, recipient, emailId,dealer);
          emailStatus = 'sent';
        }
        console.log('Email sent successfully. Message ID:', sentMessageId);
      }else{
        emailStatus = 'draft';
        sentMessageId =  `email-${Date.now()}`;
      }
    } catch (error) {
      emailStatus = 'failed';
      console.error('Error sending email:', error);
    }
   
    const email_content = await stripTagsRegex(emailText);
    
    // Schedule followups regardless of auto-reply setting (followups are about maintaining communication)
    if (leadId && statusJustChanged) {
      console.log('onleadstatus change',leadId);
      try {
        await onLeadStatusChange(leadId);
      } catch (followupError) {
        console.error('Error scheduling followups from email:', followupError);
      }
    } else if (leadId) {
      const job = await FollowUpJob.findOne({ leadId });
      if (job) {
        console.log('on folowup event change');
        try {
          await onFollowUpEvent(job);
        } catch (followupError) {
          console.error('Error scheduling followup event from email:', followupError);
        }
      } else {
        try {
          await onLeadStatusChange(leadId);
        } catch (followupError) {
          console.error('Error scheduling followups from email:', followupError);
        }
      }
    }
    
    if(autreply){
    sentMessageId =sentMessageId || `email-${Date.now()}`;
    
    // Save the email status and response
    const emailRecord = new Email({
      message_id: sentMessageId , // Use sentMessageId if available
      parent_message_id:parent_message_id, // Use current email's message_id as parent (null for new mail)
      parent_conversation: emailId, // Use base parent ID for the conversation (null for new mail)
      sender: recipient,
      recipient: recipientEmail, // Save the correct recipient
      subject: emailSubject,
      mail_content: email_content,
      communication_type:sms?'sms':'email',
      status: emailStatus,
      dealer_id: dealer_id,
      lead_id: leadId,
      sourcemail:currentEmail.emailId,
      date: new Date(),
      user_language: user_language.toLowerCase(),
      ...(result.campaign_id !== undefined && result.campaign_id !== null && { campaign_id: result.campaign_id }),
      ...(result.campaign_name !== undefined && result.campaign_name !== null && { campaign_name: result.campaign_name }),
      ...(result.use_replies_for_ai !== undefined && result.use_replies_for_ai !== null && { use_replies_for_ai: result.use_replies_for_ai })
     
    });
    await emailRecord.save();
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
        if(autreply){
          console.log('Triggering DealerSocket work note for lead update...');
          
          // Get the updated lead to extract necessary information
          const updatedLead = await Lead.findById(leadId);
          const updateddealer = await User.findById(dealer_id);
          if (updatedLead && updateddealer.dealer_account_information.dealersocket_dealerid) {
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
            console.log('Could not find updated lead for DealerSocket work note');
          }
        }else{

        }
       } catch (workNoteError) {
          console.error('Error triggering DealerSocket work note:', workNoteError);
          // Don't throw error - work note failure shouldn't stop email processing
        }
    }
    }

   
    

   
    
  } catch (error) {
    console.error('Error processing email:', error);
  }
}

async function stripTagsRegex(html) {
  if (typeof html !== 'string') return '';
  return html.replace(/<\/?[^>]+(>|$)/g, '');
}
// Function to create a prompt for OpenAI
async function createPrompt(currentEmail, conversationThread) {
    const { subject, sender, recipient, mail_content } = currentEmail;

    const prompt = `
  Analyze the following email and conversation thread, and generate a response in the specified format.
  
  **Email Details:**
  - Subject: ${subject}
  - Sender: ${sender}
  - Recipient: ${recipient}
  - Content: ${mail_content}
  
  **Conversation Thread:**
  ${JSON.stringify(conversationThread, null, 2)}
  
  **Instructions:**
  1. Analyze the **current email** to determine if a lead should be created. If yes, set \`create_lead\` to \`true\` and provide lead details (\`name\`, \`email\`, \`phone\`, \`source\`). If no, set \`create_lead\` to \`false\` and leave \`lead\` blank.
  2. If \`create_lead\` is \`true\`, set \`new_mail\` to \`true\` and provide the response message for a **new email**.
  3. If \`create_lead\` is \`false\`, set \`new_mail\` to \`false\` and provide the response message for a **reply** to the current email.
  4. Include the \`message_id\` and \`parent_message_id\` for tracking.
  
  **Response Format:**
  {
    create_lead: true or false,
    lead: {
      name: '...',
      email: '...',
      phone: '...',
      source: '...'
    },
    new_mail: true or false,
    Response: '...',
    message_id: '...',
    parent_message_id: '...'
  }
  `;
  
    return prompt;
  }

  async function callOllama(conversation, currentEmail) {
    
    
    const url =  process.env.N8N_EMAIL_API;
    const payload = {
      conversationThread: conversation,
      currentEmail: currentEmail
    };
  
    console.log('Sending payload:');
  
    try {
      const response = await fetch(url, {
        method: 'POST', // Explicitly set method to POST
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload) // Convert payload to JSON string
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      const result = await response.json(); // Parse JSON response
      return result;
    } catch (error) {
      console.error('Error calling Ollama API:', error);
      throw error; // Re-throw the error for the caller to handle
    }
  }

// Function to trigger the OpenAI API
async function openaitrigger(emailBody) {
  console.log(emailBody);
  const processedPrompt = Array.isArray(emailBody) ? JSON.stringify(emailBody) : emailBody;
  const OPENAI_API_KEY = process.env.OPENAPI_KEY;
  const payload = {
    model: 'gpt-4',
    messages: [
      { role: 'user', content: processedPrompt }
    ],
    max_tokens: 300
  };

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const result = response.data;

    // Clean and decode the response
    const sanitizedResponse = sanitizeOpenAIResponse(result.choices[0].message.content);

    return JSON5.parse(sanitizedResponse);

  } catch (error) {
    console.error("OpenAI API Error:", error.message);
    return null;
  }
}

// Function to sanitize the OpenAI response
function sanitizeOpenAIResponse(response) {
  // Implement your sanitization logic here
  return response;
}

function formatPhoneForTwilio(phone) {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');

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
