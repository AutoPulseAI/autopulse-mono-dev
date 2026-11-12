// A filled form as a PDF (the user, 13 Nov 2026: the PDF is the form's reflection, to download or print). Made from
// the stored form and values, so a completed one always gives the same PDF; a draft is stamped DRAFT. Every download
// / print is logged. ?dealer_id[&print=1]
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormDocument from '@models/FormDocument';
import User from '@models/User';
import { actorOf, canSeeFinance, fail, formsAccess } from '@lib/forms/access';
import { visibleData } from '@lib/forms/documents';
import { formPdf } from '@lib/forms/formPdf';
import { getDealerTimezone } from '@lib/reporting/time';
import moment from 'moment-timezone';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  await dbConnect();
  const q = new URL(req.url).searchParams;
  const access = await formsAccess(req, q.get('dealer_id'));
  if (access.response) return access.response;
  const { id } = await params;
  const d = mongoose.isValidObjectId(id) ? await FormDocument.findOne({ _id: id, dealer_id: access.dealerId }).lean() : null;
  if (!d) return fail('Document not found', 404);
  if (d.removed_at) return fail('This form was removed at the end of its retention period', 410);
  const trades = (d.trade_in_ids || []).length;
  const { data } = visibleData(d.schema, trades, d.data, await canSeeFinance(access.user));
  const dealer = await User.findById(access.dealerId).select('name dealer_account_information').lean();
  const tz = await getDealerTimezone(access.dealerId);
  const done = d.status === 'completed';
  const footer = `${d.template_name} v${d.template_version} · ${done ? `completed ${moment(d.completed_at).tz(tz)
    .format('MMM D, YYYY h:mm A')} by ${d.completed_by_name || 'staff'}` : 'draft'}`;
  const pdf = await formPdf(d.schema, data, { dealer: dealer?.dealer_account_information?.store_name || dealer?.name || '',
    trades, stamp: done ? null : 'DRAFT', footer });
  const actor = actorOf(access.user);
  await FormDocument.updateOne({ _id: d._id }, { $push: { audit: { at: new Date(), by: actor.by, by_name: actor.by_name,
    action: q.get('print') === '1' ? 'printed' : 'downloaded' } } });
  const name = `${d.template_name || 'form'}-${new Date(d.created_at).toISOString().slice(0, 10)}.pdf`;
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
    'Content-Disposition': `${q.get('print') === '1' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(name)}"` } });
}
