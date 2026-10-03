// Staff hand a lead back to the AI: it answers the customer's next message and
// carries on its follow-ups.
//   POST /api/dealer-ai/leads/<leadId>/resume

import { eventResponse } from "@lib/ai/aiAdminLead";
import { resumeAiForLead } from "@lib/ai/aiStaff";
import { requireLeadAccess } from "../../../_lib/dealerAi";

export async function POST(req, { params }) {
  const access = await requireLeadAccess(req, params);
  if (access.error) return access.error;
  const result = await resumeAiForLead({ leadId: access.leadId, dealerId: access.dealerId });
  return eventResponse("resume", result);
}
