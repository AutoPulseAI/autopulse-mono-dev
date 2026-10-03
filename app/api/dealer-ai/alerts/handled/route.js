// Staff dealt with an alert.
//   POST /api/dealer-ai/alerts/handled   { lead_id, source, dealer_id? }
// source: notice | alert | handoff | not_interested (from the alerts list).

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { aiServiceError, callAiService, jsonError, requireDealerSession, staffName } from "../../_lib/dealerAi";

const SOURCES = ["notice", "alert", "handoff", "not_interested"];

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError("Body must be JSON", 400);
  }
  const session = await requireDealerSession(req, body?.dealer_id);
  if (session.error) return session.error;
  const { lead_id: leadId, source } = body || {};
  if (!mongoose.isValidObjectId(leadId)) return jsonError("Invalid lead id", 400);
  if (!SOURCES.includes(source)) return jsonError(`source must be one of ${SOURCES.join(", ")}`, 400);

  const result = await callAiService(`/v1/staff/notices/${leadId}/handled`, {
    method: "POST",
    body: { dealer_id: session.dealerId, source, by: await staffName(session.user) },
  });
  if (!result.ok) return aiServiceError(result, "That alert is no longer on the lead.");
  return NextResponse.json(result.body);
}
