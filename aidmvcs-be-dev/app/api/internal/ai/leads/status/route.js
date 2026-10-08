// POST /api/internal/ai/leads/status - the AI service closed the opportunity itself (Day 91 -> "Closed - Lost",
// ownership ended -> "Closed - No Longer Owns"): the CRM lead shows it, with a note, unless staff changed the
// status after the AI closed it or it is a staff status the AI can't override (agentic-upsell PLAN_4 stream S).
// Shared-secret auth. Body: {dealer_id, lead_id, status, reason?, closed_at?}. See app/lib/ai/aiDnd.js.

import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import { verifyInternalServiceToken } from '@lib/internalServiceAuth';
import { markLeadClosedFromAi, validateClosedStatusPayload } from '@lib/ai/aiDnd';
import { clearPendingJobs } from '@lib/followupService';
import { cancelAllRemindersForLead, createManagerialReviewMessages } from '@lib/appointmentReminderService';
import Email from '@models/Email';
import Lead from '@models/Lead';

export async function POST(req) {
  if (!verifyInternalServiceToken(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const { errors } = validateClosedStatusPayload(body);
  if (errors.length) return NextResponse.json({ error: 'Invalid request', details: errors }, { status: 422 });
  try {
    await dbConnect();
    const result = await markLeadClosedFromAi(body, { Lead, Email, clearPendingJobs, cancelAllRemindersForLead,
      createManagerialReviewMessages });
    if (!result.found) return NextResponse.json({ error: 'Lead not found for this dealer' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[ai] lead status from the AI failed', { lead_id: body?.lead_id, error: error?.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
