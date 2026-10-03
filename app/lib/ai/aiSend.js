// The platform sends a message for the AI service (CHANNEL_DRIVER=platform,
// agentic-upsell channels/platform.py): through the platform's own sendSMS /
// sendEmail, from the dealer's own Twilio number / mailbox, so every AI
// message goes out exactly like a staff message and shows in the dealer's
// conversation screen.
//
// Called by app/api/internal/ai/messages/send/route.js. Kept free of Next.js
// and of module-level provider clients (everything is injected) so it is unit
// tested directly (test-ai-layer.js) and against MongoDB
// (test-ai-layer-integration.js).
//
// Contract:
//   -> {dealer_id, lead_id, customer_id, channel, to, text, subject?,
//       idempotency_key, turn_id?, is_fallback?, media_urls?: [url]}
//   <- 200 {id, provider_id, status: "sent", created}       sent + recorded
//   <- 200 {..., duplicate: true}                           already sent once for this key
//   <- 422 {error, retryable: false, opted_out: true}       provider says STOP
//   <- 422 {error, retryable: false}                        permanent (bad number, no sender)
//   <- 502 {error, retryable: true}                         provider down / timeout
// The Email row is written only for a successful send. A failure is recorded
// by the AI service afterwards (POST /api/internal/ai/messages, status
// "failed"), once it has given up retrying.

import { aiEmailHtml, buildAiEmailDocument, validateAiSendPayload } from './aiMessageRecord.js';

export class AiSendError extends Error {
  constructor(message, { httpStatus = 502, retryable = true, optedOut = false } = {}) {
    super(message);
    this.name = 'AiSendError';
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    this.optedOut = optedOut;
  }
}

// sendSMS marks its errors (retryable, reason); sendEmail doesn't.
export function classifyProviderError(error) {
  if (error?.reason === 'unsubscribed' || error?.code === 21610) {
    return new AiSendError(`The customer opted out of texts from this number: ${error.message}`,
      { httpStatus: 422, retryable: false, optedOut: true });
  }
  if (error?.retryable === false) {
    return new AiSendError(error.message || 'Provider refused the message', { httpStatus: 422, retryable: false });
  }
  return new AiSendError(error?.message || 'Provider failed', { httpStatus: 502, retryable: true });
}

export async function sendAiMessage(body, {
  Email, Lead, User, EmailAccount, sendSMS, sendEmail, now = () => new Date(),
}) {
  const { errors } = validateAiSendPayload(body);
  if (errors.length) throw Object.assign(new AiSendError('Invalid message', { httpStatus: 422, retryable: false }),
    { details: errors });

  // Idempotent on the key: a retried send that already went out is answered
  // with the first send's provider id and never sent twice.
  const existing = await Email.findOne({ ai_idempotency_key: body.idempotency_key })
    .select('_id message_id status').lean();
  if (existing && existing.status !== 'failed') {
    return { id: String(existing._id), provider_id: existing.message_id, status: 'sent', created: false, duplicate: true };
  }

  const dealer = await User.findOne({ _id: body.dealer_id, type: 'dealer' }).lean();
  if (!dealer) throw new AiSendError('Dealer not found', { httpStatus: 404, retryable: false });
  const lead = await Lead.findOne({ _id: body.lead_id, dealer_id: body.dealer_id }).select('_id email phone').lean();
  if (!lead) throw new AiSendError('Lead not found for this dealer', { httpStatus: 404, retryable: false });

  const mediaUrls = body.media_urls || [];
  let providerId;
  let emailAccount = null;
  if (body.channel === 'sms') {
    if (!dealer.dealer_account_information?.sms_conversion_phone) {
      throw new AiSendError('Dealer has no Twilio number (sms_conversion_phone)', { httpStatus: 422, retryable: false });
    }
    try {
      providerId = await sendSMS(body.to, body.text, dealer, mediaUrls);
    } catch (error) {
      throw classifyProviderError(error);
    }
  } else {
    emailAccount = await EmailAccount.findOne({ dealer_id: dealer._id, active: { $ne: false } })
      .select('email_address').lean();
    if (!emailAccount?.email_address) {
      throw new AiSendError('Dealer has no mailbox (EmailAccount)', { httpStatus: 422, retryable: false });
    }
    // Thread under the lead's latest email, like a staff reply does.
    const latest = await Email.findOne({ lead_id: lead._id, communication_type: 'email', message_id: { $ne: null } })
      .sort({ timestamp: -1 }).select('message_id').lean();
    try {
      providerId = await sendEmail(body.to, body.subject || 'Thank you for your inquiry',
        aiEmailHtml(body.text, mediaUrls), emailAccount.email_address, latest?.message_id || null, dealer);
    } catch (error) {
      throw classifyProviderError(error);
    }
  }
  if (!providerId) providerId = `ai-${body.idempotency_key}`;

  const document = buildAiEmailDocument({
    payload: { ...body, status: 'sent', provider_id: String(providerId), sent_at: now().toISOString(),
      sent_via_platform: true },
    dealer, emailAccount,
  });
  try {
    if (existing) {
      // An earlier attempt was recorded as failed; this one went out.
      await Email.updateOne({ _id: existing._id }, { $set: document });
      return { id: String(existing._id), provider_id: String(providerId), status: 'sent', created: false };
    }
    const created = await Email.create(document);
    return { id: String(created._id), provider_id: String(providerId), status: 'sent', created: true };
  } catch (error) {
    if (error?.code === 11000) {
      const winner = await Email.findOne({ ai_idempotency_key: body.idempotency_key }).select('_id').lean();
      if (winner) return { id: String(winner._id), provider_id: String(providerId), status: 'sent', created: false };
    }
    // Sent but not recorded: still report the send (the AI service records it
    // again through /api/internal/ai/messages, idempotently).
    console.error('[ai] message sent but not recorded', { key: body.idempotency_key, error: error?.message });
    return { id: null, provider_id: String(providerId), status: 'sent', created: false, record_error: error?.message };
  }
}
