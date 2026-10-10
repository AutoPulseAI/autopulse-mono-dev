// What "Contacted" means on the dashboard and in the Leads filter (client, 10 Oct 2026): the customer and the
// dealership have actually talked - the customer replied to us, or the customer wrote to us first. Not a status
// someone or something set. Read from the conversation itself:
//   - any text from the customer, or
//   - an email from the customer that isn't the lead's own arrival (the portal's lead email / ADF file is the
//     first inbound email of an email lead, so it doesn't count).
import Email from '../models/Email.js';

const INBOUND = ['received', 'incoming'];
const ADF = /<\?adf|<adf[\s>]/i;

export async function contactedLeadIds(leadIds, { EmailModel = Email } = {}) {
  if (!leadIds?.length) return [];
  const rows = await EmailModel.aggregate([
    { $match: { lead_id: { $in: leadIds }, status: { $in: INBOUND }, is_note: { $ne: true } } },
    { $project: { lead_id: 1, communication_type: 1,
      adf: { $regexMatch: { input: { $cond: [{ $eq: [{ $type: '$mail_content' }, 'string'] }, '$mail_content', ''] },
        regex: ADF.source, options: 'i' } },
      lead_msg: { $regexMatch: { input: { $ifNull: ['$message_id', ''] }, regex: '^lead-' } } } },
    { $match: { adf: false, lead_msg: false } },
    { $group: { _id: '$lead_id',
      sms: { $sum: { $cond: [{ $eq: ['$communication_type', 'sms'] }, 1, 0] } },
      email: { $sum: { $cond: [{ $eq: ['$communication_type', 'email'] }, 1, 0] } } } },
    { $match: { $or: [{ sms: { $gt: 0 } }, { email: { $gt: 1 } }] } },
  ]);
  return rows.map((r) => r._id);
}
