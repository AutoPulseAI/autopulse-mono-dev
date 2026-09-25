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
import { notifyAiOfInbound, notifyAiOfNewLead } from './aiDispatch.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  notifyInbound = notifyAiOfInbound, logger = console }) {
  const dealerId = String(currentSMS.dealer_id || dealer?._id);
  const from = currentSMS.sender;
  const text = currentSMS.mail_content || currentSMS.body || '';

  // 1. Which lead? The SMS webhook already linked replies to earlier messages
  // in the same phone-number pair; fall back to the thread, then the number.
  let lead = null;
  if (currentSMS.lead_id) lead = await Lead.findOne({ _id: currentSMS.lead_id, dealer_id: dealerId });
  if (!lead) lead = await leadFromParent(currentSMS.parent_message_id || currentSMS.parent_conversation, dealerId);
  if (!lead && from) lead = await Lead.findOne({ dealer_id: dealerId, phone: from }).sort({ createdAt: -1 });

  let created = false;
  if (!lead) {
    lead = await new Lead(newLeadFields({ dealerId, channel: 'sms', comments: text, phone: from })).save();
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
    ? await notifyNewLead({ lead, dealerId, channel: 'sms', mode: 'live', logger })
    : await notifyInbound({ emailRecord: record, lead, dealerId, channel: 'sms', text, mode: 'live', logger });
  logger.info?.('[ai] live inbound SMS handled', {
    lead_id: String(lead._id), created, email_id: String(record._id), event: event?.status,
  });
  return { leadId: lead._id, created, emailRecordId: record._id, event };
}

export async function handleInboundEmailLive({ currentEmail, dealer, notifyNewLead = notifyAiOfNewLead,
  notifyInbound = notifyAiOfInbound, logger = console }) {
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
  if (!lead && senderEmail) lead = await Lead.findOne({ dealer_id: dealerId, email: senderEmail }).sort({ createdAt: -1 });

  let created = false;
  if (!lead) {
    if (!senderEmail) {
      logger.warn?.('[ai] live inbound email has no usable sender address; not creating a lead',
        { message_id: currentEmail.message_id });
      return { status: 'no_sender', emailRecordId: record._id };
    }
    lead = await new Lead(newLeadFields({
      dealerId, channel: 'email', comments: text, name: senderName, email: senderEmail,
    })).save();
    await linkCustomerToLead(lead, { source: 'email' });
    created = true;
  }

  if (!record.lead_id || String(record.lead_id) !== String(lead._id)) {
    await Email.updateOne({ _id: record._id }, { $set: { lead_id: lead._id } });
  }
  await Lead.updateOne({ _id: lead._id }, { $set: { response_mode: 'email', last_inbound_at: new Date() } });

  const event = created
    ? await notifyNewLead({ lead, dealerId, channel: 'email', mode: 'live', logger })
    : await notifyInbound({ emailRecord: record, lead, dealerId, channel: 'email', text, mode: 'live', logger });
  logger.info?.('[ai] live inbound email handled', {
    lead_id: String(lead._id), created, email_id: String(record._id), event: event?.status,
  });
  return { leadId: lead._id, created, emailRecordId: record._id, event };
}
