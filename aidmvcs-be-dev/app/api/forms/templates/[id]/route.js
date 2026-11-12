// One form of the library (SOW v6 Deliverable K, gaps G-064 / G-065). Library managers only, except GET.
//   GET   ?dealer_id -> { template (with the current version's schema), sources, roles, statuses, can_manage }
//   PATCH { dealer_id, name?, category?, active?, departments?, role_ids?, statuses?, retention_days?, schema? }
//         schema = the edited form (lib/forms/schema.js). Saved over the current version while no customer form uses
//         it; once one does, it is saved as a new version (that customer's copy keeps the version it was made with).
//   POST  multipart: dealer_id, file -> the new PDF is read into a new version of the form (the dealer then edits it)
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormTemplate, { FORM_CATEGORIES } from '@models/FormTemplate';
import FormDocument from '@models/FormDocument';
import { actorOf, canManageForms, dealerRoles, fail, formsAccess, json, templateSummary } from '@lib/forms/access';
import { SOURCES, isSource } from '@lib/forms/sources';
import { normalizeSchema } from '@lib/forms/schema';
import { extractForm } from '@lib/forms/extract';
import { saveFile } from '@lib/forms/storage';

export const runtime = 'nodejs';
const LEAD_STATUSES = ['Lead', 'Lead Not Contacted', 'Contacted - No Next Action', 'Contacted - Specific Follow-up',
  'Appointment Booked', 'No Show', 'Visited', 'Managerial Review', 'Sold Pending', 'Sold Delivered', 'Unsold'];

async function load(req, params, dealerId) {
  const access = await formsAccess(req, dealerId);
  if (access.response) return access;
  const { id } = await params;
  const t = mongoose.isValidObjectId(id) ? await FormTemplate.findOne({ _id: id, dealer_id: access.dealerId }) : null;
  if (!t) return { response: fail('Form not found', 404) };
  return { ...access, t };
}

const current = (t) => t.versions.find((v) => v.version === t.current_version);

function detail(t) {
  const v = current(t);
  return { ...templateSummary(t.toObject()), schema: v?.schema || null, source_filename: v?.source_filename || null,
    version_list: t.versions.map((x) => ({ version: x.version, created_at: x.created_at, created_by: x.created_by_name,
      from_pdf: x.source_filename })).reverse(),
    history: t.history.slice(-30).reverse() };
}

export async function GET(req, { params }) {
  await dbConnect();
  const found = await load(req, params, new URL(req.url).searchParams.get('dealer_id'));
  if (found.response) return found.response;
  return json({ template: detail(found.t), sources: SOURCES, roles: await dealerRoles(found.dealerId),
    statuses: LEAD_STATUSES, categories: FORM_CATEGORIES, can_manage: await canManageForms(found.user) });
}

export async function PATCH(req, { params }) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const found = await load(req, params, body?.dealer_id);
  if (found.response) return found.response;
  if (!(await canManageForms(found.user))) return fail('You do not have permission to manage forms', 403);
  const { t } = found;
  const actor = actorOf(found.user);
  const changes = [];
  if (body.name !== undefined) {
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) return fail('Give the form a name', 400);
    if (name !== t.name) { changes.push(`name "${name}"`); t.name = name; }
  }
  if (body.category !== undefined) {
    if (!FORM_CATEGORIES.includes(body.category)) return fail('Unknown category', 400);
    if (body.category !== t.category) { changes.push(`category ${body.category}`); t.category = body.category; }
  }
  if (body.departments !== undefined) {
    t.departments = [...new Set((body.departments || []).filter((x) => ['sales', 'service'].includes(x)))];
    changes.push(`departments: ${t.departments.join(', ') || 'both'}`);
  }
  if (body.role_ids !== undefined) {
    const own = new Set((await dealerRoles(found.dealerId)).map((r) => r.id));
    const ids = (body.role_ids || []).map(String);
    if (ids.some((r) => !own.has(r))) return fail('A role picked is not one of this dealership\'s', 400);
    t.role_ids = ids; changes.push(`roles: ${ids.length || 'all'}`);
  }
  if (body.statuses !== undefined) {
    t.statuses = (body.statuses || []).filter((x) => LEAD_STATUSES.includes(x));
    changes.push(`available at: ${t.statuses.join(', ') || 'any status'}`);
  }
  if (body.retention_days !== undefined) {
    const r = body.retention_days === null || body.retention_days === '' ? null : Number(body.retention_days);
    if (r !== null && !(Number.isInteger(r) && r >= 30 && r <= 3650)) return fail('Keep copies 30 to 3650 days, or leave it empty to keep them', 400);
    t.retention_days = r; changes.push(`copies kept: ${r ? `${r} days` : 'always'}`);
  }
  if (body.schema !== undefined) {
    let schema;
    try { schema = normalizeSchema(body.schema, { isSource }); } catch (e) { return fail(e.message, 400); }
    const v = current(t);
    const used = v && await FormDocument.exists({ template_id: t._id, template_version: v.version });
    if (!v || used) {
      const version = Math.max(0, ...t.versions.map((x) => x.version)) + 1;
      t.versions.push({ version, schema, source_file_id: v?.source_file_id || null, source_filename: v?.source_filename || null,
        created_by: actor.by, created_by_name: actor.by_name });
      t.current_version = version;
      t.history.push({ ...actor, action: 'new_version', detail: `version ${version} (the form was edited after customers' forms were made)` });
    } else {
      v.schema = schema;
      t.markModified('versions');
      t.history.push({ ...actor, action: 'edited', detail: `version ${v.version}` });
    }
  }
  if (body.active !== undefined && Boolean(body.active) !== t.active) {
    if (body.active && !(current(t)?.schema?.sections || []).some((s) => s.fields.length)) {
      return fail('Add the form\'s fields before switching it on', 400);
    }
    t.active = Boolean(body.active);
    t.history.push({ ...actor, action: t.active ? 'activated' : 'deactivated' });
  }
  if (changes.length) t.history.push({ ...actor, action: 'settings', detail: changes.join('; ') });
  await t.save();
  return json({ template: detail(t) });
}

export async function POST(req, { params }) {
  await dbConnect();
  let form;
  try { form = await req.formData(); } catch { return fail('Send the file as multipart/form-data', 400); }
  const found = await load(req, params, form.get('dealer_id'));
  if (found.response) return found.response;
  if (!(await canManageForms(found.user))) return fail('You do not have permission to manage forms', 403);
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return fail('Choose the new PDF', 400);
  const buffer = Buffer.from(await file.arrayBuffer());
  let read;
  try { read = await extractForm(buffer, { fallbackTitle: found.t.name }); } catch (e) { return fail(e.message, e.status || 400); }
  const { t } = found;
  const actor = actorOf(found.user);
  const sourceId = await saveFile(buffer, { filename: file.name, dealerId: found.dealerId, kind: 'template_source' });
  const version = Math.max(0, ...t.versions.map((x) => x.version)) + 1;
  t.versions.push({ version, schema: read.schema, source_file_id: sourceId, source_filename: file.name || null,
    created_by: actor.by, created_by_name: actor.by_name });
  t.current_version = version;
  t.history.push({ ...actor, action: 'new_version', detail: `version ${version} read from ${file.name || 'a PDF'}: `
    + `${read.found.sections} sections, ${read.found.fields} fields` });
  await t.save();
  return json({ template: detail(t), found: read.found });
}
