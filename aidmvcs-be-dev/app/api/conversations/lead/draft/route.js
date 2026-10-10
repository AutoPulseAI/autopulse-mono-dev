import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Email from "@models/Email";
import Lead from "@models/Lead";
import User from "@models/User";
import { Types } from "mongoose";
import jwt from "jsonwebtoken";

const { ObjectId } = Types;

const SMS_MAX_CHARS = 160;
const PROVIDER_TIMEOUT_MS = 30000;

/** Build conversation thread for a lead (same logic as GET /api/conversations/lead) */
async function getConversationThread(leadId) {
  const parentEmail = await Email.findOne({
    lead_id: new ObjectId(leadId),
    $or: [{ is_note: { $exists: false } }, { is_note: false }],
  })
    .sort({ timestamp: 1, _id: 1 })
    .lean();

  if (!parentEmail) return { thread: [], warning: "No conversation found for this lead." };

  const conversationFilter = {
    $or: [
      { _id: parentEmail._id },
      ...(parentEmail.message_id != null
        ? [{ parent_message_id: parentEmail.message_id }]
        : []),
    ],
  };

  const thread = await Email.find(conversationFilter)
    .sort({ timestamp: 1 })
    .limit(50)
    .lean();

  return { thread, warning: thread.length === 0 ? "Conversation thread is empty." : null };
}

/** "Write with AI": the draft comes straight from OpenAI (client, 10 Oct 2026: no n8n for anything; the CRM's
 * translation already calls OpenAI the same way). Same contract as before: { draft, subject? }. */
const DRAFT_MODEL = process.env.OPENAI_DRAFT_MODEL || "gpt-4o-mini";

function draftPrompt({ lead, dealerName, channel, language, thread, prompt }) {
  const name = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || lead?.name || "the customer";
  const history = (thread || []).slice(-20)
    .map((m) => `${m.direction === "IN" ? "Customer" : "Dealership"}: ${m.subject ? `[${m.subject}] ` : ""}${m.body}`)
    .join("\n");
  const kind = channel === "sms" ? `a text message (at most ${SMS_MAX_CHARS} characters, no subject)`
    : channel === "note" ? "a short internal note for the team (not sent to the customer)"
    : "an email (give a short subject on the first line as 'Subject: ...', then the body)";
  return [
    { role: "system", content: `You write for ${dealerName}, a car dealership, replying to ${name}. Write ${kind} in ${language}. `
      + "Be warm, short and specific to the conversation. Never invent prices, payments, approvals, trade values, "
      + "availability or appointment times that aren't in the conversation. Output only the message." },
    { role: "user", content: `Conversation so far:\n${history || "(no messages yet)"}\n\n`
      + `What the staff member wants to say: ${prompt || "a helpful next reply"}` },
  ];
}

async function callDraftProvider(payload, channel) {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAPI_KEY || "";
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: DRAFT_MODEL, temperature: 0.4, messages: draftPrompt(payload) }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Draft provider error: ${response.status} ${errText.slice(0, 300)}`);
    }
    const data = await response.json();
    let draft = String(data?.choices?.[0]?.message?.content || "").trim();
    let subject;
    if (channel === "email") {
      const m = draft.match(/^\s*Subject:\s*(.+)\n+/i);
      if (m) { subject = m[1].trim(); draft = draft.slice(m[0].length).trim(); }
    }
    if (channel === "sms" && draft.length > SMS_MAX_CHARS) draft = draft.slice(0, SMS_MAX_CHARS - 3) + "...";
    return { draft, subject };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") throw new Error("Generation timed out. Please try again.");
    throw err;
  }
}

export async function POST(request) {
  try {
    await dbConnect();

    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    try {
      const token = authHeader.split(" ")[1];
      jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      lead_id,
      channel,
      language = "English",
      intent = "",
    } = body || {};

    if (!lead_id || !channel) {
      return NextResponse.json(
        { message: "lead_id and channel are required" },
        { status: 400 }
      );
    }
    if (!["email", "sms", "note"].includes(channel)) {
      return NextResponse.json(
        { message: "channel must be email, sms, or note" },
        { status: 400 }
      );
    }

    if (!ObjectId.isValid(lead_id)) {
      return NextResponse.json(
        { message: "Invalid lead_id format" },
        { status: 400 }
      );
    }

    const lead = await Lead.findById(lead_id).lean();
    if (!lead) {
      return NextResponse.json(
        { message: "Lead not found" },
        { status: 404 }
      );
    }

    const { thread, warning } = await getConversationThread(lead_id);

    const threadSummary = thread.map((m) => {
      const date = m.timestamp || m.date ? new Date(m.timestamp || m.date).toISOString() : "";
      // The portal's lead file (ADF XML) is noise to the writer: it gets a one-line summary instead (client, 10 Oct
      // 2026: raw XML showed in the Write with AI context).
      const raw = String(m.mail_content || m.body || "");
      const body = /<\?adf|<adf[\s>]/i.test(raw)
        ? `(Lead submitted by the customer${lead?.vehicle ? ` about ${lead.vehicle}` : ""}${lead?.comments ? `: ${String(lead.comments).slice(0, 300)}` : ""})`
        : raw.slice(0, 2000);
      const direction =
        m.status === "incoming" || m.status === "received" ? "IN" : "OUT";

      // Normalize attachments per message: pass through any structured attachments,
      // or fall back to an empty array if none exist.
      const attachments =
        Array.isArray(m.attachments) && m.attachments.length > 0
          ? m.attachments.map((att) => ({
              filename: att.filename || att.name || "",
              contentType: att.contentType || att.mimetype || att.type || "",
              url: att.url || att.location || att.href || "",
              size: att.size || att.length || undefined,
            }))
          : [];

      return {
        date,
        direction,
        subject: m.subject,
        body,
        attachments,
      };
    });

    const dealerId = lead.dealer_id;
    let dealerName = "Dealer";
    if (dealerId) {
      const dealer = await User.findById(dealerId).select("name").lean();
      if (dealer?.name) dealerName = dealer.name;
    }

    const normalizedLanguage =
      typeof language === "string" ? language.trim() || "English" : "English";

    const trimmedIntent =
      typeof intent === "string" ? intent.slice(0, 500).trim() : "";

    const providerPayload = {
      lead,
      dealerName,
      channel,
      language: normalizedLanguage,
      thread: threadSummary,
      prompt: trimmedIntent,
    };
    //console.log(providerPayload);

    const { draft, subject } = await callDraftProvider(providerPayload, channel);

    return NextResponse.json({  
      draft: draft || "",
      ...(channel === "email" && subject != null ? { subject } : {}),
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    console.error("Draft API error:", err);
    const message =
      err.message || "Failed to generate draft. Please try again.";
    return NextResponse.json(
      { message, error: true },
      { status: err.message?.includes("timed out") ? 408 : 500 }
    );
  }
}
