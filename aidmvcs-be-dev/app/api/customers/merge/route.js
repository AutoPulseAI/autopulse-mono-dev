// POST /api/customers/merge  merge two customers of one dealership (SOW Deliverable B b3, gap G-008).
//   body { dealer_id, keep_id, merge_id, reason?, confirm: false | true }   merge `merge_id` INTO `keep_id`
//   body { dealer_id, merge_id, undo: true }                                   undo a merge
// What a merge does (app/lib/customerFamily.js): `merge_id` is marked merged into `keep_id`. Nothing is moved or
// deleted - every lead keeps its own status, owner, conversation, appointments and AI workflow; deals, service
// records and trade-ins stay as they are. The kept customer's page then shows all of them, the merged customer
// leaves the Customers list, and new leads with its phone / email go to the kept customer. The kept customer keeps
// its own name, contacts and owner. Undo clears the mark (leads that came in after the merge stay on the kept one).
// confirm false (default) = PREVIEW, nothing written.
// Errors: 401 · 403 not this dealership / no "Manage Leads" · 400 bad request · 404 customer not found ·
// 409 already merged, or changed meanwhile.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Customer from '@models/Customer';
import Lead from '@models/Lead';
import Deal from '@models/Deal';
import RepairOrder from '@models/RepairOrder';
import TradeIn from '@models/TradeIn';
import User from '@models/User';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';
import { customerFamily } from '@lib/customerFamily';
import { logActivity } from '@lib/activityLog';

export const runtime = 'nodejs';
const fail = (error, status) => Response.json({ error }, { status });

async function summary(c, dealerId) {
  const family = await customerFamily(c._id, dealerId);
  const where = { dealer_id: dealerId, customer_id: { $in: family } };
  const [list, leads, openLeads, deals, serviceVisits, tradeIns, owner] = await Promise.all([
    Lead.find(where).select('vehicle_year vehicle_make vehicle_model lead_source source fe_lead_status assigned_to createdAt')
      .populate({ path: 'assigned_to', select: 'name', strictPopulate: false }).sort({ createdAt: -1 }).limit(25).lean(),
    Lead.countDocuments(where),
    Lead.countDocuments({ ...where, fe_lead_status: { $not: /sold|closed|lost|opted out|dnd/i } }),
    Deal.countDocuments(where), RepairOrder.countDocuments(where), TradeIn.countDocuments(where),
    c.assigned_to ? User.findById(c.assigned_to).select('name').lean() : null,
  ]);
  return { _id: String(c._id), name: c.name || null, emails: (c.emails || []).map((e) => e.value),
    phones: (c.phones || []).map((p) => p.value), owner: owner?.name || null, leads, open_leads: openLeads, deals,
    service_visits: serviceVisits, trade_ins: tradeIns,
    opportunities: list.map((l) => ({ id: String(l._id), vehicle: [l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(' ') || null,
      source: l.lead_source || l.source || null, status: l.fe_lead_status || null, owner: l.assigned_to?.name || null })) };
}

export async function POST(req) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const dealerId = String(body?.dealer_id || '');
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  if (!(await hasPermission(access.user, 'Manage Leads'))) return fail('Only managers can merge customers', 403);
  const user = access.user;
  const mergeId = String(body.merge_id || '');
  if (!mongoose.isValidObjectId(mergeId)) return fail('merge_id is not valid', 400);

  if (body.undo === true) {
    const merged = await Customer.findOne({ _id: mergeId, dealer_id: dealerId }).select('merged_into name').lean();
    if (!merged) return fail('Customer not found', 404);
    if (!merged.merged_into) return fail('This customer is not merged', 409);
    const res = await Customer.updateOne({ _id: mergeId, merged_into: merged.merged_into }, { $unset: { merged_into: 1 } });
    if (!res.modifiedCount) return fail('Changed by someone else meanwhile', 409);
    const kept = await Customer.findById(merged.merged_into).select('merge_history').lean();
    const entry = [...(kept?.merge_history || [])].reverse().find((h) => String(h.merged_customer_id) === mergeId && !h.reversed_at);
    if (entry?.replaced) {
      const r = entry.replaced;
      const back = {};
      if (r.fields.includes('name')) Object.assign(back, { name: r.name, first_name: r.first_name, last_name: r.last_name });
      if (r.fields.includes('email')) back.emails = r.emails;
      if (r.fields.includes('address')) back.addresses = r.addresses;
      await Customer.updateOne({ _id: merged.merged_into }, { $set: back });
    }
    await Customer.updateOne({ _id: merged.merged_into },
      { $set: { 'merge_history.$[h].reversed_at': new Date(), 'merge_history.$[h].reversed_by': user._id } },
      { arrayFilters: [{ 'h.merged_customer_id': new mongoose.Types.ObjectId(mergeId), 'h.reversed_at': null }] });
    await logActivity({ dealer_id: dealerId, customer_id: merged.merged_into, actor_type: 'staff', actor_id: user._id,
      actor_name: user.name || null, action: 'customer_merge_undone', to: merged.name || mergeId });
    return Response.json({ ok: true, undone: true });
  }

  const keepId = String(body.keep_id || '');
  if (!mongoose.isValidObjectId(keepId)) return fail('keep_id is not valid', 400);
  if (keepId === mergeId) return fail('Pick two different customers', 400);
  const [keep, merge] = await Promise.all([
    Customer.findOne({ _id: keepId, dealer_id: dealerId }).lean(),
    Customer.findOne({ _id: mergeId, dealer_id: dealerId }).lean(),
  ]);
  if (!keep || !merge) return fail('Customer not found', 404);
  if (keep.merged_into) return fail('The customer to keep is itself merged into another customer', 409);
  if (merge.merged_into) return fail('That customer is already merged', 409);

  const [keepInfo, mergeInfo] = await Promise.all([summary(keep, dealerId), summary(merge, dealerId)]);
  const notes = [];
  if (mergeInfo.owner && mergeInfo.owner !== keepInfo.owner) {
    notes.push(`The kept customer's owner stays ${keepInfo.owner || 'Unassigned'}; each lead keeps its own salesperson.`);
  }
  if (keepInfo.open_leads && mergeInfo.open_leads) {
    notes.push('Both have open leads: each lead keeps its own status, appointments and AI follow-ups.');
  }
  if (body.confirm !== true) return Response.json({ preview: true, keep: keepInfo, merge: mergeInfo, notes });

  const res = await Customer.updateOne({ _id: mergeId, dealer_id: dealerId, merged_into: { $in: [null] } },
    { $set: { merged_into: keep._id } });
  if (!res.modifiedCount) return fail('That customer was merged by someone else meanwhile', 409);
  // Merge review: a field the manager took from the other customer. Only the customer record changes (never a lead, so
  // nothing about who the AI messages); what it replaced is kept on the merge so Undo puts it back.
  const picks = body.picks || {};
  const set = {};
  const taken = [];
  if (picks.name === 'merge' && merge.name) {
    Object.assign(set, { name: merge.name, first_name: merge.first_name ?? null, last_name: merge.last_name ?? null });
    taken.push('name');
  }
  const primaryOf = (list) => (list || []).find((x) => x.is_primary) || (list || [])[0];
  const email = picks.email === 'merge' ? primaryOf(merge.emails) : null;
  if (email) {
    const others = (keep.emails || []).filter((e) => e.value !== email.value).map((e) => ({ ...e, is_primary: false }));
    set.emails = [{ ...email, is_primary: true }, ...others];
    taken.push('email');
  }
  const address = picks.address === 'merge' ? primaryOf(merge.addresses) : null;
  if (address) {
    const { _id, ...copy } = address;
    set.addresses = [{ ...copy, is_primary: true }, ...(keep.addresses || []).map((a) => ({ ...a, is_primary: false }))];
    taken.push('address');
  }
  const replaced = taken.length ? { name: keep.name ?? null, first_name: keep.first_name ?? null, last_name: keep.last_name ?? null,
    emails: keep.emails || [], addresses: keep.addresses || [], fields: taken } : null;
  if (taken.length) await Customer.updateOne({ _id: keep._id }, { $set: set });
  const reason = String(body.reason || '').slice(0, 300) || null;
  await Customer.updateOne({ _id: keep._id }, { $push: { merge_history: {
    merged_customer_id: merge._id, merged_by: user._id, merged_at: new Date(), reason, ...(replaced ? { replaced } : {}) } } });
  await logActivity({ dealer_id: dealerId, customer_id: keep._id, actor_type: 'staff', actor_id: user._id,
    actor_name: user.name || null, action: 'customer_merged', from: merge.name || mergeId,
    detail: [reason, taken.length ? `kept from the other customer: ${taken.join(', ')}` : null].filter(Boolean).join(' · ') || null });
  await logActivity({ dealer_id: dealerId, customer_id: merge._id, actor_type: 'staff', actor_id: user._id,
    actor_name: user.name || null, action: 'customer_merged_away', to: keep.name || keepId });
  return Response.json({ ok: true, keep_id: keepId, merge_id: mergeId });
}
