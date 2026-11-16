// One form of the library. Library managers only, except GET.
//   GET    ?dealer_id                -> { template, fields (each blank: label, what fills it), history }
//   PATCH  { dealer_id, name?, active? }  -> rename / switch on or off
//   POST   multipart: dealer_id, file -> a new version of the same form (its blanks found again; older kept).
//   DELETE ?dealer_id                -> leaves the library (exports already made stay in the export log)
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormTemplate from '@models/FormTemplate';
import { actorOf, canManageForms, fail, formsAccess, json, templateSummary } from '@lib/forms/access';
import { readForm } from '@lib/forms/read';
import { sourceLabel } from '@lib/forms/sources';
import { saveFile } from '@lib/forms/storage';

export const runtime = 'nodejs';

async function load(req, params, dealerId) {
  const access = await formsAccess(req, dealerId);
  if (access.response) return access;
  const { id } = await params;
  const t = mongoose.isValidObjectId(id) ? await FormTemplate.findOne({ _id: id, dealer_id: access.dealerId, deleted_at: null }) : null;
  if (!t) return { response: fail('Form not found', 404) };
  return { ...access, t };
}

const detail = (t) => {
  const v = t.versions.find((x) => x.version === t.current_version) || {};
  return { template: templateSummary(t.toObject()),
    fields: (v.fields || []).map((f, i) => ({ n: i + 1, label: f.label, page: f.page, fills_with: f.source ? sourceLabel(f.source) : null,
      kind: f.found_by === 'ai' ? 'AI' : f.kind === 'pdf_field' ? 'Fillable field' : 'Blank line' })),
    history: t.history.slice(-20).reverse() };
};

export async function GET(req, { params }) {
  await dbConnect();
  const found = await load(req, params, new URL(req.url).searchParams.get('dealer_id'));
  if (found.response) return found.response;
  return json(detail(found.t));
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
  if (body.name !== undefined) {
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) return fail('Give the form a name', 400);
    if (name !== t.name) { t.history.push({ ...actor, action: 'renamed', detail: `"${t.name}" -> "${name}"` }); t.name = name; }
  }
  if (body.active !== undefined && Boolean(body.active) !== (t.active !== false)) {
    t.active = Boolean(body.active);
    t.history.push({ ...actor, action: t.active ? 'switched on' : 'switched off' });
  }
  await t.save();
  return json(detail(t));
}

export async function POST(req, { params }) {
  await dbConnect();
  let form;
  try { form = await req.formData(); } catch { return fail('Send the PDF as multipart/form-data', 400); }
  const found = await load(req, params, form.get('dealer_id'));
  if (found.response) return found.response;
  if (!(await canManageForms(found.user))) return fail('You do not have permission to manage forms', 403);
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return fail('Choose the new PDF', 400);
  let found2;
  try { found2 = await readForm(Buffer.from(await file.arrayBuffer()), file.name); } catch (e) { return fail(e.message, e.status || 400); }
  const { t } = found;
  const actor = actorOf(found.user);
  const fileId = await saveFile(found2.buffer, { filename: found2.filename, dealerId: found.dealerId, kind: 'form' });
  const version = Math.max(0, ...t.versions.map((x) => x.version)) + 1;
  t.versions.push({ version, source_file_id: fileId, source_filename: found2.filename || null, fillable: found2.fillable,
    pages: found2.pages, fields: found2.fields, found_by_ai: found2.found_by_ai, created_by: actor.by, created_by_name: actor.by_name });
  t.current_version = version;
  t.history.push({ ...actor, action: 'new version', detail: `v${version}: ${found2.filename || 'PDF'}, ${found2.fields.length} blanks`
    + `${found2.found_by_ai ? ' (found by the AI)' : ''}` });
  await t.save();
  return json(detail(t));
}

export async function DELETE(req, { params }) {
  await dbConnect();
  const found = await load(req, params, new URL(req.url).searchParams.get('dealer_id'));
  if (found.response) return found.response;
  if (!(await canManageForms(found.user))) return fail('You do not have permission to manage forms', 403);
  const { t } = found;
  const actor = actorOf(found.user);
  t.deleted_at = new Date(); t.deleted_by_name = actor.by_name; t.active = false;
  t.history.push({ ...actor, action: 'deleted' });
  await t.save();
  return json({ deleted: true });
}
