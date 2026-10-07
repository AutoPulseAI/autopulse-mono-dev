// Admin-only "hand back to AI": a paused or handed-off lead becomes active
// again, and the AI answers the customer's next message (MASTER_PLAN_1 Stage 11).
//   POST /api/admin/ai/leads/<leadId>/resume

import { loadLeadForAdmin, eventResponse } from '@lib/ai/aiAdminLead';
import { resumeAiForLead } from '@lib/ai/aiStaff';

export async function POST(request, { params }) {
  const loaded = await loadLeadForAdmin(request, params);
  if (loaded.error) return loaded.error;
  const result = await resumeAiForLead({ leadId: loaded.leadId, dealerId: loaded.dealerId });
  return eventResponse('resume', result);
}
