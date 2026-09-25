// Shared by the admin AI lead routes (app/api/admin/ai/leads/[id]/...):
// admin auth, a valid lead id, and the lead with its dealer.

import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import { requireAdmin } from '@lib/adminAuth';
import Lead from '@models/Lead';

export async function loadLeadForAdmin(request, params) {
  const auth = requireAdmin(request);
  if (auth.error) return { error: auth.error };

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) {
    return { error: NextResponse.json({ error: 'Invalid lead id' }, { status: 400 }) };
  }
  await dbConnect();
  const lead = await Lead.findById(id).select('dealer_id name').lean();
  if (!lead) return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };
  return { auth, lead, leadId: String(lead._id), dealerId: String(lead.dealer_id) };
}

// sendAiEvent's result → HTTP answer. `off` means the dealer's AI is off, so
// there is nothing to pause or resume.
export function eventResponse(action, result) {
  if (result.status === 'off') {
    return NextResponse.json({ error: `This dealer's AI mode is off; nothing to ${action}.` }, { status: 409 });
  }
  if (result.status === 'delivered' || result.status === 'queued_for_retry') {
    return NextResponse.json({ status: result.status }, { status: result.status === 'delivered' ? 200 : 202 });
  }
  return NextResponse.json({ error: `Could not ${action} the AI for this lead`, detail: result.error ?? result.reason },
    { status: 502 });
}
