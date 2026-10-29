// What "Contacted" means on the dashboard and in the Leads filter (client, 10 Oct 2026): the customer and the
// dealership have actually talked - the customer replied to us, or the customer wrote to us first. Not a status
// someone or something set. Read from the conversation itself:
//   - any text from the customer, or
//   - an email from the customer that isn't the lead's own arrival (the portal's lead email / ADF file is the
//     first inbound email of an email lead, so it doesn't count).
// The numbers are set in AI Studio (SMS, Email & Compliance -> "What counts as Contacted"; client, 13 Oct 2026).
import Email from '../models/Email.js';
import { AiConfigItem, AiConfigVersion } from '../models/AiConfig.js';

const INBOUND = ['received', 'incoming'];
const ADF = /<\?adf|<adf[\s>]/i;
const DEFAULT_RULE = { customer_texts: 1, customer_emails: 2 };
let cached = { at: 0, rule: DEFAULT_RULE };

export async function contactedRule() {
  if (Date.now() - cached.at < 60000) return cached.rule;
  let rule = DEFAULT_RULE;
  try {
    const item = await AiConfigItem.findOne({ type: 'compliance', key: 'contacted', dealer_id: null,
      deleted: { $ne: true } }).lean();
    const version = item?.published_version
      ? await AiConfigVersion.findOne({ item_id: item._id, version: item.published_version }).lean() : null;
    const c = version?.content || {};
    rule = { customer_texts: Number(c.customer_texts) > 0 ? Number(c.customer_texts) : DEFAULT_RULE.customer_texts,
      customer_emails: Number(c.customer_emails) > 0 ? Number(c.customer_emails) : DEFAULT_RULE.customer_emails };
  } catch { /* the built-in rule */ }
  cached = { at: Date.now(), rule };
  return rule;
}

export async function contactedLeadIds(leadIds, { EmailModel = Email, rule = null } = {}) {
  if (!leadIds?.length) return [];
  const { customer_texts: minTexts, customer_emails: minEmails } = rule || await contactedRule();
  const rows = await EmailModel.aggregate([
    { $match: { lead_id: { $in: leadIds }, status: { $in: INBOUND }, is_note: { $ne: true }, is_lead_email: { $ne: true } } },
    { $project: { lead_id: 1, communication_type: 1,
      adf: { $regexMatch: { input: { $cond: [{ $eq: [{ $type: '$mail_content' }, 'string'] }, '$mail_content', ''] },
        regex: ADF.source, options: 'i' } },
      lead_msg: { $regexMatch: { input: { $ifNull: ['$message_id', ''] }, regex: '^lead-' } } } },
    { $match: { adf: false, lead_msg: false } },
    { $group: { _id: '$lead_id',
      sms: { $sum: { $cond: [{ $eq: ['$communication_type', 'sms'] }, 1, 0] } },
      email: { $sum: { $cond: [{ $eq: ['$communication_type', 'email'] }, 1, 0] } } } },
    { $match: { $or: [{ sms: { $gte: minTexts } }, { email: { $gte: minEmails } }] } },
  ]);
  return rows.map((r) => r._id);
}

// Betsy, 27 Oct 2026 meeting ("Customer Replied" listed leads created that day; "if a lead from two months ago replies
// today it should be in this list - even if they put stop"): the leads among `leadIds` with a customer message in
// [from, to], whenever the lead came in, latest reply first: [{ _id, last_reply_at }]. A lead's own arrival (the
// portal's email / ADF) is not a reply.
// One channel of our messages, for the Messages card's list (28 Oct 2026 meeting: "you will add that filter"). MMS: a
// text with a photo; SMS: a text without one.
const CHANNEL_MATCH = {
  sms: { communication_type: 'sms', has_attachments: { $ne: true } },
  mms: { communication_type: 'sms', has_attachments: true },
  email: { communication_type: { $ne: 'sms' } },
};

export async function repliedLeadIds(leadIds, from, to, { EmailModel = Email, direction = 'received', channel = null } = {}) {
  if (!leadIds?.length) return [];
  const at = {};
  if (from) at.$gte = from;
  if (to) at.$lte = to;
  // Betsy, 27 Oct 2026 meeting: "how many went out today - who did they go out to": direction 'sent' is the same list
  // for our messages to the customer (AI, staff or automatic; not notes).
  const status = direction === 'sent' ? { $nin: [...INBOUND, 'note'] } : { $in: INBOUND };
  const rows = await EmailModel.aggregate([
    { $match: { lead_id: { $in: leadIds }, status, is_note: { $ne: true }, is_lead_email: { $ne: true },
      ...(from || to ? { timestamp: at } : {}), ...(CHANNEL_MATCH[channel] || {}) } },
    { $project: { lead_id: 1, timestamp: 1,
      adf: { $regexMatch: { input: { $cond: [{ $eq: [{ $type: '$mail_content' }, 'string'] }, '$mail_content', ''] },
        regex: ADF.source, options: 'i' } },
      lead_msg: { $regexMatch: { input: { $ifNull: ['$message_id', ''] }, regex: '^lead-' } } } },
    { $match: { adf: false, lead_msg: false } },
    { $group: { _id: '$lead_id', last_reply_at: { $max: '$timestamp' } } },
    { $sort: { last_reply_at: -1 } },
  ]);
  return rows;
}

const FAILED = ['failed', 'undelivered', 'bounced', 'error'];

// The dashboard's Messages card (Betsy, 27 Oct 2026 meeting: "I want to know how many were sent today and how many were
// received - I need to know if the cadences are firing"): our messages to these leads' customers in [from, to] by who
// sent them, and the customers' messages back. Notes and the portal's lead email are not messages.
export async function messageActivity(leadIds, from, to, { EmailModel = Email } = {}) {
  const empty = { sent: { total: 0, ai: 0, staff: 0, automatic: 0, failed: 0, customers: 0 },
    delivered: { total: 0, texts: 0, mms: 0, emails: 0, customers: 0 }, received: { total: 0, customers: 0 } };
  if (!leadIds?.length) return empty;
  const at = {};
  if (from) at.$gte = from;
  if (to) at.$lte = to;
  const [row] = await EmailModel.aggregate([
    { $match: { lead_id: { $in: leadIds }, is_note: { $ne: true }, status: { $ne: 'note' }, is_lead_email: { $ne: true },
      ...(from || to ? { timestamp: at } : {}) } },
    { $project: { lead_id: 1, inbound: { $in: ['$status', INBOUND] }, failed: { $in: ['$status', FAILED] },
      // The user, 28 Oct 2026: "a message goes out means delivered to the customer". A text counts once its delivery
      // report says delivered; an email once the mail service took it (email has no delivery report).
      delivered: { $or: [{ $and: [{ $eq: ['$communication_type', 'sms'] }, { $eq: ['$status', 'delivered'] }] },
        { $and: [{ $ne: ['$communication_type', 'sms'] }, { $in: ['$status', ['sent', 'delivered']] }] }] },
      sms: { $eq: ['$communication_type', 'sms'] },
      // 28 Oct 2026 meeting ("MMS costs more than SMS - can we show it on this dashboard?"): a text with a photo.
      mms: { $and: [{ $eq: ['$communication_type', 'sms'] }, { $eq: ['$has_attachments', true] }] },
      ai: { $eq: ['$ai_generated', true] }, staff: { $gt: ['$message_by', null] },
      adf: { $regexMatch: { input: { $cond: [{ $eq: [{ $type: '$mail_content' }, 'string'] }, '$mail_content', ''] },
        regex: ADF.source, options: 'i' } } } },
    { $match: { adf: false } },
    { $group: { _id: null,
      sent: { $sum: { $cond: ['$inbound', 0, 1] } },
      ai: { $sum: { $cond: [{ $and: [{ $not: ['$inbound'] }, '$ai'] }, 1, 0] } },
      staff: { $sum: { $cond: [{ $and: [{ $not: ['$inbound'] }, { $not: ['$ai'] }, '$staff'] }, 1, 0] } },
      failed: { $sum: { $cond: [{ $and: [{ $not: ['$inbound'] }, '$failed'] }, 1, 0] } },
      received: { $sum: { $cond: ['$inbound', 1, 0] } },
      delivered: { $sum: { $cond: [{ $and: [{ $not: ['$inbound'] }, '$delivered'] }, 1, 0] } },
      texts: { $sum: { $cond: [{ $and: [{ $not: ['$inbound'] }, '$delivered', '$sms'] }, 1, 0] } },
      mms: { $sum: { $cond: [{ $and: [{ $not: ['$inbound'] }, '$delivered', '$mms'] }, 1, 0] } },
      deliveredTo: { $addToSet: { $cond: [{ $and: [{ $not: ['$inbound'] }, '$delivered'] }, '$lead_id', '$$REMOVE'] } },
      sentTo: { $addToSet: { $cond: ['$inbound', '$$REMOVE', '$lead_id'] } },
      from: { $addToSet: { $cond: ['$inbound', '$lead_id', '$$REMOVE'] } } } },
  ]);
  if (!row) return empty;
  return { sent: { total: row.sent, ai: row.ai, staff: row.staff, automatic: row.sent - row.ai - row.staff,
    failed: row.failed, customers: row.sentTo.length },
    delivered: { total: row.delivered, texts: row.texts, mms: row.mms, emails: row.delivered - row.texts,
      customers: row.deliveredTo.length },
    received: { total: row.received, customers: row.from.length } };
}
