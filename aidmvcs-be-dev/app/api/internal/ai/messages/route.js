// POST /api/internal/ai/messages - the AI service records a message it sent
// (or failed to send), so it shows in the dealer's conversation screen with an
// AI marker (MASTER_PLAN_1 Stage 5, BPLAN Phase 3).
//
// Caller: agentic-upsell's LivePlatformClient.record_message, authenticated
// with the shared internal-service secret (never a browser).
// Idempotent on idempotency_key: recording the same send twice returns the
// same Email record with created: false.

import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import { verifyInternalServiceToken } from '@lib/internalServiceAuth';
import { buildAiEmailDocument, validateAiMessagePayload } from '@lib/ai/aiMessageRecord';
import Email from '@models/Email';
import EmailAccount from '@models/EmailAccount';
import Lead from '@models/Lead';
import User from '@models/User';

function jsonError(message, status, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function POST(req) {
  if (!verifyInternalServiceToken(req)) return jsonError('Unauthorized', 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError('Body must be JSON', 400);
  }
  const { errors } = validateAiMessagePayload(body);
  if (errors.length) return jsonError('Invalid message', 422, { details: errors });

  try {
    await dbConnect();

    const existing = await Email.findOne({ ai_idempotency_key: body.idempotency_key }).select('_id').lean();
    if (existing) return NextResponse.json({ id: String(existing._id), created: false });

    const dealer = await User.findOne({ _id: body.dealer_id, type: 'dealer' })
      .select('_id dealer_account_information').lean();
    if (!dealer) return jsonError('Dealer not found', 404);

    // The lead must belong to this dealer: the shared secret proves the caller
    // is the AI service, not that the ids it sent belong together.
    const lead = await Lead.findOne({ _id: body.lead_id, dealer_id: body.dealer_id }).select('_id').lean();
    if (!lead) return jsonError('Lead not found for this dealer', 404);

    const emailAccount = body.channel === 'email'
      ? await EmailAccount.findOne({ dealer_id: dealer._id }).select('email_address').lean()
      : null;

    const document = buildAiEmailDocument({ payload: body, dealer, emailAccount });
    try {
      const created = await Email.create(document);
      return NextResponse.json({ id: String(created._id), created: true });
    } catch (error) {
      // Two concurrent records of the same send: the unique index let one win.
      if (error?.code === 11000) {
        const winner = await Email.findOne({ ai_idempotency_key: body.idempotency_key }).select('_id').lean();
        if (winner) return NextResponse.json({ id: String(winner._id), created: false });
      }
      throw error;
    }
  } catch (error) {
    console.error('[ai] record message failed', { idempotency_key: body?.idempotency_key, error: error?.message });
    return jsonError('Internal server error', 500);
  }
}
