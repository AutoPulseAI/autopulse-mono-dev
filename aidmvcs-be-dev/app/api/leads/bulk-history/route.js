// GET /api/leads/bulk-history  Leads > Actions > Bulk history (SOW Deliverable B b5: bulk "audit trail").
//   ?dealer_id (required) &page &limit (default 10, max 50) &from &to (ISO dates) &by (name) &action (reassign|status)
//   &result (done|failed|undone) &q (a lead's name: changes that touched it)
//   -> { rows: [{ _id, at, by_name, action, to_label, leads, updated, unchanged, failed, undone_at, undone_by_name,
//                 can_undo }], people: [names for the "Done by" filter], pagination }
//   &id=<row id> -> { row, items: one page of that change's leads (before -> after, result, reason) }
// Errors: 401 · 403 not this dealership's staff.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import BulkChange from '@models/BulkChange';
import { requireDealerAccess } from '@lib/apiGuard';
import { canUndo } from '@lib/bulkChanges';

export const runtime = 'nodejs';
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const date = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

export async function GET(req) {
  await dbConnect();
  const url = new URL(req.url);
  const dealerId = String(url.searchParams.get('dealer_id') || '');
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 10));

  const one = url.searchParams.get('id');
  if (one) {
    const row = mongoose.isValidObjectId(one)
      ? await BulkChange.findOne({ _id: one, dealer_id: dealerId }).select('-items').lean() : null;
    if (!row) return Response.json({ error: 'Not found' }, { status: 404 });
    const [{ items = [], total = 0 } = {}] = await BulkChange.aggregate([
      { $match: { _id: row._id } },
      { $project: { total: { $size: '$items' }, items: { $slice: ['$items', (page - 1) * limit, limit] } } },
    ]);
    return Response.json({ row: { ...row, can_undo: canUndo(row) }, items,
      pagination: { currentPage: page, totalPages: Math.max(1, Math.ceil(total / limit)), totalItems: total, itemsPerPage: limit } });
  }

  const match = { dealer_id: dealerId };
  const from = date(url.searchParams.get('from'));
  const to = date(url.searchParams.get('to'));
  if (from || to) match.at = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const by = url.searchParams.get('by');
  if (by) match.by_name = by;
  const action = url.searchParams.get('action');
  if (['reassign', 'status'].includes(action)) match.action = action;
  const result = url.searchParams.get('result');
  if (result === 'failed') match.failed = { $gt: 0 };
  if (result === 'undone') match.undone_at = { $ne: null };
  if (result === 'done') { match.failed = 0; match.undone_at = null; }
  const q = String(url.searchParams.get('q') || '').trim();
  if (q) match['items.name'] = { $regex: escape(q), $options: 'i' };

  const [total, rows, people] = await Promise.all([
    BulkChange.countDocuments(match),
    BulkChange.find(match).select('-items').sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    BulkChange.distinct('by_name', { dealer_id: dealerId }),
  ]);
  return Response.json({
    rows: rows.map((r) => ({ ...r, leads: (r.updated || 0) + (r.unchanged || 0) + (r.failed || 0), can_undo: canUndo(r) })),
    people: people.filter(Boolean).sort(),
    pagination: { currentPage: page, totalPages: Math.max(1, Math.ceil(total / limit)), totalItems: total, itemsPerPage: limit },
  });
}
