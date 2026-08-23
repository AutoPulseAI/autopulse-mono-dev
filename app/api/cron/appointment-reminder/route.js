import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb.js';
import Lead from '@models/Lead.js';
import Email from '@models/Email.js';
import AppointmentReminder from '@models/AppointmentReminder.js';
import User from '@models/User.js';
import { sendEmail } from '@lib/email.js';
import { sendSMS } from '@lib/sms.js';
import { checkLeadByIdentifiers } from '@lib/dealersocket-worknote.js';
import moment from 'moment-timezone';

/**
 * POST endpoint for cron-triggered appointment reminders
 * Processes existing reminders: sends email/SMS and saves to Email model
 * booking_id is actually lead_id in AppointmentReminder table
 */
export async function POST(request) {
  try {
    await dbConnect();
    
    let payload;
    try {
      const text = await request.text();
      if (!text.trim()) {
        return NextResponse.json({ error: 'Empty request body' }, { status: 400 });
      }
      payload = JSON.parse(text);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json({ error: 'Invalid JSON format' }, { status: 400 });
    }

    const { 
      reminder_id, // Required: ID of the AppointmentReminder to process
      message // Optional: Custom message (if not provided, will use generated content)
    } = payload;

    if (!reminder_id) {
      return NextResponse.json({ error: 'reminder_id is required' }, { status: 400 });
    }

    const reminder = await AppointmentReminder.findById(reminder_id);
    if (!reminder) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
    }

    // Check if reminder is already processed
    if (reminder.status === 'sent' || reminder.status === 'failed') {
      return NextResponse.json({ 
        success: true, 
        message: 'Reminder already processed',
        status: reminder.status 
      });
    }

    // Get the lead - booking_id is actually lead_id in this table
    const leadId = reminder.lead_id || reminder.booking_id;
    if (!leadId) {
      reminder.status = 'failed';
      reminder.error_message = 'Lead ID not found in reminder';
      await reminder.save();
      return NextResponse.json({ error: 'Lead ID not found for reminder' }, { status: 404 });
    }

    const lead = await Lead.findById(leadId);
    if (!lead) {
      reminder.status = 'failed';
      reminder.error_message = 'Lead not found';
      await reminder.save();
      return NextResponse.json({ error: 'Lead not found for reminder' }, { status: 404 });
    }

    // Check if lead status prevents sending
    if (lead.fe_lead_status === 'DND' ) {
      if (reminder.message_type !== 'managerial_review') {
        reminder.status = 'cancelled';
        await reminder.save();
        return NextResponse.json({ 
          error: 'Lead status is DND or Managerial Review. Reminder cancelled.' 
        }, { status: 400 });
      }
    }

    // Get dealer
    const dealer = await User.findById(lead.dealer_id || reminder.dealer_id);
    if (!dealer) {
      reminder.status = 'failed';
      reminder.error_message = 'Dealer not found';
      await reminder.save();
      return NextResponse.json({ error: 'Dealer not found' }, { status: 404 });
    }

    // Get dealer email account and SMS phone
    const EmailAccount = (await import('@models/EmailAccount.js')).default;
    const dealerEmailAccount = await EmailAccount.findOne({ dealer_id: dealer._id });
    const dealerEmail = dealerEmailAccount?.email_address || null;
    const dealerSMSPhone = dealer.dealer_account_information?.sms_conversion_phone || null;

    // Get the last communication to set parent_message_id (excluding notes)
    const lastComm = await Email
      .findOne({ 
        lead_id: lead._id,
        $or: [
          { is_note: { $exists: false } },
          { is_note: false }
        ]
      })
      .sort({ date: -1 });

    const parent_message_id = lastComm?.parent_message_id || lastComm?.message_id;

    // Determine communication type and recipients
    const reminderType = reminder.reminder_type || 'email';
    const recipientEmail = reminder.customer_email || lead.email;
    const recipientPhone = reminder.customer_phone || lead.phone;

    // Get dealer information for templates
    const dealerInfo = dealer.dealer_account_information || {};
    const dealerName = dealerInfo.dealer_name || dealer.name || 'Our Dealership';
    const dealerUrl = dealer.website || dealerInfo.dealer_url || '';
    const dealershipPhone = dealerInfo.dealer_phone || dealerInfo.sms_conversion_phone || dealer.phone || '';
    
    // Get vehicle model from lead
    const vehicleModel = lead.vehicle_model || '';
    
    // Extract first name from customer name
    const firstName = reminder.customer_name ? reminder.customer_name.split(' ')[0] : 'there';

    // Prepare message content based on type
    let subject = '';
    let emailContent = '';
    let smsContent = '';

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
      smsContent = `Hi ${firstName}, this is a quick check-in from ${dealerName}'s Management Team.\n\nHas someone from our team reached out to you about your inquiry on the ${vehicleModel || 'vehicle'} yet?\n\nYou can also call us directly at ${dealershipPhone || 'our dealership'} if that's easier.`;
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
      smsContent = `Hey ${firstName}, did you get a chance to stop by ${dealerName}?\n\nWe'd love to hear how your visit went! You can always explore more options anytime at ${dealerUrl || 'our website'}`;
    } else {
      // Same-Day Appointment Reminder (2-4 hours before appointment)
      const appointmentDateTime = reminder.reminder_data?.appointment_datetime_local
        ? moment.tz(reminder.reminder_data.appointment_datetime_local, reminder.reminder_data.dealer_timezone || 'America/New_York')
        : moment();
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
      smsContent = `Hey ${firstName}, just a quick note from ${dealerName}${dealerUrl ? ` ${dealerUrl}` : ''} — we're all set for your ${vehicleText}appointment on ${formattedDate} at ${formattedTime}.\n\nAnything specific you'd like us to prepare before you arrive?`;
    }

    // Send email/SMS and create Email records
    const emailRecords = [];
    let sentSuccessfully = false;

    // Send email if needed (based on last communication type or reminder type)
    const shouldSendEmail = lastComm?.communication_type === 'email' || 
                          (!lastComm && (reminderType === 'email' || reminderType === 'both'));
    
    if (shouldSendEmail && recipientEmail && dealerEmail) {
      try {
        const messageId = await sendEmail(
          recipientEmail,
          subject,
          emailContent,
          dealerEmail,
          lastComm?.message_id || null,
          dealer
        );

        // Create Email record
        const emailRecord = new Email({
          message_id: messageId || `reminder-email-${reminder._id}-${Date.now()}`,
          parent_message_id: parent_message_id,
          parent_conversation: lastComm?.parent_conversation || parent_message_id,
          sender: dealerEmail,
          recipient: recipientEmail,
          subject: subject,
          mail_content: emailContent,
          communication_type: 'email',
          status: 'sent',
          dealer_id: dealer._id,
          lead_id: lead._id,
          date: new Date(),
          timestamp: new Date()
        });
        await emailRecord.save();
        emailRecords.push(emailRecord);
        sentSuccessfully = true;
      } catch (err) {
        console.error(`Error sending email for reminder ${reminder._id}:`, err);
        // Continue to try SMS even if email fails
      }
    }

    // Send SMS if needed (based on last communication type or reminder type)
    const shouldSendSMS = lastComm?.communication_type === 'sms' || 
                         (!lastComm && (reminderType === 'sms' || reminderType === 'both'));
    
    if (shouldSendSMS && recipientPhone && dealerSMSPhone) {
      try {
        let formattedPhone = recipientPhone;
        try {
          formattedPhone = formatPhoneForTwilio(recipientPhone);
        } catch (e) {
          console.warn('Could not format phone number:', e.message);
          formattedPhone = recipientPhone; // Use original if formatting fails
        }

        const messageId = await sendSMS(formattedPhone, smsContent, dealer);

        // Create Email record
        const smsRecord = new Email({
          message_id: messageId || `reminder-sms-${reminder._id}-${Date.now()}`,
          parent_message_id: parent_message_id,
          parent_conversation: lastComm?.parent_conversation || parent_message_id,
          sender: dealerSMSPhone,
          recipient: formattedPhone,
          subject: null,
          mail_content: smsContent,
          communication_type: 'sms',
          status: 'sent',
          dealer_id: dealer._id,
          lead_id: lead._id,
          date: new Date(),
          timestamp: new Date()
        });
        await smsRecord.save();
        emailRecords.push(smsRecord);
        sentSuccessfully = true;
      } catch (err) {
        console.error(`Error sending SMS for reminder ${reminder._id}:`, err);
        // Mark as failed if both email and SMS fail
        if (!sentSuccessfully) {
          let formattedPhone = recipientPhone;
          try {
            formattedPhone = formatPhoneForTwilio(recipientPhone);
          } catch (e) {
            console.warn('Could not format phone number:', e.message);
            formattedPhone = recipientPhone; // Use original if formatting fails
          }
          reminder.status = reminder.attempt_count >= 2 ? 'failed' : 'pending';
          reminder.error_message = err.message;
          reminder.attempt_count = (reminder.attempt_count || 0) + 1;
          await reminder.save();

          const smsRecord = new Email({
            message_id: `reminder-sms-${reminder._id}-${Date.now()}`,
            parent_message_id: parent_message_id,
            parent_conversation: lastComm?.parent_conversation || parent_message_id,
            sender: dealerSMSPhone,
            recipient: formattedPhone,
            subject: null,
            mail_content: smsContent,
            communication_type: 'sms',
            status: 'failed',
            dealer_id: dealer._id,
            lead_id: lead._id,
            date: new Date(),
            timestamp: new Date()
          });
          await smsRecord.save();
          return NextResponse.json({ 
            error: 'Failed to send email and SMS',
            details: err.message 
          }, { status: 500 });
        }
      }
    }

    // Update reminder status if at least one message was sent
    if (sentSuccessfully) {
      reminder.status = 'sent';
      reminder.sent_at = new Date();
      reminder.attempt_count = (reminder.attempt_count || 0) + 1;
      await reminder.save();
    }

    // DealerSocket work note insert
    try {
      const updatedLead = await Lead.findById(lead._id);
      const updatedDealer = await User.findById(lead.dealer_id);
      if (
        updatedLead &&
        updatedDealer?.dealer_account_information?.dealersocket_dealerid
      ) {
        const workNoteCriteria = {
          lead_id: updatedLead._id?.toString(),
          dealer_id: updatedDealer.dealer_account_information.dealersocket_dealerid,
          frenchise_id: updatedDealer.dealer_account_information.dealersocket_frenchiseid,
          entity_email: updatedLead.email || reminder.customer_email,
          entity_phone: updatedLead.phone || reminder.customer_phone,
          vin: updatedLead.vin || null,
          auto_insert_work_note: true,
          vendor_name: 'AutoPulse'
        };
        const workNoteResult = await checkLeadByIdentifiers(workNoteCriteria);
        if (workNoteResult.success && workNoteResult.found) {
          console.log('DealerSocket work note inserted (cron reminder):', workNoteResult.work_notes);
        }
      }
    } catch (dsErr) {
      console.warn('DealerSocket work note insert failed (cron reminder):', dsErr?.message || dsErr);
    }

    if (sentSuccessfully) {
      return NextResponse.json({ 
        success: true, 
        message: 'Reminder processed successfully',
        reminder_id: reminder._id,
        email_records: emailRecords.map(r => ({ id: r._id, type: r.communication_type }))
      });
    } else {
      return NextResponse.json({ 
        error: 'No messages were sent. Check reminder_type and recipient information.' 
      }, { status: 400 });
    }

  } catch (err) {
    console.error('Error in appointment reminder POST route:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function formatPhoneForTwilio(phone) {
  // If phone is empty, undefined, or null, return null
  if (!phone || !phone.toString().trim()) {
    return null;
  }

  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');

  // If no digits found, return null
  if (!cleaned || cleaned.length === 0) {
    return null;
  }

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
