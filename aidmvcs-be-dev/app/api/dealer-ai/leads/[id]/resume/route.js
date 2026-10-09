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
  const result = await resumeAiForLead({ leadId: access.leadId, dealerId: access.dealerId });
  // Client, 10 Oct 2026: staff actions on the customer timeline.
  await logActivity({ dealer_id: access.dealerId, customer_id: access.lead.customer_id || null, lead_id: access.leadId,
    actor_type: "staff", actor_id: access.user?._id || null, actor_name: await staffName(access.user),
    action: "ai_turned_on" });
  return eventResponse("resume", result);
}
