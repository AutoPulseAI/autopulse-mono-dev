// Filling a form for a customer (SOW v6 Deliverable K, gaps G-065 / G-066).
//   GET  ?dealer_id&customer_id   -> { documents } stored for the customer (newest first)
//   POST { dealer_id, template_id, customer_id, lead_id, trade_in_ids: [...], action }
//        action 'review'  -> every mapped field with the value it would get; missing ones flagged (required or not)
//        action 'preview' -> the filled PDF, not stored (blanks stay blank)
//        action 'save'    -> refused while a required field is missing; else the PDF is stored as an immutable
//                            snapshot against the customer and the lead -> { document }
// The customer, lead and trade-ins must be the dealership's and the same customer's (merged customers included); the
// form must be active and allowed for the caller's role. Payoff / lienholder only for "Manage Leads".
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormTemplate from '@models/FormTemplate';
import FormDocument from '@models/FormDocument';
import Lead from '@models/Lead';
import TradeIn from '@models/TradeIn';
import { actorOf, canSeeFinance, canUseTemplate, fail, formsAccess, json } from '@lib/forms/access';
import { collectValues, isSensitive, sourceLabel } from '@lib/forms/sources';
import { fillPdf } from '@lib/forms/render';
import { readFile, removeFile, saveFile } from '@lib/forms/storage';
import { customerFamily } from '@lib/customerFamily';
import { getDealerTimezone } from '@lib/reporting/time';

export const runtime = 'nodejs';
const oid = (v) => (v && mongoose.isValidObjectId(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null);

function docRow(d) {
  return { id: String(d._id), template_id: String(d.template_id), name: d.template_name, version: d.template_version,
    lead_id: d.lead_id ? String(d.lead_id) : null, trade_ins: (d.trade_in_ids || []).length, missing: d.missing || [],
    created_at: d.created_at, created_by: d.created_by_name, retain_until: d.retain_until, removed: Boolean(d.removed_at),
    downloads: (d.audit || []).filter((a) => a.action !== 'generated').length };
}

// Copies past their form's retention are removed (the file; the record of what was made stays).
async function purgeExpired(dealerId) {
  const expired = await FormDocument.find({ dealer_id: dealerId, retain_until: { $lt: new Date() }, removed_at: null })
    .select('file_id').limit(200).lean();
  for (const d of expired) {
    if (d.file_id) await removeFile(d.file_id);
    await FormDocument.updateOne({ _id: d._id }, { $set: { removed_at: new Date(), file_id: null },
      $push: { audit: { at: new Date(), action: 'removed (retention)' } } });
  }
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
    .sort({ created_at: -1 }).limit(200).lean();
  return json({ documents: docs.map(docRow) });
}

export async function POST(req) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const access = await formsAccess(req, body?.dealer_id);
  if (access.response) return access.response;
  const { user, dealerId } = access;
  const action = String(body.action || 'review');
  if (!['review', 'preview', 'save'].includes(action)) return fail('action must be review, preview or save', 400);

  const t = oid(body.template_id) ? await FormTemplate.findOne({ _id: oid(body.template_id), dealer_id: dealerId }).lean() : null;
  if (!t) return fail('Form not found', 404);
  if (!t.active) return fail('This form is switched off in the Forms Library', 409);
  if (!canUseTemplate(user, t)) return fail('Your role cannot use this form', 403);
  const version = t.versions.find((v) => v.version === t.current_version);
  if (!version) return fail('The form has no PDF', 409);
  if (!version.mapping.length) return fail('This form has no fields mapped yet (Forms Library)', 409);

  const customerId = oid(body.customer_id);
  if (!customerId) return fail('customer_id is required', 400);
  const family = (await customerFamily(customerId, dealerId)).map(String);
  if (!family.length) return fail('Customer not found', 404);
  const lead = oid(body.lead_id) ? await Lead.findOne({ _id: oid(body.lead_id), dealer_id: dealerId }).select('customer_id').lean() : null;
  if (body.lead_id && (!lead || !family.includes(String(lead.customer_id)))) return fail('That lead is not this customer\'s', 400);
  const tradeIds = [...new Set((Array.isArray(body.trade_in_ids) ? body.trade_in_ids : []).map(String))].slice(0, 10);
  if (tradeIds.length) {
    const own = await TradeIn.countDocuments({ _id: { $in: tradeIds.map(oid).filter(Boolean) }, dealer_id: dealerId,
      customer_id: { $in: family.map(oid) } });
    if (own !== tradeIds.length) return fail('A trade-in picked is not this customer\'s', 400);
  }

  const finance = await canSeeFinance(user);
  let collected;
  try {
    collected = await collectValues({ dealerId, customerId, leadId: lead?._id || null, tradeInIds: tradeIds, user,
      canSeeFinance: finance, tz: await getDealerTimezone(dealerId) });
  } catch (e) { return fail(e.message, e.status || 500); }
  const { values, allTrades } = collected;
  const rows = version.mapping.map((m) => ({ where: m.field || `Page ${m.page}${m.label ? ` - ${m.label}` : ''}`,
    source: m.source, label: sourceLabel(m.source), value: values[m.source] || '', required: Boolean(m.required),
    missing: !values[m.source], hidden: isSensitive(m.source) && !finance }));
  const missingRequired = rows.filter((r) => r.required && r.missing).map((r) => r.label);
  if (action === 'review') {
    return json({ rows, missing_required: [...new Set(missingRequired)], trade_ins: allTrades.length,
      template: { name: t.name, version: t.current_version } });
  }

  const pdf = await fillPdf(await readFile(version.file_id), version.mapping, values, { allTrades });
  if (action === 'preview') {
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="preview.pdf"` } });
  }
  if (missingRequired.length) {
    return json({ error: `Required fields are empty: ${[...new Set(missingRequired)].join(', ')}. Fill them on the `
      + 'customer / lead / trade-in first.', missing_required: [...new Set(missingRequired)] }, 422);
  }
  const fileId = await saveFile(pdf, { filename: `${t.name}.pdf`, dealerId, kind: 'document' });
  const actor = actorOf(user);
  const snapshot = Object.fromEntries(version.mapping.map((m) => [m.source, isSensitive(m.source) ? (values[m.source]
    ? '(entered)' : '') : values[m.source] || '']));
  const doc = await FormDocument.create({ dealer_id: dealerId, template_id: t._id, template_name: t.name,
    template_version: t.current_version, customer_id: customerId, lead_id: lead?._id || null, trade_in_ids: tradeIds.map(oid),
    values: snapshot, missing: [...new Set(rows.filter((r) => r.missing).map((r) => r.label))], file_id: fileId,
    size: pdf.length, created_by: actor.by, created_by_name: actor.by_name,
    retain_until: t.retention_days ? new Date(Date.now() + t.retention_days * 864e5) : null,
    audit: [{ at: new Date(), by: actor.by, by_name: actor.by_name, action: 'generated' }] });
  return json({ document: docRow(doc.toObject()) }, 201);
}
