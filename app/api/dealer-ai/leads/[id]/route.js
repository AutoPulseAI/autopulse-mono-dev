// The AI panel on a lead (app/dealer/ai/components/AiLeadPanel.js).
//   GET /api/dealer-ai/leads/<leadId>
// What the AI knows and plans for this lead (the AI service's lead profile: stage,
// opportunity day, next touch, appointment, call task, history...), the
// customer's consent per channel, and the dealer's AI mode.

import { NextResponse } from "next/server";
import { effectiveAiMode } from "@lib/ai/aiMode";
import User from "@models/User";
import { callAiService, requireLeadAccess } from "../../_lib/dealerAi";

export async function GET(req, { params }) {
  const access = await requireLeadAccess(req, params);
  if (access.error) return access.error;
  const { leadId, dealerId } = access;
  const query = { dealer_id: dealerId };

  const [profile, consent, dealer] = await Promise.all([
    callAiService(`/v1/leads/${leadId}/profile`, { query }),
    callAiService(`/v1/staff/leads/${leadId}/consent`, { query }),
    User.findById(dealerId).select("ai_mode setting").lean(),
  ]);

  return NextResponse.json({
    lead_id: leadId,
    dealer_id: dealerId,
    ai_mode: effectiveAiMode(dealer),
    profile: profile.ok ? profile.body : null,
    // "not_found": the AI hasn't worked this lead; "unavailable": the service didn't answer.
    profile_status: profile.ok ? "ok" : profile.status === 404 ? "not_found" : "unavailable",
    consent: consent.ok ? consent.body : null,
  });
}
