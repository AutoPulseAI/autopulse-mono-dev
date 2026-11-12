// "This is how it will look": the form being edited (unsaved changes included) as a PDF, blank - no customer data.
//   POST { dealer_id, schema }
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormTemplate from '@models/FormTemplate';
import User from '@models/User';
import { fail, formsAccess } from '@lib/forms/access';
import { normalizeSchema } from '@lib/forms/schema';
import { isSource } from '@lib/forms/sources';
import { formPdf } from '@lib/forms/formPdf';

export const runtime = 'nodejs';

export async function POST(req, { params }) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const access = await formsAccess(req, body?.dealer_id);
  if (access.response) return access.response;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id) || !(await FormTemplate.exists({ _id: id, dealer_id: access.dealerId }))) {
    return fail('Form not found', 404);
  }
  let schema;
  try { schema = normalizeSchema(body.schema, { isSource }); } catch (e) { return fail(e.message, 400); }
  const dealer = await User.findById(access.dealerId).select('name dealer_account_information').lean();
  const pdf = await formPdf(schema, {}, { dealer: dealer?.dealer_account_information?.store_name || dealer?.name || '',
    trades: 1, stamp: 'PREVIEW', footer: 'Preview of the form - blank' });
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } });
}
