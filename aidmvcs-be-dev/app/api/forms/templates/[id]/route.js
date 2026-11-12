// One form of the library (SOW v6 Deliverable K, gaps G-064 / G-065). Library managers only, except GET.
//   GET   ?dealer_id                -> { template (current version: fields, pages, mapping), versions, history,
//                                       sources, roles, statuses, can_manage }
//   PATCH { dealer_id, name?, category?, active?, departments?, role_ids?, statuses?, retention_days?, mapping? }
//         mapping = the current version's [{ field | page,x,y,size,label, source, required }], checked against the PDF
//   POST  multipart: dealer_id, file  -> replaces the PDF with a new version; the mapping is carried over for every
//         field / page the new PDF still has (the rest is listed in `dropped`). Older versions are kept.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormTemplate, { FORM_CATEGORIES } from '@models/FormTemplate';
import { actorOf, canManageForms, dealerRoles, fail, formsAccess, json, templateSummary } from '@lib/forms/access';
import { SOURCES, isSource } from '@lib/forms/sources';
import { inspectPdf } from '@lib/forms/render';
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
  return { ...templateSummary(t.toObject()), fields: v?.fields || [], pages: v?.pages || [], mapping: v?.mapping || [],
    filename: v?.filename || null,
    version_list: t.versions.map((x) => ({ version: x.version, filename: x.filename, fillable: x.fillable,
      uploaded_at: x.uploaded_at, uploaded_by: x.uploaded_by_name, mapped: x.mapping.length })).reverse(),
    history: t.history.slice(-30).reverse() };
}

export async function GET(req, { params }) {
  await dbConnect();
  const found = await load(req, params, new URL(req.url).searchParams.get('dealer_id'));
  if (found.response) return found.response;
  return json({ template: detail(found.t), sources: SOURCES, roles: await dealerRoles(found.dealerId),
    statuses: LEAD_STATUSES, can_manage: await canManageForms(found.user) });
}

// The mapping as sent, checked against the version's PDF: a fillable PDF maps its own field names; a flat one places
// boxes on its pages. Returns { mapping } or { error }.
function checkMapping(input, version) {
  if (!Array.isArray(input)) return { error: 'mapping must be a list' };
  if (input.length > 300) return { error: 'At most 300 mapped fields' };
  const names = new Set(version.fields.map((f) => f.name));
  const out = [];
  for (const [i, m] of input.entries()) {
    const n = `Row ${i + 1}`;
    if (!isSource(m?.source)) return { error: `${n}: pick what fills it` };
    if (m.field) {
      if (!names.has(String(m.field))) return { error: `${n}: the PDF has no field "${m.field}"` };
      out.push({ field: String(m.field), source: m.source, required: Boolean(m.required) });
      continue;
    }
    const page = Number(m.page); const x = Number(m.x); const y = Number(m.y); const size = Number(m.size || 10);
    const p = version.pages[page - 1];
    if (!p) return { error: `${n}: page ${m.page} is not in the PDF (it has ${version.pages.length})` };
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > p.width || y > p.height) {
      return { error: `${n}: the position must be on the page (x 0-${p.width}, y 0-${p.height})` };
    }
    if (!(size >= 5 && size <= 24)) return { error: `${n}: text size 5-24` };
    out.push({ page, x, y, size, label: String(m.label || '').slice(0, 60) || null, source: m.source,
      required: Boolean(m.required) });
  }
  return { mapping: out };
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
    if (name !== t.name) { changes.push(`name "${t.name}" -> "${name}"`); t.name = name; }
  }
  if (body.category !== undefined) {
    if (!FORM_CATEGORIES.includes(body.category)) return fail('Unknown category', 400);
    if (body.category !== t.category) { changes.push(`category ${body.category}`); t.category = body.category; }
  }
  if (body.departments !== undefined) {
    const d = [...new Set((body.departments || []).filter((x) => ['sales', 'service'].includes(x)))];
    t.departments = d; changes.push(`departments: ${d.join(', ') || 'both'}`);
  }
  if (body.role_ids !== undefined) {
    const own = new Set((await dealerRoles(found.dealerId)).map((r) => r.id));
    const ids = (body.role_ids || []).map(String);
    if (ids.some((r) => !own.has(r))) return fail('A role picked is not one of this dealership\'s', 400);
    t.role_ids = ids; changes.push(`roles: ${ids.length || 'all'}`);
  }
  if (body.statuses !== undefined) {
    const s = (body.statuses || []).filter((x) => LEAD_STATUSES.includes(x));
    t.statuses = s; changes.push(`available at: ${s.join(', ') || 'any status'}`);
  }
  if (body.retention_days !== undefined) {
    const r = body.retention_days === null || body.retention_days === '' ? null : Number(body.retention_days);
    if (r !== null && !(Number.isInteger(r) && r >= 30 && r <= 3650)) return fail('Keep copies 30 to 3650 days, or leave it empty to keep them', 400);
    t.retention_days = r; changes.push(`copies kept: ${r ? `${r} days` : 'always'}`);
  }
  if (body.active !== undefined && Boolean(body.active) !== t.active) {
    t.active = Boolean(body.active);
    t.history.push({ ...actor, action: t.active ? 'activated' : 'deactivated' });
  }
  if (body.mapping !== undefined) {
    const v = current(t);
    const checked = checkMapping(body.mapping, v);
    if (checked.error) return fail(checked.error, 400);
    v.mapping = checked.mapping;
    t.markModified('versions');
    t.history.push({ ...actor, action: 'mapping', detail: `version ${v.version}: ${checked.mapping.length} fields mapped` });
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
  let info;
  try { info = await inspectPdf(buffer); } catch (e) { return fail(e.message, e.status || 400); }
  const { t } = found;
  const prev = current(t);
  const names = new Set(info.fields.map((f) => f.name));
  const kept = []; const dropped = [];
  for (const m of prev?.mapping || []) {
    const ok = m.field ? names.has(m.field) : Boolean(info.pages[m.page - 1]);
    (ok ? kept : dropped).push(m.toObject ? m.toObject() : m);
  }
  const fileId = await saveFile(buffer, { filename: file.name, dealerId: found.dealerId, kind: 'template' });
  const actor = actorOf(found.user);
  const version = Math.max(...t.versions.map((v) => v.version)) + 1;
  t.versions.push({ version, file_id: fileId, filename: file.name || null, size: buffer.length, ...info, mapping: kept,
    uploaded_by: actor.by, uploaded_by_name: actor.by_name });
  t.current_version = version;
  t.history.push({ ...actor, action: 'new_version', detail: `version ${version}: ${file.name || 'PDF'}; ${kept.length} `
    + `mapped fields kept${dropped.length ? `, ${dropped.length} no longer on the PDF` : ''}` });
  await t.save();
  return json({ template: detail(t), dropped: dropped.map((m) => m.field || `page ${m.page} (${m.label || m.source})`) });
}
