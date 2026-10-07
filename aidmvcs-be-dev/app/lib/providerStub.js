// Local / dev guard for the platform's outbound providers (Twilio SMS/MMS,
// SMTP / SES email). With PROVIDER_SEND_STUB=true nothing leaves the machine:
// sendSMS / sendEmail (app/lib/sms.js, app/lib/email.js) and the account
// mails in app/lib/emailservice.js return a fake provider id instead of
// calling the provider, and each "send" is written to the dev_provider_outbox
// collection so a local run (and the end-to-end check) can see exactly what
// would have gone out, media included.
//
// `make crm-local` / `make dev-full` always set it. It is refused in
// production (NODE_ENV=production), so a stray flag can never silently stop a
// live dealer's messages.
//
// Imports are relative/dynamic so the BullMQ workers (plain Node) can use it.

import crypto from 'node:crypto';

export const PROVIDER_OUTBOX_COLLECTION = 'dev_provider_outbox';

export function isProviderSendStubbed(env = process.env) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') return false;
  return ['true', '1', 'yes'].includes(String(env.PROVIDER_SEND_STUB || '').toLowerCase());
}

// Twilio-like ids for SMS (SM + 32 hex) and RFC-5322-like ids for email, so
// threading code that inspects them keeps working.
export function stubProviderId(channel) {
  const hex = crypto.randomBytes(16).toString('hex');
  return channel === 'sms' ? `SMstub${hex.slice(0, 26)}` : `<stub-${hex}@local-dev.invalid>`;
}

// Best effort: a failure to write the dev outbox never fails the "send".
export async function recordStubSend(entry) {
  const providerId = entry.provider_id || stubProviderId(entry.channel);
  try {
    const { default: mongoose } = await import('mongoose');
    if (mongoose.connection?.readyState === 1) {
      await mongoose.connection.collection(PROVIDER_OUTBOX_COLLECTION).insertOne({
        ...entry, provider_id: providerId, created_at: new Date(),
      });
    }
  } catch (error) {
    console.warn('[provider-stub] could not record stub send', error?.message);
  }
  const otpMatch = (entry.text || entry.html || entry.subject || '').match(/\b\d{4}\b/);
  const otpInfo = otpMatch ? ` [OTP CODE: ${otpMatch[0]}]` : '';
  console.log(`[provider-stub] ${entry.channel} to ${entry.to}${otpInfo} NOT sent (PROVIDER_SEND_STUB) id=${providerId}`);
  return providerId;
}
