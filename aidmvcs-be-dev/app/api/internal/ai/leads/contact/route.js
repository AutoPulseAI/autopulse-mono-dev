// POST /api/internal/ai/leads/contact - the AI saves an email or phone the customer texted when the lead had none
// (Betsy, 21 Oct 2026, item 10: "collects a missing email or phone on the way to the appointment"). Shared-secret
// auth. Body: {dealer_id, lead_id, email?, phone?, said?}. Only an empty field is filled - one already on the lead or
// the customer is never replaced - and the customer timeline shows it. A phone saved here is for staff to call: it
// gives no texting consent (that stays in the AI's consent records).
import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import { verifyInternalServiceToken } from '@lib/internalServiceAuth';
import Lead from '@models/Lead';
import Customer from '@models/Customer';
import { logActivity } from '@lib/activityLog';

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export async function POST(req) {
  if (!verifyInternalServiceToken(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  const email = String(body?.email || '').trim().toLowerCase();
  const digits = String(body?.phone || '').replace(/\D/g, '');
  const phone = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : '';
  if (!body?.dealer_id || !body?.lead_id || (!EMAIL.test(email) && !phone)) {
    return NextResponse.json({ error: 'dealer_id, lead_id and a valid email or phone are required' }, { status: 422 });
  }
  try {
    await dbConnect();
    const lead = await Lead.findOne({ _id: body.lead_id, dealer_id: body.dealer_id }).lean();
    if (!lead) return NextResponse.json({ error: 'Lead not found for this dealer' }, { status: 404 });
    const set = {};
    if (EMAIL.test(email) && !lead.email) set.email = email;
    if (phone && !lead.phone) set.phone = phone;
    if (!Object.keys(set).length) return NextResponse.json({ updated: false, reason: 'the lead already has them' });
    await Lead.updateOne({ _id: lead._id }, { $set: set });
    if (lead.customer_id) {
      const customer = await Customer.findById(lead.customer_id).lean();
      const forCustomer = Object.fromEntries(Object.entries(set).filter(([k]) => customer && !customer[k]));
      if (Object.keys(forCustomer).length) await Customer.updateOne({ _id: customer._id }, { $set: forCustomer });
    }
    const said = String(body?.said || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    for (const [field, value] of Object.entries(set)) {
      await logActivity({
        dealer_id: String(body.dealer_id), customer_id: lead.customer_id || null, lead_id: lead._id,
        actor_type: 'ai', actor_name: 'AutoPulse AI', action: `${field}_added_by_ai`, to: value,
        detail: said ? `As the customer wrote: "${said}"` : null,
      });
    }
    return NextResponse.json({ updated: true, fields: Object.keys(set) });
  } catch (error) {
    console.error('[ai] lead contact failed', { lead_id: body?.lead_id, error: error?.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
