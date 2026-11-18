// Standard forms (13 Nov 2026 meeting, 7.4; lib/forms/standardForms.js).
//   GET  ?dealer_id                -> { forms: [{ key, name, category, added }] }
//   POST { dealer_id, key }        -> adds that form to the dealership's library, ready to use: { template }
// Library managers only for POST. Nothing is read by AI: our own fillable PDF, with what fills each blank set by us.
import dbConnect from '@lib/mongodb';
import FormTemplate from '@models/FormTemplate';
import { actorOf, canManageForms, fail, formsAccess, json, templateSummary } from '@lib/forms/access';
import { detectFields } from '@lib/forms/detect';
import { STANDARD_FORMS, standardFormPdf, standardFormSources } from '@lib/forms/standardForms';
import { saveFile } from '@lib/forms/storage';

export const runtime = 'nodejs';

const contextOf = (source, label) => (/co ?(buyer|applicant)/i.test(label) ? 'co_buyer'
  : source?.startsWith('trade.') ? 'trade_in' : source?.startsWith('vehicle.') ? 'vehicle_being_bought'
    : source?.startsWith('dealer.') || source?.startsWith('staff.') ? 'dealer' : 'buyer');

export async function GET(req) {
  await dbConnect();
  const access = await formsAccess(req, new URL(req.url).searchParams.get('dealer_id'));
  if (access.response) return access.response;
  const have = new Set((await FormTemplate.find({ dealer_id: access.dealerId, deleted_at: null, standard_key: { $ne: null } })
    .select('standard_key').lean()).map((t) => t.standard_key));
  return json({ forms: Object.entries(STANDARD_FORMS).map(([key, f]) => ({ key, name: f.name, category: f.category, added: have.has(key) })) });
}

export async function POST(req) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const access = await formsAccess(req, body?.dealer_id);
  if (access.response) return access.response;
  if (!(await canManageForms(access.user))) return fail('You do not have permission to manage forms', 403);
  const spec = STANDARD_FORMS[body?.key];
  if (!spec) return fail('Unknown standard form', 404);
  const buffer = await standardFormPdf(body.key);
  const found = await detectFields(buffer);
  const fills = standardFormSources(body.key);
  const fields = found.fields.map((f) => {
    const source = fills[f.pdf_field] ?? null;
    const never = ['signature', 'initials', 'checkbox'].includes(f.field_type);
    const src = never ? null : source;
    return { ...f, source: src, fill_policy: src ? 'automatic' : 'person', confidence: 1, context: contextOf(src, f.label || '') };
  });
  const filename = `${spec.name.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`;
  const fileId = await saveFile(buffer, { filename, dealerId: access.dealerId, kind: 'form' });
  const actor = actorOf(access.user);
  const t = await FormTemplate.create({ dealer_id: access.dealerId, name: spec.name, category: spec.category, active: true,
    standard_key: body.key, current_version: 1,
    versions: [{ version: 1, source_file_id: fileId, source_filename: filename, fillable: true, pages: found.pages, fields,
      fingerprint: found.fingerprint, created_by: actor.by, created_by_name: actor.by_name }],
    history: [{ ...actor, action: 'added standard form', detail: `${spec.name}: ${fields.length} blanks, `
      + `${fields.filter((f) => f.fill_policy === 'automatic').length} filled from the customer's data` }] });
  return json({ template: templateSummary(t.toObject()) }, 201);
}
