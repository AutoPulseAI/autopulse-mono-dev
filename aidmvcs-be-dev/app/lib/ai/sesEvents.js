// Amazon SES email events, through an SNS topic, on each email in the CRM (the user, 30 Oct 2026: "the campaign emails
// show delivered, opened, clicked, bounced - why not the emails we send?"). The AI's and staff's emails go out through
// SES with a configuration set (SES_CONFIGURATION_SET) whose events reach POST /api/webhooks/ses.
//   Delivery   -> delivered
//   Bounce     -> bounced; a permanent bounce stops emails to that address (an email opt-out the AI reads) + a note
//   Complaint  -> marked as spam: an email opt-out (required) + a note
//   Open/Click -> opened_at / clicked_at and counts
// Every SNS message is checked against Amazon's signature first, so nobody can fake a status.
import crypto from 'crypto';

const CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const certCache = new Map();

const SIGNED_FIELDS = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

export function snsStringToSign(message) {
  const fields = SIGNED_FIELDS[message?.Type];
  if (!fields) return null;
  return fields.filter((f) => message[f] !== undefined && message[f] !== null)
    .map((f) => `${f}\n${message[f]}\n`).join('');
}

export function validCertUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && CERT_HOST.test(u.hostname) && u.pathname.endsWith('.pem');
  } catch {
    return false;
  }
}

// True when the message is signed by Amazon SNS (and, if SES_SNS_TOPIC_ARN is set, comes from our topic).
export async function verifySnsMessage(message, { fetchCert = defaultFetchCert, topicArn = process.env.SES_SNS_TOPIC_ARN } = {}) {
  if (!message?.Signature || !validCertUrl(message.SigningCertURL)) return false;
  if (topicArn && message.TopicArn !== topicArn) return false;
  const text = snsStringToSign(message);
  if (!text) return false;
  const pem = await fetchCert(message.SigningCertURL);
  if (!pem) return false;
  const algorithm = String(message.SignatureVersion) === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
  try {
    return crypto.createVerify(algorithm).update(text, 'utf8').verify(pem, message.Signature, 'base64');
  } catch {
    return false;
  }
}

async function defaultFetchCert(url) {
  if (certCache.has(url)) return certCache.get(url);
  const res = await fetch(url);
  if (!res.ok) return null;
  const pem = await res.text();
  certCache.set(url, pem);
  return pem;
}

// The CRM's Email for an SES message id ("010001a1...", stored as "<010001a1...@email.amazonses.com>").
export async function findEmailForSes(Email, sesMessageId) {
  if (!sesMessageId) return null;
  return Email.findOne({ message_id: { $in: [`<${sesMessageId}@email.amazonses.com>`, sesMessageId] } })
    .select('_id lead_id dealer_id ai_customer_id recipient').lean();
}

// What one SES event changes on the email: [$set/$inc/$min update, follow-up action or null].
export function sesEventUpdate(event) {
  const type = event?.eventType || event?.notificationType;
  const at = (t) => (t ? new Date(t) : new Date());
  if (type === 'Delivery') {
    return [{ $set: { status: 'delivered', email_event: 'delivered', delivered_at: at(event.delivery?.timestamp) } }, null];
  }
  if (type === 'Bounce') {
    const permanent = event.bounce?.bounceType === 'Permanent';
    return [{ $set: { status: 'bounced', email_event: 'bounced', bounced_at: at(event.bounce?.timestamp),
      bounce_type: event.bounce?.bounceType || null, bounce_subtype: event.bounce?.bounceSubType || null } },
    permanent ? 'suppress_bounce' : null];
  }
  if (type === 'Complaint') {
    return [{ $set: { email_event: 'complaint', complained_at: at(event.complaint?.timestamp) } }, 'suppress_complaint'];
  }
  if (type === 'Open') {
    return [{ $inc: { open_count: 1 }, $min: { opened_at: at(event.open?.timestamp) } }, null];
  }
  if (type === 'Click') {
    return [{ $inc: { click_count: 1 }, $min: { clicked_at: at(event.click?.timestamp) },
      $set: { last_clicked_link: String(event.click?.link || '').slice(0, 500) } }, null];
  }
  return [null, null];
}

const NOTES = {
  suppress_bounce: 'This email address bounced (it does not exist or no longer accepts mail). No more emails go to it; '
    + 'please check the customer\'s email.',
  suppress_complaint: 'The customer marked our email as spam. No more emails go to them; texts are not affected.',
};

// Applies one SES event. Returns what happened, for the response and the log.
export async function applySesEvent(event, { Email, Lead, db }) {
  const sesId = event?.mail?.messageId;
  const email = await findEmailForSes(Email, sesId);
  if (!email) return { applied: false, reason: 'no email for this SES message' };
  const [update, action] = sesEventUpdate(event);
  if (!update) return { applied: false, reason: `event ${event?.eventType} not tracked` };
  await Email.collection.updateOne({ _id: email._id }, update);
  if (action) {
    const lead = await Lead.findById(email.lead_id).select('email customer_id').lean();
    const address = String(lead?.email || email.recipient || '').trim().toLowerCase() || null;
    const now = new Date();
    const source = action === 'suppress_bounce' ? 'ses_bounce' : 'ses_complaint';
    const evidenceId = `${source}:${sesId}`;
    if (!(await db.collection('ai_consent').findOne({ consent_evidence_id: evidenceId }))) {
      // An email opt-out the AI reads (agentic-upsell channels/consent.py); texts are not touched.
      await db.collection('ai_consent').insertOne({
        dealer_id: String(email.dealer_id), customer_id: email.ai_customer_id || (lead?.customer_id ? String(lead.customer_id) : null),
        channel: 'email', consent_type: 'opt_out', consent_status: 'opted_out', consent_source: source,
        consent_timestamp: now, consent_text_version: null, consent_evidence_id: evidenceId,
        consenting_seller_id: String(email.dealer_id), source_url: null, lead_id: String(email.lead_id),
        evidence: { email_id: String(email._id), ses_message_id: sesId }, recorded_at: now,
        ...(address ? { address } : {}),
      });
      await Lead.collection.updateOne({ _id: email.lead_id }, { $set: action === 'suppress_bounce'
        ? { email_bounced: true, email_bounced_at: now } : { email_unsubscribed: true, email_unsubscribed_at: now } });
      await Email.create({
        sender: 'AutoPulse AI', recipient: 'staff', subject: 'Lead Note', status: 'sent', communication_type: 'note',
        mail_content: NOTES[action], dealer_id: String(email.dealer_id), lead_id: email.lead_id, is_note: true,
        internal_use: true, message_id: `note_${evidenceId}`, timestamp: now, date: now, ai_generated: true,
      });
    }
  }
  return { applied: true, event: event.eventType, email_id: String(email._id), action };
}
