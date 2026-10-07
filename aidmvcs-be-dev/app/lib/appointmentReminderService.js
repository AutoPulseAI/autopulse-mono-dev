import dbConnect from './mongodb.js'; 
import AppointmentReminder from '../models/AppointmentReminder.js';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Lead from '../models/Lead.js';
import { getDealerAiMode } from './ai/aiMode.js';
import moment from 'moment-timezone';
import {
  normalizeUserLanguage,
  toDisplayLanguageName,
  translateReminderBundle,
} from './serverTranslateOutgoing.js';

// No double messages (agentic-upsell MASTER_PLAN_3 C5, PLAN_4 stream C1): for
// a dealer whose AI is `live`, the AI sends the appointment confirmation,
// countdown reminders, no-show and post-visit messages itself (through the
// platform's send endpoint), so the platform's own reminders, post-appointment
// follow-ups and managerial review messages are neither created nor sent.
// `shadow` / `off` dealers keep today's behaviour. Exported for tests.
export async function aiOwnsCustomerMessages(dealerId, { getMode = getDealerAiMode } = {}) {
  if (!dealerId) return false;
  return (await getMode(String(dealerId))) === 'live';
}

/**
 * Create appointment reminders for a booking
 * @param {Object} bookingData - The booking data
 * @param {string} dealerId - The dealer ID
 */
export async function createAppointmentReminders(bookingData, dealerId) {
  try {
    await dbConnect();
    if (await aiOwnsCustomerMessages(dealerId)) {
      console.log(`Reminders skipped for dealer ${dealerId}: the AI is live and sends the appointment messages`);
      return { success: false, skipped_for_ai: true, message: 'AI owns appointment messages' };
    }
    
    // Get dealer's reminder settings
    const dealer = await User.findById(dealerId);
    if (!dealer || !dealer.appointment_reminder_settings?.enabled) {
      console.log(`Reminders disabled for dealer ${dealerId}`);
      return { success: false, message: 'Reminders disabled' };
    }

    const settings = dealer.appointment_reminder_settings;
    const dealerTimezone = dealer.dealer_account_information?.time_zone || 'America/New_York';
    
    // Normalize booking_date and booking_time - they are already in dealer timezone
    // If it's a Date object, convert it to dealer timezone string first
    let normalizedDateStr;
    if (bookingData.booking_date instanceof Date) {
      // Convert Date to dealer timezone and extract date part (already in dealer timezone)
      normalizedDateStr = moment(bookingData.booking_date).tz(dealerTimezone).format('YYYY-MM-DD');
      console.log(`DEBUG: booking_date is Date object, converted to: ${normalizedDateStr}`);
    } else {
      // If it's a string, use it as-is (already in dealer timezone, format: YYYY-MM-DD)
      normalizedDateStr = String(bookingData.booking_date).split('T')[0]; // Extract date part if it includes time
      console.log(`DEBUG: booking_date is string: ${bookingData.booking_date}, normalized to: ${normalizedDateStr}`);
    }
    const normalizedTimeStr = (bookingData.time || '').toString().slice(0,5);
    console.log(`DEBUG: booking_time: ${bookingData.time}, normalized to: ${normalizedTimeStr}`);

    // Create appointment datetime in dealer's timezone
    // booking_date and booking_time are already in dealer timezone, so parse them as such
    const appointmentDateTime = moment.tz(
      `${normalizedDateStr} ${normalizedTimeStr}`,
      'YYYY-MM-DD HH:mm',
      dealerTimezone
    );
    
    console.log(`Creating reminders for appointment at ${appointmentDateTime.format()} in ${dealerTimezone} timezone`);
    console.log(`DEBUG: Input - booking_date: ${bookingData.booking_date} (type: ${typeof bookingData.booking_date}), time: ${bookingData.time}`);
    
    // Delete any existing reminders for this booking
    await AppointmentReminder.deleteMany({ booking_id: bookingData._id });
    
    const reminders = [];
    
    // Create reminders for each interval BEFORE appointment
    const now = moment().tz(dealerTimezone); // Use dealer's timezone for all comparisons
    const hoursUntilAppointment = appointmentDateTime.diff(now, 'hours', true);
    const minLeadHoursRaw = process.env.APPOINTMENT_REMINDER_MIN_LEAD_HOURS;
    const minLeadHours = Number.isFinite(Number(minLeadHoursRaw)) ? Number(minLeadHoursRaw) : 12;
    const shouldCreatePreAppointmentReminders = hoursUntilAppointment > minLeadHours;
    const isAppointmentToday = appointmentDateTime.isSame(now, 'day');
    const isAppointmentTomorrow = appointmentDateTime.isSame(now.clone().add(1, 'day'), 'day');
    
    console.log(`Current time in ${dealerTimezone}: ${now.format()}, Appointment: ${appointmentDateTime.format()}, Is today: ${isAppointmentToday}, Is tomorrow: ${isAppointmentTomorrow}`);
    
    if (!shouldCreatePreAppointmentReminders) {
      console.log(
        `Skipping pre-appointment reminders for booking ${bookingData._id}: appointment is in ${hoursUntilAppointment.toFixed(2)} hours (<= ${minLeadHours}h cutoff)`
      );
    } else {
      for (let i = 0; i < settings.total_reminders && i < settings.reminder_intervals.length; i++) {
        const intervalHours = settings.reminder_intervals[i];
        const scheduledFor = appointmentDateTime.clone().subtract(intervalHours, 'hours');
        
        // Allow reminders if:
        // 1. They're in the future, OR
        // 2. Appointment is today/tomorrow and reminder is within 2 hours in the past (to handle late bookings)
        const isInFuture = scheduledFor.isAfter(now);
        const isWithinPastBuffer = scheduledFor.isAfter(now.clone().subtract(2, 'hours')); // Allow 2 hour buffer for past reminders
        const shouldCreate = isInFuture || ((isAppointmentToday || isAppointmentTomorrow) && isWithinPastBuffer);
        
        console.log(`Reminder ${i + 1}: scheduled for ${scheduledFor.format()}, isInFuture: ${isInFuture}, isWithinPastBuffer: ${isWithinPastBuffer}, shouldCreate: ${shouldCreate}`);
        
        if (shouldCreate) {
          const reminder = new AppointmentReminder({
            dealer_id: dealerId,
            booking_id: bookingData._id,
            customer_name: bookingData.customer_name || 'Customer',
            customer_email: bookingData.customer_email,
            customer_phone: bookingData.customer_phone,
            // Store appointment_date as Date - convert from dealer timezone string to Date (will be stored as UTC in MongoDB)
            appointment_date: moment.tz(`${normalizedDateStr} 00:00:00`, 'YYYY-MM-DD HH:mm:ss', dealerTimezone).toDate(),
            appointment_time: normalizedTimeStr,
            reminder_type: settings.reminder_type || 'both',
            message_type: 'appointment_reminder',
            scheduled_for: scheduledFor.toDate(), // Convert moment (in dealer timezone) to Date (UTC) for MongoDB storage
            status: 'pending',
            reminder_data: {
              interval_hours: intervalHours,
              reminder_number: i + 1,
              total_reminders: settings.total_reminders,
              dealer_timezone: dealerTimezone,
              appointment_datetime_local: appointmentDateTime.format(),
              scheduled_for_local: scheduledFor.format()
            }
          });
          
          await reminder.save();
          reminders.push(reminder);
          console.log(`Created reminder ${i + 1} for ${scheduledFor.format()} (${dealerTimezone})`);
        }
      }
    }

    // Create reminders for each interval AFTER appointment (post follow-ups)
    if (settings.post_enabled) {
      const postType = settings.post_type || 'both';
      const postTotal = settings.post_total_reminders || 0;
      const postIntervals = settings.post_intervals || [];
      for (let i = 0; i < postTotal && i < postIntervals.length; i++) {
        const intervalHours = postIntervals[i];
        const scheduledFor = appointmentDateTime.clone().add(intervalHours, 'hours');
        // Allow post-appointment reminders if they're in the future OR if appointment is today/tomorrow and reminder is within 2 hours in the past
        const nowPost = moment().tz(dealerTimezone); // Use dealer's timezone
        const isAppointmentTodayPost = appointmentDateTime.isSame(nowPost, 'day');
        const isAppointmentTomorrowPost = appointmentDateTime.isSame(nowPost.clone().add(1, 'day'), 'day');
        const isInFuturePost = scheduledFor.isAfter(nowPost);
        const isWithinPastBufferPost = scheduledFor.isAfter(nowPost.clone().subtract(2, 'hours')); // Allow 2 hour buffer
        
        if (isInFuturePost || ((isAppointmentTodayPost || isAppointmentTomorrowPost) && isWithinPastBufferPost)) {
          const reminder = new AppointmentReminder({
            dealer_id: dealerId,
            booking_id: bookingData._id,
            customer_name: bookingData.customer_name || 'Customer',
            customer_email: bookingData.customer_email,
            customer_phone: bookingData.customer_phone,
            // Store appointment_date as Date - convert from dealer timezone string to Date (will be stored as UTC in MongoDB)
            appointment_date: moment.tz(`${normalizedDateStr} 00:00:00`, 'YYYY-MM-DD HH:mm:ss', dealerTimezone).toDate(),
            appointment_time: normalizedTimeStr,
            reminder_type: postType,
            message_type: 'post_appointment',
            scheduled_for: scheduledFor.toDate(), // Convert moment (in dealer timezone) to Date (UTC) for MongoDB storage
            status: 'pending',
            reminder_data: {
              interval_hours: intervalHours,
              reminder_number: i + 1,
              total_reminders: postTotal,
              dealer_timezone: dealerTimezone,
              appointment_datetime_local: appointmentDateTime.format(),
              scheduled_for_local: scheduledFor.format()
            }
          });
          await reminder.save();
          reminders.push(reminder);
          console.log(`Created POST reminder ${i + 1} for ${scheduledFor.format()} (${dealerTimezone})`);
        }
      }
    }
    
    return { 
      success: true, 
      message: `Created ${reminders.length} reminders`,
      reminders: reminders.length
    };
    
  } catch (error) {
    console.error('Error creating appointment reminders:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get pending reminders that are due to be sent
 * @param {Date} currentTime - Current time (for testing)
 */
export async function getPendingReminders(currentTime = new Date()) {
  try {
    await dbConnect();
    
    const pendingReminders = await AppointmentReminder.find({
      status: 'pending',
      scheduled_for: { $lte: currentTime },
      attempt_count: { $lt: 3 } // Max 3 attempts
    }).populate('dealer_id', 'name email branding_information dealer_account_information');
    
    console.log(`Found ${pendingReminders.length} pending reminders`);
    
    // Log timezone information for debugging
    pendingReminders.forEach(reminder => {
      const dealerTimezone = reminder.dealer_id?.dealer_account_information?.time_zone || 'America/New_York';
      const scheduledMoment = moment(reminder.scheduled_for).tz(dealerTimezone);
      console.log(`Reminder ${reminder._id}: ${scheduledMoment.format()} (${dealerTimezone})`);
    });
    
    return pendingReminders;
    
  } catch (error) {
    console.error('Error getting pending reminders:', error);
    return [];
  }
}

/**
 * Send email reminder
 * @param {Object} reminder - The reminder document
 */
async function sendEmailReminder(reminder) {
  const { sendEmail } = await import('./email');
  
  const subject = `Appointment Reminder - ${reminder.customer_name}`;
  
  // Get dealer timezone from reminder data or default
  const dealerTimezone = reminder.reminder_data?.dealer_timezone || 'America/New_York';
  
  // Create appointment datetime in dealer's timezone (normalize inputs)
  const sendEmailDateStr = reminder.appointment_date instanceof Date
    ? moment(reminder.appointment_date).tz(dealerTimezone).format('YYYY-MM-DD')
    : String(reminder.appointment_date);
  const sendEmailTimeStr = (reminder.appointment_time || '').toString().slice(0,5);
  const appointmentDateTime = moment.tz(`${sendEmailDateStr} ${sendEmailTimeStr}`, 'YYYY-MM-DD HH:mm', dealerTimezone);
  
  let emailContent = `
    <h2>Appointment Reminder</h2>
    <p>Hello ${reminder.customer_name},</p>
    <p>This is a reminder about your upcoming appointment:</p>
    <ul>
      <li><strong>Date:</strong> ${appointmentDateTime.format('dddd, MMMM Do, YYYY')}</li>
      <li><strong>Time:</strong> ${appointmentDateTime.format('h:mm A')} (${dealerTimezone})</li>
    </ul>
    <p>We look forward to seeing you!</p>
    <p>Best regards,<br>Your Dealership Team</p>
  `;
  
  // Get dealer email account
  const dealerId = reminder.dealer_id?._id || reminder.dealer_id;
  let dealerEmail = null;
  if (dealerId) {
    const EmailAccount = (await import('../models/EmailAccount.js')).default;
    const dealerEmailAccount = await EmailAccount.findOne({ dealer_id: dealerId });
    dealerEmail = dealerEmailAccount?.email_address || null;
  }
  
  // Get the last communication to set parent_message_id (excluding notes)
  const leadId = reminder.lead_id || reminder.booking_id;
  let parent_message_id = null;
  let lastComm = null;
  let leadDoc = null;
  if (leadId) {
    const Email = (await import('../models/Email.js')).default;
    lastComm = await Email
      .findOne({ 
        lead_id: leadId,
        $or: [
          { is_note: { $exists: false } },
          { is_note: false }
        ]
      })
      .sort({ date: -1 });
    
    parent_message_id = lastComm?.parent_message_id || lastComm?.message_id || null;
    leadDoc = await Lead.findById(leadId);
  }

  let subjectToSend = subject;
  const targetLangRaw = lastComm?.user_language ?? leadDoc?.user_language;
  if (leadId && normalizeUserLanguage(targetLangRaw) !== 'english') {
    try {
      const translated = await translateReminderBundle({
        targetLanguage: toDisplayLanguageName(targetLangRaw),
        sourceHint: '',
        subject,
        emailHtml: emailContent,
        smsText: '',
      });
      subjectToSend = translated.subject;
      emailContent = translated.emailHtml;
    } catch (e) {
      console.warn('sendEmailReminder translation failed:', e?.message || e);
    }
  }
  
  await sendEmail(
    reminder.customer_email,
    subjectToSend,
    emailContent,
    dealerEmail,
    parent_message_id,
    reminder.dealer_id
  );
}

/**
 * Send SMS reminder
 * @param {Object} reminder - The reminder document
 */
async function sendSMSReminder(reminder) {
  if (!reminder.customer_phone) {
    console.log(`No phone number for reminder ${reminder._id}`);
    return;
  }
  
  const { sendSMS } = await import('./sms');
  const dealer = await User.findById(reminder.dealer_id);
  // Get dealer timezone from reminder data or default
  const dealerTimezone = reminder.reminder_data?.dealer_timezone || 'America/New_York';
  
  // Create appointment datetime in dealer's timezone (normalize inputs)
  const sendSMSDateStr = reminder.appointment_date instanceof Date
    ? moment(reminder.appointment_date).tz(dealerTimezone).format('YYYY-MM-DD')
    : String(reminder.appointment_date);
  const sendSMSTimeStr = (reminder.appointment_time || '').toString().slice(0,5);
  const appointmentDateTime = moment.tz(`${sendSMSDateStr} ${sendSMSTimeStr}`, 'YYYY-MM-DD HH:mm', dealerTimezone);
  
  let message = `Hi ${reminder.customer_name}, this is a reminder about your appointment on ${appointmentDateTime.format('MMM Do')} at ${appointmentDateTime.format('h:mm A')}. We look forward to seeing you!`;

  const leadIdSms = reminder.lead_id || reminder.booking_id;
  let lastCommSms = null;
  let leadDocSms = null;
  if (leadIdSms) {
    const Email = (await import('../models/Email.js')).default;
    lastCommSms = await Email
      .findOne({
        lead_id: leadIdSms,
        $or: [
          { is_note: { $exists: false } },
          { is_note: false },
        ],
      })
      .sort({ date: -1 });
    leadDocSms = await Lead.findById(leadIdSms);
  }
  const targetLangRawSms = lastCommSms?.user_language ?? leadDocSms?.user_language;
  if (leadIdSms && normalizeUserLanguage(targetLangRawSms) !== 'english') {
    try {
      const translated = await translateReminderBundle({
        targetLanguage: toDisplayLanguageName(targetLangRawSms),
        sourceHint: '',
        subject: '',
        emailHtml: '',
        smsText: message,
      });
      message = translated.smsText;
    } catch (e) {
      console.warn('sendSMSReminder translation failed:', e?.message || e);
    }
  }
  
  await sendSMS(reminder.customer_phone, message,dealer);
}

/**
 * Process all pending reminders (called by cron)
 */
export async function processAllPendingReminders() {
  try {
    console.log('🔄 Starting appointment reminder processing...');
    
    const pendingReminders = await getPendingReminders();
    
    if (pendingReminders.length === 0) {
      console.log('✅ No pending reminders to process');
      return { processed: 0, success: 0, failed: 0 };
    }
    
    let successCount = 0;
    let failedCount = 0;
    
    for (const reminder of pendingReminders) {
      const result = await processReminder(reminder);
      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }
    }
    
    console.log(`✅ Processed ${pendingReminders.length} reminders: ${successCount} success, ${failedCount} failed`);
    
    return {
      processed: pendingReminders.length,
      success: successCount,
      failed: failedCount
    };
    
  } catch (error) {
    console.error('Error processing pending reminders:', error);
    return { processed: 0, success: 0, failed: 0, error: error.message };
  }
}

/**
 * Cancel reminders for a booking (when booking is cancelled)
 * @param {string} bookingId - The booking ID
 */
export async function cancelRemindersForBooking(bookingId) {
  try {
    await dbConnect();
    
    const result = await AppointmentReminder.updateMany(
      { booking_id: bookingId, status: 'pending' },
      { status: 'cancelled' }
    );
    
    console.log(`Cancelled ${result.modifiedCount} reminders for booking ${bookingId}`);
    return { success: true, cancelled: result.modifiedCount };
    
  } catch (error) {
    console.error('Error cancelling reminders:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Cancel all pending reminders for a lead (both booking_id and lead_id)
 * @param {string} leadId - The lead ID
 */
export async function cancelAllRemindersForLead(leadId) {
  try {
    await dbConnect();
    
    const result = await AppointmentReminder.updateMany(
      { 
        $or: [
          { booking_id: leadId, status: 'pending' },
          { lead_id: leadId, status: 'pending' }
        ]
      },
      { status: 'cancelled' }
    );
    
    console.log(`Cancelled ${result.modifiedCount} pending reminders for lead ${leadId}`);
    return { success: true, cancelled: result.modifiedCount };
    
  } catch (error) {
    console.error('Error cancelling reminders for lead:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create managerial review messages for a lead
 * @param {string} leadId - The lead ID
 * @param {string} dealerId - The dealer ID
 */
export async function createManagerialReviewMessages(leadId, dealerId) {
  try {
    await dbConnect();
    if (await aiOwnsCustomerMessages(dealerId)) {
      console.log(`Managerial review messages skipped for dealer ${dealerId}: the AI is live`);
      return { success: false, skipped_for_ai: true, message: 'AI owns follow-up messages' };
    }
    
    // Get dealer's managerial review settings
    const dealer = await User.findById(dealerId);
    if (!dealer || !dealer.managerial_review_settings?.enabled) {
      console.log(`Managerial review messaging disabled for dealer ${dealerId}`);
      return { success: false, message: 'Managerial review messaging disabled' };
    }

    const settings = dealer.managerial_review_settings;
    const dealerTimezone = dealer.dealer_account_information?.time_zone || 'America/New_York';
    
    // Get the lead
    const lead = await Lead.findById(leadId);
    if (!lead) {
      console.error(`Lead ${leadId} not found for managerial review message creation`);
      return { success: false, message: 'Lead not found' };
    }

    // Always set booking_id to lead_id
    const bookingId = leadId;

    // Use lead's statusChangedAt as the baseline for managerial review messages
    const reviewDate = moment.tz(lead.statusChangedAt || lead.updatedAt, dealerTimezone);
    
    console.log(`Creating managerial review messages for lead ${leadId} (booking_id: ${bookingId}) starting from ${reviewDate.format()} in ${dealerTimezone} timezone`);
    
    // Delete any existing managerial review messages for this lead
    await AppointmentReminder.deleteMany({ 
      lead_id: leadId, 
      message_type: 'managerial_review'
    });
    
    const messages = [];
    
    // Create messages for each interval AFTER status change
    for (let i = 0; i < settings.frequency.length; i++) {
      const intervalHours = settings.frequency[i];
      const scheduledFor = reviewDate.clone().add(intervalHours, 'hours');
      
      // Allow messages if they're in the future OR if status change is today/tomorrow and message is within 2 hours in the past
      const nowReview = moment().tz(dealerTimezone); // Use dealer's timezone
      const isStatusChangeToday = reviewDate.isSame(nowReview, 'day');
      const isStatusChangeTomorrow = reviewDate.isSame(nowReview.clone().add(1, 'day'), 'day');
      const isInFuture = scheduledFor.isAfter(nowReview);
      const isWithinPastBuffer = scheduledFor.isAfter(nowReview.clone().subtract(2, 'hours')); // Allow 2 hour buffer for past messages
      
      if (isInFuture || ((isStatusChangeToday || isStatusChangeTomorrow) && isWithinPastBuffer)) {
        const message = new AppointmentReminder({
          dealer_id: dealerId,
          booking_id: bookingId, // Always set booking_id to lead_id
          lead_id: leadId,
          customer_name: lead.name || 'Customer',
          customer_email: lead.email,
          customer_phone: lead.phone,
          appointment_date: reviewDate.toDate(),
          appointment_time: reviewDate.format('HH:mm'),
          reminder_type: settings.communication_type || 'both',
          message_type: 'managerial_review',
          scheduled_for: scheduledFor.toDate(),
          status: 'pending',
          reminder_data: {
            interval_hours: intervalHours,
            message_number: i + 1,
            total_messages: settings.frequency.length,
            dealer_timezone: dealerTimezone,
            status_changed_at_local: reviewDate.format(),
            scheduled_for_local: scheduledFor.format()
          }
        });
        
        await message.save();
        messages.push(message);
        console.log(`Created managerial review message ${i + 1} for ${scheduledFor.format()} (${dealerTimezone})`);
      }
    }

    return { 
      success: true, 
      message: `Created ${messages.length} managerial review messages`,
      messagesCount: messages.length 
    };
    
  } catch (error) {
    console.error('Error creating managerial review messages:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Process and send a single reminder/message
 * @param {Object} reminder - The AppointmentReminder document
 */
export async function processReminder(reminder) {
  try {
    console.log(`Processing reminder ${reminder._id} for ${reminder.customer_name}`);
    
    const customerName = reminder.customer_name;
    const customerEmail = reminder.customer_email;
    const customerPhone = reminder.customer_phone;
    
    // Get dealer information
    const dealerId = reminder.dealer_id?._id || reminder.dealer_id;
    let dealer = null;
    let dealerName = 'Our Dealership';
    let dealerUrl = '';
    let dealershipPhone = '';
    
    // Created before the dealer's AI went live: never sent now (the AI owns
    // these messages); cancelled so the cron stops picking it up.
    if (dealerId && await aiOwnsCustomerMessages(dealerId)) {
      reminder.status = 'cancelled';
      reminder.error_message = 'Skipped: the AI is live for this dealer and sends its own messages';
      await reminder.save?.();
      return { success: true, skipped: true, reason: 'ai_live' };
    }

    if (dealerId) {
      dealer = await User.findById(dealerId);
      if (dealer) {
        const dealerInfo = dealer.dealer_account_information || {};
        dealerName = dealerInfo.name || dealer.name || 'Our Dealership';
        dealerUrl = dealer.website || dealerInfo.dealer_url || '';
        dealershipPhone = dealerInfo.dealer_phone || dealerInfo.sms_conversion_phone || dealer.phone || '';
      }
    }

    // Per-dealer quiet hours: do not send between 8pm and 9am dealer-local time.
    // Cron can run 24/7; we gate per reminder based on dealer timezone.
    const dealerTimezone =
      dealer?.dealer_account_information?.time_zone ||
      reminder.reminder_data?.dealer_timezone ||
      'America/New_York';
    const dealerLocalHour = moment().tz(dealerTimezone).hour(); // 0-23
    const isWithinSendWindow = dealerLocalHour >= 9 && dealerLocalHour < 20;
    if (!isWithinSendWindow) {
      console.log(
        `⏸ Skipping reminder ${reminder._id}: dealer local time is outside 9am-8pm window`,
        { dealerTimezone, dealerLocalHour },
      );
      return {
        success: true,
        skipped: true,
        reason: 'outside_send_window',
        dealer_timezone: dealerTimezone,
        dealer_local_hour: dealerLocalHour,
      };
    }

    // Only count an attempt once we're allowed to send.
    reminder.attempt_count += 1;
    
    // Get lead information for vehicle model and language fallback
    const leadId = reminder.lead_id || reminder.booking_id;
    let vehicleModel = '';
    let leadForLanguage = null;
    if (leadId) {
      leadForLanguage = await Lead.findById(leadId);
      if (leadForLanguage) {
        vehicleModel = leadForLanguage.vehicle_model || '';
      }
    }
    
    // Extract first name from customer name
    const firstName = customerName ? customerName.split(' ')[0] : 'there';
    
    let subject = '';
    let emailContent = '';
    let smsMessage = '';
    
    // Check message type to determine content
    if (reminder.message_type === 'managerial_review') {
      // Managerial Review Sequence
      subject = `Quick check-in from ${dealerName} Management`;
      emailContent = `
        <p>Hi ${firstName},</p>
        <p>This is a quick note from the Management Team at ${dealerName}. We noticed you recently inquired about the ${vehicleModel || 'vehicle'}, and we just wanted to make sure someone from our team has reached out to assist you.</p>
        <p>If you haven't heard from us yet or if you'd prefer to speak directly, feel free to call us anytime at ${dealershipPhone || 'our dealership'} — we'll be happy to help.</p>
        <p>Thank you for considering ${dealerName}!</p>
        <br>
        <p>Best regards,<br>${dealerName} Management Team</p>
        ${dealerUrl ? `<p><a href="${dealerUrl}">Visit our website</a></p>` : ''}
      `;
      // Managerial Review SMS template
      smsMessage = `Hi ${firstName}, this is a quick check-in from ${dealerName}'s Management Team.\n\nHas someone from our team reached out to you about your inquiry on the ${vehicleModel || 'vehicle'} yet?\n\nYou can also call us directly at ${dealershipPhone || 'our dealership'} if that's easier.`;
    } else if (reminder.message_type === 'post_appointment') {
      // Post-Appointment Experience Follow-ups
      subject = `How was your visit to ${dealerName}?`;
      emailContent = `
        <p>Hi ${firstName},</p>
        <p>We hope you enjoyed your visit to ${dealerName}! Your feedback helps us improve and ensure every guest has a great experience.</p>
        <p>If you have a moment, we'd love to hear how your visit went — was everything up to your expectations?</p>
        <p>You can also continue exploring more vehicles and offers anytime at:</p>
        ${dealerUrl ? `<p>👉 <a href="${dealerUrl}">${dealerUrl}</a></p>` : ''}
        <p>Thank you for stopping by!</p>
        <br>
        <p>Warm regards,<br>The ${dealerName} Team</p>
      `;
      // Post-Appointment SMS template
      smsMessage = `Hey ${firstName}, did you get a chance to stop by ${dealerName}?\n\nWe'd love to hear how your visit went! You can always explore more options anytime at ${dealerUrl || 'our website'}`;
    } else {
      // Same-Day Appointment Reminder (2-4 hours before appointment)
      const appointmentDateTime = moment.tz(reminder.reminder_data.appointment_datetime_local, reminder.reminder_data.dealer_timezone || 'America/New_York');
      const formattedTime = appointmentDateTime.format('h:mm A');
      const formattedDate = appointmentDateTime.format('dddd, MMMM Do, YYYY');
      const vehicleText = vehicleModel ? `${vehicleModel} ` : '';
      
      subject = `Reminder: Your ${vehicleText}appointment on ${formattedDate} at ${formattedTime}`;
      emailContent = `
        <p>Hi ${firstName},</p>
        <p>Just a quick reminder from ${dealerName} — we're all set for your ${vehicleText}appointment on ${formattedDate} at ${formattedTime}.</p>
        <p>If there's anything specific you'd like us to prepare or discuss before you arrive, just hit reply and let us know.</p>
        <p>We're looking forward to seeing you soon!</p>
        <br>
        <p>Best,<br>The ${dealerName} Team</p>
        ${dealerUrl ? `<p><a href="${dealerUrl}">Visit our website</a></p>` : ''}
      `;
      // Same-Day Appointment Reminder SMS template
      smsMessage = `Hey ${firstName}, just a quick note from ${dealerName}${dealerUrl ? ` ${dealerUrl}` : ''} — we're all set for your ${vehicleText}appointment on ${formattedDate} at ${formattedTime}.\n\nAnything specific you'd like us to prepare before you arrive?`;
    }
    
    // Get the last communication to determine reminder type and parent_message_id (excluding notes)
    let lastComm = null;
    let parent_message_id = null;
    let communicationType = null;
    
    if (leadId) {
      const Email = (await import('../models/Email.js')).default;
      lastComm = await Email
        .findOne({ 
          lead_id: leadId,
          $or: [
            { is_note: { $exists: false } },
            { is_note: false }
          ]
        })
        .sort({ date: -1 });
      
      if (lastComm) {
        parent_message_id = lastComm.parent_message_id || lastComm.message_id || null;
        communicationType = lastComm.communication_type; // 'email' or 'sms'
      }
    }
    
    // Determine how to send reminder based on last communication type
    // If no last communication, fallback to reminder_type setting
    const shouldSendEmail = communicationType === 'email' || 
                           (!lastComm && (reminder.reminder_type === 'email' || reminder.reminder_type === 'both'));
    const shouldSendSMS = communicationType === 'sms' || 
                         (!lastComm && (reminder.reminder_type === 'sms' || reminder.reminder_type === 'both'));

    let subjectToSend = subject;
    let emailContentToSend = emailContent;
    let smsMessageToSend = smsMessage;

    const targetLangRaw =
      lastComm?.user_language ?? leadForLanguage?.user_language;
    const targetDisplay = toDisplayLanguageName(targetLangRaw);
    if (
      leadId &&
      normalizeUserLanguage(targetLangRaw) !== 'english'
    ) {
      try {
        const translated = await translateReminderBundle({
          targetLanguage: targetDisplay,
          sourceHint: '',
          subject: subjectToSend,
          emailHtml: emailContentToSend,
          smsText: smsMessageToSend,
        });
        subjectToSend = translated.subject;
        emailContentToSend = translated.emailHtml;
        smsMessageToSend = translated.smsText;
      } catch (trErr) {
        console.warn(
          'Reminder translation failed, sending English templates:',
          trErr?.message || trErr
        );
      }
    }
    
    let sentSuccessfully = false;
    const Email = (await import('../models/Email.js')).default;
    
    // Helper function to strip HTML tags for plain text storage
    const stripTagsRegex = (html) => {
      if (!html) return '';
      return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    };
    
    // Get dealer SMS phone number
    const dealerSMSPhone = dealer?.dealer_account_information?.sms_conversion_phone || 
                           dealer?.dealer_account_information?.dealer_phone || 
                           dealer?.phone || null;
    
    // Send email if last communication was email (or no communication and reminder_type allows email)
    if (shouldSendEmail && customerEmail) {
      // Get dealer email account
      let dealerEmail = null;
      if (dealerId) {
        const EmailAccount = (await import('../models/EmailAccount.js')).default;
        const dealerEmailAccount = await EmailAccount.findOne({ dealer_id: dealerId });
        dealerEmail = dealerEmailAccount?.email_address || null;
      }
      
      if (dealerEmail) {
        try {
          const { sendEmail } = await import('./email.js');
          const messageId = await sendEmail(
            customerEmail,
            subjectToSend,
            emailContentToSend,
            dealerEmail,
            parent_message_id,
            dealer
          );
          console.log(`Email sent for reminder ${reminder._id} (based on last communication: ${communicationType || 'none'})`);
          
          // Save email record to Email model
          const emailRecord = new Email({
            message_id: messageId || `reminder-email-${reminder._id}-${Date.now()}`,
            parent_message_id: parent_message_id,
            parent_conversation: lastComm?.parent_conversation || parent_message_id,
            sender: dealerEmail,
            recipient: customerEmail,
            subject: subjectToSend,
            mail_content: stripTagsRegex(emailContentToSend), // Store plain text
            communication_type: 'email',
            status: 'sent',
            dealer_id: dealerId,
            lead_id: leadId,
            date: new Date(),
            timestamp: new Date()
          });
          await emailRecord.save();
          sentSuccessfully = true;
        } catch (emailError) {
          console.error(`Error sending email for reminder ${reminder._id}:`, emailError);
          
          // Save failed email record to Email model
          try {
            const failedEmailRecord = new Email({
              message_id: `reminder-email-${reminder._id}-${Date.now()}`,
              parent_message_id: parent_message_id,
              parent_conversation: lastComm?.parent_conversation || parent_message_id,
              sender: dealerEmail || 'system',
              recipient: customerEmail,
              subject: subjectToSend,
              mail_content: stripTagsRegex(emailContentToSend),
              communication_type: 'email',
              status: 'failed',
              dealer_id: dealerId,
              lead_id: leadId,
              date: new Date(),
              timestamp: new Date()
            });
            await failedEmailRecord.save();
          } catch (saveError) {
            console.error(`Error saving failed email record:`, saveError);
          }
          // Continue to try SMS if email fails and SMS is also needed
        }
      } else {
        console.log(`Cannot send email for reminder ${reminder._id}: dealer email not found`);
      }
    }
    
    // Send SMS if last communication was SMS (or no communication and reminder_type allows SMS)
    if (shouldSendSMS && customerPhone && dealerSMSPhone) {
      try {
        const { sendSMS, normalizeSmsPhone } = await import('./sms.js');
        const normalizedCustomerPhone = normalizeSmsPhone(customerPhone);
        const messageId = await sendSMS(normalizedCustomerPhone, smsMessageToSend, dealer);
        console.log(`SMS sent for reminder ${reminder._id} (based on last communication: ${communicationType || 'none'})`);
        
        // Save SMS record to Email model
        const smsRecord = new Email({
          message_id: messageId || `reminder-sms-${reminder._id}-${Date.now()}`,
          parent_message_id: parent_message_id,
          parent_conversation: lastComm?.parent_conversation || parent_message_id,
          sender: dealerSMSPhone,
          recipient: normalizedCustomerPhone,
          subject: null,
          mail_content: smsMessageToSend,
          communication_type: 'sms',
          status: 'sent',
          dealer_id: dealerId,
          lead_id: leadId,
          date: new Date(),
          timestamp: new Date()
        });
        await smsRecord.save();
        sentSuccessfully = true;
      } catch (smsError) {
        console.error(`Error sending SMS for reminder ${reminder._id}:`, smsError);
        
        // Save failed SMS record to Email model
        try {
          const failedSmsRecord = new Email({
            message_id: `reminder-sms-${reminder._id}-${Date.now()}`,
            parent_message_id: parent_message_id,
            parent_conversation: lastComm?.parent_conversation || parent_message_id,
            sender: dealerSMSPhone || 'system',
            recipient: customerPhone,
            subject: null,
            mail_content: smsMessageToSend,
            communication_type: 'sms',
            status: 'failed',
            dealer_id: dealerId,
            lead_id: leadId,
            date: new Date(),
            timestamp: new Date()
          });
          await failedSmsRecord.save();
        } catch (saveError) {
          console.error(`Error saving failed SMS record:`, saveError);
        }
        
        // If email also failed, mark as failed
        if (!sentSuccessfully) {
          reminder.status = reminder.attempt_count >= 3 ? 'failed' : 'pending';
          reminder.error_message = smsError.message;
          await reminder.save();
          return { success: false, error: smsError.message };
        }
      }
    }
    
    // Only mark as sent if at least one message was sent successfully
    if (sentSuccessfully) {
      reminder.status = 'sent';
      reminder.sent_at = new Date();
      await reminder.save();
    } else {
      // If neither email nor SMS could be sent, mark as failed
      reminder.status = reminder.attempt_count >= 3 ? 'failed' : 'pending';
      reminder.error_message = 'No messages could be sent. Check communication type and recipient information.';
      await reminder.save();
      return { success: false, error: 'No messages could be sent' };
    }
    
    console.log(`Successfully sent reminder ${reminder._id}`);
    return { success: true };
    
  } catch (error) {
    console.error(`Error processing reminder ${reminder._id}:`, error);
    reminder.status = reminder.attempt_count >= 3 ? 'failed' : 'pending'; // Max 3 attempts
    reminder.error_message = error.message;
    await reminder.save();
    return { success: false, error: error.message };
  }
}
