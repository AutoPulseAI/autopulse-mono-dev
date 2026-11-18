// Release or discard a DMS feed file that was held back (SOW G-087). Super admin.
//   POST { action: 'release' | 'discard' }  release: the worker imports it within a minute (worker/dealervault/
//   sqsConsumer.js); discard: it is never imported (the record stays, for the history).
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import HeldFile from '@models/DealerVaultHeldFile';
import { requireSuperAdmin } from '@lib/apiGuard';

export async function POST(req, { params }) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!['release', 'discard'].includes(body.action)) return Response.json({ error: 'action must be release or discard' }, { status: 400 });
  if (!mongoose.isValidObjectId(id)) return Response.json({ error: 'Not found' }, { status: 404 });
  const res = await HeldFile.updateOne({ _id: id, status: 'held' }, { $set: {
    status: body.action === 'release' ? 'release_requested' : 'discarded',
    decided_by_name: access.user?.name || 'Super admin', decided_at: new Date() } });
  if (!res.modifiedCount) return Response.json({ error: 'Only a held file can be released or discarded' }, { status: 409 });
  return Response.json({ ok: true });
}
