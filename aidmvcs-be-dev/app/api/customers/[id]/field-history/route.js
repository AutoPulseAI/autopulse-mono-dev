// A customer's field history (SOW Appendix B 4-5; 23 Nov 2026): what each source said about the customer's name,
// phones, emails and each vehicle's mileage, and what was decided - plus the staff contact edits
// (Customer.contact_history). Staff also record the customer's own word here: "that's not my number / mileage"
// (CUSTOMER_DISPUTED: the next DMS refresh can't silently bring it back) or "yes, that's right" (CUSTOMER_CONFIRMED).
//   GET  ?dealer_id=<id>  -> { rows: [newest first], edits: [contact_history] }
//   POST { dealer_id, field: name|phone|email|mileage:<VIN>, value, status: CUSTOMER_DISPUTED|CUSTOMER_CONFIRMED,
//          approximate?: true }   (approximate: the customer said "about 40,000")
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Customer from '@models/Customer';
import CustomerFieldHistory from '@models/CustomerFieldHistory';
import { requireDealerAccess } from '@lib/apiGuard';
import { normalizeEmail, normalizePhone } from '@lib/customerResolver';
import { recordHistory } from '@lib/reconcile/ledger';
import { parseMiles } from '@lib/reconcile/decide';

export const runtime = 'nodejs';
const fail = (message, status) => Response.json({ message, error: message }, { status });

async function load(req, id, dealerId) {
  if (!mongoose.isValidObjectId(id)) return { response: fail('Invalid customer id', 400) };
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access;
  const customer = await Customer.findOne({ _id: id, dealer_id: String(dealerId) }).select('contact_history').lean();
  if (!customer) return { response: fail('Customer not found', 404) };
  return { user: access.user, customer };
}

export async function GET(req, { params }) {
  await dbConnect();
  const { id } = await params;
  const r = await load(req, id, new URL(req.url).searchParams.get('dealer_id') || '');
  if (r.response) return r.response;
  const rows = await CustomerFieldHistory.find({ customer_id: id }).sort({ imported_at: -1, _id: -1 }).limit(500).lean();
  return Response.json({ rows, edits: [...(r.customer.contact_history || [])].reverse() });
}

export async function POST(req, { params }) {
  await dbConnect();
  const { id } = await params;
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const r = await load(req, id, String(body?.dealer_id || ''));
  if (r.response) return r.response;
  const status = ['CUSTOMER_DISPUTED', 'CUSTOMER_CONFIRMED'].includes(body?.status) ? body.status : null;
  if (!status) return fail('status must be CUSTOMER_DISPUTED or CUSTOMER_CONFIRMED', 400);
  const field = String(body?.field || '');
  let value;
  if (field === 'phone') value = String(normalizePhone(String(body?.value || '')) || '').slice(-10);
  else if (field === 'email') value = normalizeEmail(String(body?.value || ''));
  else if (field === 'name') value = String(body?.value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  else if (/^mileage:[A-Z0-9]{11,17}$/.test(field)) value = parseMiles(body?.value);
  else return fail('field must be name, phone, email or mileage:<VIN>', 400);
  if (!value || (field === 'phone' && value.length !== 10)) return fail('The value is not valid', 422);
  const user = r.user;
  const disputed = status === 'CUSTOMER_DISPUTED';
  await recordHistory([{ dealer_id: String(body.dealer_id), customer_id: id, field, value,
    decision: disputed ? 'RETAIN' : 'ACCEPT',
    reason: disputed ? 'the customer said this is wrong: a refresh can\'t bring it back' : 'confirmed by the customer',
    source: 'CUSTOMER', source_event_type: 'mark', source_event_date: field.startsWith('mileage:') && !disputed ? new Date() : null,
    precision: body?.approximate ? 'APPROXIMATE' : 'EXACT', status, by: user._id, by_name: user.name || null }]);
  return Response.json({ ok: true });
}
