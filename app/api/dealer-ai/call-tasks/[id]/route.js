// Staff finished a call task (Call Tasks page outcome prompt).
//   POST /api/dealer-ai/call-tasks/<taskId>
//   { action: "complete" | "dismiss", outcome?, note?, dealer_id? }
// outcome (complete only): connected | no_answer | voicemail | wrong_number | other.
// The lead outcome (appointment, follow-up, opted out...) is applied by the page
// through the CRM's own routes first and summarised in `note`.

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { aiServiceError, callAiService, jsonError, requireDealerSession, staffName } from "../../_lib/dealerAi";

const OUTCOMES = ["connected", "no_answer", "voicemail", "wrong_number", "other"];

export async function POST(req, { params }) {
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return jsonError("Invalid call task id", 400);
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError("Body must be JSON", 400);
  }
  const session = await requireDealerSession(req, body?.dealer_id);
  if (session.error) return session.error;

  const { action, outcome, note } = body || {};
  if (!["complete", "dismiss"].includes(action)) return jsonError("action must be complete or dismiss", 400);
  if (action === "complete" && !OUTCOMES.includes(outcome)) {
    return jsonError("Pick how the call went.", 422);
  }

  const result = await callAiService(`/v1/call-tasks/${id}/${action}`, {
    method: "POST",
    body: {
      dealer_id: session.dealerId,
      outcome: action === "complete" ? outcome : null,
      note: note ? String(note).slice(0, 2000) : null,
      by: await staffName(session.user),
    },
  });
  if (!result.ok) return aiServiceError(result, "That call task was not found.");
  return NextResponse.json(result.body);
}
