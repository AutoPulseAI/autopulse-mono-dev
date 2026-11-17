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
import Booking from '@models/Booking';
import { notifyManagers } from '@lib/ai/managerAlerts';
import { setOwnership } from '@lib/ownership';

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
    const result = await markLeadClosedFromAi(body, { Lead, Email, Booking, clearPendingJobs, cancelAllRemindersForLead,
      createManagerialReviewMessages, notifyManagers });
    if (!result.found) return NextResponse.json({ error: 'Lead not found for this dealer' }, { status: 404 });
    // SOW G-085: the customer told the AI they no longer own the vehicle - kept on the customer, so an older DMS
    // record never shows them as its owner again (app/lib/ownership.js).
    if (body.status === 'Closed - No Longer Owns') {
      const lead = await Lead.findById(body.lead_id).select('customer_id dealer_id vin').lean();
      if (lead?.customer_id && lead.vin) {
        await setOwnership({ customerId: lead.customer_id, dealerId: lead.dealer_id, vin: lead.vin, owns: false,
          by: 'customer', note: body.reason || null, at: body.closed_at ? new Date(body.closed_at) : new Date() });
      }
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[ai] lead status from the AI failed', { lead_id: body?.lead_id, error: error?.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
