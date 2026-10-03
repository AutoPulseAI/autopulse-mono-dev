// POST /api/internal/ai/messages/send - the AI service asks the platform to
// send one message (agentic-upsell CHANNEL_DRIVER=platform). The platform
// sends it with its own sendSMS / sendEmail from the dealer's number /
// mailbox, records the AI Email in the conversation, and answers with the
// provider id; delivery updates come back through ./status.
//
// Shared-secret auth (never a browser). Contract and error codes:
// app/lib/ai/aiSend.js. In local/dev runs PROVIDER_SEND_STUB=true makes the
// providers no-ops (app/lib/providerStub.js), so nothing real is sent.

import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import { verifyInternalServiceToken } from '@lib/internalServiceAuth';
import { AiSendError, sendAiMessage } from '@lib/ai/aiSend';
import { sendSMS } from '@lib/sms';
import { sendEmail } from '@lib/email';
import Email from '@models/Email';
import EmailAccount from '@models/EmailAccount';
import Lead from '@models/Lead';
import User from '@models/User';

export async function POST(req) {
  if (!verifyInternalServiceToken(req)) {
    return NextResponse.json({ error: 'Unauthorized', retryable: false }, { status: 401 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON', retryable: false }, { status: 400 });
  }
  try {
    await dbConnect();
    const result = await sendAiMessage(body, { Email, Lead, User, EmailAccount, sendSMS, sendEmail });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AiSendError) {
      return NextResponse.json({ error: error.message, retryable: error.retryable, opted_out: error.optedOut,
        ...(error.details ? { details: error.details } : {}) }, { status: error.httpStatus });
    }
    console.error('[ai] platform send failed', { idempotency_key: body?.idempotency_key, error: error?.message });
    return NextResponse.json({ error: 'Internal server error', retryable: true }, { status: 500 });
  }
}
