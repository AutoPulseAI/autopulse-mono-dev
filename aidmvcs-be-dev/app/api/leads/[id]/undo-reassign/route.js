// Undo a lead reassignment (BB, 14 Nov 2026). The lead goes back to whoever had it before its last reassignment
// (ActivityLog 'lead_reassigned', app/api/leads/[id] and bulk-assign).
//   GET  -> { last: { at, by, from, to, can_undo, why_not? } | null }
//   POST -> { ok, assigned_to, name }    The undo is itself logged as a reassignment (detail 'undo').
// Only while the lead is still with the person it was moved to (someone changed it since = 409, nothing touched).
// Errors: 401 · 403 no "Assign Leads" permission · 404 lead / no reassignment · 409 changed since.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import User from '@models/User';
import ActivityLog from '@models/ActivityLog';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission, isLeadManager } from '@lib/staffPermission';
import { logActivity } from '@lib/activityLog';

const fail = (error, status) => Response.json({ error, message: error }, { status });
const idOf = (v) => (v ? String(v) : null);

// Entries written before 17 Nov 2026 carry names only: find that person among the dealership's staff (and the owner)
// by name, only when exactly one matches.
async function idByName(dealerId, name) {
  if (!name) return null;
  const people = await User.find({ $or: [{ _id: mongoose.isValidObjectId(dealerId) ? dealerId : null }, { parent_id: dealerId }],
    name }).select('_id').lean();
  return people.length === 1 ? String(people[0]._id) : undefined; // undefined = can't tell who
}

async function lastReassignment(lead, user = null) {
  const entry = await ActivityLog.findOne({ lead_id: lead._id, action: 'lead_reassigned' }).sort({ at: -1 }).lean();
  if (!entry) return null;
  const from = entry.from == null ? null : idOf(entry.from_id) ?? await idByName(String(lead.dealer_id), entry.from);
  const to = entry.to == null ? null : idOf(entry.to_id) ?? await idByName(String(lead.dealer_id), entry.to);
  const current = idOf(lead.assigned_to);
  let why = null;
  if (entry.undone_at) why = 'Already undone';
  else if (from === undefined || to === undefined) why = 'The earlier owner can no longer be found';
  else if (current !== to) why = 'The lead was changed again since';
  // A manager override can only be undone by a manager (the user, 24 Nov 2026).
  else if (String(entry.detail || '').startsWith('override:') && !(await isLeadManager(user))) why = 'Only a manager can undo a manager override';
  return { entry, from, to, can_undo: !why, why_not: why };
}

async function load(req, params) {
  await dbConnect();
  const { id } = await params;
  const lead = mongoose.isValidObjectId(id) ? await Lead.findById(id).select('dealer_id assigned_to customer_id').lean() : null;
  if (!lead) return { response: fail('Lead not found', 404) };
  const access = await requireDealerAccess(req, String(lead.dealer_id));
  if (access.response) return { response: fail('Lead not found', 404) };
  return { lead, user: access.user };
}

export async function GET(req, { params }) {
  const { lead, user, response } = await load(req, params);
  if (response) return response;
  const last = await lastReassignment(lead, user);
  return Response.json({ last: last ? { at: last.entry.at, by: last.entry.actor_name, from: last.entry.from,
    to: last.entry.to, can_undo: last.can_undo, why_not: last.why_not } : null });
}

export async function POST(req, { params }) {
  const { lead, user, response } = await load(req, params);
  if (response) return response;
  if (!(await hasPermission(user, 'Assign Leads'))) return fail('You do not have permission to assign leads', 403);
  const last = await lastReassignment(lead, user);
  if (!last) return fail('This lead has no reassignment to undo', 404);
  if (!last.can_undo) return fail(last.why_not, 409);
  // Only if the lead is still with the person it was moved to.
  const res = await Lead.updateOne({ _id: lead._id, assigned_to: lead.assigned_to ?? null },
    { $set: { assigned_to: last.from ? new mongoose.Types.ObjectId(last.from) : null, updatedAt: new Date() } });
  if (!res.modifiedCount) return fail('The lead was changed again just now - nothing was undone', 409);
  await ActivityLog.updateOne({ _id: last.entry._id }, { $set: { undone_at: new Date() } });
  await logActivity({ dealer_id: lead.dealer_id, lead_id: lead._id, customer_id: lead.customer_id || null,
    actor_type: 'staff', actor_id: user._id, actor_name: user.name || null, action: 'lead_reassigned',
    from: last.entry.to, to: last.entry.from, detail: 'undo',
    ...(last.to ? { from_id: last.to } : {}), ...(last.from ? { to_id: last.from } : {}) });
  return Response.json({ ok: true, assigned_to: last.from, name: last.entry.from || null });
}
