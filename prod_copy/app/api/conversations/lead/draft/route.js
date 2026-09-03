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

/** Call third-party draft provider (e.g. n8n) */
async function callDraftProvider(payload, channel) {
  const url = process.env.N8N_WRITE_WITH_AI_API;
  if (!url) {
    throw new Error("N8N_EMAIL_API is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Draft provider error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    //console.log('rvi',data);
    // Expect provider to return { draft, subject? }, but fall back gracefully
    let draft = data.draft || data.text || "";
    let subject = data.subject;

    // Enforce SMS length cap defensively
    if (channel === "sms" && draft.length > SMS_MAX_CHARS) {
      draft = draft.slice(0, SMS_MAX_CHARS - 3) + "...";
    }

    return { draft, subject };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("Generation timed out. Please try again.");
    }
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
      const body = (m.mail_content || m.body || "").slice(0, 2000);
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
