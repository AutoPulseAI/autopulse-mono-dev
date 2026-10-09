// Inbound SMS / email for a dealer in AI `live` mode (MASTER_PLAN_1 Stage 5).
//
// In `off` and `shadow` mode, app/worker/processSms.js and emailWorker.js run
// their existing n8n flow, where n8n decides whether a message is a new lead,
// what to reply, and on which channel. In `live` mode none of that runs.
// These functions do the small deterministic part the platform still owns:
//
//   1. find the lead this message belongs to (thread link -> sender), or
//      create one for a first contact, and link its Customer;
//   2. save the inbound message as an Email record, linked to the lead, so
//      it shows in the conversation screen;
//   3. tell the AI service: `lead-created` for a new lead, otherwise
//      `inbound-message`. The AI service sends the reply and records it back
//      through POST /api/internal/ai/messages.
//
// No auto-reply, no n8n, no FollowUpJob scheduling: the AI service owns the
// conversation for live dealers (architecture §4-§6).

import Lead from '../../models/Lead.js';
import Email from '../../models/Email.js';
import { linkCustomerToLead } from '../customerResolver.js';
import { parseAdfLeadEmail } from '../adfLeadParser.js';
import { notifyAiOfInbound, notifyAiOfNewLead } from './aiDispatch.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- PLAN_4 stream X3 items 7 and 8 -------------------------------------------------------------------------
//
// Production's data has phones in many formats ("+15551234567", "(555) 123-4567", "5551234567"), and its SMS
// webhook does not thread replies (no lead_id on the inbound SMS), so an exact-string match made a NEW lead per
// reply, which then got a first-touch greeting. Every format of the number is matched now.
//
// A lead that is closed (Closed - Lost / No Longer Owns) is the end of THAT opportunity, not of the customer
// (client, 1 Oct 2026): a returning customer's message starts a new lead, so an appointment booked there gets its
// confirmation, reminders and cadence (the AI keeps a closed lead's stage, and refuses those there).

export const CLOSED_LEAD_STATUSES = Object.freeze(['closed - lost', 'closed lost', 'closed - no longer owns', 'lost',
  'dead']);

export function isClosedLead(lead) {
  const status = String(lead?.fe_lead_status || lead?.lead_status || lead?.status || '').trim().toLowerCase();
  return CLOSED_LEAD_STATUSES.includes(status);
}

export function phoneVariants(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return raw ? [raw] : [];
  const ten = digits.slice(-10);
  const [a, b, c] = [ten.slice(0, 3), ten.slice(3, 6), ten.slice(6)];
  return [...new Set([raw, ten, `+1${ten}`, `1${ten}`, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`,
    `+1 (${a}) ${b}-${c}`, `+1 ${a}-${b}-${c}`])];
}

// The customer's leads, newest first; the open one wins, else null (all closed) with `closedOnly` set.
export async function openLeadFor({ dealerId, phone = null, email = null, LeadModel = Lead }) {
  const ors = [];
  if (phone) ors.push({ phone: { $in: phoneVariants(phone) } });
  if (email) ors.push({ email: { $regex: `^${String(email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
  if (!ors.length) return { lead: null, closedOnly: false };
  const leads = await LeadModel.find({ dealer_id: dealerId, $or: ors }).sort({ createdAt: -1, _id: -1 }).limit(20);
  const open = leads.find((lead) => !isClosedLead(lead));
  return { lead: open || null, closedOnly: !open && leads.length > 0, previous: leads[0] || null };
}

// Lead emails from a portal or a lead provider come from their own no-reply address: the customer is in the body.
const PORTAL_SENDER = /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|leads?|notifications?|alerts?|mailer|inquir(y|ies)|messages?)([._+-]|@)/i;
const PORTAL_DOMAINS = /@(?:[\w-]+\.)*(?:cars\.com|cargurus\.com|autotrader\.com|truecar\.com|edmunds\.com|kbb\.com|carfax\.com|carvana\.com|capitalone\.com|facebookmail\.com|dealerinspire\.com|dealer\.com|dealeron\.com|carsforsale\.com|autolist\.com|craigslist\.org|700credit\.com|routeone\.net|dealertrack\.com)$/i;

export function isPortalSender(address) {
  const email = String(address || '').toLowerCase();
  return Boolean(email) && (PORTAL_DOMAINS.test(email) || PORTAL_SENDER.test(email.split('@')[0] + '@'));
}

function field(text, labels) {
  for (const label of labels) {
    const m = text.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:\\-]\\s*([^\\n]+)`, 'i'));
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

// "Name: Jane Doe / Email: jane@x.com / Phone: (555) 123-4567" in a plain lead email. Null when it names no way
// to reach a customer other than the sender itself.
export function parsePlainLeadEmail(text, senderEmail = null) {
  const body = String(text || '').replace(/\r/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  const sender = String(senderEmail || '').toLowerCase();
  let email = field(body, ['e-?mail(?: address)?', 'customer e-?mail', 'buyer e-?mail']);
  email = email && (email.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/) || [null])[0];
  if (!email) {
    email = (body.match(/[^\s<>@:]+@[^\s<>@]+\.[a-z]{2,}/gi) || [])
      .find((found) => found.toLowerCase() !== sender && !isPortalSender(found)) || null;
  }
  const phoneText = field(body, ['phone(?: number)?', 'mobile', 'cell', 'telephone', 'customer phone']);
  const phoneDigits = String(phoneText || '').replace(/\D/g, '');
  const phone = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : null;
  const first = field(body, ['first name']);
  const last = field(body, ['last name']);
  const name = field(body, ['name', 'customer name', 'full name', 'buyer name', 'from'])
    || [first, last].filter(Boolean).join(' ') || null;
  if (email && email.toLowerCase() === sender) email = null;
  if (!email && !phone) return null;
  return { name: name && !EMAIL_PATTERN.test(name) ? name.slice(0, 120) : undefined, email: email ? email.toLowerCase() : undefined,
    phone: phone || undefined };
}

// The customer a lead email is about: ADF XML first (production has no ADF parser - this is ours), then a plain
// portal email's fields. Null for a person writing to the dealer themselves.
export function customerFromLeadEmail(text, senderEmail) {
  if (/<adf[\s>]/i.test(String(text || ''))) {
    try {
      const adf = parseAdfLeadEmail(text);
      if (adf) {
        return { kind: 'adf', name: adf.name || undefined, email: adf.email ? adf.email.toLowerCase() : undefined,
          phone: adf.phone ? String(adf.phone).replace(/\D/g, '').slice(-10) || undefined : undefined,
          comments: adf.comments || '', source: adf.source || 'ADF/XML' };
      }
    } catch {
      // an ADF the parser can't read falls through to the plain-email reading
    }
  }
  const plain = parsePlainLeadEmail(text, senderEmail);
  if (plain && (isPortalSender(senderEmail) || !senderEmail)) {
    return { kind: 'portal', ...plain, comments: String(text || '').slice(0, 2000),
      source: String(senderEmail || '').split('@')[1] || 'email' };
  }
  return null;
}

function newLeadFields({ dealerId, channel, comments, name, email, phone }) {
  return {
    name,
    email,
    phone,
    source: channel,
    dealer_id: dealerId,
    lead_status: 'New',
    fe_lead_status: 'Lead',
    status: 'New',
    followup_preference: channel,
    response_mode: channel,
    comments,
    user_language: 'english',
    data: { comments, channel, created_by: 'ai_live_inbound' },
    statusChangedAt: new Date(),
  };
}

// "Jane Doe <jane@x.com>" -> { email: 'jane@x.com', name: 'Jane Doe' }
export function parseSenderHeader(sender) {
  const raw = typeof sender === 'string' ? sender.trim() : '';
  const bracketed = raw.match(/^(.*)<([^>]+)>\s*$/);
  const email = (bracketed ? bracketed[2] : raw).trim().toLowerCase();
  const name = bracketed ? bracketed[1].replace(/["']/g, '').trim() || undefined : undefined;
  return EMAIL_PATTERN.test(email) ? { email, name } : { email: null, name };
}

async function leadFromParent(parentId, dealerId) {
  if (!parentId) return null;
  const parent = await Email.findOne({ message_id: parentId, dealer_id: dealerId, lead_id: { $ne: null } })
    .sort({ timestamp: -1 });
  return parent?.lead_id ? Lead.findOne({ _id: parent.lead_id, dealer_id: dealerId }) : null;
}

export async function handleInboundSmsLive({ currentSMS, dealer, notifyNewLead = notifyAiOfNewLead,
  notifyInbound = notifyAiOfInbound, logger = console, mode = 'live' }) {
  const dealerId = String(currentSMS.dealer_id || dealer?._id);
  const from = currentSMS.sender;
  const text = currentSMS.mail_content || currentSMS.body || '';

  // 1. Which lead? The SMS webhook already linked replies to earlier messages
  // in the same phone-number pair; fall back to the thread, then the number.
  let lead = null;
  if (currentSMS.lead_id) lead = await Lead.findOne({ _id: currentSMS.lead_id, dealer_id: dealerId });
  if (!lead) lead = await leadFromParent(currentSMS.parent_message_id || currentSMS.parent_conversation, dealerId);
  if (lead && isClosedLead(lead)) lead = null; // threaded to a closed lead: a returning customer (item 8)
  let returning = null;
  if (!lead && from) {
    const found = await openLeadFor({ dealerId, phone: from });
    lead = found.lead;
    if (found.closedOnly) returning = found.previous;
  }

  let created = false;
  if (!lead) {
    lead = await new Lead({
      ...newLeadFields({ dealerId, channel: 'sms', comments: text, phone: from }),
      ...(returning ? { name: returning.name, email: returning.email, previous_lead_id: returning._id } : {}),
    }).save();
    // A customer texting in is a real (if narrow) opt-in signal, matching processSms.js.
    await linkCustomerToLead(lead, { source: 'sms', smsOptIn: true });
    created = true;
  }

  // 2. Save the inbound SMS, as processSms.js does.
  const record = await new Email({
    ...currentSMS,
    media: undefined,
    lead_id: lead._id,
    parent_message_id: currentSMS.parent_message_id ?? null,
    communication_type: 'sms',
    status: currentSMS.status || 'received',
    user_language: lead.user_language || 'english',
  }).save();
  await Lead.updateOne({ _id: lead._id }, { $set: { response_mode: 'sms', last_inbound_at: new Date() } });

  // 3. Tell the AI service.
  const event = created
    ? await notifyNewLead({ lead, dealerId, channel: 'sms', mode, logger })
    : await notifyInbound({ emailRecord: record, lead, dealerId, channel: 'sms', text, mode, logger });
  logger.info?.('[ai] live inbound SMS handled', {
    lead_id: String(lead._id), created, email_id: String(record._id), event: event?.status,
  });
  return { leadId: lead._id, created, emailRecordId: record._id, event };
}

export async function handleInboundEmailLive({ currentEmail, dealer, notifyNewLead = notifyAiOfNewLead,
  notifyInbound = notifyAiOfInbound, logger = console, mode = 'live' }) {
  const dealerId = String(currentEmail.dealer_id || dealer?._id);
  const text = currentEmail.mail_content || currentEmail.emailBody || '';

  // /api/system saved this email before queueing it, and linked it to a lead
  // when it's a reply in a known thread.
  let record = null;
  if (currentEmail.email_record_id) record = await Email.findOne({ _id: currentEmail.email_record_id, dealer_id: dealerId });
  if (!record) record = await Email.findOne({ message_id: currentEmail.message_id, dealer_id: dealerId }).sort({ timestamp: -1 });
  if (!record) {
    logger.error?.('[ai] live inbound email: saved Email record not found', { message_id: currentEmail.message_id });
    return { status: 'missing_record' };
  }

  let lead = record.lead_id ? await Lead.findOne({ _id: record.lead_id, dealer_id: dealerId }) : null;
  if (!lead) lead = await leadFromParent(currentEmail.parent_message_id || currentEmail.parent_conversation, dealerId);

  const { email: senderEmail, name: senderName } = parseSenderHeader(currentEmail.sender);
  if (lead && isClosedLead(lead)) lead = null; // a returning customer (item 8)
  // A lead email (ADF, or a portal's plain notification) is about the customer in its body, never its sender.
  const leadEmail = lead ? null : customerFromLeadEmail(text, senderEmail);
  const portal = isPortalSender(senderEmail);
  let returning = null;
  if (!lead) {
    const who = leadEmail || (portal ? null : { email: senderEmail });
    if (who && (who.email || who.phone)) {
      const found = await openLeadFor({ dealerId, phone: who.phone, email: who.email });
      lead = found.lead;
      if (found.closedOnly) returning = found.previous;
    }
  }

  let created = false;
  if (!lead) {
    if (!leadEmail && (portal || !senderEmail)) {
      // A portal email we can't read a customer from: never a lead addressed to the portal itself.
      logger.warn?.('[ai] live inbound email names no customer to contact; not creating a lead',
        { message_id: currentEmail.message_id, portal });
      return { status: portal ? 'portal_without_customer' : 'no_sender', emailRecordId: record._id };
    }
    const contact = leadEmail || { name: senderName, email: senderEmail };
    const channel = leadEmail && contact.phone ? 'sms' : 'email';
    lead = await new Lead({
      ...newLeadFields({ dealerId, channel, comments: leadEmail ? (leadEmail.comments || text) : text,
        name: contact.name, email: contact.email, phone: contact.phone }),
      ...(leadEmail ? { source: leadEmail.source, data: { comments: leadEmail.comments || text, channel,
        created_by: `ai_live_inbound_${leadEmail.kind}` } } : {}),
      ...(returning ? { previous_lead_id: returning._id } : {}),
    }).save();
    await linkCustomerToLead(lead, { source: leadEmail ? leadEmail.kind : 'email' });
    created = true;
  }

  if (!record.lead_id || String(record.lead_id) !== String(lead._id)) {
    await Email.updateOne({ _id: record._id }, { $set: { lead_id: lead._id } });
  }
  const replyChannel = created && lead.followup_preference === 'sms' ? 'sms' : 'email';
  await Lead.updateOne({ _id: lead._id }, { $set: { response_mode: replyChannel, last_inbound_at: new Date() } });

  const event = created
    ? await notifyNewLead({ lead, dealerId, channel: replyChannel, mode, logger })
    : await notifyInbound({ emailRecord: record, lead, dealerId, channel: 'email', text, mode, logger });
  logger.info?.('[ai] live inbound email handled', {
    lead_id: String(lead._id), created, email_id: String(record._id), event: event?.status,
  });
  return { leadId: lead._id, created, emailRecordId: record._id, event };
}
