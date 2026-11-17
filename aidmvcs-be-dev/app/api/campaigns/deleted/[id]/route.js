// Put a deleted campaign back (BB, 14 Nov 2026: undo delete).  POST { dealer_id } -> { ok, campaign_id }
// It comes back with its leads, as a draft: nothing is sent until someone schedules it again (its old send time may
// have passed while it was deleted). Errors: 404 · 409 already put back · 410 deleted over 30 days ago.
import dbConnect from '@lib/mongodb';
import Campaign from '@models/Campaign';
import { requireDealerAccess } from '@lib/apiGuard';
import { restoreFromTrash } from '@lib/trash';

export async function POST(req, { params }) {
  await dbConnect();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body?.dealer_id) return Response.json({ error: 'dealer_id is required' }, { status: 400 });
  const guard = await requireDealerAccess(req, String(body.dealer_id));
  if (guard.response) return guard.response;
  const out = await restoreFromTrash({ id, kind: 'campaign', dealerId: body.dealer_id, user: guard.user,
    collection: Campaign.collection.collectionName,
    prepare: (doc) => ({ ...doc, status: doc.status === 'completed' ? 'completed' : 'draft', updatedAt: new Date() }) });
  if (out.error) return Response.json({ error: out.error }, { status: out.status });
  return Response.json({ ok: true, campaign_id: out.record_id });
}
