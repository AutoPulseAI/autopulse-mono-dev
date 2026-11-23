// POST /api/leads/bulk-history/<id or batch id>/undo  undo one bulk reassignment (Leads > Actions > Bulk history, or Undo on the
// notice after saving). Each lead goes back to the owner it had before, only while it is still with the owner the
// bulk change gave it (changed since = left alone, counted). Each undo is logged like a single undo (ActivityLog
// lead_reassigned, detail 'undo'), which also writes the internal note in the conversation.
// Status changes are not undone in bulk: they start workflows (AI notice, follow-ups) - each lead is changed back by
// hand. Errors: 401 · 403 no "Assign Leads" permission · 404 · 409 already undone / not a reassignment.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import User from '@models/User';
import BulkChange from '@models/BulkChange';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';
import { logActivity } from '@lib/activityLog';
import { validBatchId } from '@lib/bulkChanges';

export const runtime = 'nodejs';
const fail = (error, status) => Response.json({ error, message: error }, { status });

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
  if (!(await hasPermission(access.user, 'Assign Leads'))) return fail('You do not have permission to assign leads', 403);
  if (row.action !== 'reassign') return fail('Status changes are changed back one lead at a time', 409);
  // Claim the undo first, so two clicks never undo twice.
  const claimed = await BulkChange.updateOne({ _id: row._id, undone_at: null },
    { $set: { undone_at: new Date(), undone_by_name: access.user.name || null } });
  if (!claimed.modifiedCount) return fail('This bulk change was already undone', 409);

  const done = row.items.filter((i) => i.result === 'updated');
  const ownerIds = [...new Set(done.map((i) => i.from_id && String(i.from_id)).filter(Boolean))];
  const names = new Map((await User.find({ _id: { $in: ownerIds } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  const result = { restored: 0, changed_since: 0, failed: 0 };
  for (const i of done) {
    try {
      const res = await Lead.updateOne({ _id: i.lead_id, dealer_id: row.dealer_id, assigned_to: row.to_id ?? null },
        { $set: { assigned_to: i.from_id ?? null, updatedAt: new Date() } });
      if (!res.modifiedCount) { result.changed_since += 1; continue; }
      const lead = await Lead.findById(i.lead_id).select('customer_id').lean();
      await logActivity({ dealer_id: row.dealer_id, lead_id: i.lead_id, customer_id: lead?.customer_id || null,
        actor_type: 'staff', actor_id: access.user._id, actor_name: access.user.name || null, action: 'lead_reassigned',
        from: row.to_label, to: i.from_id ? (names.get(String(i.from_id)) || i.from_label) : null, detail: 'undo',
        ...(row.to_id ? { from_id: row.to_id } : {}), ...(i.from_id ? { to_id: i.from_id } : {}) });
      result.restored += 1;
    } catch (error) {
      result.failed += 1;
      console.error('[bulk-undo] lead failed', { lead_id: String(i.lead_id), error: error?.message });
    }
  }
  await BulkChange.updateOne({ _id: row._id }, { $set: { undo_result: result } });
  return Response.json({ ok: true, ...result });
}
