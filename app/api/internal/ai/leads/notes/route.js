// POST /api/internal/ai/leads/notes - the AI service writes an internal note
// on a lead (e.g. a service request with the customer's preferred day/time).
// Shared-secret auth. Body: {dealer_id, lead_id, text, kind?, idempotency_key?} (a repeat key returns the
// same note, created: false - stream R).
// See app/lib/ai/aiDnd.js addAiLeadNote.

import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import { verifyInternalServiceToken } from '@lib/internalServiceAuth';
import { addAiLeadNote, validateNotePayload } from '@lib/ai/aiDnd';
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
  const { errors } = validateNotePayload(body);
  if (errors.length) return NextResponse.json({ error: 'Invalid request', details: errors }, { status: 422 });
  try {
    await dbConnect();
    const result = await addAiLeadNote(body, { Lead, Email });
    if (!result.found) return NextResponse.json({ error: 'Lead not found for this dealer' }, { status: 404 });
    return NextResponse.json({ id: result.id, created: result.created !== false });
  } catch (error) {
    console.error('[ai] lead note failed', { lead_id: body?.lead_id, error: error?.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
