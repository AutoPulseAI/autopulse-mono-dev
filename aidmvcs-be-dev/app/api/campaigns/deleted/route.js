// Deleted campaigns that can still be put back (BB, 14 Nov 2026: undo delete; app/lib/trash.js).
//   GET ?dealer_id -> { deleted: [{ _id, record_id, label, deleted_at, deleted_by_name }] } (last 30 days)
import dbConnect from '@lib/mongodb';
import { requireDealerAccess } from '@lib/apiGuard';
import { listTrash } from '@lib/trash';

export async function GET(req) {
  await dbConnect();
  const dealerId = new URL(req.url).searchParams.get('dealer_id');
  if (!dealerId) return Response.json({ error: 'dealer_id is required' }, { status: 400 });
  const guard = await requireDealerAccess(req, String(dealerId));
  if (guard.response) return guard.response;
  return Response.json({ deleted: await listTrash({ kind: 'campaign', dealerId }) });
}
