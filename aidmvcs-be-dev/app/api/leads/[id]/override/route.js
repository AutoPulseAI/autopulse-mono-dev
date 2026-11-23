// Manager override (SOW Deliverable B b3: "manager override"; the user, 24 Nov 2026). A manager takes a lead off its
// owner now, even mid-conversation, with a reason the owner sees.
//   GET  -> { owner: { id, name } | null, can_override, staff: [{ id, name }] }
//   POST { to: <staff id>, reason, expected_owner: <owner id the screen showed | null> } -> { ok, assigned_to, name }
// What happens: the lead's owner changes; ActivityLog lead_reassigned with detail "override: <reason>" (which also writes
// the internal note in the conversation, app/lib/reassignmentNote.js); the old owner sees it in the bell ("Taken over
// from you"); only a manager can undo it. The AI is not changed. Nothing is sent to the customer.
// Errors: 401 · 403 not a manager · 404 · 400 no reason / bad owner · 409 the owner changed meanwhile.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import User from '@models/User';
import { requireDealerAccess } from '@lib/apiGuard';
import { isLeadManager } from '@lib/staffPermission';
import { logActivity } from '@lib/activityLog';

export const runtime = 'nodejs';
const fail = (error, status) => Response.json({ error, message: error }, { status });

async function load(req, params) {
  await dbConnect();
  const { id } = await params;
  const lead = mongoose.isValidObjectId(id) ? await Lead.findById(id).select('dealer_id assigned_to customer_id').lean() : null;
  if (!lead) return { response: fail('Lead not found', 404) };
  const access = await requireDealerAccess(req, String(lead.dealer_id));
  if (access.response) return { response: fail('Lead not found', 404) };
  return { lead, user: access.user };
}

const staffOf = (dealerId) => User.find({ $or: [{ _id: mongoose.isValidObjectId(dealerId) ? dealerId : null }, { parent_id: dealerId }] })
  .select('name email').lean();

export async function GET(req, { params }) {
  const { lead, user, response } = await load(req, params);
  if (response) return response;
  const staff = await staffOf(String(lead.dealer_id));
  const owner = lead.assigned_to ? staff.find((s) => String(s._id) === String(lead.assigned_to)) : null;
  return Response.json({
    owner: lead.assigned_to ? { id: String(lead.assigned_to), name: owner?.name || 'a removed user' } : null,
    can_override: await isLeadManager(user),
    staff: staff.map((s) => ({ id: String(s._id), name: s.name || s.email })),
  });
}

export async function POST(req, { params }) {
  const { lead, user, response } = await load(req, params);
  if (response) return response;
  if (!(await isLeadManager(user))) return fail('Only a manager can override the owner', 403);
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const reason = String(body?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!reason) return fail('Say why - the owner sees it', 400);
  const to = String(body?.to || '');
  const staff = await staffOf(String(lead.dealer_id));
  const target = staff.find((s) => String(s._id) === to);
  if (!target) return fail('Pick someone from this dealership', 400);
  const current = lead.assigned_to ? String(lead.assigned_to) : null;
  if ((body.expected_owner ?? null) !== current) return fail('The owner changed meanwhile - look again before overriding', 409);
  if (current === to) return fail(`${target.name} already owns this lead`, 400);
  const res = await Lead.updateOne({ _id: lead._id, assigned_to: lead.assigned_to ?? null },
    { $set: { assigned_to: target._id, updatedAt: new Date() } });
  if (!res.modifiedCount) return fail('The owner changed meanwhile - look again before overriding', 409);
  const fromName = current ? (staff.find((s) => String(s._id) === current)?.name || 'a removed user') : null;
  await logActivity({ dealer_id: lead.dealer_id, lead_id: lead._id, customer_id: lead.customer_id || null,
    actor_type: 'staff', actor_id: user._id, actor_name: user.name || null, action: 'lead_reassigned',
    from: fromName, to: target.name || null, detail: `override: ${reason}`,
    ...(current ? { from_id: current } : {}), to_id: target._id });
  return Response.json({ ok: true, assigned_to: String(target._id), name: target.name || null });
}
