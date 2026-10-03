import Booking from '@models/Booking';
import Lead from '@models/Lead';
import FollowUpJob from '@models/FollowUpJob';
import User from '@models/User';
import Email from '@models/Email';
import dbConnect from "@lib/mongodb";
import mongoose from 'mongoose';

// Callers: staff (signed in), the public customer booking page, and the AI
// service with the shared secret (agentic-upsell LivePlatformClient, like the
// Customer 360 route). Every new booking and every date/time change goes
// through the dealer's opening hours + slot capacity check
// (app/lib/bookingService.js): 409 for a taken slot.
import { onLeadStatusChange ,onFollowUpEvent} from '@lib/followupService.js';
import { aiOwnsCustomerMessages, cancelAllRemindersForLead, createAppointmentReminders } from '@lib/appointmentReminderService';
import { notifyAiOfStaffStatus } from '@lib/ai/aiStaff';
import { verifyInternalServiceToken } from '@lib/internalServiceAuth';
import {
  ACTIVE_BOOKING_STATUSES,
  bookingDayUtc,
  capacitySettings,
  checkBookingSlot,
  dealerTimezone,
  keepsPlaceInSlot,
  normalizeBookingTime,
  sameDayBookings,
  slotErrorResponseBody,
  slotErrorStatus,
  slotsForDay,
  appointmentTypeFor, nextAvailableSlot, nextSlotSentence, normalizeAppointmentType,
} from '@lib/bookingService';
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

// Who is booking: the AI service (shared secret), a signed-in user (staff) or
// the public customer booking page (no token, app/(frontpages)/booking).
async function bookingCaller(request) {
  if (verifyInternalServiceToken(request)) return { kind: 'ai', user: null };
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('_id name email type parent_id');
      if (user) return { kind: 'staff', user };
    } catch (err) {
      console.warn('Token verification failed:', err.message);
    }
  }
  return { kind: 'customer', user: null };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// A failed slot check: 409 for a taken slot, 422 for a time that can't be
// booked at all; with the day's free slots so the caller can offer one.
async function slotRejection(check, { dealer, date, time = null, excludeBookingId = null, appointmentType = 'sales' }) {
  const bookings = check.reason === 'invalid_date' ? [] : await sameDayBookings(Booking, {
    dealerId: dealer._id, date, tz: dealerTimezone(dealer), excludeBookingId });
  const alternatives = slotsForDay({ dealer, date, sameDayBookings: bookings, appointmentType })
    .filter((s) => s.available).map((s) => s.time).slice(0, 6);
  // The first open slot after the requested one, the same day or later (client, 5 Oct 2026).
  const next_available = check.reason === 'invalid_date' ? null : await nextAvailableSlot(Booking, {
    dealer, date, time: check.reason === 'slot_full' ? time : null, appointmentType, excludeBookingId });
  const body = slotErrorResponseBody(check);
  if (check.reason === 'slot_full') body.message = `${body.message}. ${nextSlotSentence(next_available, dealerTimezone(dealer))}`;
  return json({ ...body, alternatives, next_available }, slotErrorStatus(check));
}

export async function POST(request) {
  await dbConnect();

  try {
    const caller = await bookingCaller(request);
    const body = await request.json();
    const {
      dealer_id,
      lead_id,
      customerName,
      email,
      phone,
      notes,
      allow_overbook,
    } = body;
    const bookingDate = body.bookingDate;
    // "2 PM", "2:00 PM" and "14:00" are all stored as "14:00".
    const bookingTime = normalizeBookingTime(body.bookingTime) || body.bookingTime;
    const booking_status = true;
    const fe_lead_status = 'Appointment Booked';
    const existingLead = await Lead.findById(lead_id);

    if (!existingLead) {
      return json({ error: 'Lead not found' }, 404);
    }
    if (dealer_id && existingLead.dealer_id && String(existingLead.dealer_id) !== String(dealer_id)) {
      return json({ error: 'Lead not found for this dealer' }, 404);
    }

    // Resolve dealer timezone once for booking date normalization/formatting
    const dealerDoc = dealer_id
      ? await User.findById(dealer_id).select('dealer_account_information name phone website ai_mode setting')
      : null;
    if (!dealerDoc) {
      return json({ error: 'Dealer not found' }, 404);
    }
    const dealerTimezone = dealerDoc?.dealer_account_information?.time_zone || 'America/New_York';

    // The same lead booking the same time again (a retried AI call, a double
    // click) gets the booking it already has, not a second one.
    const bookingDay = bookingDayUtc(bookingDate, dealerTimezone);
    const sameBooking = bookingDay && await Booking.findOne({
      dealer_id: String(dealer_id), lead_id: String(lead_id), bookingDate: bookingDay, bookingTime,
      booking_status: { $in: ACTIVE_BOOKING_STATUSES },
    });
    if (sameBooking) {
      return json({ success: true, booking: sameBooking, bookingId: String(sameBooking._id), duplicate: true,
        leadUpdated: false });
    }

    // Opening hours + slot capacity (app/lib/bookingService.js), by appointment type: sales or service.
    // Staff may overbook on purpose; the AI and the customer page never can.
    const appointmentType = appointmentTypeFor(existingLead, body.appointment_type);
    const overbook = caller.kind === 'staff' && allow_overbook === true;
    if (!overbook) {
      const check = await checkBookingSlot(Booking, { dealer: dealerDoc, date: bookingDate, time: bookingTime, appointmentType });
      if (!check.ok) return slotRejection(check, { dealer: dealerDoc, date: bookingDate, time: bookingTime, appointmentType });
    }

    // Create new booking
    const booking = new Booking({
      dealer_id,
      lead_id,
      customerName: customerName || existingLead.name,
      email: email || existingLead.email,
      phone: phone || existingLead.phone,
      bookingDate: bookingDay || undefined,
      bookingTime,
      notes,
      created_by: caller.kind,
      appointment_type: appointmentType,
    });

    await booking.save();

    // Two requests for the slot's last place: the later one gives it back.
    if (!overbook && !(await keepsPlaceInSlot(Booking, { dealer: dealerDoc, date: bookingDate, time: bookingTime,
      bookingId: booking._id, appointmentType }))) {
      await Booking.deleteOne({ _id: booking._id });
      const check = await checkBookingSlot(Booking, { dealer: dealerDoc, date: bookingDate, time: bookingTime, appointmentType });
      return slotRejection(check.ok ? { ...check, ok: false, reason: 'slot_full',
        message: `The ${check.slot} slot on ${bookingDate} was just taken` } : check,
      { dealer: dealerDoc, date: bookingDate, time: bookingTime, appointmentType });
    }

    // Initialize updates object
    const updates = {};
    let statusJustChanged = false;

    if (fe_lead_status && fe_lead_status !== existingLead.fe_lead_status) {
      statusJustChanged = true;
      updates.fe_lead_status = fe_lead_status;
    }
    updates.booking_status = booking_status || 'pending';
    updates.booking = { booking_date: bookingDay, booking_time: bookingTime };
    const bookingAt = moment.tz(`${bookingDate} ${bookingTime}`, 'YYYY-MM-DD HH:mm', dealerTimezone);
    if (bookingAt.isValid()) updates.booking.booking_at = bookingAt.utc().toDate();

    // Update lead with booking information and the booking reference
    await Lead.findByIdAndUpdate(
      existingLead._id,
      {
        $set: {
          ...updates,
          'data.bookingId': booking._id,
          'data.booking': updates.booking,
          status: 'Appointment Booked',
          statusChangedAt: new Date()
        }
      }
    );

    // For a dealer whose AI is live the AI sends the confirmation and the
    // reminders itself (through /api/internal/ai/messages/send), so the
    // platform's own are skipped (no double messages, PLAN_4 stream C1).
    const aiLive = await aiOwnsCustomerMessages(dealer_id);

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

    // Send appointment booking notifications (email/SMS) and save to conversation.
    // Skipped for an AI-live dealer: the AI confirms the appointment itself.
    if (aiLive) {
      console.log(`Booking notifications skipped for dealer ${dealer_id}: the AI is live`);
    } else try {
      // The signed-in user who booked (null for the customer page)
      const messageBy = caller.user?._id || null;

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

    // A booking made by staff or by the customer is news to the AI: it runs
    // the appointment's messages (MASTER_PLAN_3 C5). No-op for `off` dealers.
    if (caller.kind !== 'ai') {
      await notifyAiOfStaffStatus({ leadId: lead_id, dealerId: dealer_id, status: 'Appointment Booked' });
    }

    return json({
      success: true,
      booking,
      bookingId: String(booking._id),
      leadUpdated: statusJustChanged
    }, 201);

  } catch (error) {
    console.error('Booking creation error:', error);
    return json({ success: false, error: error.message }, 500);
  }
}

// GET /api/booking
//   ?lead_id=...                 the customer booking page's prefill (public, as before)
//   ?dealer_id=...&date=YYYY-MM-DD  that day's slots with how many places are taken
//   ?booking_id=...              one booking (the AI service or signed-in staff only)
export async function GET(request) {
  await dbConnect();

  try {
    const { searchParams } = new URL(request.url);
    const lead_id = searchParams.get('lead_id');
    const dealer_id = searchParams.get('dealer_id');
    const date = searchParams.get('date');
    const booking_id = searchParams.get('booking_id');

    if (booking_id) {
      const caller = await bookingCaller(request);
      if (caller.kind === 'customer') return json({ error: 'Unauthorized' }, 401);
      if (!mongoose.isValidObjectId(booking_id)) return json({ error: 'Booking not found' }, 404);
      const booking = await Booking.findById(booking_id).lean();
      if (!booking || (dealer_id && String(booking.dealer_id) !== String(dealer_id))) {
        return json({ error: 'Booking not found' }, 404);
      }
      return json({ booking });
    }

    if (dealer_id && date) {
      if (!mongoose.isValidObjectId(dealer_id)) return json({ error: 'Dealer not found' }, 404);
      const dealer = await User.findById(dealer_id).select('dealer_account_information').lean();
      if (!dealer) return json({ error: 'Dealer not found' }, 404);
      const tz = dealerTimezone(dealer);
      const bookings = await sameDayBookings(Booking, { dealerId: dealer_id, date, tz });
      const appointmentType = normalizeAppointmentType(searchParams.get('appointment_type'));
      const { maxPerSlot, slotMinutes } = capacitySettings(dealer, appointmentType);
      return json({ date, timezone: tz, appointment_type: appointmentType, max_per_slot: maxPerSlot,
        slot_minutes: slotMinutes, slots: slotsForDay({ dealer, date, sameDayBookings: bookings, appointmentType }) });
    }

    if (!lead_id) {
      return json({});
    }

    const lead = await Lead.findById(lead_id);
    if (!lead) {
      return json({ error: 'Lead not found' }, 404);
    }

    return json({
      customerName: lead.name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      ...(lead.data?.booking ? {
        bookingDate: lead.data.booking.booking_date,
        bookingTime: lead.data.booking.booking_time
      } : {})
    });
  } catch (error) {
    console.error('Lead fetch error:', error);
    return json({ error: error.message }, 500);
  }
}

// PUT /api/booking {bookingId, booking_status?, booking_date?, booking_time?, showed?, allow_overbook?}
// A new date/time goes through the same slot check as a new booking.
export async function PUT(request) {
  await dbConnect();

  try {
    const caller = await bookingCaller(request);
    const body = await request.json();
    const { bookingId, booking_status, booking_date, showed, allow_overbook } = body;
    const booking_time = body.booking_time ? (normalizeBookingTime(body.booking_time) || body.booking_time) : body.booking_time;

    const existingBooking = bookingId && mongoose.isValidObjectId(bookingId) ? await Booking.findById(bookingId) : null;
    if (!existingBooking) {
      return json({ error: 'Booking not found' }, 404);
    }
    if (booking_status !== undefined && !Booking.schema.path('booking_status').enumValues.includes(booking_status)) {
      return json({ error: `booking_status must be one of ${Booking.schema.path('booking_status').enumValues.join(', ')}` }, 422);
    }
    const dealerDoc = await User.findById(existingBooking.dealer_id).select('dealer_account_information');
    const dealerTimezone = dealerDoc?.dealer_account_information?.time_zone || 'America/New_York';

    const updates = {};
    if (booking_status !== undefined) updates.booking_status = booking_status;
    if (typeof showed === 'boolean') {
      updates.showed = showed;
      updates.showed_at = new Date();
    }

    // A new date and/or time (applied whether or not booking_status is sent).
    const dateChanged = Boolean(booking_date || booking_time);
    const newDate = booking_date || moment(existingBooking.bookingDate).tz(dealerTimezone).format('YYYY-MM-DD');
    const newTime = booking_time || existingBooking.bookingTime;
    const overbook = caller.kind === 'staff' && allow_overbook === true;
    const stillActive = (updates.booking_status ?? existingBooking.booking_status) !== 'cancelled';
    if (dateChanged) {
      if (dealerDoc && stillActive && !overbook) {
        const check = await checkBookingSlot(Booking, { dealer: dealerDoc, date: newDate, time: newTime,
          excludeBookingId: existingBooking._id, appointmentType: existingBooking.appointment_type });
        if (!check.ok) return slotRejection(check, { dealer: dealerDoc, date: newDate, time: newTime,
          excludeBookingId: existingBooking._id, appointmentType: existingBooking.appointment_type });
      }
      const normalizedDate = bookingDayUtc(newDate, dealerTimezone);
      if (!normalizedDate) return json({ error: 'booking_date must be YYYY-MM-DD' }, 422);
      updates.bookingDate = normalizedDate;
      updates.bookingTime = newTime;
      updates.booking = { booking_date: normalizedDate, booking_time: newTime };
      const bookingAt = moment.tz(`${newDate} ${newTime}`, 'YYYY-MM-DD HH:mm', dealerTimezone);
      if (bookingAt.isValid()) updates.booking.booking_at = bookingAt.utc().toDate();
    }

    const { booking: leadBooking, ...bookingUpdates } = updates;
    const previous = { bookingDate: existingBooking.bookingDate, bookingTime: existingBooking.bookingTime };
    const updatedBooking = await Booking.findByIdAndUpdate(
      bookingId,
      { $set: bookingUpdates },
      { new: true }
    );

    if (dateChanged && dealerDoc && stillActive && !overbook && !(await keepsPlaceInSlot(Booking, {
      dealer: dealerDoc, date: newDate, time: newTime, bookingId, appointmentType: existingBooking.appointment_type }))) {
      await Booking.updateOne({ _id: bookingId }, { $set: previous });
      return json({ success: false, error: 'slot_taken', message: `The ${newTime} slot on ${newDate} was just taken` }, 409);
    }

    // Update the lead's booking fields (both the top-level ones the status
    // screen writes and data.booking the booking page reads).
    if (leadBooking) {
      await Lead.updateOne(
        { _id: existingBooking.lead_id },
        { $set: { booking: leadBooking, 'data.booking': leadBooking } }
      );
    }

    if (booking_status === 'cancelled') {
      await cancelAllRemindersForLead(existingBooking.lead_id);
    } else if (leadBooking) {
      // Recreate appointment reminders for the new date/time (skipped for a
      // dealer whose AI is live: appointmentReminderService gates it).
      try {
        const bookingData = {
          _id: updatedBooking.lead_id,
          customer_name: updatedBooking.customerName,
          customer_email: updatedBooking.email,
          customer_phone: updatedBooking.phone,
          booking_date: newDate, // dealer-local YYYY-MM-DD
          time: newTime // dealer-local HH:MM
        };
        const reminderResult = await createAppointmentReminders(bookingData, updatedBooking.dealer_id);
        console.log('Appointment reminders updated:', reminderResult);
      } catch (reminderError) {
        console.error('Error updating appointment reminders:', reminderError);
        // Don't fail the booking update if reminders fail
      }
    }

    return json({ success: true, booking: updatedBooking });
  } catch (error) {
    console.error('Booking update error:', error);
    return json({ success: false, error: error.message }, 500);
  }
}
