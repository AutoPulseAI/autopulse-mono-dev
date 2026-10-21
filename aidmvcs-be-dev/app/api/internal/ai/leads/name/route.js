// POST /api/internal/ai/leads/name - the AI saves the name a customer texted when the lead had none ("N/A", "null").
// Client, 18 Oct 2026 (Betsy: "it didn't update the name ... for n/a or null it needs to ask for the first and last
// name"). Shared-secret auth. Body: {dealer_id, lead_id, name, said?}. A real name already on the lead is replaced
// only when the customer said it themselves ("my name is Sal" - Betsy, 21 Oct 2026, item 10: `said` is their words);
// the lead and the customer profile both change, and the customer timeline shows "Name updated by AI".
import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import { verifyInternalServiceToken } from '@lib/internalServiceAuth';
import Lead from '@models/Lead';
import Customer from '@models/Customer';
import { logActivity } from '@lib/activityLog';

const PLACEHOLDER = /^\s*(|n\/?a|null|null null|none|name|customer|unknown|test|undefined)\s*$/i;

export async function POST(req) {
  if (!verifyInternalServiceToken(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  const name = String(body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!body?.dealer_id || !body?.lead_id || !name || PLACEHOLDER.test(name)) {
    return NextResponse.json({ error: 'dealer_id, lead_id and a real name are required' }, { status: 422 });
  }
  try {
    await dbConnect();
    const lead = await Lead.findOne({ _id: body.lead_id, dealer_id: body.dealer_id }).lean();
    if (!lead) return NextResponse.json({ error: 'Lead not found for this dealer' }, { status: 404 });
    const said = String(body?.said || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const placeholder = PLACEHOLDER.test(String(lead.name || ''));
    if (!placeholder && !said) return NextResponse.json({ updated: false, reason: 'lead already has a name' });
    if (String(lead.name || '').trim().toLowerCase() === name.toLowerCase()) {
      return NextResponse.json({ updated: false, reason: 'same name' });
    }
    await Lead.updateOne({ _id: lead._id }, { $set: { name } });
    if (lead.customer_id) {
      const customer = await Customer.findById(lead.customer_id).lean();
      if (customer && (said || PLACEHOLDER.test(String(customer.name || '')))) {
        await Customer.updateOne({ _id: customer._id }, { $set: { name } });
      }
    }
    await logActivity({
      dealer_id: String(body.dealer_id), customer_id: lead.customer_id || null, lead_id: lead._id,
      actor_type: 'ai', actor_name: 'AutoPulse AI', action: 'name_updated_by_ai',
      from: placeholder ? null : String(lead.name || ''), to: name,
      detail: said ? `As the customer wrote: "${said}"` : 'The lead had no name',
    });
    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error('[ai] lead name failed', { lead_id: body?.lead_id, error: error?.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
