// app/api/leads/status/route.js
import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb.js";
import Lead from "@models/Lead.js";
import User from "@models/User.js";
import { onLeadStatusChange, clearPendingJobs } from '@lib/followupService.js';
import { notifyAiOfStaffStatus } from '@lib/ai/aiStaff';
import { createAppointmentReminders, createManagerialReviewMessages, cancelAllRemindersForLead } from '@lib/appointmentReminderService.js';
import { appointmentBookingTemplate } from '@lib/templates/appointmentBookingTemplate.js';
import { appointmentUpdateTemplate } from '@lib/templates/appointmentUpdateTemplate.js';
import { appointmentBookingSMSTemplate, appointmentUpdateSMSTemplate } from '@lib/templates/appointmentSMSTemplate.js';
import { noShowEmailTemplate, noShowSMSTemplate } from '@lib/templates/noShowTemplate.js';
import { sendEmail } from '@lib/email.js';
import { sendSMS } from '@lib/sms.js';
import moment from 'moment-timezone';
import Email from '@models/Email.js';
import jwt from 'jsonwebtoken';
import {
  normalizeUserLanguage,
  toDisplayLanguageName,
  translateReminderBundle,
} from '@lib/serverTranslateOutgoing.js';

// Helper function to strip HTML tags, CSS, and extract only plain text content
function stripTagsRegex(html) {
  if (typeof html !== 'string') return '';
  
  let text = html;
  
  // Remove style blocks (CSS) completely
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Remove script blocks
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  
  // Remove DOCTYPE declarations
  text = text.replace(/<!DOCTYPE[^>]*>/gi, '');
  
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  
  // Remove head and meta tags
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
  text = text.replace(/<meta[^>]*>/gi, '');
  text = text.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '');
  
  // Remove all HTML tags but preserve line breaks for readability
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  
  // Remove all remaining HTML tags
  text = text.replace(/<\/?[^>]+(>|$)/g, '');
  
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&apos;/g, "'");
  text = text.replace(/&#8217;/g, "'");
  text = text.replace(/&#8211;/g, '-');
  text = text.replace(/&#8212;/g, '--');
  
  // Clean up: remove multiple consecutive newlines (max 2)
  text = text.replace(/\n{3,}/g, '\n\n');
  
  // Clean up: remove multiple consecutive spaces
  text = text.replace(/[ \t]+/g, ' ');
  
  // Trim each line and remove empty lines at start/end
  text = text.split('\n').map(line => line.trim()).filter(line => line.length > 0).join('\n');
  
  return text.trim();
}

// Helper function to find latest message in conversation thread
async function findLatestMessageInThread(leadId) {
  try {
    const latestMessage = await Email.findOne({ 
      lead_id: leadId,
      $or: [
        { is_note: { $exists: false } },
        { is_note: false }
      ]
    })
    .sort({ timestamp: -1 })
    .limit(1);
    
    return latestMessage;
  } catch (error) {
    console.error('Error finding latest message:', error);
    return null;
  }
}

async function translateStatusNotification({ lastComm, lead, subject, emailHtml, smsText }) {
  const targetLangRaw = lastComm?.user_language ?? lead?.user_language;
  if (normalizeUserLanguage(targetLangRaw) === 'english') {
    return { subject, emailHtml, smsText };
  }

  try {
    return await translateReminderBundle({
      targetLanguage: toDisplayLanguageName(targetLangRaw),
      sourceHint: '',
      subject,
      emailHtml,
      smsText,
    });
  } catch (err) {
    console.warn('Status notification translation failed, using original content:', err?.message || err);
    return { subject, emailHtml, smsText };
  }
}

// Helper function to create conversation record for appointment notifications
async function createAppointmentNotificationRecord(leadId, dealerId, messageType, content, subject, communicationType, sentMessageId, message_by, status = 'sent') {
  try {
    const latestMessage = await findLatestMessageInThread(leadId);
    let parentMessageId = latestMessage ? latestMessage.parent_message_id??latestMessage.message_id : null;
    if(!parentMessageId){
      parentMessageId = latestMessage?.message_id || null;
    }
    // Get lead information for recipient
    const lead = await Lead.findById(leadId);
    if (!lead) {
      console.error(`Lead ${leadId} not found for appointment notification record`);
      return null;
    }
    
    // Get dealer information for sender
    const dealer = await User.findById(dealerId);
    if (!dealer) {
      console.error(`Dealer ${dealerId} not found for appointment notification record`);
      return null;
    }
    
    // Determine sender and recipient based on communication type
    let sender = null;
    let recipient = null;
    
    if (communicationType === 'email') {
      // Get dealer email account
      const EmailAccount = (await import('@models/EmailAccount.js')).default;
      const dealerEmailAccount = await EmailAccount.findOne({ dealer_id: dealerId });
      sender = dealerEmailAccount?.email_address || dealer.email || null;
      recipient = lead.email || null;
    } else if (communicationType === 'sms') {
      // Get dealer SMS phone
      const dealerInfo = dealer.dealer_account_information || {};
      sender = dealerInfo.sms_conversion_phone || dealerInfo.dealer_phone || dealer.phone || null;
      recipient = lead.phone || null;
    }
    
    // Set parent_conversation - use parent_message_id if available, otherwise use message_id, otherwise null
    const parentConversation = parentMessageId || latestMessage?.message_id || null;
    
    const notificationRecord = new Email({
      message_id: sentMessageId || `appointment-${Date.now()}`,
      parent_message_id: parentMessageId,
      parent_conversation: latestMessage?.message_id || null,
      sender: sender || 'system',
      recipient: recipient || 'customer',
      subject: communicationType === 'email' ? subject : undefined,
      mail_content: content,
      communication_type: communicationType,
      status: status,
      dealer_id: dealerId,
      lead_id: leadId,
      message_by: message_by,
      date: new Date(),
      timestamp: new Date(),
      is_appointment_notification: true,
      appointment_notification_type: messageType // 'booking' or 'update'
    });
    
    await notificationRecord.save();
    console.log(`Appointment ${messageType} ${communicationType} notification saved to conversation thread (sender: ${sender}, recipient: ${recipient})`);
    return notificationRecord;
  } catch (error) {
    console.error('Error creating appointment notification record:', error);
    return null;
  }
}

export async function PUT(request) {
  let messageBy = null; // Default to null (system message)
  try {
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const currentUser = await User.findById(decoded.userId).select('_id name email type');
      // Set message_by to user ID for authenticated users
      if (currentUser) {
        messageBy = currentUser._id;
      }else{
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
    }else{
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }
  } catch (err) {
    console.warn("Token verification failed in reply route:", err.message);
    // Continue without token - messageBy will remain null
  }
  try {
    const { id, status, booking_date, booking_time } = await request.json();
    console.log('Lead status update payload:', { id, status, booking_date, booking_time });

    if (!id || !status) {
      return NextResponse.json(
        { error: "Missing `id` or `status` in request body" },
        { status: 400 }
      );
    }

    await dbConnect();

    // Get the lead first (need dealer_id for timezone when interpreting booking_date/booking_time)
    const originalLead = await Lead.findById(id);
    if (!originalLead) {
      return NextResponse.json(
        { error: "Lead not found" },
        { status: 404 }
      );
    }

    const updateDoc = {
      status,
      lead_status: status,
      fe_lead_status: status,
      statusChangedAt: new Date()
    };

    // When appointment booked, persist booking fields if provided.
    // booking_date and booking_time are always in the dealer's timezone (not UTC).
    if (status === 'Appointment Booked') {
      const dealer = await User.findById(originalLead.dealer_id).select('dealer_account_information');
      const dealerTimezone = dealer?.dealer_account_information?.time_zone || 'America/New_York';

      updateDoc.booking = updateDoc.booking || {};
      // Normalize booking_time as HH:mm (from input type="time")
      if (booking_time) {
        const [hh, mm] = booking_time.split(":");
        if (!isNaN(parseInt(hh)) && !isNaN(parseInt(mm))) {
          updateDoc.booking.booking_time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        }
      }
      // Interpret booking_date and booking_time in dealer timezone; store UTC for consistency
      if (booking_date) {
        const startOfDayInDealerTz = moment.tz(booking_date, 'YYYY-MM-DD', dealerTimezone);
        if (startOfDayInDealerTz.isValid()) {
          updateDoc.booking.booking_date = startOfDayInDealerTz.utc().toDate();
        }
      }
      if (booking_date && booking_time) {
        const bookingMoment = moment.tz(
          `${booking_date} ${updateDoc.booking.booking_time || booking_time}`,
          'YYYY-MM-DD HH:mm',
          dealerTimezone
        );
        if (bookingMoment.isValid()) {
          updateDoc.booking.booking_at = bookingMoment.utc().toDate();
        }
      }
      updateDoc.booking_status = true;
    }
    console.log('Update document:', updateDoc);

    const updated = await Lead.findByIdAndUpdate(
      id,
      updateDoc,
      { new: true, runValidators: true }
    );

    if (!updated) {
      return NextResponse.json(
        { error: "Lead not found" },
        { status: 404 }
      );
    }

    // Cancel all pending reminders and follow-ups for this lead FIRST (before creating new ones)
    try {
      await cancelAllRemindersForLead(id);
      await clearPendingJobs(id);
      console.log(`Cancelled all pending reminders and follow-ups for lead ${id}`);
    } catch (cancelError) {
      console.error('Error cancelling pending reminders/follow-ups:', cancelError);
      // Don't fail the entire request if cancellation fails
    }

    // Create appointment reminders if booking was created/updated
    if (status === 'Appointment Booked' && (booking_date || booking_time)) {
      try {
        // Pass the original booking_date string (already in dealer timezone) instead of the converted Date object
        // This prevents timezone conversion issues - the input is already in dealer timezone
        const bookingData = {
          _id: updated._id,
          customer_name: updated.name,
          customer_email: updated.email,
          customer_phone: updated.phone,
          booking_date: booking_date, // Use original string (already in dealer timezone)
          time: booking_time // Use original string (already in dealer timezone)
        };
        const reminderResult = await createAppointmentReminders(bookingData, updated.dealer_id);
        console.log('Appointment reminders created from lead status update:', reminderResult);
      } catch (reminderError) {
        console.error('Error creating appointment reminders from lead status update:', reminderError);
      }
    }

    // Send appointment booking/update notifications
    if (status === 'Appointment Booked' && (booking_date || booking_time)) {
      try {
        // Get dealer information
        const dealer = await User.findById(updated.dealer_id);
        if (!dealer) {
          console.error('Dealer not found for appointment notification');
          return NextResponse.json({ error: "Dealer not found" }, { status: 404 });
        }

        const dealerInfo = dealer.dealer_account_information || {};
        const dealerName = dealerInfo.name || 'Our Dealership';
        const dealerPhone = dealerInfo.dealer_phone || dealerInfo.sms_conversion_phone || 'N/A';
        const dealerAddress = dealerInfo.dealer_street_address || '';
        
        // Format appointment date and time (new values)
        const appointmentDate = moment(updateDoc.booking?.booking_date || booking_date).format('dddd, MMMM Do, YYYY');
        const appointmentTime = updateDoc.booking?.booking_time || booking_time;
        
        // Check if this is a new booking or an update (using originalLead which has old values)
        const isUpdate = originalLead?.booking?.booking_date || originalLead?.booking?.booking_time;
        
        if (isUpdate) {
          // This is an appointment update
          const oldDate = originalLead.booking?.booking_date ? 
            moment(originalLead.booking.booking_date).format('dddd, MMMM Do, YYYY') : 'Not set';
          const oldTime = originalLead.booking?.booking_time || 'Not set';
          
          // Get the last communication to set parent_message_id and determine communication type (excluding notes)
          const lastComm = await Email
            .findOne({ 
              lead_id: updated._id,
              $or: [
                { is_note: { $exists: false } },
                { is_note: false }
              ]
            })
            .sort({ date: -1 });
          
          const parent_message_id = lastComm?.parent_message_id || lastComm?.message_id || null;
          const communicationType = lastComm?.communication_type; // 'email' or 'sms'
          
          // Determine what to send based on last communication type
          const shouldSendEmail = communicationType === 'email' || (!lastComm && updated.email);
          const shouldSendSMS = communicationType === 'sms' || (!lastComm && updated.phone);
          
          // Send email notification if last communication was email (or no previous communication)
          if (shouldSendEmail && updated.email) {
            const emailTemplate = appointmentUpdateTemplate(
              updated.name || 'Customer',
              oldDate,
              oldTime,
              appointmentDate,
              appointmentTime,
              dealerName,
              dealerPhone,
              dealerAddress
            );
            const translatedEmail = await translateStatusNotification({
              lastComm,
              lead: updated,
              subject: emailTemplate.subject,
              emailHtml: emailTemplate.html,
              smsText: '',
            });
            
            // Get dealer email account
            const EmailAccount = (await import('@models/EmailAccount.js')).default;
            const dealerEmailAccount = await EmailAccount.findOne({ dealer_id: updated.dealer_id });
            const dealerEmail = dealerEmailAccount?.email_address || null;
            let sentMessageId;
            let messageStatus = 'sent';
            try{
              sentMessageId = await sendEmail(
                updated.email,
                translatedEmail.subject,
                translatedEmail.emailHtml,
                dealerEmail,
                lastComm?.message_id,
                dealer
              );
              messageStatus = 'sent';
            }catch(error){
              sentMessageId = `email-${Date.now()}`
              messageStatus = 'failed';
              console.error('Appointment update email failed:', error);
            }
            console.log('Appointment update email sent to:', updated.email);
            
            // Save to conversation thread (save plain text instead of HTML)
            const emailTextContent = stripTagsRegex(translatedEmail.emailHtml);
            await createAppointmentNotificationRecord(
              updated._id,
              updated.dealer_id,
              'update',
              emailTextContent,
              translatedEmail.subject,
              'email',
              sentMessageId,
              messageBy,
              messageStatus
            );
          }
          
          // Send SMS notification if last communication was SMS (or no previous communication)
          if (shouldSendSMS && updated.phone) {
            
              const smsMessage = appointmentUpdateSMSTemplate(
                updated.name || 'Customer',
                oldDate,
                oldTime,
                appointmentDate,
                appointmentTime,
                dealerName,
                dealerPhone
              );
            const translatedSms = await translateStatusNotification({
              lastComm,
              lead: updated,
              subject: '',
              emailHtml: '',
              smsText: smsMessage,
            });

            let sentMessageId;
            let messageStatus = 'sent';
            try{
              sentMessageId = await sendSMS(updated.phone, translatedSms.smsText, dealer);
              messageStatus = 'sent';
              console.log('Appointment update SMS sent to:', updated.phone);
            }catch(error){
              sentMessageId = `sms-${Date.now()}`
              messageStatus = 'failed';
              console.error('Appointment update SMS failed sent to:', updated.phone, error);
            }
           
            
            // Save to conversation thread
            await createAppointmentNotificationRecord(
              updated._id,
              updated.dealer_id,
              'update',
              translatedSms.smsText,
              undefined,
              'sms',
              sentMessageId,
              messageBy,
              messageStatus
            );
          }
        } else {
          // This is a new appointment booking
          
          // Get the last communication to set parent_message_id and determine communication type (excluding notes)
          const lastComm = await Email
            .findOne({ 
              lead_id: updated._id,
              $or: [
                { is_note: { $exists: false } },
                { is_note: false }
              ]
            })
            .sort({ date: -1 });
          console.log(lastComm,'lastComm');
          
          const parent_message_id = lastComm?.parent_message_id || lastComm?.message_id || null;
          const communicationType = lastComm?.communication_type; // 'email' or 'sms'
          
          // Determine what to send based on last communication type
          const shouldSendEmail = communicationType === 'email' || (!lastComm && updated.email);
          const shouldSendSMS = communicationType === 'sms' || (!lastComm && updated.phone);
          
          // Send email notification if last communication was email (or no previous communication)
          if (shouldSendEmail && updated.email) {
            const emailTemplate = appointmentBookingTemplate(
              updated.name || 'Customer',
              appointmentDate,
              appointmentTime,
              dealerName,
              dealerPhone,
              dealerAddress
            );
            const translatedEmail = await translateStatusNotification({
              lastComm,
              lead: updated,
              subject: emailTemplate.subject,
              emailHtml: emailTemplate.html,
              smsText: '',
            });
            
            // Get dealer email account
            const EmailAccount = (await import('@models/EmailAccount.js')).default;
            const dealerEmailAccount = await EmailAccount.findOne({ dealer_id: updated.dealer_id });
            const dealerEmail = dealerEmailAccount?.email_address || null;
            
            let sentMessageId;
            let messageStatus = 'sent';
            try{
              sentMessageId = await sendEmail(
                updated.email,
                translatedEmail.subject,
                translatedEmail.emailHtml,
                dealerEmail,
                lastComm?.message_id || null,
                dealer
              );
              messageStatus = 'sent';
            }catch(error){
              sentMessageId = `email-${Date.now()}`
              messageStatus = 'failed';
              console.error('Appointment booking email failed:', error);
            }

            console.log('Appointment booking email sent to:', updated.email);
            
            // Save to conversation thread (save plain text instead of HTML)
            const emailTextContent = stripTagsRegex(translatedEmail.emailHtml);
            await createAppointmentNotificationRecord(
              updated._id,
              updated.dealer_id,
              'booking',
              emailTextContent,
              translatedEmail.subject,
              'email',
              sentMessageId,
              messageBy,
              messageStatus
            );
          }
          
          // Send SMS notification if last communication was SMS (or no previous communication)
          if (shouldSendSMS && updated.phone) {
            const smsMessage = appointmentBookingSMSTemplate(
              updated.name || 'Customer',
              appointmentDate,
              appointmentTime,
              dealerName,
              dealerPhone
            );
            const translatedSms = await translateStatusNotification({
              lastComm,
              lead: updated,
              subject: '',
              emailHtml: '',
              smsText: smsMessage,
            });
            
            let sentMessageId;
            let messageStatus = 'sent';
            try{
              sentMessageId = await sendSMS(updated.phone, translatedSms.smsText, dealer);
              messageStatus = 'sent';
              console.log('Appointment booking SMS sent to:', updated.phone);
            }catch(error){
              sentMessageId = `sms-${Date.now()}`
              messageStatus = 'failed';
              console.error('Appointment booking SMS failed sent to:', updated.phone, error);
            }
            
            // Save to conversation thread
            await createAppointmentNotificationRecord(
              updated._id,
              updated.dealer_id,
              'booking',
              translatedSms.smsText,
              undefined,
              'sms',
              sentMessageId,
              messageBy,
              messageStatus
            );
          }
        }
      } catch (notificationError) {
        console.error('Error sending appointment notifications:', notificationError);
        // Don't fail the entire request if notifications fail
      }
    }

    // Create managerial review messages if status changed to "Managerial Review"
    if (status === 'Managerial Review') {
      try {
        const reviewResult = await createManagerialReviewMessages(updated._id, updated.dealer_id);
        console.log('Managerial review messages created from lead status update:', reviewResult);
      } catch (reviewError) {
        console.error('Error creating managerial review messages from lead status update:', reviewError);
      }
    }

    // Send No-Show message if status changed to "No Show"
    if (status === 'No Show') {
      try {
        // Get dealer information
        const dealer = await User.findById(updated.dealer_id);
        if (!dealer) {
          console.error('Dealer not found for no-show notification');
        } else {
          const dealerInfo = dealer.dealer_account_information || {};
          const dealerName = dealerInfo.dealer_name || dealer.name || 'Our Dealership';
          const dealerUrl = dealer.website || dealerInfo.dealer_url || '';
          
          // Get vehicle model from lead
          const vehicleModel = updated.vehicle_model || '';
          
          // Extract first name from customer name
          const firstName = updated.name ? updated.name.split(' ')[0] : 'there';
          
          // Get the last communication to set parent_message_id and determine communication type (excluding notes)
          const lastComm = await Email
            .findOne({ 
              lead_id: updated._id,
              $or: [
                { is_note: { $exists: false } },
                { is_note: false }
              ]
            })
            .sort({ date: -1 });
          
          const parent_message_id = lastComm?.parent_message_id || lastComm?.message_id || null;
          const communicationType = lastComm?.communication_type; // 'email' or 'sms'
          
          // Determine what to send based on last communication type
          const shouldSendEmail = communicationType === 'email' || (!lastComm && updated.email);
          const shouldSendSMS = communicationType === 'sms' || (!lastComm && updated.phone);
          
          // Send email notification if last communication was email (or no previous communication)
          if (shouldSendEmail && updated.email) {
            const emailTemplate = noShowEmailTemplate(
              firstName,
              vehicleModel,
              dealerName,
              dealerUrl
            );
            const translatedEmail = await translateStatusNotification({
              lastComm,
              lead: updated,
              subject: emailTemplate.subject,
              emailHtml: emailTemplate.html,
              smsText: '',
            });
            
            // Get dealer email account
            const EmailAccount = (await import('@models/EmailAccount.js')).default;
            const dealerEmailAccount = await EmailAccount.findOne({ dealer_id: updated.dealer_id });
            const dealerEmail = dealerEmailAccount?.email_address || null;
            
            if (dealerEmail) {
              let sentMessageId;
              let messageStatus = 'sent';
              try{
                sentMessageId = await sendEmail(
                  updated.email,
                  translatedEmail.subject,
                  translatedEmail.emailHtml,
                  dealerEmail,
                  lastComm?.message_id,
                  dealer
                );
                messageStatus = 'sent';
                console.log('No-show email sent to:', updated.email);
              }catch(error){
                sentMessageId = `email-${Date.now()}`
                messageStatus = 'failed';
                console.error('No-show email failed sent to:', updated.email, error);
              }
              
              // Save to conversation thread (save plain text instead of HTML)
              const emailTextContent = stripTagsRegex(translatedEmail.emailHtml);

              await createAppointmentNotificationRecord(
                updated._id,
                updated.dealer_id,
                'no-show',
                emailTextContent,
                translatedEmail.subject,
                'email',
                sentMessageId,
                messageBy,
                messageStatus
              );
            }
          }
          
          // Send SMS notification if last communication was SMS (or no previous communication)
          if (shouldSendSMS && updated.phone) {
            const smsMessage = noShowSMSTemplate(firstName, dealerName, dealerUrl);
            const translatedSms = await translateStatusNotification({
              lastComm,
              lead: updated,
              subject: '',
              emailHtml: '',
              smsText: smsMessage,
            });
            let sentMessageId;
            let messageStatus = 'sent';
            try{
            sentMessageId = await sendSMS(updated.phone, translatedSms.smsText, dealer);
            messageStatus = 'sent';
            console.log('No-show SMS sent to:', updated.phone);
            }catch(error){
              sentMessageId = `sms-${Date.now()}`
              messageStatus = 'failed';
              console.error('No-show SMS failed sent to:', updated.phone, error);
            }
            // Save to conversation thread
            await createAppointmentNotificationRecord(
              updated._id,
              updated.dealer_id,
              'no-show',
              translatedSms.smsText,
              undefined,
              'sms',
              sentMessageId,
              messageBy,
              messageStatus
            );
          }
        }
      } catch (noShowError) {
        console.error('Error sending no-show notifications:', noShowError);
        // Don't fail the entire request if notifications fail
      }
    }

    await onLeadStatusChange(id);

    // Booked / visited / sold / DND / managerial review: staff own this lead
    // now, so the AI stops replying to it (MASTER_PLAN_1 Stage 11). Never throws.
    await notifyAiOfStaffStatus({ leadId: id, dealerId: updated.dealer_id, status });

    return NextResponse.json({ lead: updated }, { status: 200 });
  } catch (err) {
    console.error("PUT /api/leads/status error:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
