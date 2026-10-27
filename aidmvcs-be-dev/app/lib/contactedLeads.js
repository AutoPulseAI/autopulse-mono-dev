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
export async function repliedLeadIds(leadIds, from, to, { EmailModel = Email } = {}) {
  if (!leadIds?.length) return [];
  const at = {};
  if (from) at.$gte = from;
  if (to) at.$lte = to;
  const rows = await EmailModel.aggregate([
    { $match: { lead_id: { $in: leadIds }, status: { $in: INBOUND }, is_note: { $ne: true }, is_lead_email: { $ne: true },
      ...(from || to ? { timestamp: at } : {}) } },
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
