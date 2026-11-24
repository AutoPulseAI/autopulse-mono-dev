// The Actions page (SOW Deliverables B b3 + D; approved by the user, 24 Nov 2026). Read only: it shows work already kept
// elsewhere and never schedules, sends or changes anything, so the AI's cadence stays the one workflow (D5).
//   stuck leads   an open lead from the last 90 days that nobody is moving, with one reason each
//   team board    each person's open work
//   lead facts    source, department, owner, sales type, new/used and next step of a lead
import mongoose from 'mongoose';
import Lead from '../models/Lead.js';
import Booking from '../models/Booking.js';
import Email from '../models/Email.js';
import User from '../models/User.js';
import ActivityLog from '../models/ActivityLog.js';
import LeadReminder from '../models/LeadReminder.js';
import { duplicateGroups } from './duplicateCustomers.js';
import { openTasks } from './customerTasks.js';
import { leadDepartment } from './departmentNames.js';

const DAY = 86400000;
const WINDOW_DAYS = 90;
const MAX_LEADS = 1500;
const FIRST_RESPONSE_MS = 5 * 60000; // the first-response target
const FIRST_RESPONSE_DAYS = 7;
const CACHE_MS = 60000; // the list is worked out at most once a minute per dealership
const CLOSED_CALL = ['completed', 'dismissed', 'cancelled', 'missed'];
const NEXT_STEP_KINDS = ['cadence_touch', 'next_action', 'visit_followup', 'owner_touch', 'channel_switch'];
const cache = new Map();

/** A lead still being worked. Unsold stays open: it needs a showroom follow-up. */
export const openStatusFilter = { $not: /^(sold|closed|lost|opted out|dnd)/i };

/** One reason per lead, the most urgent first. Pure. */
export function stuckReason(lead, facts, now = new Date()) {
  const id = String(lead._id);
  const age = now - new Date(lead.createdAt);
  if (!facts.responded.has(id) && age > FIRST_RESPONSE_MS && age <= FIRST_RESPONSE_DAYS * DAY) {
    return ['First response late', 'No reply yet. Target: 5 minutes.', 'Open lead'];
  }
  if (!lead.assigned_to) return ['No owner', 'Nobody owns this lead.', 'Assign'];
  if (facts.noShow.has(id) && !facts.booked.has(id)) return ['No-show recovery', 'Missed a visit and has no new appointment.', 'Add task'];
  if (lead.customer_id && facts.duplicates.has(String(lead.customer_id))) {
    return ['Possible duplicate', 'Shares a phone or email with another customer.', 'Review merge'];
  }
  if (!facts.hasNext.has(id)) {
    return /unsold/i.test(lead.fe_lead_status || '')
      ? ['Unsold follow-up', 'Left the showroom unsold with no next step.', 'Add task']
      : ['No next step', 'No task, appointment or AI follow-up is planned.', 'Add task'];
  }
  return null;
}

async function workOutStuck(dealerId, now) {
  const leads = await Lead.find({ dealer_id: dealerId, createdAt: { $gte: new Date(now - WINDOW_DAYS * DAY) },
    fe_lead_status: openStatusFilter })
    .select('name phone vehicle_year vehicle_make vehicle_model fe_lead_status lead_source source department assigned_to customer_id createdAt')
    .populate({ path: 'assigned_to', select: 'name', strictPopulate: false })
    .sort({ createdAt: -1 }).limit(MAX_LEADS + 1).lean();
  const capped = leads.length > MAX_LEADS;
  const list = leads.slice(0, MAX_LEADS);
  const ids = list.map((l) => String(l._id));
  const oids = list.map((l) => l._id);
  const db = mongoose.connection.db;
  const recent = list.filter((l) => now - new Date(l.createdAt) <= FIRST_RESPONSE_DAYS * DAY).map((l) => l._id);
  const [calls, followups, reminders, booked, noShows, sent, dupes] = await Promise.all([
    db.collection('ai_call_tasks').distinct('lead_id', { lead_id: { $in: ids }, status: { $nin: CLOSED_CALL } }).catch(() => []),
    db.collection('scheduled_followups').distinct('lead_id', { lead_id: { $in: ids }, status: 'pending', kind: { $in: NEXT_STEP_KINDS } }).catch(() => []),
    LeadReminder.distinct('lead_id', { lead_id: { $in: oids }, done_at: null }),
    Booking.distinct('lead_id', { lead_id: { $in: ids }, bookingDate: { $gte: now }, booking_status: { $ne: 'cancelled' } }),
    Booking.distinct('lead_id', { lead_id: { $in: ids }, showed: false, bookingDate: { $gte: new Date(now - 14 * DAY) } }),
    recent.length ? Email.distinct('lead_id', { lead_id: { $in: [...recent, ...recent.map(String)] },
      status: { $nin: ['received', 'incoming', 'note'] }, is_note: { $ne: true }, is_lead_email: { $ne: true } }) : [],
    duplicateGroups(dealerId).catch(() => ({ groups: [] })),
  ]);
  const bookedSet = new Set(booked.map(String));
  const facts = {
    responded: new Set(sent.map(String)),
    booked: bookedSet,
    noShow: new Set(noShows.map(String)),
    duplicates: new Set((dupes.groups || []).flatMap((g) => g.customers.map((c) => String(c._id)))),
    hasNext: new Set([...calls, ...followups, ...reminders, ...booked].map(String)),
  };
  const rows = [];
  for (const lead of list) {
    const reason = stuckReason(lead, facts, now);
    if (!reason) continue;
    rows.push({ id: String(lead._id), lead_id: String(lead._id), customer_id: lead.customer_id ? String(lead.customer_id) : null,
      name: lead.name || lead.phone || 'Unknown customer', phone: lead.phone || null,
      vehicle: [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(' ') || null,
      reason: reason[0], detail: reason[1], fix: reason[2], status: lead.fe_lead_status || null,
      source: lead.lead_source || lead.source || null, department: leadDepartment(lead),
      owner_id: lead.assigned_to?._id ? String(lead.assigned_to._id) : null, owner: lead.assigned_to?.name || null, since: lead.createdAt });
  }
  return { rows, capped };
}

const canSee = (scope) => (row) => {
  if (scope.role === 'admin') return true;
  if (row.owner_id === scope.userId) return true;
  if (scope.role === 'staff') return false;
  if (row.owner_id) return scope.team.has(row.owner_id);
  return !scope.departments.length || scope.departments.includes(row.department);
};

export async function stuckLeads(dealerId, scope, now = new Date()) {
  const key = String(dealerId);
  let hit = cache.get(key);
  if (!hit || now - hit.at > CACHE_MS) {
    hit = { at: now, ...(await workOutStuck(key, now)) };
    cache.set(key, hit);
  }
  return { rows: hit.rows.filter(canSee(scope)), capped: hit.capped };
}

/** The staff member's open reminders (or all the team's), newest work first. */
export async function reminderRows(dealerId, scope) {
  const rows = await LeadReminder.find({ dealer_id: String(dealerId) }).sort({ done_at: 1, due_at: 1 }).limit(1000).lean();
  const leads = await Lead.find({ _id: { $in: rows.map((r) => r.lead_id) } })
    .select('name phone vehicle_year vehicle_make vehicle_model fe_lead_status lead_source source department assigned_to customer_id').lean();
  const byId = new Map(leads.map((l) => [String(l._id), l]));
  return rows.map((r) => {
    const lead = byId.get(String(r.lead_id)) || {};
    const ownerId = r.assigned_to ? String(r.assigned_to) : lead.assigned_to ? String(lead.assigned_to) : null;
    return { id: String(r._id), lead_id: String(r.lead_id), customer_id: lead.customer_id ? String(lead.customer_id) : null,
      name: lead.name || lead.phone || 'Unknown customer', phone: lead.phone || null,
      vehicle: [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(' ') || null,
      note: r.note, due_at: r.due_at, done_at: r.done_at, done_by_name: r.done_by_name || null, owner_id: ownerId,
      created_by_name: r.created_by_name || null, escalated_at: r.escalated_at || null, department: leadDepartment(lead) };
  }).filter(canSee(scope));
}

/** Each person's open work. Alerts come from the AI service, so the page adds them. */
export async function teamBoard(dealerId, scope, now = new Date()) {
  const key = String(dealerId);
  const staff = await User.find({ $or: [{ _id: key }, { parent_id: key }] }).select('name departments role')
    .populate({ path: 'role', select: 'name', strictPopulate: false }).lean();
  const shown = staff.filter((s) => scope.role === 'admin' || String(s._id) === scope.userId
    || (scope.role === 'manager' && scope.team.has(String(s._id))));
  const db = mongoose.connection.db;
  const [{ rows: stuck }, calls, missed, reminders, last] = await Promise.all([
    stuckLeads(key, scope, now),
    db.collection('ai_call_tasks').find({ dealer_id: key, status: 'open' }).project({ lead_id: 1, assigned_to: 1, due_by: 1 }).limit(3000).toArray().catch(() => []),
    db.collection('ai_call_tasks').find({ dealer_id: key, status: 'missed', missed_at: { $gte: new Date(now - 30 * DAY) } }).project({ lead_id: 1, assigned_to: 1 }).limit(3000).toArray().catch(() => []),
    LeadReminder.find({ dealer_id: key, done_at: null }).select('assigned_to lead_id due_at').limit(3000).lean(),
    ActivityLog.aggregate([{ $match: { dealer_id: key, actor_type: 'staff', at: { $gte: new Date(now - 30 * DAY) } } },
      { $group: { _id: '$actor_id', at: { $max: '$at' } } }]),
  ]);
  const leadIds = [...new Set([...calls, ...missed].filter((c) => !c.assigned_to).map((c) => String(c.lead_id)))]
    .filter((id) => mongoose.isValidObjectId(id));
  const owners = new Map((leadIds.length ? await Lead.find({ _id: { $in: leadIds } }).select('assigned_to').lean() : [])
    .map((l) => [String(l._id), l.assigned_to ? String(l.assigned_to) : null]));
  const who = (c) => (c.assigned_to ? String(c.assigned_to) : owners.get(String(c.lead_id)) || null);
  const count = (list, fn = who) => list.reduce((m, x) => { const k = fn(x); if (k) m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());
  const open = count(calls);
  const late = count(calls.filter((c) => c.due_by && new Date(c.due_by) < now));
  const miss = count(missed);
  const stuckBy = count(stuck, (r) => r.owner_id);
  const rem = count(reminders, (r) => (r.assigned_to ? String(r.assigned_to) : null));
  const remLate = count(reminders.filter((r) => new Date(r.due_at) < now), (r) => (r.assigned_to ? String(r.assigned_to) : null));
  const lastBy = new Map(last.map((l) => [String(l._id), l.at]));
  return shown.map((s) => {
    const id = String(s._id);
    return { id, name: s.name || 'Unnamed', role: s.role?.name || (id === key ? 'Admin' : 'Staff'),
      department: (s.departments || []).join(', ') || 'All', calls: (open.get(id) || 0) + (rem.get(id) || 0),
      overdue: (late.get(id) || 0) + (remLate.get(id) || 0), missed: miss.get(id) || 0, stuck: stuckBy.get(id) || 0,
      last_action: lastBy.get(id) || null };
  }).sort((a, b) => (b.overdue + b.stuck + b.calls) - (a.overdue + a.stuck + a.calls) || a.name.localeCompare(b.name));
}

/** Same rule as the AI (agentic-upsell slots/requirements.py lead_type_for), with credit shown by name. Pure. */
export function salesType(lead) {
  const explicit = lead?.data?.lead_type || lead?.lead_type;
  if (explicit === 'service' || lead?.department === 'service') return 'Service';
  if (explicit === 'trade_in') return 'Trade / sell my car';
  const source = `${lead?.source || ''} ${lead?.lead_source || ''}`.toLowerCase();
  if (/sell\s*my\s*car|trade|kbb|kelley|accutrade|instant\s*offer|valuation|appraisal/.test(source)) return 'Trade / sell my car';
  if (/credit|financ|capital\s*one|700credit|carzing|dealercentric|eunifi|pre-?qual|approval/.test(source)) return 'Credit';
  return 'General';
}

/** Light facts for table rows: source, department, status and owner. */
export async function leadRowFacts(dealerId, ids) {
  const clean = [...new Set(ids.map(String))].filter((id) => mongoose.isValidObjectId(id)).slice(0, 1000);
  if (!clean.length) return {};
  const leads = await Lead.find({ _id: { $in: clean }, dealer_id: String(dealerId) })
    .select('fe_lead_status lead_source source department assigned_to customer_id')
    .populate({ path: 'assigned_to', select: 'name', strictPopulate: false }).lean();
  return Object.fromEntries(leads.map((l) => [String(l._id), { status: l.fe_lead_status || null,
    source: l.lead_source || l.source || null, department: leadDepartment(l),
    owner_id: l.assigned_to?._id ? String(l.assigned_to._id) : null, owner: l.assigned_to?.name || null,
    customer_id: l.customer_id ? String(l.customer_id) : null }]));
}

/** Read-only type, new/used and next step for the lead card. */
export async function leadCardFacts(dealerId, leadId) {
  if (!mongoose.isValidObjectId(leadId)) return null;
  const lead = await Lead.findOne({ _id: leadId, dealer_id: String(dealerId) }).select('source lead_source department data').lean();
  if (!lead) return null;
  const db = mongoose.connection.db;
  const [fact, tasks] = await Promise.all([
    db.collection('qualification_facts').findOne({ lead_id: String(leadId), path: 'interest.new_or_used', valid_to: null, pending: { $ne: true } }).catch(() => null),
    openTasks({ leadIds: [String(leadId)] }).catch(() => []),
  ]);
  const wanted = { new: 'New', used: 'Used', either: 'New or used' }[fact?.value] || null;
  const next = tasks[0] ? { text: tasks[0].text, at: tasks[0].at, who: tasks[0].who, kind: tasks[0].kind } : null;
  return { sales_type: salesType(lead), vehicle_wanted: wanted, next_step: next };
}
