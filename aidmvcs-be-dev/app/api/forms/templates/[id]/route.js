// One form of the library. Library managers only, except GET.
//   GET    ?dealer_id                -> { template, fields (each blank: label, what fills it), history }
//   PATCH  { dealer_id, name?, active?, fields? }  -> rename / switch on or off / correct blanks:
//          fields: [{ id, label?, context?, source?, fill_policy?, x?, y?, w?, delete? }] - saved on the form and reused
//          whenever the same form is uploaded again (lib/forms/reuse.js); each change is kept (FormCorrection).
//          Signatures, initials, checkboxes and co-buyer blanks are never filled automatically (the user, 16 Nov 2026).
//   POST   multipart: dealer_id, file -> a new version of the same form (its blanks found again; older kept).
//   DELETE ?dealer_id                -> leaves the library (exports already made stay in the export log)
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormTemplate from '@models/FormTemplate';
import { actorOf, canManageForms, fail, formsAccess, json, templateSummary } from '@lib/forms/access';
import { readForm } from '@lib/forms/read';
import FormCorrection from '@models/FormCorrection';
import { savedFieldsFor } from '@lib/forms/reuse';
import { SOURCES, isSource, sourceLabel } from '@lib/forms/sources';
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

const CONTEXTS = ['buyer', 'co_buyer', 'dealer', 'trade_in', 'vehicle_being_bought'];
const KIND_NAME = { pdf_field: 'Fillable field', blank: 'Blank line', checkbox: 'Checkbox' };
const detail = (t) => {
  const v = t.versions.find((x) => x.version === t.current_version) || {};
  return { template: templateSummary(t.toObject()),
    fields: (v.fields || []).map((f, i) => ({ n: i + 1, id: f.id, label: f.label, page: f.page,
      x: f.x, y: f.y, w: f.w, h: f.h, source: f.source || null,
      fills_with: f.source && f.fill_policy !== 'person' ? sourceLabel(f.source) : null,
      field_type: f.field_type || 'text', context: f.context || 'buyer', fill_policy: f.fill_policy || (f.source ? 'automatic' : 'person'),
      confidence: f.confidence ?? null, corrected: Boolean(f.corrected), kind: KIND_NAME[f.kind] || 'Blank line' })),
    sources: SOURCES.map((x) => ({ key: x.key, label: `${x.group}: ${x.label}`, sensitive: x.sensitive })),
    contexts: CONTEXTS, reused_from: v.reused_from || null, history: t.history.slice(-20).reverse() };
};

// Apply staff corrections to the current version's blanks. Returns { error } or { changes: [{ id, action, before, after }] }.
function correctFields(v, list) {
  if (!Array.isArray(list)) return { error: 'fields must be a list' };
  const plain = (f) => (f?.toObject ? f.toObject() : { ...f });
  const fields = (v.fields || []).map(plain);
  const changes = [];
  for (const c of list) {
    const i = fields.findIndex((f) => f.id === c?.id);
    if (i < 0) return { error: `Blank ${c?.id} is not on this form` };
    const before = { ...fields[i] };
    if (c.delete) { fields.splice(i, 1); changes.push({ id: c.id, action: 'deleted', before, after: null }); continue; }
    const f = fields[i];
    if (c.label !== undefined) f.label = String(c.label || '').trim().slice(0, 80);
    if (c.context !== undefined) { if (!CONTEXTS.includes(c.context)) return { error: `Unknown part of the form: ${c.context}` }; f.context = c.context; }
    if (c.source !== undefined) { if (c.source && !isSource(c.source)) return { error: `Unknown data: ${c.source}` }; f.source = c.source || null; }
    if (c.fill_policy !== undefined) f.fill_policy = c.fill_policy === 'person' ? 'person' : 'automatic';
    for (const k of ['x', 'y', 'w']) {
      if (c[k] === undefined) continue;
      const n = Number(c[k]);
      if (!Number.isFinite(n) || n < 0 || n > 5000 || (k === 'w' && n < 4)) return { error: `Bad ${k} for blank ${c.id}` };
      f[k] = Math.round(n * 10) / 10;
    }
    // Never filled automatically: signatures, initials, checkboxes, co-buyer blanks; nothing to fill = left for the person.
    if (['signature', 'initials', 'checkbox'].includes(f.field_type) || f.context === 'co_buyer') f.source = null;
    if (!f.source) f.fill_policy = 'person';
    f.bbox = [f.x, f.y, f.x + (f.w || 0), f.y + (f.h || f.size || 0)].map((n) => Math.round(n * 10) / 10);
    f.corrected = true; f.confidence = 1;
    changes.push({ id: c.id, action: 'changed', before, after: { ...f } });
  }
  v.fields = fields;
  return { changes };
}

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
  if (body.fields !== undefined) {
    const v = t.versions.find((x) => x.version === t.current_version);
    if (!v) return fail('This form needs to be uploaded again', 409);
    const done = correctFields(v, body.fields);
    if (done.error) return fail(done.error, 422);
    if (done.changes.length) {
      v.corrected_at = new Date();
      t.markModified('versions');
      t.history.push({ ...actor, action: 'blanks corrected', detail: `${done.changes.length} blank(s): `
        + done.changes.map((c) => `${c.action === 'deleted' ? 'removed' : 'changed'} "${c.before?.label || c.id}"`).join(', ').slice(0, 300) });
      await FormCorrection.insertMany(done.changes.map((c) => ({ dealer_id: found.dealerId, template_id: t._id,
        version: v.version, field_id: c.id, action: c.action, before: c.before, after: c.after, by: actor.by, by_name: actor.by_name })));
    }
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
  const saved = await savedFieldsFor(found2.fingerprint, found.dealerId);
  const fields = saved ? saved.fields : found2.fields;
  const fileId = await saveFile(found2.buffer, { filename: found2.filename, dealerId: found.dealerId, kind: 'form' });
  const version = Math.max(0, ...t.versions.map((x) => x.version)) + 1;
  t.versions.push({ version, source_file_id: fileId, source_filename: found2.filename || null, fillable: found2.fillable,
    pages: found2.pages, fields, fingerprint: found2.fingerprint, ...(saved ? { reused_from: saved.reused_from } : {}),
    created_by: actor.by, created_by_name: actor.by_name });
  t.current_version = version;
  t.history.push({ ...actor, action: 'new version', detail: `v${version}: ${found2.filename || 'PDF'}, ${fields.length} blanks`
    + `${saved ? ' (same form as before: saved blanks reused)' : ''}` });
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
