// The AI Insights page (app/dealer/ai/insights): what the AI's follow-ups achieve
// and what it has learned (agentic-upsell PLAN_4 stream L, blueprint box 5).
//   GET /api/dealer-ai/insights?days=7|30|90|180|365[&dealer_id=]
// Proxies the AI service's GET /v1/insights/engagement for the signed-in user's
// dealership: response and appointment rates by bucket, source, new/used, angle,
// wording, send time and time of day; each test's leader and sample sizes; the
// verified price drops. Anyone at the dealership can read it.

import { NextResponse } from "next/server";
import { insightsDays } from "@lib/ai/aiInsights";
import { aiServiceError, callAiService, requireDealerSession } from "../_lib/dealerAi";

export async function GET(req) {
  const url = new URL(req.url);
  const session = await requireDealerSession(req, url.searchParams.get("dealer_id"));
  if (session.error) return session.error;
  const days = insightsDays(url.searchParams.get("days"));

  const result = await callAiService("/v1/insights/engagement", { query: { dealer_id: session.dealerId, days } });
  if (!result.ok) return aiServiceError(result);
  return NextResponse.json(result.body);
}
