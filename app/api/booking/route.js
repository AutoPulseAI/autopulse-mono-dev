import Booking from '@models/Booking';
import Lead from '@models/Lead';
import FollowUpJob from '@models/FollowUpJob';
import User from '@models/User';
import Email from '@models/Email';
import dbConnect from "@lib/mongodb";

import { onLeadStatusChange ,onFollowUpEvent} from '@lib/followupService.js';
import { createAppointmentReminders } from '@lib/appointmentReminderService';
import { appointmentBookingTemplate } from '@lib/templates/appointmentBookingTemplate.js';
import { appointmentBookingSMSTemplate } from '@lib/templates/appointmentSMSTemplate.js';
import { sendEmail } from '@lib/email.js';
import { sendSMS } from '@lib/sms.js';
import moment from 'moment-timezone';
import jwt from 'jsonwebtoken';
import {
  normalizeUserLanguage,
  toDisplayLanguageName,
  translateReminderBundle,
} from '@lib/serverTranslateOutgoing.js';

const BOOKING_TIMEZONE_DEBUG = String(process.env.BOOKING_TIMEZONE_DEBUG || '').toLowerCase() === 'true';

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

async function translateBookingNotification({ lastComm, lead, subject, emailHtml, smsText }) {
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
    console.warn('Booking notification translation failed, using original content:', err?.message || err);
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

export async function POST(request) {
  await dbConnect();

  try {
    const body = await request.json();
    const { 
      dealer_id, 
      lead_id, 
      customerName, 
      email, 
      phone, 
      bookingDate, 
      bookingTime, 
      notes,
      
    } = body;
    const booking_status = true;
    const fe_lead_status = 'Appointment Booked';
    const existingLead = await Lead.findById(lead_id);
    
    if (!existingLead) {
      return new Response(JSON.stringify({ error: 'Lead not found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(existingLead);
    // Initialize updates object
    const updates = {};
    let statusJustChanged = false;

    if (fe_lead_status && fe_lead_status !== existingLead.fe_lead_status) {
      statusJustChanged = true;
      updates.fe_lead_status = fe_lead_status;
    }

    // Resolve dealer timezone once for booking date normalization/formatting
    const dealerDoc = dealer_id
      ? await User.findById(dealer_id).select('dealer_account_information name phone website')
      : null;
    const dealerTimezone = dealerDoc?.dealer_account_information?.time_zone || 'America/New_York';

    // Handle booking status updates
    if (fe_lead_status === 'Appointment Booked') {
      updates.booking_status = booking_status || 'pending';
      
      // Process booking date and time if provided
      if (bookingDate || bookingTime) {
        updates.booking = {};
        
        // Process booking date
        if (bookingDate) {
          const bookingDateLocal = moment.tz(String(bookingDate), 'YYYY-MM-DD', dealerTimezone);
          if (bookingDateLocal.isValid()) {
            // Persist date as dealer-local midnight converted to UTC Date.
            updates.booking.booking_date = bookingDateLocal.startOf('day').utc().toDate();
          }
        }
        
        // Process booking time
        if (bookingTime) {
          let formattedTime = bookingTime;
          // Convert time to 24-hour format if needed
          if (bookingTime.match(/^\d{1,2}\s?(AM|PM)$/i)) {
            const [hour, period] = bookingTime.split(/(?=[AP]M)/i);
            let hours = parseInt(hour);
            const isPM = period.trim().toUpperCase() === 'PM';
            
            if (isPM && hours < 12) hours += 12;
            if (!isPM && hours === 12) hours = 0;
            
            formattedTime = `${hours.toString().padStart(2, '0')}:00`;
          }
          updates.booking.booking_time = formattedTime;
        }
      }

      // Update lead with booking information
      if (Object.keys(updates).length > 0) {
        await Lead.findByIdAndUpdate(
          existingLead._id, 
          { $set: updates },
          { new: true }
        );
      }
    }
    console.log(updates);

    // Create new booking
    const booking = new Booking({
      dealer_id,
      lead_id,
      customerName,
      email,
      phone,
      bookingDate: updates.booking?.booking_date || (bookingDate ? moment.tz(String(bookingDate), 'YYYY-MM-DD', dealerTimezone).startOf('day').utc().toDate() : undefined),
      bookingTime: updates.booking?.booking_time || bookingTime,
      notes,
     // booking_status: updates.booking_status || 'pending'
    });

    await booking.save();

    // Update lead with booking reference
    await Lead.findByIdAndUpdate(
      lead_id,
      { 
        $set: { 
          'data.bookingId': booking._id,
          status: 'Appointment Booked',
          statusChangedAt: new Date()
        }
      }
    );

    // Create appointment reminders for this booking
    try {
      // Format booking data for createAppointmentReminders function
      const bookingData = {
        _id: existingLead._id,
        customer_name: customerName || existingLead.name,
        customer_email: email || existingLead.email,
        customer_phone: phone || existingLead.phone,
        booking_date: bookingDate, // Use original string (already in dealer timezone)
        time: bookingTime // Use original string (already in dealer timezone)
      };
      const reminderResult = await createAppointmentReminders(bookingData, dealer_id);
      console.log('Appointment reminders created:', reminderResult);
    } catch (reminderError) {
      console.error('Error creating appointment reminders:', reminderError);
      // Don't fail the booking creation if reminders fail
    }

    // Send appointment booking notifications (email/SMS) and save to conversation
    try {
      // Get authorization token for message_by
      let messageBy = null;
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const currentUser = await User.findById(decoded.userId).select('_id name email type');
          if (currentUser) {
            messageBy = currentUser._id;
          }
        } catch (err) {
          console.warn("Token verification failed:", err.message);
        }
      }

      // Get dealer information
      const dealer = dealerDoc || await User.findById(dealer_id);
      if (dealer && existingLead) {
        const dealerInfo = dealer.dealer_account_information || {};
        const dealerName = dealerInfo.name || 'Our Dealership';
        const dealerPhone = dealerInfo.dealer_phone || dealerInfo.sms_conversion_phone || 'N/A';
        const dealerAddress = dealerInfo.dealer_street_address || '';
        
        // Format appointment date and time
        const appointmentDate = bookingDate
          ? moment.tz(String(bookingDate), 'YYYY-MM-DD', dealerTimezone).format('dddd, MMMM Do, YYYY')
          : moment(booking.bookingDate).tz(dealerTimezone).format('dddd, MMMM Do, YYYY');
        const appointmentTime = booking.bookingTime;

        if (BOOKING_TIMEZONE_DEBUG) {
          console.log('BOOKING_TZ_DEBUG', {
            leadId: String(existingLead._id),
            dealerId: String(dealer_id),
            dealerTimezone,
            inputBookingDate: bookingDate || null,
            storedBookingDateISO: booking?.bookingDate ? new Date(booking.bookingDate).toISOString() : null,
            renderedAppointmentDate: appointmentDate,
            appointmentTime,
          });
        }
        
        // Get the last communication to determine communication type
        const lastComm = await Email
          .findOne({ 
            lead_id: existingLead._id,
            $or: [
              { is_note: { $exists: false } },
              { is_note: false }
            ]
          })
          .sort({ date: -1 });
        
        const communicationType = lastComm?.communication_type;
        
        // Determine what to send based on last communication type
        const shouldSendEmail = communicationType === 'email' || (!lastComm && existingLead.email);
        const shouldSendSMS = communicationType === 'sms' || (!lastComm && existingLead.phone);
        
        // Send email notification
        if (shouldSendEmail && existingLead.email) {
          const emailTemplate = appointmentBookingTemplate(
            customerName || existingLead.name || 'Customer',
            appointmentDate,
            appointmentTime,
            dealerName,
            dealerPhone,
            dealerAddress
          );
          const translatedEmail = await translateBookingNotification({
            lastComm,
            lead: existingLead,
            subject: emailTemplate.subject,
            emailHtml: emailTemplate.html,
            smsText: '',
          });
          
          // Get dealer email account
          const EmailAccount = (await import('@models/EmailAccount.js')).default;
          const dealerEmailAccount = await EmailAccount.findOne({ dealer_id: dealer_id });
          const dealerEmail = dealerEmailAccount?.email_address || null;
          
          let sentMessageId;
          let messageStatus = 'sent';
          try {
            sentMessageId = await sendEmail(
              existingLead.email,
              translatedEmail.subject,
              translatedEmail.emailHtml,
              dealerEmail,
              lastComm?.message_id || null,
              dealer
            );
            messageStatus = 'sent';
            console.log('Appointment booking email sent to:', existingLead.email);
          } catch (error) {
            sentMessageId = `email-${Date.now()}`;
            messageStatus = 'failed';
            console.error('Appointment booking email failed:', error);
          }
          
          // Save to conversation thread
          const emailTextContent = stripTagsRegex(translatedEmail.emailHtml);
          await createAppointmentNotificationRecord(
            existingLead._id,
            dealer_id,
            'booking',
            emailTextContent,
            translatedEmail.subject,
            'email',
            sentMessageId,
            messageBy,
            messageStatus
          );
        }
        
        // Send SMS notification
        if (shouldSendSMS && existingLead.phone) {
          const smsMessage = appointmentBookingSMSTemplate(
            customerName || existingLead.name || 'Customer',
            appointmentDate,
            appointmentTime,
            dealerName,
            dealerPhone
          );
          const translatedSms = await translateBookingNotification({
            lastComm,
            lead: existingLead,
            subject: '',
            emailHtml: '',
            smsText: smsMessage,
          });
          
          let sentMessageId;
          let messageStatus = 'sent';
          try {
            sentMessageId = await sendSMS(existingLead.phone, translatedSms.smsText, dealer);
            messageStatus = 'sent';
            console.log('Appointment booking SMS sent to:', existingLead.phone);
          } catch (error) {
            sentMessageId = `sms-${Date.now()}`;
            messageStatus = 'failed';
            console.error('Appointment booking SMS failed:', error);
          }
          
          // Save to conversation thread
          await createAppointmentNotificationRecord(
            existingLead._id,
            dealer_id,
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
      // Don't fail the booking creation if notifications fail
    }

    // Handle status change events
    if (lead_id && statusJustChanged) {
      await onLeadStatusChange(lead_id);
    } else if (lead_id) {
      const job = await FollowUpJob.findOne({ leadId: lead_id });
      if (job) {
        await onFollowUpEvent(job);
      } else {
        await onLeadStatusChange(lead_id);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      booking,
      leadUpdated: statusJustChanged
    }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Booking creation error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}

export async function GET(request) {
  await dbConnect();

  try {
    const { searchParams } = new URL(request.url);
    const lead_id = searchParams.get('lead_id');
    
    if (!lead_id) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    const lead = await Lead.findById(lead_id);
    if (!lead) {
      return new Response(JSON.stringify({ error: 'Lead not found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    return new Response(JSON.stringify({
      customerName: lead.name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      ...(lead.data?.booking ? {
        bookingDate: lead.data.booking.booking_date,
        bookingTime: lead.data.booking.booking_time
      } : {})
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Lead fetch error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}

export async function PUT(request) {
  await dbConnect();

  try {
    const body = await request.json();
    const { bookingId, booking_status, booking_date, booking_time } = body;

    const updates = {};
    const existingBooking = bookingId ? await Booking.findById(bookingId).select('dealer_id') : null;
    const dealerDoc = existingBooking?.dealer_id
      ? await User.findById(existingBooking.dealer_id).select('dealer_account_information')
      : null;
    const dealerTimezone = dealerDoc?.dealer_account_information?.time_zone || 'America/New_York';

    if (booking_status !== undefined) {
      updates.booking_status = booking_status;
      
      if (booking_date || booking_time) {
        updates.booking = {};
        
        // Process booking date
        if (booking_date) {
          const bookingDateLocal = moment.tz(String(booking_date), 'YYYY-MM-DD', dealerTimezone);
          if (bookingDateLocal.isValid()) {
            const normalizedDate = bookingDateLocal.startOf('day').utc().toDate();
            updates.booking.booking_date = normalizedDate;
            updates.bookingDate = normalizedDate;
          }
        }
        
        // Process booking time
        if (booking_time) {
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
          updates.bookingTime = formattedTime;
        }
      }
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      bookingId,
      { $set: updates },
      { new: true }
    );

    if (!updatedBooking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    // Update the lead's booking reference
    if (updates.booking) {
      await Lead.findOneAndUpdate(
        { 'data.bookingId': bookingId },
        { $set: { 'data.booking': updates.booking } }
      );
    }

    // Recreate appointment reminders if booking date/time changed
    if (updates.booking && (updates.booking.booking_date || updates.booking.booking_time)) {
      try {
        // Format booking data for createAppointmentReminders function
        const bookingData = {
          _id: updatedBooking.lead_id,
          customer_name: updatedBooking.customerName,
          customer_email: updatedBooking.email,
          customer_phone: updatedBooking.phone,
          booking_date: booking_date, // Use original string (already in dealer timezone)
          time: booking_time // Use original string (already in dealer timezone)
        };
        const reminderResult = await createAppointmentReminders(bookingData, updatedBooking.dealer_id);
        console.log('Appointment reminders updated:', reminderResult);
      } catch (reminderError) {
        console.error('Error updating appointment reminders:', reminderError);
        // Don't fail the booking update if reminders fail
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      booking: updatedBooking 
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Booking update error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}