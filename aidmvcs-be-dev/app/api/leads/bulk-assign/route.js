// POST /api/leads/bulk-assign  reassign many leads at once (SOW Deliverable B b5, gap G-010: "bulk operations by
// permission with preview, confirmation, audit, safe errors").
//   body { dealer_id, lead_ids: [...], assigned_to: <staff id> | null, confirm: false | true }
//   confirm false (default) = PREVIEW: nothing is written; each lead with its current and new owner.
//   confirm true            = do it: each lead changed on its own; one lead failing never stops the others; every
//                             change is logged like a single reassignment (ActivityLog 'lead_reassigned', detail 'bulk').
// Errors: 401 not signed in · 403 not this dealership's staff, or no "Assign Leads" permission · 400 bad request
// (no leads, more than 200, bad ids) · 422 the new owner is not a staff member of this dealership.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import User from '@models/User';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';
import { logActivity } from '@lib/activityLog';

export const runtime = 'nodejs';
const MAX = 200;
const fail = (error, status) => Response.json({ error }, { status });

export async function POST(req) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const dealerId = String(body?.dealer_id || '');
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  if (!(await hasPermission(access.user, 'Assign Leads'))) return fail('You do not have permission to assign leads', 403);

  const raw = Array.isArray(body.lead_ids) ? body.lead_ids.map(String) : [];
  const ids = [...new Set(raw)];
  if (!ids.length) return fail('Pick at least one lead', 400);
  if (ids.length > MAX) return fail(`At most ${MAX} leads at a time`, 400);
  if (ids.some((id) => !mongoose.isValidObjectId(id))) return fail('Some lead ids are not valid', 400);

  const to = body.assigned_to ? String(body.assigned_to) : null;
  let assignee = null;
  if (to) {
    assignee = mongoose.isValidObjectId(to)
      ? await User.findOne({ _id: to, parent_id: dealerId, type: 'dealer' }).select('_id name').lean() : null;
    if (!assignee) return fail('The new owner must be a staff member of this dealership', 422);
  }

  const leads = await Lead.find({ _id: { $in: ids } }).select('_id name dealer_id customer_id assigned_to').lean();
  const byId = new Map(leads.map((l) => [String(l._id), l]));
  const ownerIds = [...new Set(leads.map((l) => l.assigned_to && String(l.assigned_to)).filter(Boolean))];
  const names = new Map((await User.find({ _id: { $in: ownerIds } }).select('name').lean())
    .map((u) => [String(u._id), u.name]));
  const ownerName = (id) => (id ? names.get(String(id)) || 'a removed user' : 'Unassigned');
  const newName = assignee ? assignee.name : 'Unassigned';

  const rows = ids.map((id) => {
    const l = byId.get(id);
    if (!l || String(l.dealer_id) !== dealerId) return { lead_id: id, name: null, error: 'Not a lead of this dealership' };
    const current = l.assigned_to ? String(l.assigned_to) : null;
    return { lead_id: id, name: l.name || null, current: ownerName(current), will_be: newName, change: current !== to };
  });
  const summary = { leads: rows.length, will_change: rows.filter((r) => r.change).length,
    already: rows.filter((r) => r.change === false).length, errors: rows.filter((r) => r.error).length };
  if (body.confirm !== true) return Response.json({ preview: true, summary, rows });

  const results = { updated: [], unchanged: [], failed: [] };
  const actor = access.user;
  for (const r of rows) {
    if (r.error) { results.failed.push({ lead_id: r.lead_id, reason: r.error }); continue; }
    if (!r.change) { results.unchanged.push(r.lead_id); continue; }
    const l = byId.get(r.lead_id);
    try {
      // Only if nobody changed it since the preview (same owner as read): no silent overwrite.
      const res = await Lead.updateOne({ _id: l._id, assigned_to: l.assigned_to ?? null },
        { $set: { assigned_to: to, updatedAt: new Date() } });
      if (!res.modifiedCount) { results.failed.push({ lead_id: r.lead_id, reason: 'Changed by someone else meanwhile - not touched' }); continue; }
      await logActivity({ dealer_id: dealerId, lead_id: l._id, customer_id: l.customer_id || null, actor_type: 'staff',
        actor_id: actor._id, actor_name: actor.name || null, action: 'lead_reassigned',
        from: l.assigned_to ? r.current : null, to: assignee ? newName : null, detail: 'bulk' });
      results.updated.push(r.lead_id);
    } catch (error) {
      results.failed.push({ lead_id: r.lead_id, reason: 'Could not be saved' });
      console.error('[bulk-assign] lead failed', { lead_id: r.lead_id, error: error?.message });
    }
  }
  return Response.json({ preview: false, updated: results.updated.length, unchanged: results.unchanged.length,
    failed: results.failed });
}
