// A form's PDF for checking it (SOW v6 Deliverable K, gap G-065 "visual/config mapping ... preview").
//   GET ?dealer_id[&version=N][&layout=1][&grid=1]
//   layout=1: each mapped field / placed box shows what fills it ("[Customer: Full name]"); grid=1 adds a 50-point
//   grid with its coordinates, to place boxes on a flat PDF. No customer data is ever put in.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormTemplate from '@models/FormTemplate';
import { fail, formsAccess } from '@lib/forms/access';
import { sourceLabel } from '@lib/forms/sources';
import { layoutPdf } from '@lib/forms/render';
import { readFile } from '@lib/forms/storage';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  await dbConnect();
  const q = new URL(req.url).searchParams;
  const access = await formsAccess(req, q.get('dealer_id'));
  if (access.response) return access.response;
  const { id } = await params;
  const t = mongoose.isValidObjectId(id) ? await FormTemplate.findOne({ _id: id, dealer_id: access.dealerId }).lean() : null;
  if (!t) return fail('Form not found', 404);
  const v = t.versions.find((x) => x.version === Number(q.get('version') || t.current_version));
  if (!v) return fail('No such version', 404);
  let pdf = await readFile(v.file_id);
  if (q.get('layout') === '1' || q.get('grid') === '1') {
    pdf = await layoutPdf(pdf, q.get('layout') === '1' ? v.mapping : [], sourceLabel, { grid: q.get('grid') === '1' });
  }
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
    'Content-Disposition': `inline; filename="${encodeURIComponent(t.name)}-v${v.version}.pdf"` } });
}
