// One customer's text conversation on the AI Messages screen (app/dealer/ai/messages).
//   GET /api/dealer-ai/messages/<leadId>
// Every SMS on the lead, oldest first: what came in from Twilio and what went out,
// with who sent it (the AI, a staff member, or the platform's own auto-reply).

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

  const [records, summaries] = await Promise.all([
    Email.find({ lead_id: lead._id, communication_type: "sms", is_note: { $ne: true } })
      .populate({ path: "message_by", select: "name email", strictPopulate: false })
      .sort({ timestamp: -1, _id: -1 })
      .limit(MAX_MESSAGES)
      .lean(),
    leadSummaries(dealerId, [leadId]),
  ]);

  const messages = records.reverse().map((m) => {
    const inbound = INBOUND.includes(m.status);
    return {
      id: String(m._id),
      direction: inbound ? "inbound" : "outbound",
      text: m.mail_content || "",
      at: m.timestamp || m.date,
      status: m.status,
      from: m.sender,
      to: m.recipient,
      ai: Boolean(m.ai_generated),
      staff: inbound || m.ai_generated ? null : m.message_by?.name || m.message_by?.email || null,
      media: [...(m.attachments || []), ...(m.media || [])]
        .map((a) => ({ url: a.publicUrl || a.url, type: a.contentType || "" }))
        .filter((a) => a.url),
    };
  });

  return NextResponse.json({
    lead: { lead_id: leadId, ...(summaries[leadId] || { name: lead.name, phone: lead.phone }) },
    messages,
  });
}
