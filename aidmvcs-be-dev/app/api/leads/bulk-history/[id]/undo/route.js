// POST /api/leads/bulk-history/<id or batch id>/undo  undo one bulk change (Leads > Actions > Bulk history, or Undo on
// the notice after saving; the user, 24 Nov 2026: every action can be undone). Only the leads the change actually
// changed are touched, each only while it still holds what the change put there - a lead changed since is left alone
// and counted (changed_since).
//   reassign            back to the owner before (logged like a single undo; writes the internal note)
//   status              back to the status before, through the status change every screen uses (its workflow runs, as
//                       when staff do it by hand); a status that can't be set that way is reported, not forced
//   department / lead_source / campaign   back to the value before, through PATCH /api/leads/[id]/details
//   note / task         the note / call task the change added is removed (a task already done is left)
// Errors: 401 · 403 no permission · 404 · 409 already undone.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import User from '@models/User';
import Email from '@models/Email';
import LeadReminder from '@models/LeadReminder';
import BulkChange from '@models/BulkChange';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';
import { logActivity } from '@lib/activityLog';
import { validBatchId } from '@lib/bulkChanges';
import { PUT as changeStatus } from '../../../../conversations/lead/status/route.js';
import { PATCH as editDetails } from '../../../[id]/details/route.js';

export const runtime = 'nodejs';
const fail = (error, status) => Response.json({ error, message: error }, { status });
const FIELDS = { department: 'department', lead_source: 'lead_source', campaign: 'campaign' };

export async function POST(req, { params }) {
  await dbConnect();
  const { id } = await params;
  // <id> is the row's id (Bulk history) or the batch id the browser made (the notice right after saving).
  const batchId = validBatchId(id);
  const row = mongoose.isValidObjectId(id) ? await BulkChange.findById(id).lean()
    : batchId ? await BulkChange.findOne({ batch_id: batchId }).lean() : null;
  if (!row) return fail('Bulk change not found', 404);
  const access = await requireDealerAccess(req, row.dealer_id);
  if (access.response) return fail('Bulk change not found', 404);
  const needs = row.action === 'reassign' ? 'Assign Leads' : 'Manage Leads';
  if (!(await hasPermission(access.user, needs))) return fail('You do not have permission to undo this', 403);
  // Claim the undo first, so two clicks never undo twice.
  const claimed = await BulkChange.updateOne({ _id: row._id, undone_at: null },
    { $set: { undone_at: new Date(), undone_by_name: access.user.name || null } });
  if (!claimed.modifiedCount) return fail('This bulk change was already undone', 409);

  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const h of ['authorization', 'cookie']) if (req.headers.get(h)) headers.set(h, req.headers.get(h));
  const call = async (handler, url, method, payload, routeParams) => {
    const res = await handler(new Request(new URL(url, req.url), { method, headers, body: JSON.stringify(payload) }),
      routeParams ? { params: Promise.resolve(routeParams) } : undefined);
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  };

  const done = row.items.filter((i) => i.result === 'updated');
  const result = { restored: 0, changed_since: 0, failed: 0, reasons: [] };
  const miss = (i, reason) => { result.failed += 1; if (result.reasons.length < 20) result.reasons.push({ lead_id: String(i.lead_id), name: i.name, reason }); };
  const names = row.action === 'reassign'
    ? new Map((await User.find({ _id: { $in: [...new Set(done.map((i) => i.from_id && String(i.from_id)).filter(Boolean))] } })
      .select('name').lean()).map((u) => [String(u._id), u.name]))
    : new Map();

  for (const i of done) {
    try {
      if (row.action === 'reassign') {
        const res = await Lead.updateOne({ _id: i.lead_id, dealer_id: row.dealer_id, assigned_to: row.to_id ?? null },
          { $set: { assigned_to: i.from_id ?? null, updatedAt: new Date() } });
        if (!res.modifiedCount) { result.changed_since += 1; continue; }
        const lead = await Lead.findById(i.lead_id).select('customer_id').lean();
        await logActivity({ dealer_id: row.dealer_id, lead_id: i.lead_id, customer_id: lead?.customer_id || null,
          actor_type: 'staff', actor_id: access.user._id, actor_name: access.user.name || null, action: 'lead_reassigned',
          from: row.to_label, to: i.from_id ? (names.get(String(i.from_id)) || i.from_label) : null, detail: 'undo',
          ...(row.to_id ? { from_id: row.to_id } : {}), ...(i.from_id ? { to_id: i.from_id } : {}) });
      } else if (row.action === 'status') {
        const lead = await Lead.findById(i.lead_id).select('fe_lead_status').lean();
        if (!lead || (lead.fe_lead_status || null) !== row.to_label) { result.changed_since += 1; continue; }
        if (!i.from_label) { miss(i, 'It had no status before'); continue; }
        const r = await call(changeStatus, '/api/conversations/lead/status', 'PUT', { id: String(i.lead_id), status: i.from_label });
        if (!r.ok) { miss(i, r.data.error || r.data.message || `Refused (${r.status})`); continue; }
      } else if (FIELDS[row.action]) {
        const r = await call(editDetails, `/api/leads/${i.lead_id}/details`, 'PATCH',
          { changes: { [FIELDS[row.action]]: { from: row.to_value, to: i.from_label || '' } }, skip_notify: true }, { id: String(i.lead_id) });
        if (r.status === 409) { result.changed_since += 1; continue; }
        if (!r.ok) { miss(i, r.data.error || r.data.message || `Refused (${r.status})`); continue; }
      } else if (row.action === 'note') {
        if (!i.ref_id) { miss(i, 'The note can no longer be found'); continue; }
        const res = await Email.deleteOne({ _id: i.ref_id, lead_id: i.lead_id, is_note: true });
        if (!res.deletedCount) { result.changed_since += 1; continue; }
      } else if (row.action === 'task') {
        if (!i.ref_id) { miss(i, 'The task can no longer be found'); continue; }
        const res = await LeadReminder.deleteOne({ _id: i.ref_id, lead_id: i.lead_id, done_at: null });
        if (!res.deletedCount) { result.changed_since += 1; continue; }
      }
      if (row.action === 'note' || row.action === 'task') {
        const lead = await Lead.findById(i.lead_id).select('customer_id').lean();
        await logActivity({ dealer_id: row.dealer_id, lead_id: i.lead_id, customer_id: lead?.customer_id || null,
          actor_type: 'staff', actor_id: access.user._id, actor_name: access.user.name || null,
          action: row.action === 'note' ? 'note_removed' : 'reminder_removed', detail: `bulk undo: ${row.to_label || ''}` });
      }
      result.restored += 1;
    } catch (error) {
      miss(i, 'Could not be saved');
      console.error('[bulk-undo] lead failed', { action: row.action, lead_id: String(i.lead_id), error: error?.message });
    }
  }
  await BulkChange.updateOne({ _id: row._id }, { $set: { undo_result: { restored: result.restored,
    changed_since: result.changed_since, failed: result.failed } } });
  return Response.json({ ok: true, action: row.action, ...result });
}
