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
//       idempotency_key, compliance_decision_id, turn_id?, is_fallback?, media_urls?: [url]}
//
// PLAN_4 stream X1 item 5: the shared secret alone no longer sends anything. The lead must be this dealer's,
// `to` must be that lead's (or its customer's) phone / email, the lead must not be DND, and the AI must name the
// send check's decision (`compliance_decision_id`, its ai_compliance_log row): with `findComplianceDecision`
// injected (the route does) it must be an ALLOW for this dealer, lead, channel and recipient from the last
// DECISION_MAX_AGE_MS. The id is kept on the Email row (`ai_compliance_decision_id`). Refusals are 422, never
// retried:
//   <- 422 {error, retryable: false, compliance: true}       no / wrong decision, recipient or DND
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
  constructor(message, { httpStatus = 502, retryable = true, optedOut = false, compliance = false } = {}) {
    super(message);
    this.name = 'AiSendError';
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    this.optedOut = optedOut;
    this.compliance = compliance;
  }
}

// PLAN_4 stream X1 item 5 ----------------------------------------------------------------------------------
export const DECISION_MAX_AGE_MS = 30 * 60 * 1000;
const DND_STATUS = /^\s*(dnd|do not disturb|do not contact)\s*$/i;
const refuse = (message) => new AiSendError(message, { httpStatus: 422, retryable: false, compliance: true });
const lastTen = (value) => String(value || '').replace(/\D/g, '').slice(-10);
const lowerTrim = (value) => String(value || '').trim().toLowerCase();

export function isDndLead(lead) {
  return ['fe_lead_status', 'lead_status', 'status'].some((k) => DND_STATUS.test(String(lead?.[k] || '')));
}

// `to` is one of the lead's (or its customer's) own contact points on that channel.
export function recipientBelongsToLead(channel, to, lead, customer) {
  if (channel === 'sms') {
    const want = lastTen(to);
    const phones = [lead?.phone, ...((customer?.phones || []).map((p) => p?.value))];
    return want.length === 10 && phones.some((p) => lastTen(p) === want);
  }
  const want = lowerTrim(to);
  const emails = [lead?.email, ...((customer?.emails || []).map((e) => e?.value))];
  return Boolean(want) && emails.some((e) => lowerTrim(e) === want);
}

// The AI's send-check row must be an ALLOW for exactly this send, and recent.
export function decisionAllowsSend(decision, body, now = new Date()) {
  if (!decision) return 'no such compliance decision';
  if (String(decision.dealer_id) !== String(body.dealer_id)) return 'the decision is for another dealer';
  if (decision.decision !== 'ALLOW') return `the decision is ${decision.decision}, not ALLOW`;
  if (String(decision.lead_id || '') !== String(body.lead_id)) return 'the decision is for another lead';
  if (decision.channel !== body.channel) return 'the decision is for another channel';
  const same = body.channel === 'sms' ? lastTen(decision.to) === lastTen(body.to) : lowerTrim(decision.to) === lowerTrim(body.to);
  if (!same) return 'the decision is for another recipient';
  const at = new Date(decision.logged_at || decision.at || 0).getTime();
  if (!at || now.getTime() - at > DECISION_MAX_AGE_MS) return 'the decision is too old';
  return null;
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

export function dealerAllowsMms(dealer) {
  return dealer?.ai_mms_enabled === true || dealer?.dealer_account_information?.ai_mms_enabled === true;
}

export async function sendAiMessage(body, {
  Email, Lead, User, EmailAccount, sendSMS, sendEmail, now = () => new Date(), Customer = null,
  findComplianceDecision = null,
}) {
  const { errors } = validateAiSendPayload(body);
  if (errors.length) throw Object.assign(new AiSendError('Invalid message', { httpStatus: 422, retryable: false }),
    { details: errors });
  if (!/^[a-f0-9]{24}$/i.test(String(body.compliance_decision_id || ''))) {
    throw refuse('No compliance decision from the AI send check (compliance_decision_id)');
  }

  // Idempotent on the key: a retried send that already went out is answered
  // with the first send's provider id and never sent twice.
  const existing = await Email.findOne({ ai_idempotency_key: body.idempotency_key })
    .select('_id message_id status').lean();
  if (existing && existing.status !== 'failed') {
    return { id: String(existing._id), provider_id: existing.message_id, status: 'sent', created: false, duplicate: true };
  }

  const dealer = await User.findOne({ _id: body.dealer_id, type: 'dealer' }).lean();
  if (!dealer) throw new AiSendError('Dealer not found', { httpStatus: 404, retryable: false });
  const lead = await Lead.findOne({ _id: body.lead_id, dealer_id: body.dealer_id })
    .select('_id email phone customer_id fe_lead_status lead_status status').lean();
  if (!lead) throw new AiSendError('Lead not found for this dealer', { httpStatus: 404, retryable: false });
  // PLAN_4 stream X1 item 5: DND, the recipient, and the AI's own send-check decision.
  if (isDndLead(lead)) throw refuse('The lead is DND: nothing is sent');
  const customer = Customer && lead.customer_id
    ? await Customer.findOne({ _id: lead.customer_id }).select('phones emails').lean() : null;
  if (!recipientBelongsToLead(body.channel, body.to, lead, customer)) {
    throw refuse(`${body.to} is not this lead's ${body.channel === 'sms' ? 'phone' : 'email'}`);
  }
  if (findComplianceDecision) {
    const problem = decisionAllowsSend(await findComplianceDecision(body.compliance_decision_id), body, now());
    if (problem) throw refuse(`Compliance decision ${body.compliance_decision_id} doesn't allow this send: ${problem}`);
  }

  // Photos by text (MMS) only for a dealer that switched it on: `ai_mms_enabled`,
  // the same dealer field the AI service reads before attaching any. Email
  // photos are inline images and need no switch.
  const mediaUrls = body.channel === 'sms' && !dealerAllowsMms(dealer) ? [] : (body.media_urls || []);
  body = { ...body, media_urls: mediaUrls };
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
        aiEmailHtml(body.text, mediaUrls), emailAccount.email_address, latest?.message_id || null,
        // The branded template reads these two objects without checking them.
        { ...dealer, branding_information: dealer.branding_information || {},
          dealer_account_information: dealer.dealer_account_information || {} });
    } catch (error) {
      throw classifyProviderError(error);
    }
  }
  if (!providerId) providerId = `ai-${body.idempotency_key}`;

  const document = {
    ...buildAiEmailDocument({
      payload: { ...body, status: 'sent', provider_id: String(providerId), sent_at: now().toISOString(),
        sent_via_platform: true },
      dealer, emailAccount,
    }),
    ai_compliance_decision_id: String(body.compliance_decision_id),
  };
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
