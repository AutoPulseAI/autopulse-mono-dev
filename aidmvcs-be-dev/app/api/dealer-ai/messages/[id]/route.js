// One customer's conversation on the AI Messages screen (app/dealer/ai/messages).
//   GET /api/dealer-ai/messages/<leadId>
// Every SMS ("messages") and email ("emails") on the lead, oldest first: what came in
// and what went out, with who sent it (the AI, a staff member, or the platform's own
// auto-reply).

import { NextResponse } from "next/server";
import Email from "@models/Email";
import "@models/User";
import { assignedOnlyUserId, jsonError, keepAssignedRows, leadSummaries, requireLeadAccess } from "../../_lib/dealerAi";

const MAX_MESSAGES = 300;
const INBOUND = ["received", "incoming"];

export async function GET(req, { params }) {
  const access = await requireLeadAccess(req, params);
  if (access.error) return access.error;
  const { leadId, dealerId, user, lead } = access;

  const assignedTo = await assignedOnlyUserId(user);
  if (assignedTo && !(await keepAssignedRows(dealerId, assignedTo, [{ lead_id: leadId }])).length) {
    return jsonError("You don't have access to this lead.", 403);
  }

  const find = (type) => Email.find({ lead_id: lead._id, communication_type: type, is_note: { $ne: true } })
    .populate({ path: "message_by", select: "name email", strictPopulate: false })
    .sort({ timestamp: -1, _id: -1 })
    .limit(MAX_MESSAGES)
    .lean();
  const [smsRecords, emailRecords, summaries] = await Promise.all([find("sms"), find("email"), leadSummaries(dealerId, [leadId])]);

  const common = (m) => {
    const inbound = INBOUND.includes(m.status);
    return {
      id: String(m._id),
      direction: inbound ? "inbound" : "outbound",
      at: m.timestamp || m.date,
      status: m.status,
      from: m.sender,
      to: m.recipient,
      ai: Boolean(m.ai_generated),
      staff: inbound || m.ai_generated ? null : m.message_by?.name || m.message_by?.email || null,
      media: [...(m.attachments || []), ...(m.media || [])]
        .map((a) => ({ url: a.publicUrl || a.url, type: a.contentType || "", name: a.fileName || "" }))
        .filter((a) => a.url),
    };
  };

  const messages = smsRecords.reverse().map((m) => ({ ...common(m), text: m.mail_content || "" }));
  // The raw lead file (ADF XML from CarGurus, Cars.com, ...) is how the lead arrived, not a conversation: it is
  // never shown here (client, 9 Oct 2026); the lead's details are on the lead itself.
  const isRawLeadFile = (m) => typeof m.mail_content === "string" && /<\?adf|<adf[\s>]/i.test(m.mail_content);
  const emails = emailRecords.filter((m) => !isRawLeadFile(m)).reverse().map((m) => ({
    ...common(m),
    subject: m.subject || "",
    body: typeof m.mail_content === "string" ? m.mail_content : "",
  }));

  // Opening a conversation reads it (client, 10 Oct 2026: the red count never went down here): the customer's
  // messages on this lead are marked read, the same as opening it in Leads (app/api/conversations/mark-read).
  await Email.updateMany(
    { lead_id: lead._id, status: { $in: INBOUND }, read: { $ne: true } },
    { $set: { read: true, read_by: access.user?._id || null, read_at: new Date() } },
  );

  return NextResponse.json({
    lead: { lead_id: leadId, ...(summaries[leadId] || { name: lead.name, phone: lead.phone }) },
    messages,
    emails,
  });
}
