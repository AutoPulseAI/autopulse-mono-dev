// POST /api/internal/ai/leads/owner - the AI service: this DealerVault customer has no lead in the CRM; create their
// owner lead (Sold Delivered, source DealerVault) so the owner life cycle has a conversation to live in. Returns the
// customer's latest lead instead when one exists. Shared-secret auth.
// Body: {dealer_id, customer_id, deal_number?}. See app/lib/ai/aiOwnerLead.js.

import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import { verifyInternalServiceToken } from '@lib/internalServiceAuth';
import { ensureOwnerLead, validateOwnerLeadPayload } from '@lib/ai/aiOwnerLead';
import Customer from '@models/Customer';
import Lead from '@models/Lead';

export async function POST(req) {
  if (!verifyInternalServiceToken(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const { errors } = validateOwnerLeadPayload(body);
  if (errors.length) return NextResponse.json({ error: 'Invalid request', details: errors }, { status: 422 });
  try {
    await dbConnect();
    const result = await ensureOwnerLead(body, { Lead, Customer });
    if (!result.found) return NextResponse.json({ error: 'Customer not found for this dealer' }, { status: 404 });
    return NextResponse.json({ lead_id: result.lead_id, created: result.created });
  } catch (error) {
    console.error('[ai] owner lead failed', { customer_id: body?.customer_id, error: error?.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
