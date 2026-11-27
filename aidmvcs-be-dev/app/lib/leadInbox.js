// The Leads page's side list as an inbox, like WhatsApp (the user, 27 Nov 2026: "the leads can also show the inbox
// design"): for one page of leads, each lead's last message (text, time, who, channel) and how many of the customer's
// messages are unread. One query for the whole page. Notes are left out.
import mongoose from 'mongoose';
import Email from '../models/Email.js';

const strip = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export async function attachInboxPreview(leads, { Model = Email } = {}) {
  const ids = (leads || []).map((l) => l?._id).filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(String(id)));
  if (!ids.length) return leads;
  const rows = await Model.aggregate([
    { $match: { lead_id: { $in: ids }, is_note: { $ne: true }, status: { $ne: 'note' },
      communication_type: { $in: ['sms', 'email'] } } },
    { $sort: { timestamp: -1, _id: -1 } },
    // Only what the preview needs, and only the start of the text: long HTML emails are never carried through the
    // grouping (27 Nov 2026, the site slowed down).
    { $project: { lead_id: 1, timestamp: 1, status: 1, communication_type: 1, ai_generated: 1, message_by: 1, read: 1,
      mail_content: { $cond: [{ $eq: [{ $type: '$mail_content' }, 'string'] }, { $substrCP: ['$mail_content', 0, 1500] }, ''] } } },
    { $group: { _id: '$lead_id', last: { $first: '$$ROOT' },
      unread: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['received', 'incoming']] }, { $ne: ['$read', true] }] }, 1, 0] } } } },
    { $project: { 'last.mail_content': 1, 'last.timestamp': 1, 'last.status': 1, 'last.communication_type': 1,
      'last.ai_generated': 1, 'last.message_by': 1, unread: 1 } },
  ]);
  const byLead = new Map(rows.map((r) => [String(r._id), r]));
  for (const lead of leads) {
    const r = byLead.get(String(lead._id));
    if (!r) { lead.inbox = { unread: 0, last: null }; continue; }
    const inbound = ['received', 'incoming'].includes(r.last.status);
    lead.inbox = {
      unread: r.unread || 0,
      last: { text: strip(r.last.mail_content).slice(0, 120), at: r.last.timestamp || null, channel: r.last.communication_type,
        from: inbound ? 'customer' : r.last.ai_generated ? 'ai' : r.last.message_by ? 'staff' : 'system',
        failed: ['failed', 'undelivered', 'bounced', 'error'].includes(r.last.status) },
    };
  }
  return leads;
}
