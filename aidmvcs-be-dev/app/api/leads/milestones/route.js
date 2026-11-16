// GET /api/leads/milestones?lead_ids=a,b,c  each lead's funnel times (SOW B b4, G-009; app/lib/leadMilestones.js).
// Staff of the leads' dealership only; at most 50 leads per call.
// Also each lead as its own opportunity (G-005): its owner, and where the AI talks to the customer about it - the AI
// keeps one conversation per customer, on their first open lead (agentic-upsell agent/duplicates.py), so a newer
// lead names the lead whose conversation carries it. Leads stay separate: own status, owner, source, VIN, bookings.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import { requireDealerAccess } from '@lib/apiGuard';
import { leadMilestones } from '@lib/leadMilestones';
import User from '@models/User';
import DeskLogEntry from '@models/DeskLogEntry';

export const runtime = 'nodejs';
const MAX = 50;

export async function GET(req) {
  await dbConnect();
  const ids = String(new URL(req.url).searchParams.get('lead_ids') || '').split(',').map((s) => s.trim())
    .filter((s) => mongoose.isValidObjectId(s));
  if (!ids.length) return Response.json({ error: 'lead_ids is required' }, { status: 400 });
  if (ids.length > MAX) return Response.json({ error: `at most ${MAX} leads per request` }, { status: 400 });
  const dealers = [...new Set((await Lead.find({ _id: { $in: ids } }).select('dealer_id').lean())
    .map((l) => String(l.dealer_id)))];
  if (dealers.length !== 1) return Response.json({ error: 'Leads not found' }, { status: 404 });
  const access = await requireDealerAccess(req, dealers[0]);
  if (access.response) return Response.json({ error: 'Leads not found' }, { status: 404 });
  const leads = await Lead.find({ _id: { $in: ids } }).select('assigned_to createdAt').lean();
  const ownerIds = [...new Set(leads.map((l) => l.assigned_to && String(l.assigned_to)).filter((x) => x && mongoose.isValidObjectId(x)))];
  const owners = new Map((await User.find({ _id: { $in: ownerIds } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  const states = await mongoose.connection.db.collection('ai_lead_state').find({ lead_id: { $in: ids } },
    { projection: { lead_id: 1, duplicate_of: 1, status: 1 } }).toArray();
  const stateOf = new Map(states.map((s) => [String(s.lead_id), s]));
  const primaries = [...new Set(states.map((s) => s.duplicate_of && String(s.duplicate_of)).filter((x) => x && mongoose.isValidObjectId(x)))];
  const primaryDocs = new Map((await Lead.find({ _id: { $in: primaries } }).select('createdAt vehicle_year vehicle_make vehicle_model').lean())
    .map((l) => [String(l._id), l]));
  // The lead's showroom visits on the Desk Log (the Desk Log is part of the customer's record, not a separate list).
  const visitDocs = await DeskLogEntry.find({ lead_id: { $in: ids.map((x) => new mongoose.Types.ObjectId(x)) } })
    .select('lead_id checked_in_at stage outcome unsold_reason salesperson_id department notes').sort({ checked_in_at: -1 }).lean();
  const sp = [...new Set(visitDocs.map((v) => v.salesperson_id && String(v.salesperson_id)).filter(Boolean))];
  const spNames = new Map((await User.find({ _id: { $in: sp } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  const visitsOf = (id) => visitDocs.filter((v) => String(v.lead_id) === id).slice(0, 10).map((v) => ({
    id: String(v._id), at: v.checked_in_at, stage: v.stage || null, department: v.department || 'sales',
    outcome: v.outcome ? `${v.outcome}${v.unsold_reason ? ` - ${v.unsold_reason}` : ''}` : null,
    salesperson: v.salesperson_id ? spNames.get(String(v.salesperson_id)) || null : null,
    note: (v.notes || []).at(-1)?.text || null }));
  const details = Object.fromEntries(leads.map((l) => {
    const st = stateOf.get(String(l._id));
    const on = st?.duplicate_of ? String(st.duplicate_of) : null;
    const p = on ? primaryDocs.get(on) : null;
    return [String(l._id), {
      owner: l.assigned_to ? owners.get(String(l.assigned_to)) || 'a removed user' : 'Unassigned',
      ai: !st ? 'none' : on ? 'linked' : 'own',
      ai_lead_id: on,
      visits: visitsOf(String(l._id)),
      ai_lead_label: p ? [[p.vehicle_year, p.vehicle_make, p.vehicle_model].filter(Boolean).join(' ') || 'the earlier lead',
        p.createdAt ? new Date(p.createdAt).toISOString() : null] : null,
    }];
  }));
  return Response.json({ milestones: await leadMilestones(ids), details });
}
