// The dealership's own Do-Not-Contact list in the dealer portal (19 Nov 2026, SOW reference B8 "Manage Do-Not-Call
// List"; SOW L, G-071 "dealership-specific internal DNC lists"). The same list AutoPulse keeps on Admin > Contact
// compliance (ContactSuppression), for this dealership only:
//   GET    ?dealer_id=[&export=csv]               -> { entries, can_edit }   (csv: the active list as a file)
//   POST   { dealer_id, kind: phone|email, value, reason? }   add
//   DELETE { dealer_id, id }                                 remove (kept with removed_at, as on the admin page)
// Every staff member of the dealership can see it; adding and removing need the dealer account or "Manage Account
// Information". What the list does to sending is the dealer's compliance policy (lib/compliance/eligibility.js).
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import ContactSuppression from '@models/ContactSuppression';
import User from '@models/User';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';
import { normalizeEmail, normalizePhone } from '@lib/customerResolver';

export const runtime = 'nodejs';
const fail = (error, status) => Response.json({ error }, { status });
const canEdit = (user) => hasPermission(user, 'Manage Account Information');
const nameOf = async (user) => (await User.findById(user?._id).select('name email').lean())?.name || 'Staff';

async function guard(req, dealerId) {
  await dbConnect();
  if (!mongoose.isValidObjectId(dealerId)) return { response: fail('dealer_id is required', 400) };
  return requireDealerAccess(req, String(dealerId));
}

export async function GET(req) {
  const p = new URL(req.url).searchParams;
  const dealerId = String(p.get('dealer_id') || '');
  const g = await guard(req, dealerId);
  if (g.response) return g.response;
  const entries = await ContactSuppression.find({ dealer_id: dealerId, removed_at: null }).sort({ createdAt: -1 }).lean();
  if (p.get('export') === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['kind,value,channel,reason,added_by,added_at',
      ...entries.map((s) => [s.kind, s.value, s.channel, s.reason, s.added_by_name, s.createdAt?.toISOString()].map(esc).join(','))].join('\n');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="do-not-contact.csv"' } });
  }
  return Response.json({
    can_edit: await canEdit(g.user),
    entries: entries.map((s) => ({ id: String(s._id), kind: s.kind, value: s.value, channel: s.channel, reason: s.reason,
      source: s.source, added_by_name: s.added_by_name, added_at: s.createdAt })),
  });
}

export async function POST(req) {
  const b = await req.json().catch(() => null);
  const dealerId = String(b?.dealer_id || '');
  const g = await guard(req, dealerId);
  if (g.response) return g.response;
  if (!(await canEdit(g.user))) return fail('Only the dealership account or a manager can change this list', 403);
  const kind = b?.kind === 'email' ? 'email' : 'phone';
  const value = kind === 'email' ? normalizeEmail(b?.value) : normalizePhone(b?.value);
  if (!value || (kind === 'phone' && value.length !== 10)) return fail(kind === 'email' ? 'The email is not valid' : 'The phone needs 10 digits', 400);
  if (await ContactSuppression.findOne({ dealer_id: dealerId, kind, value, removed_at: null }).lean()) return fail('Already on the list', 409);
  await ContactSuppression.create({ dealer_id: dealerId, kind, value, channel: kind === 'email' ? 'email' : 'call_sms',
    reason: String(b?.reason || '').trim().slice(0, 200) || null, source: 'staff', added_by: g.user._id, added_by_name: await nameOf(g.user) });
  return Response.json({ ok: true });
}

export async function DELETE(req) {
  const b = await req.json().catch(() => null);
  const dealerId = String(b?.dealer_id || '');
  const g = await guard(req, dealerId);
  if (g.response) return g.response;
  if (!(await canEdit(g.user))) return fail('Only the dealership account or a manager can change this list', 403);
  if (!mongoose.isValidObjectId(b?.id)) return fail('id is required', 400);
  const res = await ContactSuppression.updateOne({ _id: b.id, dealer_id: dealerId, removed_at: null },
    { $set: { removed_at: new Date(), removed_by_name: await nameOf(g.user) } });
  if (!res.matchedCount) return fail('Not on the list', 404);
  return Response.json({ ok: true });
}
