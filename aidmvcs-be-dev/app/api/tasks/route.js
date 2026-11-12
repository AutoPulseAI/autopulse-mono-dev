// GET /api/tasks?dealer_id=  the staff task list's CRM queues (app/lib/staffTasks.js; SOW D, G-025 / G-028).
// 401 not signed in · 400 no dealership · 403 not this dealership. "View Assigned Leads" staff get their own leads.
import { NextResponse } from 'next/server';
import { assignedOnlyUserId, requireDealerSession } from '../dealer-ai/_lib/dealerAi';
import { staffTaskQueues } from '@lib/staffTasks';

export const runtime = 'nodejs';

export async function GET(req) {
  const session = await requireDealerSession(req, new URL(req.url).searchParams.get('dealer_id'));
  if (session.error) return session.error;
  const onlyUserId = await assignedOnlyUserId(session.user);
  return NextResponse.json({ ...(await staffTaskQueues(session.dealerId, { onlyUserId })), mine_only: !!onlyUserId });
}
