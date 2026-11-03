// The Call Tasks page's calendar (Betsy, 2 Nov 2026 meeting: "click on the dates and see the call tasks they're missing
// for yesterday or the day before ... how many call tasks are there, how many they missed").
//   GET /api/dealer-ai/call-tasks/by-day?days=14&tz_offset_minutes=-300[&dealer_id=]
//   -> { days: [{ day: "2026-11-02", opened, called, missed, open }] } newest first.

import { NextResponse } from "next/server";
import { aiServiceError, callAiService, requireDealerSession } from "../../_lib/dealerAi";

export async function GET(req) {
  const url = new URL(req.url);
  const session = await requireDealerSession(req, url.searchParams.get("dealer_id"));
  if (session.error) return session.error;
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 14));
  const result = await callAiService("/v1/staff/call-tasks/by-day", { query: {
    dealer_id: session.dealerId, days, tz_offset_minutes: Number(url.searchParams.get("tz_offset_minutes")) || 0 } });
  if (!result.ok) return aiServiceError(result);
  return NextResponse.json({ days: Array.isArray(result.body) ? result.body : [] });
}
