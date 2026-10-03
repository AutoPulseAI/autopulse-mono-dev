// The AI Alerts page (app/dealer/ai/alerts) and the sidebar count.
//   GET /api/dealer-ai/alerts[?include_handled=1][&count_only=1][&dealer_id=]
// Handoffs, call requests, bad contact details, possible opt-outs, "not
// interested" reasons, bookings the AI made... from the AI service's lead state.

import { NextResponse } from "next/server";
import { aiServiceError, callAiService, leadSummaries, requireDealerSession } from "../_lib/dealerAi";

export async function GET(req) {
  const url = new URL(req.url);
  const session = await requireDealerSession(req, url.searchParams.get("dealer_id"));
  if (session.error) return session.error;
  const includeHandled = url.searchParams.get("include_handled") === "1";

  const result = await callAiService("/v1/staff/notices", {
    query: { dealer_id: session.dealerId, include_handled: includeHandled ? "true" : "false" },
  });
  if (!result.ok) return aiServiceError(result);
  const unhandledCount = result.body?.unhandled_count ?? 0;
  if (url.searchParams.get("count_only") === "1") {
    return NextResponse.json({ unhandled_count: unhandledCount });
  }
  const notices = result.body?.notices || [];
  const leads = await leadSummaries(session.dealerId, notices.map((n) => n.lead_id));
  return NextResponse.json({
    unhandled_count: unhandledCount,
    alerts: notices.map((n) => ({ ...n, lead: leads[n.lead_id] || null })),
  });
}
