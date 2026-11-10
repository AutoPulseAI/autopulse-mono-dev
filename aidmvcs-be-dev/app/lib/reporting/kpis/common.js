// Shared pieces of the Reports-page KPIs (SOW 8 Deliverable F; P1 plan items 1, 4, 5).
//
// Every KPI here returns ROWS: one row per record at the KPI's grain, with a unique `id`. The number is rows.length
// (a median / rate is computed from the same rows), the drill-down is the rows, and the CSV is the rows - so a card,
// its list and its CSV can't disagree. Joins only filter, never multiply rows (design note A-F 2.3).
//
// Fixed here against the old dashboard code (which is left as it is):
//   - statuses are matched through app/lib/reporting/normalize.js (case and legacy spellings: 'visited' vs 'Visited'),
//   - messages are dated by emails.timestamp (never createdAt, which Email does not have, or `date`),
//   - appointment KPIs count bookings and list bookings; lead KPIs count leads and list leads (no grain mixing).
//
// Imports are relative so BullMQ workers can load this module too.
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import Lead from '../../../models/Lead.js';
import User from '../../../models/User.js';
import Booking from '../../../models/Booking.js';
import { leadMatch, hasLeadFilter } from '../filters.js';
import { attributeAppointments } from '../appointmentAttribution.js';
import { appointmentPassed, bookingShowed } from '../../appointmentFunnel.js';
import { replyCohorts } from '../replyCohorts.js';
import { getDealerTimezone, localDayRange, toLocalDate, localDate } from '../time.js';
import { normalizeProvider, normalizeStatus } from '../normalize.js';

export const STATE = Object.freeze({ LIVE: 'live', BLOCKED: 'blocked', NEEDS_DATA: 'needs_data' });
export const KIND = Object.freeze({ COUNT: 'count', RATE: 'rate', MEDIAN: 'median' });

// Filters a KPI can apply, by what its rows are linked to.
export const LEAD_FILTERS = Object.freeze(['source', 'lead_source', 'assigned_to']);
export const BOOKING_FILTERS = Object.freeze([...LEAD_FILTERS, 'actor', 'appointment_type']);
export const MESSAGE_FILTERS = Object.freeze([...LEAD_FILTERS, 'channel']);
export const REPLY_FILTERS = Object.freeze([...LEAD_FILTERS, 'channel']);

export const isOid = (id) => id != null && /^[0-9a-f]{24}$/i.test(String(id));
export const oid = (id) => new mongoose.Types.ObjectId(String(id));

// dealer_id is a String in the CRM's schemas, but raw inserts can hold an ObjectId: match both.
export function dealerForms(dealerId) {
  const s = String(dealerId);
  return isOid(s) ? [s, oid(s)] : [s];
}

export function collection(name) {
  return mongoose.connection.collection(name);
}

export async function windowFor(args) {
  const tz = args.tz || await getDealerTimezone(args.dealerId);
  const from = toLocalDate(args.from, tz);
  const to = toLocalDate(args.to ?? args.from, tz);
  return { tz, from, to, ...localDayRange(from, to, tz) };
}

export function localDateTime(at, tz) {
  if (!at) return '';
  const m = moment(at);
  return m.isValid() ? m.tz(tz).format('YYYY-MM-DD HH:mm') : '';
}

export function localDay(at, tz) {
  return at ? localDate(at, tz) : null;
}

// One value per ctx (a dashboard run): a report or a lookup runs once for all the KPIs that need it.
export function memo(ctx, key, fn) {
  if (!ctx.memo) ctx.memo = new Map();
  if (!ctx.memo.has(key)) ctx.memo.set(key, Promise.resolve().then(fn));
  return ctx.memo.get(key);
}

const spec = (args) => args.spec || {};

// The filters attributeAppointments / replyCohorts take, from the parsed spec.
export function moduleFilters(args, keys) {
  const s = spec(args);
  const out = {};
  for (const k of keys) if (s[k] != null && !(Array.isArray(s[k]) && !s[k].length)) out[k] = s[k];
  return out;
}

export function attribution(args, ctx, basis = 'created') {
  const filters = moduleFilters(args, BOOKING_FILTERS);
  return memo(ctx, `attr:${basis}:${JSON.stringify(filters)}`, () => attributeAppointments({
    dealerId: args.dealerId, from: args.from, to: args.to ?? args.from, tz: args.tz, basis, filters,
    now: args.now }));
}

export function replies(args, ctx) {
  const filters = moduleFilters(args, REPLY_FILTERS);
  return memo(ctx, `replies:${JSON.stringify(filters)}`, () => replyCohorts({
    dealerId: args.dealerId, from: args.from, to: args.to ?? args.from, tz: args.tz, filters, now: args.now }));
}

// Lead fields the rows show.
const LEAD_FIELDS = { name: 1, email: 1, phone: 1, source: 1, lead_source: 1, fe_lead_status: 1, assigned_to: 1,
  customer_id: 1, createdAt: 1, dealer_id: 1, contact_type: 1 };

export async function leadsByIds(ids, ctx) {
  const want = [...new Set(ids.filter(isOid).map(String))];
  if (!ctx.leads) ctx.leads = new Map();
  const missing = want.filter((id) => !ctx.leads.has(id));
  if (missing.length) {
    const rows = await Lead.collection.find({ _id: { $in: missing.map(oid) } }, { projection: LEAD_FIELDS }).toArray();
    for (const id of missing) ctx.leads.set(id, null);
    for (const l of rows) ctx.leads.set(String(l._id), l);
  }
  return new Map(want.map((id) => [id, ctx.leads.get(id)]));
}

// Lead ids (of `candidates`) that pass the spec's lead filters and belong to the dealer; null = no lead filter.
export async function passingLeads(args, candidates) {
  const s = spec(args);
  if (!hasLeadFilter(s)) return null;
  const ids = [...new Set(candidates.filter(isOid).map(String))];
  if (!ids.length) return new Set();
  const rows = await Lead.collection.find({ _id: { $in: ids.map(oid) }, dealer_id: { $in: dealerForms(args.dealerId) },
    ...leadMatch(s) }, { projection: { _id: 1 } }).toArray();
  return new Set(rows.map((r) => String(r._id)));
}

// Leads of the dealer with createdAt in the window, passing the lead filters.
export async function leadsReceived(args, ctx) {
  return memo(ctx, 'leads_received', async () => {
    const w = await windowFor(args);
    const rows = await Lead.collection.find({ dealer_id: { $in: dealerForms(args.dealerId) },
      createdAt: { $gte: w.start, $lte: w.end }, ...leadMatch(spec(args)) }, { projection: LEAD_FIELDS })
      .sort({ createdAt: 1, _id: 1 }).toArray();
    if (!ctx.leads) ctx.leads = new Map();
    for (const l of rows) ctx.leads.set(String(l._id), l);
    return rows;
  });
}

export async function staffNames(ids, ctx) {
  const want = [...new Set(ids.filter(isOid).map(String))];
  if (!ctx.staff) ctx.staff = new Map();
  const missing = want.filter((id) => !ctx.staff.has(id));
  if (missing.length) {
    const users = await User.collection.find({ _id: { $in: missing.map(oid) } },
      { projection: { name: 1, first_name: 1, last_name: 1, email: 1 } }).toArray();
    for (const id of missing) ctx.staff.set(id, null);
    for (const u of users) {
      const full = [u.first_name, u.last_name].filter(Boolean).join(' ');
      ctx.staff.set(String(u._id), u.name || full || u.email || String(u._id));
    }
  }
  return ctx.staff;
}

export function staffLabel(names, id) {
  if (!id) return 'Unassigned';
  return names.get(String(id)) || `Staff ${String(id).slice(-6)}`;
}

// The standard lead columns.
export const LEAD_COLUMNS = Object.freeze([
  ['lead_id', 'Lead ID'], ['customer', 'Customer'], ['phone', 'Phone'], ['email', 'Email'],
  ['lead_date', 'Lead date'], ['lead_source', 'Lead source'], ['status', 'Status'], ['assigned_to', 'Assigned to'],
]);

export async function leadRows(leads, args, ctx, extra = () => ({})) {
  const w = await windowFor(args);
  const names = await staffNames(leads.filter(Boolean).map((l) => l.assigned_to), ctx);
  return leads.map((l) => {
    const provider = normalizeProvider(l.lead_source, l.source);
    const staff = l.assigned_to ? staffLabel(names, l.assigned_to) : 'Unassigned';
    return {
      id: String(l._id),
      lead_id: String(l._id),
      customer: l.name || '',
      phone: l.phone || '',
      email: l.email || '',
      lead_date: localDateTime(l.createdAt, w.tz),
      lead_source: provider,
      status: l.fe_lead_status || '',
      assigned_to: staff,
      _day: localDay(l.createdAt, w.tz),
      _g: { lead_source: provider, staff, status: normalizeStatus(l.fe_lead_status).label },
      ...extra(l),
    };
  });
}

// Lead rows for lead ids that are not loaded yet (e.g. from activity logs). Missing leads are left out.
export async function leadRowsForIds(ids, args, ctx, extra = () => ({})) {
  const map = await leadsByIds(ids, ctx);
  const leads = [...new Set(ids.map(String))].map((id) => map.get(id)).filter(Boolean);
  return leadRows(leads, args, ctx, extra);
}

export const BOOKING_COLUMNS = Object.freeze([
  ['booking_id', 'Appointment ID'], ['lead_id', 'Lead ID'], ['customer', 'Customer'],
  ['appointment_date', 'Appointment date'], ['appointment_time', 'Time'], ['created_at', 'Set on'],
  ['booking_status', 'Status'], ['showed', 'Showed'], ['made_by', 'Made by'], ['appointment_type', 'Sales / service'],
  ['lead_source', 'Lead source'], ['assigned_to', 'Assigned to'],
]);

export const CATEGORY_LABELS = Object.freeze({ ai: 'AI', ai_assisted: 'AI-assisted', human_only: 'Human only',
  unknown: 'Unknown' });

// attributeAppointments rows -> booking rows (one per booking id). _shown / _noshow / _past: the one Shown rule (the
// Dashboard's "Appointments Showed" card, app/lib/appointmentFunnel.js bookingShowed), staff marked it a no-show
// (Booking.showed === false), and whether the appointment's date and time have passed (dealer time zone) - Shown,
// No-show, No outcome recorded and Show rate are built from these three.
export async function bookingRows(attrRows, args, ctx) {
  const w = await windowFor(args);
  const now = args.now ? new Date(args.now) : new Date();
  const leads = await leadsByIds(attrRows.map((r) => r.lead_id), ctx);
  const names = await staffNames([...leads.values()].filter(Boolean).map((l) => l.assigned_to), ctx);
  const ids = attrRows.map((r) => r.booking_id).filter(isOid);
  const customers = new Map();
  if (ids.length) {
    const docs = await Booking.collection.find({ _id: { $in: ids.map(oid) } }, { projection: { customerName: 1 } })
      .toArray();
    for (const d of docs) customers.set(String(d._id), d.customerName);
  }
  return attrRows.map((r) => {
    const lead = leads.get(String(r.lead_id)) || null;
    const provider = lead ? normalizeProvider(lead.lead_source, lead.source) : 'Unknown';
    const staff = lead?.assigned_to ? staffLabel(names, lead.assigned_to) : 'Unassigned';
    // Booking.bookingDate is stored as the appointment's day; show it as the dealer-local day.
    return {
      id: r.booking_id,
      booking_id: r.booking_id,
      lead_id: r.lead_id,
      customer: customers.get(r.booking_id) || lead?.name || '',
      appointment_date: r.booking_date ? localDate(r.booking_date, w.tz) : '',
      appointment_time: r.booking_time || '',
      created_at: localDateTime(r.created_at, w.tz),
      booking_status: r.booking_status || '',
      showed: r.showed === true ? 'yes' : r.showed === false ? 'no' : '',
      made_by: CATEGORY_LABELS[r.category] || r.category,
      appointment_type: r.appointment_type,
      lead_source: provider,
      assigned_to: staff,
      _day: localDay(r.created_at, w.tz),
      _shown: r.booking_status !== 'cancelled' && bookingShowed(r, lead?.fe_lead_status),
      _noshow: r.booking_status !== 'cancelled' && r.showed === false,
      _past: appointmentPassed({ bookingDate: r.booking_date, bookingTime: r.booking_time }, { now, tz: w.tz }),
      _g: { lead_source: provider, staff, creator: CATEGORY_LABELS[r.category] || r.category,
        department: r.appointment_type === 'service' ? 'Service' : 'Sales' },
    };
  });
}

export const MESSAGE_COLUMNS = Object.freeze([
  ['message_id', 'Message ID'], ['lead_id', 'Lead ID'], ['customer', 'Customer'], ['sent_at', 'Time'],
  ['channel', 'Channel'], ['sent_by', 'Sent by'], ['staff', 'Staff'], ['status', 'Status'], ['lead_source', 'Lead source'],
]);

export function sentBy(m) {
  if (['received', 'incoming'].includes(m.status)) return 'customer';
  if (m.ai_generated === true) return 'ai';
  if (m.message_by) return 'staff';
  return 'automatic';
}

export async function messageRows(messages, args, ctx) {
  const w = await windowFor(args);
  const leads = await leadsByIds(messages.map((m) => m.lead_id).filter(Boolean).map(String), ctx);
  const names = await staffNames(messages.map((m) => m.message_by).filter(Boolean), ctx);
  return messages.map((m) => {
    const lead = m.lead_id ? leads.get(String(m.lead_id)) : null;
    const provider = lead ? normalizeProvider(lead.lead_source, lead.source) : 'Unknown';
    const staff = m.message_by ? staffLabel(names, m.message_by) : '';
    return {
      id: String(m._id),
      message_id: String(m._id),
      lead_id: m.lead_id ? String(m.lead_id) : '',
      customer: lead?.name || '',
      sent_at: localDateTime(m.timestamp, w.tz),
      channel: m.communication_type === 'sms' ? (m.has_attachments ? 'mms' : 'sms') : 'email',
      sent_by: sentBy(m),
      staff,
      status: m.status || '',
      lead_source: provider,
      _day: localDay(m.timestamp, w.tz),
      _g: { lead_source: provider, staff: staff || 'No staff', channel: m.communication_type === 'sms' ? 'SMS' : 'Email' },
    };
  });
}

// Outbound messages (not notes, not the portal/ADF lead email, not inbound) - same exclusions as
// app/lib/contactedLeads.js messageActivity.
export const ADF = /<\?adf|<adf[\s>]/i;
export const INBOUND = Object.freeze(['received', 'incoming']);
export const FAILED = Object.freeze(['failed', 'undelivered', 'bounced', 'error']);

export function outboundMatch() {
  return { status: { $nin: [...INBOUND, 'note', 'draft'] }, is_note: { $ne: true }, is_lead_email: { $ne: true },
    communication_type: { $ne: 'note' }, mail_content: { $not: ADF } };
}

export function messageFilterMatch(args) {
  const s = spec(args);
  const m = {};
  if (s.channel === 'sms') m.communication_type = 'sms';
  if (s.channel === 'email') m.communication_type = 'email';
  if (s.actor === 'ai') m.ai_generated = true;
  if (s.actor === 'human') { m.ai_generated = { $ne: true }; m.message_by = { $ne: null }; }
  return m;
}

// Messages of the dealer in the window (emails.timestamp), passing the lead filters through emails.lead_id.
export async function messagesInWindow(args, match) {
  const w = await windowFor(args);
  let rows = await collection('emails').find({ dealer_id: { $in: dealerForms(args.dealerId) },
    timestamp: { $gte: w.start, $lte: w.end }, ...match }, { projection: { lead_id: 1, timestamp: 1, status: 1,
    communication_type: 1, ai_generated: 1, message_by: 1, has_attachments: 1 } }).sort({ timestamp: 1, _id: 1 })
    .toArray();
  const pass = await passingLeads(args, rows.map((r) => r.lead_id).filter(Boolean).map(String));
  if (pass) rows = rows.filter((r) => r.lead_id && pass.has(String(r.lead_id)));
  return rows;
}

export function median(values) {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function pct(num, den) {
  return den > 0 ? Math.round((num / den) * 10000) / 100 : null;
}

// Leads whose FIRST status change into one of `regex`'s values (ActivityLog status_changed; staff changes are logged
// there, app/api/conversations/lead/status/route.js) falls in the window. A lead re-set to the same group later is
// counted once, on the first day.
export async function firstStatusChangeLeads(args, ctx, key, regex) {
  return memo(ctx, `status_change:${key}`, async () => {
    const w = await windowFor(args);
    const firsts = await collection('activitylogs').aggregate([
      { $match: { dealer_id: { $in: dealerForms(args.dealerId) }, action: 'status_changed', to: regex,
        lead_id: { $ne: null } } },
      { $group: { _id: '$lead_id', at: { $min: '$at' }, to: { $first: '$to' } } },
      { $match: { at: { $gte: w.start, $lte: w.end } } },
    ]).toArray();
    const ids = firsts.map((r) => String(r._id));
    const pass = await passingLeads(args, ids);
    const keep = firsts.filter((r) => !pass || pass.has(String(r._id)));
    const at = new Map(keep.map((r) => [String(r._id), r.at]));
    const rows = await leadRowsForIds(keep.map((r) => String(r._id)), args, ctx, (l) => ({
      changed_at: localDateTime(at.get(String(l._id)), w.tz) }));
    for (const r of rows) r._day = localDay(at.get(r.id), w.tz);
    return rows;
  });
}

// A KPI whose data does not exist yet, or that is blocked on other work. Registered so the Definitions page lists it.
export function notYet(state, def) {
  return { kind: KIND.COUNT, filters: [], columns: [], ...def, state,
    evaluate: async () => { throw new Error(`${def.id} is ${state}: ${def.reason}`); } };
}
