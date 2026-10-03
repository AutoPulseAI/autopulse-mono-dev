// The Call Tasks page (app/dealer/ai/call-tasks).
//   GET /api/dealer-ai/call-tasks?view=open|upcoming|done[&dealer_id=]
// open: calls staff should make now; upcoming: the 60-minute timers still
// waiting for a reply; done: completed, dismissed or cancelled. Each row has the
// lead's stage and last AI touch (AI service) and name / vehicle (CRM lead).

import { NextResponse } from "next/server";
import { aiServiceError, callAiService, jsonError, leadSummaries, requireDealerSession } from "../_lib/dealerAi";

const VIEWS = ["open", "upcoming", "done"];

export async function GET(req) {
  const url = new URL(req.url);
  const session = await requireDealerSession(req, url.searchParams.get("dealer_id"));
  if (session.error) return session.error;
  const view = url.searchParams.get("view") || "open";
  if (!VIEWS.includes(view)) return jsonError(`view must be one of ${VIEWS.join(", ")}`, 400);

  const result = await callAiService("/v1/staff/call-tasks", { query: { dealer_id: session.dealerId, view } });
  if (!result.ok) return aiServiceError(result);
  const tasks = Array.isArray(result.body) ? result.body : [];
  const leads = await leadSummaries(session.dealerId, tasks.map((t) => t.lead_id));
  return NextResponse.json({
    view,
    tasks: tasks.map((task) => {
      const lead = leads[task.lead_id] || {};
      return {
        ...task,
        customer_name: task.customer_name || lead.name || null,
        phone: task.phone || lead.phone || null,
        vehicle: lead.vehicle || null,
        crm_status: lead.crm_status || null,
      };
    }),
  });
}
