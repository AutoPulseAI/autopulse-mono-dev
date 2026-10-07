// POST /api/internal/ai/leads/dnd - the AI service: this lead's customer
// opted out of every channel, show it as DND in the CRM (with a note) and stop
// the platform's own follow-ups and reminders. Shared-secret auth.
// Body: {dealer_id, lead_id, reason}. See app/lib/ai/aiDnd.js.

import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import { verifyInternalServiceToken } from '@lib/internalServiceAuth';
import { markLeadDndFromAi, validateDndPayload } from '@lib/ai/aiDnd';
import { clearPendingJobs } from '@lib/followupService';
import { cancelAllRemindersForLead } from '@lib/appointmentReminderService';
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
  const { errors } = validateDndPayload(body);
  if (errors.length) return NextResponse.json({ error: 'Invalid request', details: errors }, { status: 422 });
  try {
    await dbConnect();
    const result = await markLeadDndFromAi(body, { Lead, Email, clearPendingJobs, cancelAllRemindersForLead });
    if (!result.found) return NextResponse.json({ error: 'Lead not found for this dealer' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[ai] lead DND failed', { lead_id: body?.lead_id, error: error?.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
