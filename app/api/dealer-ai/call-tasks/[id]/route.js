// Staff finished a call task (Call Tasks page outcome prompt).
//   POST /api/dealer-ai/call-tasks/<taskId>
//   { action: "complete" | "dismiss", outcome?, note?, dealer_id?, lead_outcome?, follow_up?, opt_out_scope? }
// outcome (complete only): connected | no_answer | voicemail | wrong_number | other.
// lead_outcome (complete only) reaches the AI (app/lib/ai/aiCallOutcome.js; agentic-upsell
// agent/call_outcomes.py): a specific follow-up becomes its dated next step, "contact, no next step" keeps the
// cadence going, a wrong number marks the phone invalid, an opt-out writes the AI's consent (every channel, or
// calls only). An appointment is still booked by the page through the CRM's own status route.

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { callTaskResolution } from "@lib/ai/aiCallOutcome.js";
import { aiServiceError, callAiService, jsonError, requireDealerSession, staffName } from "../../_lib/dealerAi";

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

  const built = callTaskResolution(body, { dealerId: session.dealerId, by: await staffName(session.user) });
  if (built.error) return jsonError(built.error, built.status);

  const result = await callAiService(`/v1/call-tasks/${id}/${built.action}`, { method: "POST", body: built.body });
  if (!result.ok) return aiServiceError(result, "That call task was not found.");
  return NextResponse.json(result.body);
}
