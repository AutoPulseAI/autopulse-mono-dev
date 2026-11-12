// POST /api/customers/[id]/contacts  edit a customer's phones, emails and postal addresses (SOW Deliverable H b?,
// gap G-061: "labeled phones, emails, postal addresses; format validation; prior values kept; a stale import cannot
// undo a confirmed correction").
//   body { dealer_id, kind: 'phone' | 'email' | 'address', action, ... , update_open_leads?: true }
//     add          { value, label? }  (address: { address: {label, line1, line2, city, state, zip} })
//     remove       { value }          (address: { address_id })  - removed phones / emails are remembered, so a later
//                                     lead or import never adds them back (lib/customerResolver.js)
//     set_primary  { value }          (address: { address_id })
//     label        { value, label }
//   update_open_leads (default true, phone / email): the customer's open leads that use the old primary (or the
//   removed value) get the new primary - that is where texts and emails go. Sold / closed / opted-out leads are not
//   touched. Every change is in Customer.contact_history and on the timeline.
// Errors: 401 · 403 not this dealership · 400 bad request · 404 customer not found · 409 already on file / last one /
// changed meanwhile · 422 bad format.
import mongoose from "mongoose";
import dbConnect from "@lib/mongodb";
import Customer from "@models/Customer";
import Lead from "@models/Lead";
import { requireDealerAccess } from "@lib/apiGuard";
import { normalizeEmail, normalizePhone } from "@lib/customerResolver";
import { customerFamily } from "@lib/customerFamily";
import { logActivity } from "@lib/activityLog";

export const runtime = "nodejs";
const fail = (message, status) => Response.json({ message, error: message }, { status });
const LABELS = { phone: ["mobile", "home", "work", "other"], email: ["home", "work", "other"], address: ["home", "work", "billing", "other"] };
const CLOSED = /sold|closed|lost|opted out|dnd/i;
const show = (kind, v) => (kind === "phone" && /^\d{10}$/.test(String(v)) ? `(${v.slice(0, 3)}) ${v.slice(3, 6)}-${v.slice(6)}` : v);
const leadValue = (kind, v) => (kind === "phone" ? `+1${v}` : v); // leads keep phones in E.164

function normalize(kind, raw) {
  if (kind === "email") {
    const v = normalizeEmail(String(raw || ""));
    return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
  }
  const v = normalizePhone(String(raw || ""));
  return v && v.length === 10 ? v : null;
}

export async function POST(req, { params }) {
  await dbConnect();
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return fail("Invalid customer id", 400);
  let body;
  try { body = await req.json(); } catch { return fail("The request body must be JSON", 400); }
  const dealerId = String(body?.dealer_id || "");
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  const user = access.user;
  const { kind, action } = body;
  if (!["phone", "email", "address"].includes(kind)) return fail("kind must be phone, email or address", 400);
  if (!["add", "remove", "set_primary", "label"].includes(action)) return fail("action must be add, remove, set_primary or label", 400);

  const customer = await Customer.findOne({ _id: id, dealer_id: dealerId }).lean();
  if (!customer) return fail("Customer not found", 404);
  const now = new Date();
  const history = (entry) => ({ at: now, by: user._id, by_name: user.name || null, ...entry });

  // ---- postal addresses ----
  if (kind === "address") {
    const list = customer.addresses || [];
    if (action === "add") {
      const a = body.address || {};
      const clean = Object.fromEntries(["line1", "line2", "city", "state", "zip"].map((k) => [k, String(a[k] || "").trim()]));
      if (!clean.line1 || !clean.city) return fail("An address needs at least a street and a city", 422);
      if (clean.zip && !/^\d{5}(-\d{4})?$/.test(clean.zip)) return fail("ZIP must be 5 digits (or 5+4)", 422);
      const label = LABELS.address.includes(a.label) ? a.label : "home";
      const entry = { ...clean, label, is_primary: !list.length, added_at: now };
      await Customer.updateOne({ _id: id }, { $push: { addresses: entry,
        contact_history: history({ field: "address", action: "added", to: [clean.line1, clean.city].join(", ") }) } });
    } else {
      const target = list.find((a) => String(a._id) === String(body.address_id));
      if (!target) return fail("Address not found", 404);
      if (action === "remove") {
        await Customer.updateOne({ _id: id }, { $pull: { addresses: { _id: target._id } },
          $push: { contact_history: history({ field: "address", action: "removed", from: [target.line1, target.city].join(", ") }) } });
      } else if (action === "set_primary") {
        await Customer.updateOne({ _id: id }, { $set: { "addresses.$[].is_primary": false } });
        await Customer.updateOne({ _id: id, "addresses._id": target._id }, { $set: { "addresses.$.is_primary": true },
          $push: { contact_history: history({ field: "address", action: "primary", to: [target.line1, target.city].join(", ") }) } });
      } else {
        const label = LABELS.address.includes(body.label) ? body.label : null;
        if (!label) return fail(`label must be one of ${LABELS.address.join(", ")}`, 400);
        await Customer.updateOne({ _id: id, "addresses._id": target._id }, { $set: { "addresses.$.label": label } });
      }
    }
    return Response.json({ ok: true, customer: await Customer.findById(id).lean() });
  }

  // ---- phones / emails ----
  const field = kind === "phone" ? "phones" : "emails";
  const list = customer[field] || [];
  const value = normalize(kind, body.value);
  if (!value) return fail(kind === "phone" ? "Enter a 10-digit US phone number" : "Enter a valid email address", 422);
  const current = list.find((e) => e.value === value);
  const oldPrimary = (list.find((e) => e.is_primary) || list[0])?.value || null;
  let newPrimary = oldPrimary;
  let replaced = [];

  if (action === "add") {
    if (current) return fail(`${show(kind, value)} is already on file`, 409);
    const label = LABELS[kind].includes(body.label) ? body.label : undefined;
    const entry = { value, is_primary: !list.length || body.make_primary === true, source: "staff", added_at: now,
      ...(label ? { label } : {}) };
    if (entry.is_primary && list.length) await Customer.updateOne({ _id: id }, { $set: { [`${field}.$[].is_primary`]: false } });
    const res = await Customer.updateOne({ _id: id, [`${field}.value`]: { $ne: value } }, {
      $push: { [field]: entry, contact_history: history({ field: kind, action: "added", to: value }) },
      $pull: { removed_contacts: { kind, value } } });
    if (!res.modifiedCount) return fail("Changed by someone else meanwhile - reload and try again", 409);
    if (entry.is_primary) { newPrimary = value; if (oldPrimary) replaced = [oldPrimary]; }
  } else {
    if (!current) return fail(`${show(kind, value)} is not on file`, 404);
    if (action === "remove") {
      const rest = list.filter((e) => e.value !== value);
      const next = current.is_primary ? rest[0]?.value || null : oldPrimary;
      await Customer.updateOne({ _id: id }, {
        $pull: { [field]: { value } },
        $push: { removed_contacts: { kind, value, at: now, by: user._id },
          contact_history: history({ field: kind, action: "removed", from: value }) } });
      if (current.is_primary && next) {
        await Customer.updateOne({ _id: id, [`${field}.value`]: next }, { $set: { [`${field}.$.is_primary`]: true } });
      }
      newPrimary = next;
      replaced = [value];
    } else if (action === "set_primary") {
      if (current.is_primary) return Response.json({ ok: true, customer });
      await Customer.updateOne({ _id: id }, { $set: { [`${field}.$[].is_primary`]: false } });
      await Customer.updateOne({ _id: id, [`${field}.value`]: value }, { $set: { [`${field}.$.is_primary`]: true },
        $push: { contact_history: history({ field: kind, action: "primary", from: oldPrimary, to: value }) } });
      newPrimary = value;
      if (oldPrimary) replaced = [oldPrimary];
    } else {
      const label = LABELS[kind].includes(body.label) ? body.label : null;
      if (!label) return fail(`label must be one of ${LABELS[kind].join(", ")}`, 400);
      await Customer.updateOne({ _id: id, [`${field}.value`]: value }, { $set: { [`${field}.$.label`]: label },
        $push: { contact_history: history({ field: kind, action: "label", from: current.label || null, to: label }) } });
    }
  }

  // Where messages go: open leads on the old / removed value get the new primary.
  let leadsUpdated = 0;
  if (body.update_open_leads !== false && replaced.length && newPrimary && !replaced.includes(newPrimary)) {
    const leadField = kind === "phone" ? "phone" : "email";
    const family = await customerFamily(id, dealerId);
    const match = kind === "phone"
      ? { $or: replaced.map((v) => ({ phone: { $regex: `${v}$` } })) }
      : { $or: replaced.map((v) => ({ email: { $regex: `^\\s*${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, $options: "i" } })) };
    const leads = await Lead.find({ dealer_id: dealerId, customer_id: { $in: family }, ...match })
      .select("_id fe_lead_status customer_id " + leadField).lean();
    for (const lead of leads.filter((l) => !CLOSED.test(String(l.fe_lead_status || "")))) {
      const res = await Lead.updateOne({ _id: lead._id, [leadField]: lead[leadField] },
        { $set: { [leadField]: leadValue(kind, newPrimary), updatedAt: now } });
      if (!res.modifiedCount) continue;
      leadsUpdated += 1;
      await logActivity({ dealer_id: dealerId, lead_id: lead._id, customer_id: lead.customer_id || id, actor_type: "staff",
        actor_id: user._id, actor_name: user.name || null, action: "contact_corrected",
        from: lead[leadField], to: leadValue(kind, newPrimary), detail: kind });
    }
  }
  await logActivity({ dealer_id: dealerId, customer_id: id, actor_type: "staff", actor_id: user._id,
    actor_name: user.name || null, action: `contact_${action}`, from: kind, to: show(kind, value) });
  return Response.json({ ok: true, leads_updated: leadsUpdated, customer: await Customer.findById(id).lean() });
}
