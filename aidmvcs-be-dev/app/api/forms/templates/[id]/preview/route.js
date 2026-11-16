// Preview of a form: the dealer's PDF with a box on every blank and what fills it (blue) or "left blank" (orange), so
// the places can be checked before staff use the form - above all one whose blanks the AI found (a scan).
//   GET ?dealer_id -> application/pdf
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormTemplate from '@models/FormTemplate';
import { fail, formsAccess } from '@lib/forms/access';
import { fillForm } from '@lib/forms/fill';
import { sourceLabel } from '@lib/forms/sources';
import { readFile } from '@lib/forms/storage';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  await dbConnect();
  const q = new URL(req.url).searchParams;
  const access = await formsAccess(req, q.get('dealer_id'));
  if (access.response) return access.response;
  const { id } = await params;
  const t = mongoose.isValidObjectId(id) ? await FormTemplate.findOne({ _id: id, dealer_id: access.dealerId, deleted_at: null }).lean() : null;
  const v = t?.versions.find((x) => x.version === t.current_version);
  if (!v?.source_file_id) return fail('No uploaded PDF for this form', 404);
  const { pdf } = await fillForm(await readFile(v.source_file_id), v.fields || [], {}, { preview: true, describe: sourceLabel });
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
    'Content-Disposition': `inline; filename="${encodeURIComponent(`${t.name} - preview.pdf`)}"` } });
}
