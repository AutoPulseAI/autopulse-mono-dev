// "Retry" on one form (Forms Library > the form's panel): its blanks are found again by the bigger AI model
// (lib/forms/aiLocate.js MODELS.retry), for a form whose blanks were missed, misplaced or mislabelled. The AI's blanks
// replace the form's other blanks (a fillable PDF's own fields are kept). Undo puts the earlier blanks back.
// Library managers only.
//   POST { dealer_id, undo? } -> { template }
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormTemplate from '@models/FormTemplate';
import { actorOf, canManageForms, fail, formsAccess, json, templateSummary } from '@lib/forms/access';
import { aiLocate } from '@lib/forms/aiLocate';
import { readFile } from '@lib/forms/storage';

export const runtime = 'nodejs';

export async function POST(req, { params }) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const access = await formsAccess(req, body?.dealer_id);
  if (access.response) return access.response;
  if (!(await canManageForms(access.user))) return fail('You do not have permission to manage forms', 403);
  const { id } = await params;
  const t = mongoose.isValidObjectId(id) ? await FormTemplate.findOne({ _id: id, dealer_id: access.dealerId, deleted_at: null }) : null;
  if (!t) return fail('Form not found', 404);
  const v = t.versions.find((x) => x.version === t.current_version);
  if (!v?.source_file_id) return fail('This form needs to be uploaded again', 409);
  const actor = actorOf(access.user);
  const plain = (list) => (list || []).map((f) => (f.toObject ? f.toObject() : f));

  if (body.undo) {
    if (!Array.isArray(v.fields_before_ai)) return fail('Nothing to undo', 400);
    v.fields = plain(v.fields_before_ai); v.fields_before_ai = undefined; v.found_by_ai = false;
    t.history.push({ ...actor, action: 'AI blanks undone', detail: `back to ${v.fields.length} blanks` });
  } else {
    let ai;
    try { ai = await aiLocate(await readFile(v.source_file_id), { filename: v.source_filename, retry: true }); } catch (e) { return fail(e.message, e.status || 500); }
    const kept = plain(v.fields).filter((f) => f.kind === 'pdf_field');
    if (!Array.isArray(v.fields_before_ai)) v.fields_before_ai = plain(v.fields);
    // A blank the AI found on top of one of the PDF's own fields is that field.
    const onField = (a) => kept.some((k) => k.page === a.page && a.y >= k.y - 4 && a.y <= k.y + (k.h || 12) + 4
      && Math.min(a.x + a.w, k.x + k.w) - Math.max(a.x, k.x) > 0.3 * Math.min(a.w, k.w));
    v.fields = [...kept, ...ai.fields.filter((a) => !onField(a))]; v.found_by_ai = true;
    t.history.push({ ...actor, action: 'blanks found by AI', detail: `${ai.fields.length} blanks (retry)` });
  }
  t.markModified('versions');
  await t.save();
  return json({ template: templateSummary(t.toObject()) });
}
