// Admin-only "take over": the AI stops replying to this lead and cancels its
// pending channel switch until it is handed back (MASTER_PLAN_1 Stage 11).
//   POST /api/admin/ai/leads/<leadId>/pause   { reason? }

import { loadLeadForAdmin, eventResponse } from '@lib/ai/aiAdminLead';
import { pauseAiForLead } from '@lib/ai/aiStaff';

export async function POST(request, { params }) {
  const loaded = await loadLeadForAdmin(request, params);
  if (loaded.error) return loaded.error;

  let reason;
  try {
    reason = (await request.json())?.reason;
  } catch {
    reason = undefined; // body is optional
  }
  const result = await pauseAiForLead({
    leadId: loaded.leadId, dealerId: loaded.dealerId, reason, by: loaded.auth.decoded?.userId,
  });
  return eventResponse('pause', result);
}
