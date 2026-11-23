// PATCH /api/leads/[id]/details - edit a lead's details straight from the lead page, in one click (13 Nov 2026 meeting,
// 94:40-97:00: "edit the customer's name and phone from the lead page without going into the profile"; lead type and
// lead source editable; date and time stamps never editable).
//   body { changes: { <field>: { from, to } } }   field: name, phone, email, contact_type, lead_source, vin,
//                                                vehicle_year, vehicle_make, vehicle_model, department, campaign
// campaign: one of the dealer's campaigns (app/lib/leadCampaign.js) or empty = none; marked set by staff.
// department (Betsy, 14 Nov 2026; BB: convert a sales lead to service by changing its department, not closing it):
// sales / service / parts; empty = sales. A change emails the new department's staff (app/lib/departments.js).
//   `from` is what the screen showed: a field someone else (or the AI) changed meanwhile is refused (409) instead of
//   overwritten. The lead date (createdAt) cannot be changed.
// The customer record follows the lead, so the profile shows the same details:
//   - name: the customer's name too, when it was empty, the same as the lead's old name, or this is their only lead;
//   - phone / email: added to the customer's phones / emails (the old one is kept on file, as on the profile) and made
//     primary when the old one was the primary.
// Every change goes on the customer timeline (ActivityLog 'lead_edited') and in Customer.contact_history.
// Errors: 401 · 404 not found / not this dealership · 400 nothing to change / unknown field · 409 changed meanwhile ·
// 422 bad value.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import Customer from '@models/Customer';
import LeadSourceList from '@models/LeadSourceList';
import { requireDealerAccess } from '@lib/apiGuard';
import { validContactType } from '@lib/leadContactType';
import { normalizeEmail, normalizePhone } from '@lib/customerResolver';
import { logActivity } from '@lib/activityLog';
import { DEPARTMENT_NAMES, leadDepartment, notifyDepartment, validDepartment } from '@lib/departments';

export const runtime = 'nodejs';
const fail = (error, status, extra = {}) => Response.json({ error, message: error, ...extra }, { status });
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const LABELS = Object.freeze({ name: 'name', phone: 'phone', email: 'email', contact_type: 'lead type',
  lead_source: 'lead source', vin: 'VIN', vehicle_year: 'year', vehicle_make: 'make', vehicle_model: 'model', department: 'department', hot: 'Hot flag', campaign: 'campaign' });
const TYPE_NAMES = { internet: 'Internet', phone: 'Phone Up', walk_in: 'Walk-In' };

/** The stored value of one field from what staff typed, or { error }. Empty = cleared (null). */
function parseField(field, raw) {
  const s = clean(raw, field === 'email' ? 200 : 120);
  if (!s) return { value: null };
  switch (field) {
    case 'name': return { value: s };
    // 13 Nov 2026 meeting (10.11 / 10.13, DealerSocket's HOT): staff mark a lead hot; shown on the profile and lead.
    case 'hot': return /^(true|false)$/i.test(s) ? { value: /^true$/i.test(s) } : { error: 'Hot must be true or false' };
    case 'department': return validDepartment(s) ? { value: validDepartment(s) } : { error: 'Department must be Sales, Service or Parts' };
    case 'phone': {
      const d = normalizePhone(s);
      return d && d.length === 10 ? { value: `+1${d}` } : { error: 'The phone number needs 10 digits' };
    }
    case 'email': {
      const e = normalizeEmail(s);
      return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { value: e } : { error: 'The email is not valid' };
    }
    case 'contact_type': {
      const t = validContactType(s);
      return t ? { value: t } : { error: 'Lead type must be Internet, Phone Up or Walk-In' };
    }
    case 'lead_source': return s.length > 60 ? { error: 'A lead source is at most 60 characters' } : { value: s };
    case 'vin': return /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(s) ? { value: s.toUpperCase() } : { error: 'The VIN is not valid' };
    case 'vehicle_year': {
      const y = Number(s);
      return Number.isInteger(y) && y >= 1900 && y <= 2100 ? { value: y } : { error: 'The year is not a year' };
    }
    default: return { value: s.slice(0, 60) };
  }
}

const same = (field, a, b) => {
  const norm = (v) => {
    if (field === 'department') return leadDepartment({ department: v });
    if (field === 'hot') return v === true || String(v).toLowerCase() === 'true' ? 'true' : 'false';
    if (v == null || v === '') return '';
    if (field === 'phone') return normalizePhone(String(v)) || '';
    return String(v).trim().toLowerCase();
  };
  return norm(a) === norm(b);
};
const shown = (field, v) => (field === 'hot' ? (v === true ? 'hot' : 'not hot') : field === 'department' ? DEPARTMENT_NAMES[leadDepartment({ department: v })]
  : v == null || v === '' ? 'empty' : field === 'contact_type' ? TYPE_NAMES[v] || v : String(v));

export async function PATCH(req, { params }) {
  await dbConnect();
  const { id } = await params;
  const lead = mongoose.isValidObjectId(id) ? await Lead.findById(id).lean() : null;
  if (!lead) return fail('Lead not found', 404);
  const access = await requireDealerAccess(req, lead.dealer_id);
  if (access.response) return fail('Lead not found', 404);
  const user = access.user;
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const changes = body?.changes && typeof body.changes === 'object' ? body.changes : null;
  if (!changes || !Object.keys(changes).length) return fail('Nothing to change', 400);

  const set = {};
  const edits = [];
  for (const [field, change] of Object.entries(changes)) {
    if (!LABELS[field]) return fail(`${field} cannot be changed here`, 400);
    const parsed = parseField(field, change?.to);
    if (parsed.error) return fail(parsed.error, 422, { field });
    if (!same(field, lead[field], change?.from)) {
      return fail(`The ${LABELS[field]} was changed by someone else meanwhile (now ${shown(field, lead[field])}). `
        + 'Check it and save again.', 409, { field, current: lead[field] ?? null });
    }
    if (same(field, lead[field], parsed.value)) continue;
    set[field] = parsed.value;
    edits.push({ field, from: lead[field] ?? null, to: parsed.value });
  }
  const after = { ...lead, ...set };
  if (!after.phone && !after.email) return fail('The lead needs a phone number or an email', 422);
  if (!edits.length) return Response.json({ ok: true, lead, changed: [] });

  // Only if those fields still hold what was read (nobody wrote them between the read and this write).
  const guard = Object.fromEntries(edits.map((e) => [e.field, lead[e.field] ?? null]));
  // Staff placing a lead in a department wins over the automatic moves (app/lib/departmentRouting.js).
  if (set.department !== undefined) Object.assign(set, { department_set_by: 'staff', department_at: new Date() });
  if (set.campaign !== undefined) {
    if (set.campaign) {
      const list = await LeadSourceList.findOne({ dealer_id: String(lead.dealer_id) }, { campaigns: 1 }).lean();
      const hit = (list?.campaigns || []).find((c) => String(c.name).toLowerCase() === String(set.campaign).toLowerCase());
      if (!hit) return fail(`"${set.campaign}" is not one of this dealership's campaigns`, 422, { field: 'campaign' });
      set.campaign = hit.name;
    }
    set.campaign_set_by = 'staff';
  }
  const res = await Lead.updateOne({ _id: lead._id, ...guard }, { $set: { ...set, updatedAt: new Date() } });
  if (!res.matchedCount) return fail('This lead was changed by someone else just now - reload it and save again.', 409);

  // The customer record follows (see the header).
  const customer = lead.customer_id ? await Customer.findOne({ _id: lead.customer_id, dealer_id: String(lead.dealer_id) })
    .select('name phones emails').lean() : null;
  if (customer) {
    const now = new Date();
    const history = (entry) => ({ at: now, by: user._id, by_name: user.name || null, ...entry });
    const name = edits.find((e) => e.field === 'name');
    // The customer's name follows when it was empty, the same as the lead's old name, or this is their only lead.
    const onlyLead = name?.to ? (await Lead.countDocuments({ customer_id: customer._id })) <= 1 : false;
    if (name?.to && (!customer.name || same('name', customer.name, name.from) || onlyLead)) {
      await Customer.updateOne({ _id: customer._id }, { $set: { name: name.to },
        $push: { contact_history: history({ field: 'name', action: 'changed', from: customer.name || null, to: name.to }) } });
    }
    for (const kind of ['phone', 'email']) {
      const e = edits.find((x) => x.field === kind);
      if (!e?.to) continue;
      const listField = kind === 'phone' ? 'phones' : 'emails';
      const value = kind === 'phone' ? normalizePhone(e.to) : e.to;
      const old = kind === 'phone' ? normalizePhone(String(e.from || '')) : normalizeEmail(String(e.from || ''));
      const list = customer[listField] || [];
      const primary = (list.find((x) => x.is_primary) || list[0])?.value || null;
      const makePrimary = !list.length || (old && primary === old);
      if (!list.some((x) => x.value === value)) {
        if (makePrimary && list.length) await Customer.updateOne({ _id: customer._id }, { $set: { [`${listField}.$[].is_primary`]: false } });
        await Customer.updateOne({ _id: customer._id, [`${listField}.value`]: { $ne: value } }, {
          $push: { [listField]: { value, is_primary: makePrimary, source: 'staff', added_at: now },
            contact_history: history({ field: kind, action: 'added', from: old || null, to: value }) },
          $pull: { removed_contacts: { kind, value } } });
      } else if (makePrimary && primary !== value) {
        await Customer.updateOne({ _id: customer._id }, { $set: { [`${listField}.$[].is_primary`]: false } });
        await Customer.updateOne({ _id: customer._id, [`${listField}.value`]: value }, { $set: { [`${listField}.$.is_primary`]: true },
          $push: { contact_history: history({ field: kind, action: 'primary', from: primary, to: value }) } });
      }
    }
  }

  for (const e of edits) {
    await logActivity({ dealer_id: lead.dealer_id, lead_id: lead._id, customer_id: lead.customer_id || null,
      actor_type: 'staff', actor_id: user._id, actor_name: user.name || null, action: 'lead_edited',
      from: shown(e.field, e.from), to: shown(e.field, e.to), detail: LABELS[e.field] });
  }
  // A lead moved to another department: that department's staff hear about it (email).
  const dept = edits.find((e) => e.field === 'department');
  const notified = dept ? await notifyDepartment({ dealerId: lead.dealer_id, lead: after, department: dept.to,
    fromDepartment: leadDepartment({ department: dept.from }), byName: user.name }) : null;
  return Response.json({ ok: true, lead: await Lead.findById(lead._id).lean(), changed: edits.map((e) => e.field),
    ...(notified ? { notified } : {}) });
}
