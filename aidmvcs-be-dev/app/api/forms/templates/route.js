// The dealership's Forms & Documents Library (SOW v6 Deliverable K, gap G-064).
//   GET  ?dealer_id                      -> { templates, can_manage, categories }  (everything, for the library)
//   GET  ?dealer_id&usable=1&lead_id=... -> { templates } the caller may fill for that lead: active, their role, the
//                                           lead's department (service if it has a service booking) and status
//   POST multipart: dealer_id, name, category, file (PDF)  -> the new form, version 1 (managers of the library only)
// Errors: 400 bad input / not a PDF / locked PDF · 401 · 403 not this dealership's, or not allowed to manage forms.
import dbConnect from '@lib/mongodb';
import FormTemplate, { FORM_CATEGORIES } from '@models/FormTemplate';
import Lead from '@models/Lead';
import Booking from '@models/Booking';
import { actorOf, canManageForms, canUseTemplate, fail, formsAccess, json } from '@lib/forms/access';
import { inspectPdf } from '@lib/forms/render';
import { saveFile } from '@lib/forms/storage';
import { templateSummary as summary } from '@lib/forms/access';

export const runtime = 'nodejs';

export async function GET(req) {
  await dbConnect();
  const params = new URL(req.url).searchParams;
  const access = await formsAccess(req, params.get('dealer_id'));
  if (access.response) return access.response;
  const templates = await FormTemplate.find({ dealer_id: access.dealerId }).select('-history').sort({ name: 1 }).lean();
  if (params.get('usable') !== '1') {
    return json({ templates: templates.map(summary), can_manage: await canManageForms(access.user),
      categories: FORM_CATEGORIES });
  }
  const lead = params.get('lead_id') ? await Lead.findOne({ _id: params.get('lead_id'), dealer_id: access.dealerId })
    .select('fe_lead_status').lean() : null;
  const service = lead ? Boolean(await Booking.exists({ lead_id: String(lead._id), appointment_type: 'service' })) : false;
  const usable = templates.filter((t) => t.active && canUseTemplate(access.user, t)
    && (!t.departments?.length || t.departments.includes(service ? 'service' : 'sales'))
    && (!t.statuses?.length || (lead && t.statuses.includes(lead.fe_lead_status))));
  return json({ templates: usable.map(summary) });
}

export async function POST(req) {
  await dbConnect();
  let form;
  try { form = await req.formData(); } catch { return fail('Send the form as multipart/form-data', 400); }
  const access = await formsAccess(req, form.get('dealer_id'));
  if (access.response) return access.response;
  if (!(await canManageForms(access.user))) return fail('You do not have permission to manage forms', 403);
  const name = String(form.get('name') || '').trim().slice(0, 120);
  const category = String(form.get('category') || 'Other');
  const file = form.get('file');
  if (!name) return fail('Give the form a name', 400);
  if (!FORM_CATEGORIES.includes(category)) return fail(`category must be one of: ${FORM_CATEGORIES.join(', ')}`, 400);
  if (!file || typeof file.arrayBuffer !== 'function') return fail('Choose the PDF to upload', 400);
  const buffer = Buffer.from(await file.arrayBuffer());
  let info;
  try { info = await inspectPdf(buffer); } catch (e) { return fail(e.message, e.status || 400); }
  const fileId = await saveFile(buffer, { filename: file.name, dealerId: access.dealerId, kind: 'template' });
  const actor = actorOf(access.user);
  const t = await FormTemplate.create({ dealer_id: access.dealerId, name, category, current_version: 1,
    versions: [{ version: 1, file_id: fileId, filename: file.name || null, size: buffer.length, ...info,
      uploaded_by: actor.by, uploaded_by_name: actor.by_name }],
    history: [{ ...actor, action: 'uploaded', detail: `${file.name || 'PDF'} (${info.fillable ? `fillable, ${info.fields.length} fields` : 'not fillable'})` }] });
  return json({ template: summary(t.toObject()) }, 201);
}
