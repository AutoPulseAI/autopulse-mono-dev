import twilio from 'twilio';
import { isProviderSendStubbed, recordStubSend } from './providerStub.js';

// Initialize Twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;


const client = twilio(accountSid, authToken);

/**
 * Send SMS/MMS via Twilio
 * @param {string} to - Recipient phone number (e.g., +18446514715)
 * @param {string} body - SMS text content
 * @param {object} dealer - Dealer object
 * @param {Array} mediaUrls - Optional array of media URLs for MMS (e.g., ['https://example.com/image.jpg'])
 * @returns {Promise<string>} - Twilio Message SID
 */
export async function sendSMS(to, body, dealer, mediaUrls = []) {
  try {
    // Local/dev runs never reach Twilio (app/lib/providerStub.js).
    if (isProviderSendStubbed()) {
      return await recordStubSend({
        channel: 'sms', to: normalizeSmsPhone(to), text: body == null ? '' : String(body).trim(),
        from: dealer?.dealer_account_information?.sms_conversion_phone || process.env.TWILIO_PHONE_NUMBER || null,
        dealer_id: dealer?._id ? String(dealer._id) : null,
        media_urls: (mediaUrls || []).filter((url) => url && typeof url === 'string').slice(0, 10),
      });
    }
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials not configured');
    }

    // Use dealer's phone number if available, otherwise fallback to default
    const fromNumber = dealer?.dealer_account_information?.sms_conversion_phone 
      || process.env.TWILIO_PHONE_NUMBER;

    if (!fromNumber) {
      throw new Error('No Twilio phone number configured');
    }

    // Normalize destination to E.164 and validate
    const toE164 = normalizeSmsPhone(to);

    // Ensure body is always a valid string for MMS compatibility
    // Convert null/undefined to empty string, but preserve actual string values
    let messageBody = '';
    if (body != null) {
      const bodyStr = String(body);
      // Only use non-empty strings (after trimming whitespace)
      if (bodyStr.trim()) {
        messageBody = bodyStr.trim();
      }
    }

    // Prepare message options
    const messageOptions = {
      from: fromNumber,
      to: toE164,
    };

    // Add media URLs for MMS if provided
    if (mediaUrls && mediaUrls.length > 0) {
      // Twilio supports up to 10 media items per MMS
      const validMediaUrls = mediaUrls
        .filter(url => url && typeof url === 'string')
        .slice(0, 10); // Limit to 10 media items
      
      if (validMediaUrls.length > 0) {
        messageOptions.mediaUrl = validMediaUrls;
        // Always include body text with MMS if provided (Twilio supports text + media)
        // This ensures text is sent along with attachments
        if (messageBody) {
          messageOptions.body = messageBody;
          console.log(`Sending MMS with ${validMediaUrls.length} media file(s) and text: "${messageBody.substring(0, 50)}${messageBody.length > 50 ? '...' : ''}" from ${fromNumber} to ${toE164}`);
        } else {
          console.log(`Sending MMS with ${validMediaUrls.length} media file(s) (no text body provided) from ${fromNumber} to ${toE164}`);
        }
      }
    } else {
      // For SMS, always include body (even if empty)
      messageOptions.body = messageBody || '';
      console.log(`Sending SMS from ${fromNumber} to ${toE164}`);
    }

    const message = await client.messages.create(messageOptions);

    const messageType = mediaUrls && mediaUrls.length > 0 ? 'MMS' : 'SMS';
    console.log(`${messageType} sent to ${toE164}. SID: ${message.sid}`);
    return message.sid;
  } catch (error) {
    // Classify Twilio errors to help workers decide retry vs. no-retry
    const code = error?.code;
    if (code === 21610) {
      // Unsubscribed (STOP) — permanent failure until user opts back in
      error.retryable = false;
      error.reason = 'unsubscribed';
    } else if (code === 21408) {
      // Region not enabled — permanent until Twilio project is configured
      error.retryable = false;
      error.reason = 'geo_not_enabled';
    } else if (code === 21211 || error?.code === 'FORMAT') {
      // Invalid phone number
      error.retryable = false;
      error.reason = 'invalid_number';
    } else {
      // Default to retryable transient error
      error.retryable = true;
      error.reason = 'transient';
    }
    console.error('Error sending SMS:', error);
    throw error; // Let caller decide on retry based on flags
  }
}

/**
 * Format SMS for consistent storage (optional)
 * @param {object} smsData - Raw Twilio webhook data
 * @returns {object} - Formatted SMS data
 */
export function formatSMS(smsData) {
  return {
    from: smsData.From,
    to: smsData.To,
    body: smsData.Body,
    messageSid: smsData.MessageSid,
    status: smsData.SmsStatus,
    numSegments: smsData.NumSegments,
    dateSent: new Date(),
  };
}

/**
 * Validate phone number (optional)
 * @param {string} phoneNumber
 * @returns {boolean}
 */
export function isValidPhoneNumber(phoneNumber) {
  // Simple E.164 format check (e.g., +1234567890)
  return /^\+[1-9]\d{1,14}$/.test(phoneNumber);
}

// Internal helper to normalize phone numbers to E.164
export function normalizeSmsPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) {
    const err = new Error('Invalid phone number format');
    err.code = 'FORMAT';
    err.retryable = false;
    throw err;
  }
  if (digits.length === 10) return `+1${digits}`; // default to US if 10 digits
  if (digits.length > 10) return `+${digits}`;     // assume includes country code

  const err = new Error('Invalid phone number format');
  err.code = 'FORMAT';
  err.retryable = false;
  throw err;
}

const smsExports = { sendSMS, formatSMS, isValidPhoneNumber, normalizeSmsPhone };
export default smsExports;
