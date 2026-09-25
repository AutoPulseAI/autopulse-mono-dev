// POST /api/internal/ai/messages/status - the AI service forwards a delivery
// update from Twilio / SendGrid for a message it sent (BPLAN Phase 3), so the
// conversation screen shows delivered / failed.
//
// Body: { dealer_id, provider_id, status } where status is a provider word
// (delivered, failed, undelivered, ...). It is mapped onto the Email model's
// status enum, and the raw word is kept in ai_delivery_status.

import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import { verifyInternalServiceToken } from '@lib/internalServiceAuth';
import { DELIVERY_STATUS_TO_EMAIL_STATUS, validateStatusPayload } from '@lib/ai/aiMessageRecord';
import Email from '@models/Email';

export async function POST(req) {
  if (!verifyInternalServiceToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const { errors } = validateStatusPayload(body);
  if (errors.length) return NextResponse.json({ error: 'Invalid status update', details: errors }, { status: 422 });

  try {
    await dbConnect();
    const result = await Email.updateOne(
      { dealer_id: body.dealer_id, message_id: body.provider_id, ai_generated: true },
      { $set: { status: DELIVERY_STATUS_TO_EMAIL_STATUS[body.status], ai_delivery_status: body.status } },
    );
    return NextResponse.json({ updated: result.matchedCount > 0 });
  } catch (error) {
    console.error('[ai] message status update failed', { provider_id: body?.provider_id, error: error?.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
