// One filled form (SOW v6 Deliverable K, gap G-066).
//   GET   ?dealer_id -> { document: { ...row, schema, data, prefilled, hidden, trades } } (payoff / lienholder
//                       hidden from staff without "Manage Leads")
//   PATCH { dealer_id, data, complete? } -> saves what was entered; complete: true locks it for good (refused while a
//         required field is empty). A completed form never changes again.
//   DELETE ?dealer_id -> deletes a draft (a completed form is never deleted - it is the record of what was done).
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormDocument from '@models/FormDocument';
import { actorOf, canSeeFinance, fail, formsAccess, json } from '@lib/forms/access';
import { cleanData, docRow, missingRequired, visibleData } from '@lib/forms/documents';

export const runtime = 'nodejs';

async function load(req, params, dealerId) {
  const access = await formsAccess(req, dealerId);
  if (access.response) return access;
  const { id } = await params;
  const d = mongoose.isValidObjectId(id) ? await FormDocument.findOne({ _id: id, dealer_id: access.dealerId }) : null;
  if (!d) return { response: fail('Document not found', 404) };
  return { ...access, d };
}

async function view(d, user) {
  const trades = d.trade_in_ids.length;
  const { data, hidden } = visibleData(d.schema, trades, d.data, await canSeeFinance(user));
  return { ...docRow(d.toObject ? d.toObject() : d), schema: d.schema, data, hidden, prefilled: d.prefilled, trades,
    missing_required: missingRequired(d.schema, trades, d.data) };
}

export async function GET(req, { params }) {
  await dbConnect();
  const found = await load(req, params, new URL(req.url).searchParams.get('dealer_id'));
  if (found.response) return found.response;
  return json({ document: await view(found.d, found.user) });
}

export async function PATCH(req, { params }) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const found = await load(req, params, body?.dealer_id);
  if (found.response) return found.response;
  const { d, user } = found;
  if (d.status === 'completed') return fail('This form is completed and can no longer be changed', 409);
  if (d.removed_at) return fail('This form was removed at the end of its retention period', 410);
  const trades = d.trade_in_ids.length;
  const data = cleanData(d.schema, trades, body.data || {}, { finance: await canSeeFinance(user), previous: d.data });
  const actor = actorOf(user);
  const set = { data };
  const audit = [{ at: new Date(), by: actor.by, by_name: actor.by_name, action: 'edited' }];
  if (body.complete === true) {
    const missing = missingRequired(d.schema, trades, data);
    if (missing.length) return json({ error: `Fill the required fields first: ${missing.join(', ')}`, missing_required: missing }, 422);
    Object.assign(set, { status: 'completed', completed_at: new Date(), completed_by_name: actor.by_name });
    audit.push({ at: new Date(), by: actor.by, by_name: actor.by_name, action: 'completed' });
  }
  const res = await FormDocument.updateOne({ _id: d._id, status: 'draft' }, { $set: set, $push: { audit: { $each: audit } } });
  if (!res.modifiedCount) return fail('Someone completed this form just now - reload it', 409);
  return json({ document: await view(await FormDocument.findById(d._id), user) });
}

export async function DELETE(req, { params }) {
  await dbConnect();
  const found = await load(req, params, new URL(req.url).searchParams.get('dealer_id'));
  if (found.response) return found.response;
  if (found.d.status === 'completed') return fail('A completed form can\'t be deleted', 409);
  const res = await FormDocument.deleteOne({ _id: found.d._id, status: 'draft' });
  if (!res.deletedCount) return fail('Someone completed this form just now', 409);
  return json({ deleted: true });
}
