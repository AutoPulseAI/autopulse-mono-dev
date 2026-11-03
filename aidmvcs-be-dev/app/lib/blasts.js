// A text a staff member sent to many leads at once (Betsy, 2 Nov 2026 meeting, Kevin Chapman: Mercy's "ready for a
// Manager Giveaway!!!" went to 317 leads, and in the conversation it read as a message to him alone; the user, 3 Nov
// 2026: "if Mercy sends a blast, we should tag that it is a blast"). The CRM keeps no blast marker, so a blast is read
// from the messages: the same staff text to BLAST_MIN_LEADS or more leads within a day.

import Email from '../models/Email.js';

export const BLAST_MIN_LEADS = 5;
const DAY_MS = 24 * 3600e3;

const isStaff = (m) => !m?.ai_generated && !m?.is_note && m?.status !== 'note' && !['incoming', 'received'].includes(m?.status)
  && m?.message_by && String(m?.mail_content || '').trim().length >= 20;

// The ids of the messages among `messages` that are blasts (a Set of strings).
export async function blastIds(messages, { EmailModel = Email } = {}) {
  const staff = (messages || []).filter(isStaff);
  if (!staff.length) return new Set();
  const times = staff.map((m) => new Date(m.timestamp || m.date).getTime()).filter(Number.isFinite);
  const rows = await EmailModel.aggregate([
    { $match: { dealer_id: staff[0].dealer_id, mail_content: { $in: [...new Set(staff.map((m) => m.mail_content))] },
      timestamp: { $gte: new Date(Math.min(...times) - DAY_MS), $lte: new Date(Math.max(...times) + DAY_MS) } } },
    { $group: { _id: '$mail_content', leads: { $addToSet: '$lead_id' } } },
    { $project: { n: { $size: '$leads' } } },
    { $match: { n: { $gte: BLAST_MIN_LEADS } } },
  ]);
  const blasts = new Set(rows.map((r) => r._id));
  return new Set(staff.filter((m) => blasts.has(m.mail_content)).map((m) => String(m._id)));
}
