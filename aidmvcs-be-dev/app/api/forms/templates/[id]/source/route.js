// The PDF a form version was read from, for reference while editing it. ?dealer_id[&version=N]
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormTemplate from '@models/FormTemplate';
import { fail, formsAccess } from '@lib/forms/access';
import { readFile } from '@lib/forms/storage';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  await dbConnect();
  const q = new URL(req.url).searchParams;
  const access = await formsAccess(req, q.get('dealer_id'));
  if (access.response) return access.response;
  const { id } = await params;
  const t = mongoose.isValidObjectId(id) ? await FormTemplate.findOne({ _id: id, dealer_id: access.dealerId }).lean() : null;
  const v = t?.versions.find((x) => x.version === Number(q.get('version') || t.current_version));
  if (!v?.source_file_id) return fail('No uploaded PDF for this form', 404);
  return new Response(await readFile(v.source_file_id), { headers: { 'Content-Type': 'application/pdf',
    'Cache-Control': 'no-store', 'Content-Disposition': `inline; filename="${encodeURIComponent(v.source_filename || 'form.pdf')}"` } });
}
