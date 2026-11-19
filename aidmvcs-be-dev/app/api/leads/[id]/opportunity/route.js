// One opportunity's staff actions from the customer profile (SOW B3, the reference CRM's opportunity screen; 13 Nov 2026
// meeting 10.8 / 10.9 / 10.11):
//   GET                                   -> { reminders (open first), in_market, vehicles_of_interest, staff }
//   POST { action: 'reminder', due_at, note, assigned_to? }     a reminder for staff (Open tasks on the profile)
//   POST { action: 'reminder_done', reminder_id }               marks it done
//   POST { action: 'in_market', value: true | false }           Active / Not in Market (a flag; the AI is unchanged)
//   POST { action: 'vehicle_add', vehicle: { year, make, model, trim?, vin?, stock? } }
//   POST { action: 'vehicle_remove', vehicle_id }
// Every change goes on the customer timeline (ActivityLog). None of these messages the customer.
// Errors: 401 · 404 lead not found / not this dealership · 400 bad input.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import User from '@models/User';
import LeadReminder from '@models/LeadReminder';
import { requireDealerAccess } from '@lib/apiGuard';
import { logActivity } from '@lib/activityLog';

export const runtime = 'nodejs';
const fail = (error, status) => Response.json({ error }, { status });
const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

async function load(req, params) {
  await dbConnect();
  const { id } = await params;
  const lead = mongoose.isValidObjectId(id) ? await Lead.findById(id).lean() : null;
  if (!lead) return { response: fail('Lead not found', 404) };
  const access = await requireDealerAccess(req, lead.dealer_id);
  if (access.response) return { response: fail('Lead not found', 404) };
  return { lead, user: access.user };
}

async function view(lead) {
  const dealerId = String(lead.dealer_id);
  const [reminders, staff] = await Promise.all([
    LeadReminder.find({ lead_id: lead._id }).sort({ done_at: 1, due_at: 1 }).limit(50).lean(),
    mongoose.isValidObjectId(dealerId) ? User.find({ $or: [{ _id: dealerId }, { parent_id: dealerId }] }).select('name').lean() : [],
  ]);
  const fresh = await Lead.findById(lead._id).select('in_market vehicles_of_interest').lean();
  return {
    reminders: reminders.map((r) => ({ id: String(r._id), due_at: r.due_at, note: r.note, assigned_name: r.assigned_name,
      created_by_name: r.created_by_name, done_at: r.done_at, done_by_name: r.done_by_name })),
    in_market: fresh?.in_market !== false,
    vehicles_of_interest: (fresh?.vehicles_of_interest || []).map((v) => ({ id: String(v._id), year: v.year, make: v.make,
      model: v.model, trim: v.trim, vin: v.vin, stock: v.stock, added_by_name: v.added_by_name, at: v.at })),
    staff: staff.map((u) => ({ id: String(u._id), name: u.name || 'Unnamed' })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function GET(req, { params }) {
  const ctx = await load(req, params);
  if (ctx.response) return ctx.response;
  return Response.json(await view(ctx.lead));
}

export async function POST(req, { params }) {
  const ctx = await load(req, params);
  if (ctx.response) return ctx.response;
  const { lead, user } = ctx;
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const who = user?.name || user?.email || 'Staff';
  const base = { dealer_id: String(lead.dealer_id), customer_id: lead.customer_id || null, lead_id: lead._id,
    actor_type: 'staff', actor_id: user?._id || null, actor_name: who };

  switch (body?.action) {
    case 'reminder': {
      const due = new Date(body.due_at);
      const note = clean(body.note, 300);
      if (Number.isNaN(due.getTime())) return fail('Pick when the reminder is due', 400);
      if (!note) return fail('Say what the reminder is for', 400);
      let assigned = null;
      if (body.assigned_to) {
        if (!mongoose.isValidObjectId(body.assigned_to)) return fail('Pick someone from the list', 400);
        assigned = await User.findOne({ _id: body.assigned_to, $or: [{ _id: String(lead.dealer_id) }, { parent_id: String(lead.dealer_id) }] })
          .select('name').lean();
        if (!assigned) return fail('That person is not on this dealership\'s staff', 400);
      }
      await LeadReminder.create({ dealer_id: String(lead.dealer_id), lead_id: lead._id, customer_id: lead.customer_id || null,
        due_at: due, note, assigned_to: assigned?._id || null, assigned_name: assigned?.name || null,
        created_by: user?._id || null, created_by_name: who });
      await logActivity({ ...base, action: 'reminder_set', to: due.toISOString(), detail: `${note}${assigned ? ` - for ${assigned.name}` : ''}` });
      break;
    }
    case 'reminder_done': {
      if (!mongoose.isValidObjectId(body.reminder_id)) return fail('reminder_id is required', 400);
      const r = await LeadReminder.findOneAndUpdate({ _id: body.reminder_id, lead_id: lead._id, done_at: null },
        { $set: { done_at: new Date(), done_by_name: who } }, { new: true }).lean();
      if (!r) return fail('That reminder is already done or not on this lead', 400);
      await logActivity({ ...base, action: 'reminder_done', detail: r.note });
      break;
    }
    case 'in_market': {
      const value = Boolean(body.value);
      if ((lead.in_market !== false) === value) break;
      await Lead.updateOne({ _id: lead._id }, { $set: { in_market: value, in_market_at: new Date() } });
      await logActivity({ ...base, action: 'in_market_changed', from: value ? 'Not in market' : 'Active', to: value ? 'Active' : 'Not in market' });
      break;
    }
    case 'vehicle_add': {
      const v = body.vehicle || {};
      const car = { year: clean(v.year, 4), make: clean(v.make, 60), model: clean(v.model, 60), trim: clean(v.trim, 60),
        vin: clean(v.vin, 17).toUpperCase(), stock: clean(v.stock, 30), added_by_name: who, at: new Date() };
      if (!car.make && !car.model && !car.vin) return fail('Give at least the make and model, or a VIN', 400);
      if (car.vin && (lead.vehicles_of_interest || []).some((x) => x.vin && x.vin === car.vin)) return fail('That vehicle is already on the list', 400);
      if ((lead.vehicles_of_interest || []).length >= 50) return fail('This opportunity already has 50 vehicles of interest', 400);
      await Lead.updateOne({ _id: lead._id }, { $push: { vehicles_of_interest: car } });
      await logActivity({ ...base, action: 'vehicle_of_interest_added', to: [car.year, car.make, car.model, car.trim].filter(Boolean).join(' ') || car.vin });
      break;
    }
    case 'vehicle_remove': {
      const hit = (lead.vehicles_of_interest || []).find((x) => String(x._id) === String(body.vehicle_id));
      if (!hit) return fail('That vehicle is not on this opportunity', 400);
      await Lead.updateOne({ _id: lead._id }, { $pull: { vehicles_of_interest: { _id: hit._id } } });
      await logActivity({ ...base, action: 'vehicle_of_interest_removed', to: [hit.year, hit.make, hit.model, hit.trim].filter(Boolean).join(' ') || hit.vin });
      break;
    }
    default: return fail('Unknown action', 400);
  }
  return Response.json(await view(lead));
}
