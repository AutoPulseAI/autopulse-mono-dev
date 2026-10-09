// The AI Messages screen (app/dealer/ai/messages): every customer we're texting with.
//   GET /api/dealer-ai/messages[?dealer_id=]
// One row per lead with SMS or email history (Email records, communication_type "sms" /
// "email"): the latest message, how many of each channel, how many the AI sent and how
// many are unread.
// Staff with "View Assigned Leads" only get their own leads, like the other AI screens.

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import Email from "@models/Email";
import { assignedOnlyUserId, keepAssignedRows, leadSummaries, requireDealerSession } from "../_lib/dealerAi";

const MAX_THREADS = 300;
const INBOUND = ["received", "incoming"];

// One line for the contact list: a text's body, or an email's subject (its body is HTML).
const previewText = (r) => (r.last_channel === "email" ? r.last_subject || "(no subject)" : r.last_text || "");

export async function GET(req) {
  const url = new URL(req.url);
  const session = await requireDealerSession(req, url.searchParams.get("dealer_id"));
  if (session.error) return session.error;

  // dealer_id is a String on the schema, but older writers stored the ObjectId.
  const dealerIds = [session.dealerId, new mongoose.Types.ObjectId(session.dealerId)];
  const groups = await Email.aggregate([
    { $match: { dealer_id: { $in: dealerIds }, communication_type: { $in: ["sms", "email"] }, lead_id: { $ne: null }, is_note: { $ne: true } } },
    { $sort: { timestamp: -1, _id: -1 } },
    {
      $group: {
        _id: "$lead_id",
        last_text: { $first: "$mail_content" },
        last_subject: { $first: "$subject" },
        last_channel: { $first: "$communication_type" },
        last_at: { $first: { $ifNull: ["$timestamp", "$date"] } },
        last_status: { $first: "$status" },
        last_ai: { $first: "$ai_generated" },
        last_sender: { $first: "$sender" },
        last_recipient: { $first: "$recipient" },
        total: { $sum: 1 },
        sms_count: { $sum: { $cond: [{ $eq: ["$communication_type", "sms"] }, 1, 0] } },
        email_count: { $sum: { $cond: [{ $eq: ["$communication_type", "email"] }, 1, 0] } },
        ai_count: { $sum: { $cond: [{ $eq: ["$ai_generated", true] }, 1, 0] } },
        unread: {
          $sum: { $cond: [{ $and: [{ $in: ["$status", INBOUND] }, { $ne: ["$read", true] }] }, 1, 0] },
        },
      },
    },
    // A real conversation only (client, 9 Oct 2026): a text, or anything the AI sent. A lead whose only record is
    // the incoming lead email (Cars.com, CarGurus, ...) is a lead, not an AI conversation - it stays in Leads.
    { $match: { $or: [{ sms_count: { $gt: 0 } }, { ai_count: { $gt: 0 } }] } },
    { $sort: { last_at: -1 } },
    { $limit: MAX_THREADS },
  ]);

  const rows = groups.map((g) => ({ ...g, lead_id: String(g._id) }));
  const scoped = await keepAssignedRows(session.dealerId, await assignedOnlyUserId(session.user), rows);
  const leads = await leadSummaries(session.dealerId, scoped.map((r) => r.lead_id));

  const threads = scoped.map((r) => {
    const inbound = INBOUND.includes(r.last_status);
    const lead = leads[r.lead_id] || null;
    return {
      lead_id: r.lead_id,
      name: lead?.name || null,
      phone: lead?.phone || (inbound ? r.last_sender : r.last_recipient) || null,
      vehicle: lead?.vehicle || null,
      email: lead?.email || null,
      last_text: previewText(r),
      last_channel: r.last_channel,
      last_at: r.last_at,
      last_direction: inbound ? "inbound" : "outbound",
      last_ai: Boolean(r.last_ai),
      total: r.total,
      sms_count: r.sms_count,
      email_count: r.email_count,
      ai_count: r.ai_count,
      unread: r.unread,
    };
  });

  return NextResponse.json({ threads });
}
