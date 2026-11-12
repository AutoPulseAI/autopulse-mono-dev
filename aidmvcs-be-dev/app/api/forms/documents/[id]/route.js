// A stored form (SOW v6 Deliverable K, gap G-066): the PDF exactly as it was generated. Every download / print is
// logged on it (who, when). ?dealer_id[&print=1]
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormDocument from '@models/FormDocument';
import { actorOf, fail, formsAccess } from '@lib/forms/access';
import { readFile } from '@lib/forms/storage';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  await dbConnect();
  const q = new URL(req.url).searchParams;
  const access = await formsAccess(req, q.get('dealer_id'));
  if (access.response) return access.response;
  const { id } = await params;
  const d = mongoose.isValidObjectId(id) ? await FormDocument.findOne({ _id: id, dealer_id: access.dealerId }).lean() : null;
  if (!d) return fail('Document not found', 404);
  if (!d.file_id) return fail('This copy was removed at the end of its retention period', 410);
  const pdf = await readFile(d.file_id);
  const actor = actorOf(access.user);
  await FormDocument.updateOne({ _id: d._id }, { $push: { audit: { at: new Date(), by: actor.by, by_name: actor.by_name,
    action: q.get('print') === '1' ? 'printed' : 'downloaded' } } });
  const name = `${d.template_name || 'form'}-${new Date(d.created_at).toISOString().slice(0, 10)}.pdf`;
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
    'Content-Disposition': `${q.get('print') === '1' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(name)}"` } });
}
