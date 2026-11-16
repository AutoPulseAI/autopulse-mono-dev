// The dealership's Forms Library (SOW v6 Deliverable K).
//   GET  ?dealer_id[&usable=1]  -> { templates, can_manage }  (usable: switched on and allowed for the caller - the
//                                  list behind the customer profile's "Export to form")
//   POST multipart: dealer_id, name, file (PDF, or a JPG / PNG of the form) -> the form is stored as uploaded and its
//        blanks found and matched to customer data (lib/forms/read.js; a scan's blanks by the AI). Library managers only
//        ("Manage Account Information" / dealer account).
// Errors: 400 not a PDF / picture, locked, damaged · 422 nothing to fill / XFA / scan with no AI set up · 502 AI down
// · 401 · 403.
import dbConnect from '@lib/mongodb';
import FormTemplate from '@models/FormTemplate';
import { actorOf, canManageForms, canUseTemplate, fail, formsAccess, json, templateSummary } from '@lib/forms/access';
import { redetectEmpty } from '@lib/forms/detect';
import { readForm } from '@lib/forms/read';
import { readFile, saveFile } from '@lib/forms/storage';

export const runtime = 'nodejs';

export async function GET(req) {
  await dbConnect();
  const params = new URL(req.url).searchParams;
  const access = await formsAccess(req, params.get('dealer_id'));
  if (access.response) return access.response;
  const all = await FormTemplate.find({ dealer_id: access.dealerId, deleted_at: null }).select('-history').sort({ name: 1 }).lean();
  await redetectEmpty(all, { readFile, Model: FormTemplate });
  const list = params.get('usable') === '1'
    ? all.filter((t) => t.active !== false && canUseTemplate(access.user, t)).map(templateSummary).filter((t) => t.ready)
    : all.map(templateSummary);
  return json({ templates: list, can_manage: await canManageForms(access.user) });
}

export async function POST(req) {
  await dbConnect();
  let form;
  try { form = await req.formData(); } catch { return fail('Send the PDF as multipart/form-data', 400); }
  const access = await formsAccess(req, form.get('dealer_id'));
  if (access.response) return access.response;
  if (!(await canManageForms(access.user))) return fail('You do not have permission to manage forms', 403);
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return fail('Choose the form\'s PDF', 400);
  const name = String(form.get('name') || file.name || 'Form').replace(/\.pdf$/i, '').trim().slice(0, 120) || 'Form';
  let found;
  try { found = await readForm(Buffer.from(await file.arrayBuffer()), file.name); } catch (e) { return fail(e.message, e.status || 400); }
  const fileId = await saveFile(found.buffer, { filename: found.filename, dealerId: access.dealerId, kind: 'form' });
  const actor = actorOf(access.user);
  const t = await FormTemplate.create({ dealer_id: access.dealerId, name, active: true, current_version: 1,
    versions: [{ version: 1, source_file_id: fileId, source_filename: found.filename || null, fillable: found.fillable,
      pages: found.pages, fields: found.fields, found_by_ai: found.found_by_ai, created_by: actor.by, created_by_name: actor.by_name }],
    history: [{ ...actor, action: 'uploaded', detail: `${found.filename || 'PDF'}: ${found.fields.length} blanks`
      + `${found.found_by_ai ? ' (found by the AI)' : ''}, `
      + `${found.fields.filter((f) => f.source).length} filled from the customer's data` }] });
  return json({ template: templateSummary(t.toObject()) }, 201);
}
