// Staff turn the AI off for one lead ("take over"): the AI stops replying and
// cancels its pending follow-ups until it is turned back on.
//   POST /api/dealer-ai/leads/<leadId>/pause   { reason? }
// Same event as the admin route (app/api/admin/ai/leads/[id]/pause), for dealer staff.

import { eventResponse } from "@lib/ai/aiAdminLead";
import { pauseAiForLead } from "@lib/ai/aiStaff";
import { requireLeadAccess, staffName } from "../../../_lib/dealerAi";
import { logActivity } from "@lib/activityLog";

export async function POST(req, { params }) {
  const access = await requireLeadAccess(req, params);
  if (access.error) return access.error;

  let reason;
  try {
    reason = (await req.json())?.reason;
  } catch {
    reason = undefined; // body is optional
  }
  const by = await staffName(access.user);
  const result = await pauseAiForLead({
    leadId: access.leadId,
    dealerId: access.dealerId,
    reason: reason || `AI turned off for this lead by ${by}`,
    by,
  });
  // Client, 10 Oct 2026: staff actions on the customer timeline.
  await logActivity({ dealer_id: access.dealerId, customer_id: access.lead.customer_id || null, lead_id: access.leadId,
    actor_type: "staff", actor_id: access.user?._id || null, actor_name: by, action: "ai_turned_off",
    detail: reason || null });
  return eventResponse("pause", result);
}
