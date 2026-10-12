// Staff hand a lead back to the AI: it answers the customer's next message and
// carries on its follow-ups.
//   POST /api/dealer-ai/leads/<leadId>/resume

import { eventResponse } from "@lib/ai/aiAdminLead";
import { resumeAiForLead } from "@lib/ai/aiStaff";
import { requireLeadAccess, staffName } from "../../../_lib/dealerAi";
import { logActivity } from "@lib/activityLog";

export async function POST(req, { params }) {
  const access = await requireLeadAccess(req, params);
  if (access.error) return access.error;
  // Client, 12 Oct 2026 (AI toggle bug fix, SOW item 21): a legal opt-out is never overridden by the toggle - the
  // user is told why, and the attempt is on the customer's timeline.
  if (access.lead.fe_lead_status === "DND") {
    await logActivity({ dealer_id: access.dealerId, customer_id: access.lead.customer_id || null, lead_id: access.leadId,
      actor_type: "staff", actor_id: access.user?._id || null, actor_name: await staffName(access.user),
      action: "ai_turn_on_blocked", detail: "The customer opted out" });
    return Response.json({ error: "This customer opted out of messages, so the AI can't be turned back on. "
      + "It turns back on only if the customer texts START." }, { status: 409 });
  }
  const result = await resumeAiForLead({ leadId: access.leadId, dealerId: access.dealerId });
  // Client, 10 Oct 2026: staff actions on the customer timeline.
  await logActivity({ dealer_id: access.dealerId, customer_id: access.lead.customer_id || null, lead_id: access.leadId,
    actor_type: "staff", actor_id: access.user?._id || null, actor_name: await staffName(access.user),
    action: "ai_turned_on" });
  return eventResponse("resume", result);
}
