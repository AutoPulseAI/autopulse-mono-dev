// "Export to form" from a customer's profile (the user, 16 Nov 2026): the dealer's own PDF with this customer's data
// written into its blanks, downloaded. The lead (deal) picked gives the vehicle, its trade-ins and the salesperson.
//   POST { dealer_id, template_id, customer_id, lead_id?, overrides? } -> application/pdf (X-Filled / X-Empty /
//        X-Unprintable headers: how many blanks were filled, which had no data, which had letters the font can't print)
//   POST { ..., check: true } -> { fields: [{ id, n, label, page, value, auto, hand }] }: what each blank will get,
//        shown to staff before downloading (17 Nov 2026); what they type comes back as overrides { [id]: text }.
// The customer and lead must be this dealership's (merged customers included); the form switched on and allowed for
// the caller. Payoff / lienholder only for "Manage Leads". Every export is logged (FormExport).
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import FormTemplate from '@models/FormTemplate';
import FormExport from '@models/FormExport';
import Lead from '@models/Lead';
import TradeIn from '@models/TradeIn';
import { actorOf, canSeeFinance, canUseTemplate, fail, formsAccess } from '@lib/forms/access';
import { collectValues } from '@lib/forms/sources';
import { HAND_ONLY, fillForm } from '@lib/forms/fill';
import { sourceLabel } from '@lib/forms/sources';
import { readFile } from '@lib/forms/storage';
import { customerFamily } from '@lib/customerFamily';
import { getDealerTimezone } from '@lib/reporting/time';

export const runtime = 'nodejs';
const oid = (v) => (v && mongoose.isValidObjectId(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null);

export async function POST(req) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const access = await formsAccess(req, body?.dealer_id);
  if (access.response) return access.response;
  const { user, dealerId } = access;
  const t = oid(body.template_id) ? await FormTemplate.findOne({ _id: oid(body.template_id), dealer_id: dealerId, deleted_at: null }).lean() : null;
  if (!t || t.active === false) return fail('Form not found', 404);
  if (!canUseTemplate(user, t)) return fail('Your role cannot use this form', 403);
  const v = (t.versions || []).find((x) => x.version === t.current_version);
  if (!v?.source_file_id || !Array.isArray(v.fields)) return fail('This form needs to be uploaded again in the Forms Library', 409);

  const customerId = oid(body.customer_id);
  if (!customerId) return fail('customer_id is required', 400);
  const family = await customerFamily(customerId, dealerId);
  const lead = oid(body.lead_id) ? await Lead.findOne({ _id: oid(body.lead_id), dealer_id: dealerId }).select('customer_id').lean() : null;
  if (body.lead_id && (!lead || !family.map(String).includes(String(lead.customer_id)))) return fail('That lead is not this customer\'s', 400);
  // Trade-ins: the lead's own, else the customer's most recent (proposed trade-ins belong to their lead).
  const trades = await TradeIn.find({ dealer_id: dealerId, customer_id: { $in: family },
    ...(lead ? { lead_id: lead._id } : {}) }).sort({ createdAt: -1 }).limit(5).select('_id').lean();
  let values;
  try {
    ({ values } = await collectValues({ dealerId, customerId, leadId: lead?._id || null, tradeInIds: trades.map((x) => x._id),
      user, canSeeFinance: await canSeeFinance(user), tz: await getDealerTimezone(dealerId) }));
  } catch (e) { return fail(e.message, e.status || 500); }

  if (body.check) {
    return Response.json({ fields: v.fields.map((f, i) => {
      const auto = Boolean(f.source) && f.fill_policy !== 'person';
      return { id: f.id, n: i + 1, label: f.label || `Blank ${i + 1}`, page: f.page, field_type: f.field_type || 'text',
        hand: HAND_ONLY.includes(f.field_type), auto, fills_with: auto ? sourceLabel(f.source) : null,
        value: auto ? String(values[f.source] ?? '') : '' };
    }) });
  }
  const overrides = body.overrides && typeof body.overrides === 'object' && !Array.isArray(body.overrides)
    ? Object.fromEntries(Object.entries(body.overrides).filter(([k]) => v.fields.some((f) => f.id === k))
      .map(([k, val]) => [k, String(val ?? '').slice(0, 300)])) : {};
  const { pdf, filled, empty, unprintable } = await fillForm(await readFile(v.source_file_id), v.fields, values, { overrides });
  const actor = actorOf(user);
  await FormExport.create({ dealer_id: dealerId, template_id: t._id, template_name: t.name, template_version: v.version,
    customer_id: customerId, lead_id: lead?._id || null, filled, typed: Object.keys(overrides).length, by: actor.by, by_name: actor.by_name });
  const name = `${t.name} - ${String(values['customer.full_name'] || 'customer').replace(/[^\w .-]+/g, '')}.pdf`;
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`, 'X-Filled': String(filled),
    'X-Empty': encodeURIComponent([...new Set(empty)].join(', ')),
    'X-Unprintable': encodeURIComponent([...new Set(unprintable)].join(', ')) } });
}
