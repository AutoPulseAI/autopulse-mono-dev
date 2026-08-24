// leadworker.js
import { Worker } from 'bullmq';

import dbConnect from '../lib/mongodb.js';
import { sendEmail } from '../lib/email.js';
import { sendSMS } from '../lib/sms.js';

import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Email from '../models/Email.js';
import EmailAccount from '../models/EmailAccount.js';
import FollowUpJob from '../models/FollowUpJob.js'; // Using same Email model for SMS too
import { onLeadStatusChange ,onFollowUpEvent} from '../lib/followupService.js';
import { checkLeadByIdentifiers } from '../lib/dealersocket-worknote.js';
import { cancelAllRemindersForLead } from '../lib/appointmentReminderService.js';
import { linkCustomerToLead } from '../lib/customerResolver.js';

export const processLead = async (job) => {
  const { leadData, action, dealer,jobData } = job.data;
  await dbConnect();
  
  try {
    let leadId = null;
    let lead;
    let statusJustChanged = false;
    let autoReplyEnabled = true;
    if (action === 'create') {
      // Validate required fields
      if (!leadData.name) throw new Error('Name is required');
      if (!leadData.email && !leadData.phone) throw new Error('Email or phone is required');

      // Check auto-reply settings
      
      if(dealer?.setting){
          if(dealer?.setting?.autoReplyEnabled ===false ){
            autoReplyEnabled =false;
          }
      }
     
      
      const dealerEmailAccount = await EmailAccount.findOne({ dealer_id: dealer._id });
      console.log(leadData)
      
      // Call Ollama API for processing first to get user_language
      const ollamaResponse = leadData.followup_preference === 'sms' &&  leadData.phone ? await callOllama(jobData): await  callOllama(jobData);
      const { 
        response,
        response_mode,
        fe_lead_status,
        lead_status,
        booking_status,
        booking_date,
        booking_time,
        appointment_cancellation_requested = false,
        user_language = 'english'
      } = ollamaResponse;
      
      // Create new lead with user_language from Ollama response
      lead = new Lead({
        ...leadData,
        lead_status: 'New',
        fe_lead_status: 'Lead',
        status: 'New',
        user_language: (user_language || leadData.user_language || 'english').toLowerCase()
      });

      const savedLead = await lead.save();
      leadId = savedLead._id;

      await linkCustomerToLead(savedLead);

      // Update lead with Ollama response if needed
      const updates = {};
      if (fe_lead_status) {
        updates.fe_lead_status = fe_lead_status;
        updates.lead_status = lead_status || 'New';
        statusJustChanged = true;
      }
      
      // Always update user_language (add or update in all cases)
      if (user_language) {
        updates.user_language = user_language.toLowerCase();
      }

      // Handle appointment cancellation
      if (appointment_cancellation_requested === true) {
        // Cancel all reminders for this lead
        try {
          await cancelAllRemindersForLead(lead._id);
          console.log('Appointment reminders cancelled for lead:', lead._id);
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
        updates.booking = {
          ...(booking_date && { booking_date: new Date(booking_date) }),
          ...(booking_time && { booking_time: formatBookingTime(booking_time) })
        };
      }

      if (Object.keys(updates).length > 0) {
        await Lead.findByIdAndUpdate(lead._id, updates);
      }

      // Send initial communication if auto-reply is enabled
      let communicationRecord;
      
        const communicationType =response_mode;
        const sender = communicationType === 'sms' 
          ? dealer.dealer_account_information?.sms_conversion_phone 
          : dealerEmailAccount?.email_address;

        const recipient = communicationType === 'sms' ? leadData.phone : leadData.email;
        const content = response ? await stripTagsRegex(response): 'Thank you for contacting us. We will get back to you soon.';
        let status = 'sent';
        try {
          let messageId;
          if (autoReplyEnabled) {
            try {
              if (communicationType === 'sms') {
                messageId = await sendSMS(recipient, content, dealer);
              } else {
                messageId = await sendEmail(
                  recipient,
                  'Thank you for your interest',
                  content,
                  sender,
                  null,
                  dealer
                );
              }
              status = 'sent';
            } catch (sendError) {
              console.error('Error sending communication:', sendError);
              status = 'failed';
              messageId = `msg-${Date.now()}`;
            }
          } else {
            messageId = `msg-${Date.now()}`;
            status = 'draft';
          }
          const baserecord = new Email({
            message_id: messageId || `msg-${Date.now()}`,
          
            recipient: sender,
            parent_message_id:null, 
            parent_conversation:null , 
            sender: recipient,
            subject: '',
            mail_content: leadData.comments,
            status: 'incoming',
            dealer_id: dealer._id,
            lead_id: lead._id,
            date: new Date(),
            communication_type: communicationType,
            user_language: user_language.toLowerCase()
          });
          if (baserecord) {
            await baserecord.save();
          }

          // Add delay between first and second email
          const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
          await delay(1000); // 2 second delay
          
          communicationRecord = new Email({
            message_id: messageId || `msg-${Date.now()}`,
            sender: sender,
            recipient: recipient,
            parent_message_id:messageId, 
            parent_conversation:messageId , 
            subject: 'Thank you for your interest',
            mail_content: content,
            status: status,
            dealer_id: dealer._id,
            lead_id: lead._id,
            date: new Date(),
            communication_type: communicationType,
            user_language: user_language.toLowerCase()
          });

        } catch (error) {
          console.error('Error sending communication:', error);
          let messageId = `msg-${Date.now()}`;
          const baserecord = new Email({
            message_id: messageId || `msg-${Date.now()}`,
            sender,
            recipient: recipient,
            parent_message_id:null, 
            parent_conversation:null , 
            sender: recipient,
            subject: 'Thank you for your interest',
            mail_content: leadData.comments,
            status: 'incoming',
            dealer_id: dealer._id,
            lead_id: lead._id,
            date: new Date(),
            communication_type: communicationType,
            user_language: user_language.toLowerCase()
          });
          if (baserecord) {
            await baserecord.save();
          }
          
          communicationRecord = new Email({
            message_id: `msg-${Date.now()}`,
            sender: sender,
            recipient: recipient,
            parent_message_id:messageId,
            subject: 'Thank you for your interest',
            mail_content: content,
            status: 'failed',
            dealer_id: dealer._id,
            lead_id: lead._id,
            date: new Date(),
            communication_type: communicationType,
            user_language: user_language.toLowerCase()
          });
        }
      

      if (communicationRecord) {
        await communicationRecord.save();
      }

      // DealerSocket work note insert (best-effort)
      try {
        const updatedLead = await Lead.findById(lead._id);
        const updatedDealer = await User.findById(dealer._id);
        if (
          updatedLead &&
          updatedDealer?.dealer_account_information?.dealersocket_dealerid
        ) {
          const workNoteCriteria = {
            lead_id: updatedLead._id?.toString(),
            dealer_id: updatedDealer.dealer_account_information.dealersocket_dealerid,
            frenchise_id: updatedDealer.dealer_account_information.dealersocket_frenchiseid,
            entity_email: updatedLead.email || (communicationRecord ? communicationRecord.sender : null),
            entity_phone: updatedLead.phone || (communicationRecord ? communicationRecord.recipient : null),
            vin: updatedLead.vin || null,
            auto_insert_work_note: true,
            vendor_name: 'AutoPulse'
          };
          console.log('DealerSocket work note criteria (leadworker):', workNoteCriteria);
          const workNoteResult = await checkLeadByIdentifiers(workNoteCriteria);
          if (workNoteResult.success && workNoteResult.found) {
            console.log('DealerSocket work note inserted (leadworker):', workNoteResult.work_notes);
          } else {
            console.log('DealerSocket work note not inserted (leadworker)');
          }
        }
      } catch (dsErr) {
        console.warn('DealerSocket work note insert failed (leadworker):', dsErr?.message || dsErr);
      }

      // Trigger follow-up system
      if(autoReplyEnabled){
        if (statusJustChanged) {
          await onLeadStatusChange(lead._id);
        } else {
          const job = await FollowUpJob.findOne({ leadId: lead._id });
          if (job) {
            await onFollowUpEvent(job);
          } else {
            await onLeadStatusChange(lead._id);
          }
        }
      }

      return { success: true, leadId: lead._id };
    }
  } catch (error) {
    console.error('Lead processing error:', error);
    throw error;
  }
};

async function callsmsOllama(leadData) {
    //const url = 'http://olama.jugaadtravel.com:5678/webhook/incoming-lead-messages';
    const url = process.env.N8N_SMS_API
  
  // Format
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          // Add authentication if required:
          // 'Authorization': `Bearer ${process.env.OLLAMA_KEY}`
        },
        body: JSON.stringify({
          leadData,
          timestamp: new Date().toISOString()
        })
      });
  
      if (!response.ok) {
        // More detailed error logging:
        console.error('Ollama API Error:', {
          status: response.status,
          statusText: response.statusText,
          url: response.url
        });
        const errorBody = await response.text();
        console.error('Error response body:', errorBody);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      return await response.json();
    } catch (error) {
      console.error('Full error calling Ollama API:', {
        error: error.message,
        stack: error.stack,
        endpoint: url,
        payload: leadData
      });
      // Fallback response when API fails
      return {
        response: 'Thank you for contacting us. We will get back to you soon.',
        fe_lead_status: 'Lead'
      };
    }
}

async function callOllama( currentEmail) {
 
  const url =  process.env.N8N_LEAD_API;
  const payload = {
    conversationThread: [currentEmail.currentSMS],
    currentEmail: currentEmail.currentSMS
  };

  console.log('Sending payload:', payload);

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

function formatBookingTime(timeStr) {
  if (!timeStr) return null;
  
  // Convert time to 24-hour format if needed
  if (timeStr.match(/^\d{1,2}\s?(AM|PM)$/i)) {
    const [hour, period] = timeStr.split(/(?=[AP]M)/i);
    let hours = parseInt(hour);
    const isPM = period.trim().toUpperCase() === 'PM';
    
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
    
    return `${hours.toString().padStart(2, '0')}:00`;
  }
  
  return timeStr;
}
async function stripTagsRegex(html) {
  if (typeof html !== 'string') return '';
  return html.replace(/<\/?[^>]+(>|$)/g, '');
}

export const setupLeadWorker = (redis) => {
  const worker = new Worker('leadProcessingQueue', processLead, { 
    connection: redis,
    concurrency: 5
  });

  worker.on('completed', (job) => {
    console.log(`[leadProcessingQueue] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[leadProcessingQueue] Job ${job.id} failed:`, err);
  });

  return worker;
};
