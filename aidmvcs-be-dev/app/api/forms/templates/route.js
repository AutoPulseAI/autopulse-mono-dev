// The dealership's Forms Library (SOW v6 Deliverable K, gap G-064).
//   GET  ?dealer_id                      -> { templates, can_manage, categories }
//   GET  ?dealer_id&usable=1&lead_id=... -> { templates } the caller may fill for that lead: switched on, their role,
//                                           the lead's department (service if it has a service booking) and status
//   POST multipart: dealer_id, name, category, file (PDF) -> the AI reads the PDF into a first draft of the form
//        (lib/forms/aiParse.js), saved switched off for the dealer to check and edit in the builder
//   POST JSON { dealer_id, name, category, blank: true }  -> an empty form to build from scratch
// Errors: 400 bad input / not a PDF · 422 unreadable · 502 the AI failed · 503 no AI key · 401 · 403.
import dbConnect from '@lib/mongodb';
import FormTemplate, { FORM_CATEGORIES } from '@models/FormTemplate';
import Lead from '@models/Lead';
import Booking from '@models/Booking';
import { actorOf, canManageForms, canUseTemplate, fail, formsAccess, json, templateSummary } from '@lib/forms/access';
import { parseFormWithAi } from '@lib/forms/aiParse';
import { fillables, newId } from '@lib/forms/schema';

const countFields = (schema) => fillables(schema).length;
import { saveFile } from '@lib/forms/storage';

export const runtime = 'nodejs';

export async function GET(req) {
  await dbConnect();
  const params = new URL(req.url).searchParams;
  const access = await formsAccess(req, params.get('dealer_id'));
  if (access.response) return access.response;
  const templates = await FormTemplate.find({ dealer_id: access.dealerId, deleted_at: null }).select('-history').sort({ name: 1 }).lean();
  if (params.get('usable') !== '1') {
    return json({ templates: templates.map(templateSummary), can_manage: await canManageForms(access.user),
      categories: FORM_CATEGORIES });
  }
  const lead = params.get('lead_id') ? await Lead.findOne({ _id: params.get('lead_id'), dealer_id: access.dealerId })
    .select('fe_lead_status').lean() : null;
  const service = lead ? Boolean(await Booking.exists({ lead_id: String(lead._id), appointment_type: 'service' })) : false;
  const usable = templates.filter((t) => t.active && canUseTemplate(access.user, t)
    && t.versions.some((v) => v.version === t.current_version && v.schema)
    && (!t.departments?.length || t.departments.includes(service ? 'service' : 'sales'))
    && (!t.statuses?.length || (lead && t.statuses.includes(lead.fe_lead_status))));
  return json({ templates: usable.map(templateSummary) });
}

export async function POST(req) {
  await dbConnect();
  const isJson = (req.headers.get('content-type') || '').includes('application/json');
  let input;
  try { input = isJson ? await req.json() : Object.fromEntries((await req.formData()).entries()); }
  catch { return fail('Send a PDF (multipart) or { blank: true }', 400); }
  const access = await formsAccess(req, input.dealer_id);
  if (access.response) return access.response;
  if (!(await canManageForms(access.user))) return fail('You do not have permission to manage forms', 403);
  const category = String(input.category || 'Other');
  if (!FORM_CATEGORIES.includes(category)) return fail(`category must be one of: ${FORM_CATEGORIES.join(', ')}`, 400);
  const file = input.file;
  const actor = actorOf(access.user);
  let schema; let sourceId = null; let detail; let found = null;
  if (file && typeof file.arrayBuffer === 'function') {
    const buffer = Buffer.from(await file.arrayBuffer());
    try { schema = await parseFormWithAi(buffer, { filename: file.name }); }
    catch (e) { return fail(e.message, e.status || 400); }
    found = { sections: schema.sections.length, fields: countFields(schema) };
    sourceId = await saveFile(buffer, { filename: file.name, dealerId: access.dealerId, kind: 'template_source' });
    detail = `drafted by the AI from ${file.name || 'a PDF'}: ${found.sections} sections, ${found.fields} fields`;
  } else if (String(input.blank) === 'true') {
    schema = { title: String(input.name || 'New form').trim(), description: null,
      sections: [{ id: newId('s'), title: '', repeat: null, fields: [] }] };
    detail = 'started blank';
  } else return fail('Choose the PDF to upload, or start a blank form', 400);
  const name = String(input.name || '').trim().slice(0, 120) || schema.title.slice(0, 120);
  const t = await FormTemplate.create({ dealer_id: access.dealerId, name, category, active: false, current_version: 1,
    versions: [{ version: 1, schema, source_file_id: sourceId, source_filename: file?.name || null,
      created_by: actor.by, created_by_name: actor.by_name }],
    history: [{ ...actor, action: 'created', detail }] });
  return json({ template: templateSummary(t.toObject()), found }, 201);
}
