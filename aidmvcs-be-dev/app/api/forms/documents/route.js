// A customer's forms (SOW v6 Deliverable K, gaps G-065 / G-066).
//   GET  ?dealer_id&customer_id -> { documents } (newest first)
//   POST { dealer_id, template_id, customer_id, lead_id, trade_in_ids } -> a new draft: the form as it is now (its
//        current version, copied into the document) with the CRM's values already in; staff complete it on screen
// The customer, lead and trade-ins must be the dealership's and the same customer's (merged customers included); the
// form must be switched on and allowed for the caller's role.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormTemplate from '@models/FormTemplate';
import FormDocument from '@models/FormDocument';
import Lead from '@models/Lead';
import TradeIn from '@models/TradeIn';
import { actorOf, canSeeFinance, canUseTemplate, fail, formsAccess, json } from '@lib/forms/access';
import { collectValues } from '@lib/forms/sources';
import { docRow, prefill } from '@lib/forms/documents';
import { customerFamily } from '@lib/customerFamily';
import { getDealerTimezone } from '@lib/reporting/time';

export const runtime = 'nodejs';
const oid = (v) => (v && mongoose.isValidObjectId(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null);

// Copies past their form's retention are cleared (what was entered); the record that a form was made stays.
async function purgeExpired(dealerId) {
  await FormDocument.updateMany({ dealer_id: dealerId, retain_until: { $lt: new Date() }, removed_at: null },
    { $set: { removed_at: new Date(), data: {} }, $push: { audit: { at: new Date(), action: 'removed (retention)' } } });
}

export async function GET(req) {
  await dbConnect();
  const q = new URL(req.url).searchParams;
  const access = await formsAccess(req, q.get('dealer_id'));
  if (access.response) return access.response;
  const customerId = oid(q.get('customer_id'));
  if (!customerId) return fail('customer_id is required', 400);
  await purgeExpired(access.dealerId);
  const family = await customerFamily(customerId, access.dealerId);
  const docs = await FormDocument.find({ dealer_id: access.dealerId, customer_id: { $in: family } })
    .select('-schema -data').sort({ created_at: -1 }).limit(200).lean();
  return json({ documents: docs.map(docRow) });
}

export async function POST(req) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const access = await formsAccess(req, body?.dealer_id);
  if (access.response) return access.response;
  const { user, dealerId } = access;
  const t = oid(body.template_id) ? await FormTemplate.findOne({ _id: oid(body.template_id), dealer_id: dealerId, deleted_at: null }).lean() : null;
  if (!t) return fail('Form not found', 404);
  if (!t.active) return fail('This form is switched off in the Forms Library', 409);
  if (!canUseTemplate(user, t)) return fail('Your role cannot use this form', 403);
  const version = t.versions.find((v) => v.version === t.current_version);
  if (!version?.schema) return fail('This form has no fields yet (Forms Library)', 409);

  const customerId = oid(body.customer_id);
  if (!customerId) return fail('customer_id is required', 400);
  const family = (await customerFamily(customerId, dealerId)).map(String);
  const lead = oid(body.lead_id) ? await Lead.findOne({ _id: oid(body.lead_id), dealer_id: dealerId }).select('customer_id').lean() : null;
  if (body.lead_id && (!lead || !family.includes(String(lead.customer_id)))) return fail('That lead is not this customer\'s', 400);
  const tradeIds = [...new Set((Array.isArray(body.trade_in_ids) ? body.trade_in_ids : []).map(String))].slice(0, 10);
  if (tradeIds.length) {
    const own = await TradeIn.countDocuments({ _id: { $in: tradeIds.map(oid).filter(Boolean) }, dealer_id: dealerId,
      customer_id: { $in: family.map(oid) } });
    if (own !== tradeIds.length) return fail('A trade-in picked is not this customer\'s', 400);
  }
  let collected;
  try {
    collected = await collectValues({ dealerId, customerId, leadId: lead?._id || null, tradeInIds: tradeIds, user,
      canSeeFinance: await canSeeFinance(user), tz: await getDealerTimezone(dealerId) });
  } catch (e) { return fail(e.message, e.status || 500); }
  const { data, prefilled } = prefill(version.schema, collected);
  const actor = actorOf(user);
  const doc = await FormDocument.create({ dealer_id: dealerId, template_id: t._id, template_name: t.name,
    template_version: version.version, schema: version.schema, data, prefilled, customer_id: customerId,
    lead_id: lead?._id || null, trade_in_ids: tradeIds.map(oid), created_by: actor.by, created_by_name: actor.by_name,
    retain_until: t.retention_days ? new Date(Date.now() + t.retention_days * 864e5) : null,
    audit: [{ at: new Date(), by: actor.by, by_name: actor.by_name, action: 'started' }] });
  return json({ document: docRow(doc.toObject()) }, 201);
}
