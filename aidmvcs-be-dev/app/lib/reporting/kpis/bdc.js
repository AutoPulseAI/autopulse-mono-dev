// BDC productivity report (SOW 8 Deliverable F, gap G-035; KPI dictionary A-F 3.2). Staff are credited by the
// lead's CURRENT owner (Lead.assigned_to): lead assignment history is not recorded yet.
// Call attempts / meaningful contacts = the call-task records (decision 9 Nov 2026: "Meaningful contact / call attempt
// = the call-task definitions we already have"); ai_call_tasks is written by the AI service (agentic-upsell
// agent/call_tasks.py: status open / completed / dismissed / cancelled / missed, outcome connected / no_answer /
// voicemail / wrong_number / other, closed_at, missed_at, due_by, assigned_to = a CRM User id as a string).
import {
  BOOKING_COLUMNS, BOOKING_FILTERS, KIND, LEAD_COLUMNS, LEAD_FILTERS, MESSAGE_COLUMNS, STATE, collection, dealerForms,
  isOid, leadsByIds, localDateTime, localDay, memo, messageRows, messagesInWindow, notYet, outboundMatch, oid,
  passingLeads, staffLabel, staffNames, windowFor,
} from './common.js';
import { shared } from './executive.js';
import { normalizeProvider } from '../normalize.js';

const D = 'bdc';

// First outbound message (not a note / lead email) at or after the Lead Date, per lead of the cohort.
async function firstResponses(args, ctx, { human }) {
  return memo(ctx, `first_response:${human ? 'human' : 'any'}`, async () => {
    const cohort = await shared.leadsReceivedRows(args, ctx);
    const created = new Map((await leadsByIds(cohort.map((r) => r.id), ctx)).entries());
    if (!cohort.length) return { cohort, first: new Map() };
    const match = { lead_id: { $in: cohort.map((r) => oid(r.id)) }, ...outboundMatch(),
      ...(human ? { message_by: { $ne: null }, ai_generated: { $ne: true } } : {}) };
    const msgs = await collection('emails').find(match, { projection: { lead_id: 1, timestamp: 1 } })
      .sort({ timestamp: 1, _id: 1 }).toArray();
    const first = new Map();
    for (const m of msgs) {
      const k = String(m.lead_id);
      const at = created.get(k)?.createdAt;
      if (first.has(k) || !m.timestamp || (at && new Date(m.timestamp) < new Date(at))) continue;
      first.set(k, { at: m.timestamp, id: String(m._id) });
    }
    return { cohort, first };
  });
}

const speedKpi = (id, label, human) => ({
  id, label, dashboard: D, grain: 'lead', kind: KIND.MEDIAN, unit: 'minutes',
  dateBasis: 'Lead.createdAt (cohort: leads received in the range); response = emails.timestamp',
  numerator: `Median minutes from the Lead Date to the first ${human ? 'staff message (message_by set, not AI)'
    : 'outbound message (AI, staff or automatic)'} at or after it. The count is the leads that got one.`,
  denominator: 'Leads received in the range that have such a message (leads still waiting are in '
    + '"Leads with no response yet").',
  inclusions: 'SMS and email to the customer, any status except inbound / note / draft.',
  exclusions: 'Notes, the portal/ADF lead email, messages before the Lead Date (e.g. imported history). Business '
    + 'hours are not applied (24-hour clock).',
  source: ['leads', 'emails'], filters: LEAD_FILTERS, breakdowns: ['staff', 'lead_source'],
  columns: [...LEAD_COLUMNS, ['first_response_at', 'First response'], ['minutes', 'Minutes']],
  evaluate: async (args, ctx) => {
    const { cohort, first } = await firstResponses(args, ctx, { human });
    const w = await windowFor(args);
    const leads = await leadsByIds(cohort.map((r) => r.id), ctx);
    const rows = cohort.filter((r) => first.has(r.id)).map((r) => {
      const f = first.get(r.id);
      const minutes = Math.round((new Date(f.at) - new Date(leads.get(r.id).createdAt)) / 6000) / 10;
      return { ...r, first_response_at: localDateTime(f.at, w.tz), minutes };
    });
    return { rows };
  },
});

async function callTasks(args, ctx, key, match, dateField, { beforeNow = false } = {}) {
  return memo(ctx, `call_tasks:${key}`, async () => {
    const w = await windowFor(args);
    const now = args.now ? new Date(args.now) : new Date();
    const end = beforeNow && now < w.end ? now : w.end;
    let tasks = await collection('ai_call_tasks').find({ dealer_id: { $in: dealerForms(args.dealerId) },
      ...match, [dateField]: { $gte: w.start, $lte: end } }).sort({ [dateField]: 1, _id: 1 }).toArray();
    const pass = await passingLeads(args, tasks.map((t) => t.lead_id).filter(Boolean).map(String));
    if (pass) tasks = tasks.filter((t) => t.lead_id && pass.has(String(t.lead_id)));
    const leads = await leadsByIds(tasks.map((t) => t.lead_id).filter(Boolean).map(String), ctx);
    const names = await staffNames(tasks.map((t) => t.assigned_to).filter(isOid), ctx);
    return tasks.map((t) => {
      const lead = t.lead_id ? leads.get(String(t.lead_id)) : null;
      const staff = t.assigned_to ? staffLabel(names, t.assigned_to) : 'Unassigned';
      const provider = lead ? normalizeProvider(lead.lead_source, lead.source) : 'Unknown';
      return {
        id: String(t._id), task_id: String(t._id), lead_id: t.lead_id ? String(t.lead_id) : '',
        customer: t.customer_name || lead?.name || '', assigned_to: staff, status: t.status || '',
        outcome: t.outcome || '', opened_at: localDateTime(t.opened_at, w.tz), due_by: localDateTime(t.due_by, w.tz),
        closed_at: localDateTime(t.closed_at, w.tz), missed_at: localDateTime(t.missed_at, w.tz),
        _day: localDay(t[dateField], w.tz), _g: { staff, lead_source: provider, outcome: t.outcome || 'none' },
      };
    });
  });
}

const TASK_COLUMNS = [['task_id', 'Call task ID'], ['lead_id', 'Lead ID'], ['customer', 'Customer'],
  ['assigned_to', 'Assigned to'], ['status', 'Status'], ['outcome', 'Outcome'], ['opened_at', 'Opened'],
  ['due_by', 'Due by'], ['closed_at', 'Closed'], ['missed_at', 'Missed']];

const taskKpi = (id, label, numerator, key, match, dateField, dateBasis, extra = {}, opts = {}) => ({
  id, label, dashboard: D, grain: 'call_task', kind: KIND.COUNT, dateBasis, numerator, denominator: null,
  inclusions: 'Call tasks of the dealer (ai_call_tasks, written by the AI service).',
  exclusions: 'No real dial counts: there is no phone-system call log.', source: ['ai_call_tasks', 'leads'],
  filters: LEAD_FILTERS, breakdowns: ['staff', 'outcome'], columns: TASK_COLUMNS,
  evaluate: async (args, ctx) => ({ rows: await callTasks(args, ctx, key, match, dateField, opts) }), ...extra,
});

const staffMessages = (channel) => async (args, ctx) => {
  const rows = await messagesInWindow(args, { ...outboundMatch(), message_by: { $ne: null },
    ai_generated: { $ne: true }, communication_type: channel });
  return { rows: await messageRows(rows, args, ctx) };
};

export const BDC_KPIS = [
  {
    id: 'bdc.assigned_leads', label: 'Assigned leads', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: 'Lead.createdAt', numerator: 'Leads received in the range that have an owner (Lead.assigned_to), '
      + 'grouped by that owner.', denominator: null, inclusions: 'The current owner.',
    exclusions: 'Unassigned leads (their own KPI).', source: ['leads', 'users'], filters: LEAD_FILTERS,
    breakdowns: ['staff'], columns: LEAD_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: (await shared.leadsReceivedRows(args, ctx))
      .filter((r) => r.assigned_to !== 'Unassigned') }),
  },
  {
    id: 'bdc.unassigned_leads', label: 'Unassigned leads', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: 'Lead.createdAt', numerator: 'Leads received in the range with no owner.', denominator: null,
    inclusions: 'Lead.assigned_to empty.', exclusions: 'None.', source: ['leads'], filters: LEAD_FILTERS,
    breakdowns: ['lead_source'], columns: LEAD_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: (await shared.leadsReceivedRows(args, ctx))
      .filter((r) => r.assigned_to === 'Unassigned') }),
  },
  speedKpi('bdc.speed_to_lead', 'Speed to lead (first response)', false),
  speedKpi('bdc.speed_to_human', 'Speed to lead (first staff touch)', true),
  {
    id: 'bdc.no_response', label: 'Leads with no response yet', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: 'Lead.createdAt', numerator: 'Leads received in the range with no outbound message at or after the '
      + 'Lead Date (up to now).', denominator: null, inclusions: 'As bdc.speed_to_lead.',
    exclusions: 'As bdc.speed_to_lead.', source: ['leads', 'emails'], filters: LEAD_FILTERS,
    breakdowns: ['staff', 'lead_source'], columns: LEAD_COLUMNS,
    evaluate: async (args, ctx) => {
      const { cohort, first } = await firstResponses(args, ctx, { human: false });
      return { rows: cohort.filter((r) => !first.has(r.id)) };
    },
  },
  {
    id: 'bdc.staff_texts', label: 'Texts sent by staff', dashboard: D, grain: 'message', kind: KIND.COUNT,
    dateBasis: 'emails.timestamp', numerator: 'Outbound SMS/MMS written by staff (message_by set, not AI) in the '
      + 'range.', denominator: null, inclusions: 'Any delivery status (failed ones too: an attempt).',
    exclusions: 'AI and automatic messages, notes.', source: ['emails'], filters: LEAD_FILTERS,
    breakdowns: ['staff'], columns: MESSAGE_COLUMNS, evaluate: staffMessages('sms'),
  },
  {
    id: 'bdc.staff_emails', label: 'Emails sent by staff', dashboard: D, grain: 'message', kind: KIND.COUNT,
    dateBasis: 'emails.timestamp', numerator: 'Outbound emails written by staff (message_by set, not AI) in the '
      + 'range.', denominator: null, inclusions: 'Any delivery status.',
    exclusions: 'AI and automatic messages, notes, the portal/ADF lead email.', source: ['emails'],
    filters: LEAD_FILTERS, breakdowns: ['staff'], columns: MESSAGE_COLUMNS, evaluate: staffMessages('email'),
  },
  taskKpi('bdc.call_tasks_completed', 'Call tasks completed', 'Call tasks marked completed in the range (closed_at).',
    'completed', { status: 'completed' }, 'closed_at', 'ai_call_tasks.closed_at'),
  taskKpi('bdc.meaningful_contacts', 'Meaningful contacts (connected calls)', 'Completed call tasks with outcome '
    + 'connected, closed in the range.', 'connected', { status: 'completed', outcome: 'connected' }, 'closed_at',
  'ai_call_tasks.closed_at'),
  // Investigated 10 Nov 2026 (11,706 in 30 days on one dealer). agentic-upsell agent/call_tasks.py: mark_missed sets
  // status 'missed' + missed_at + closed_at (same time) on every task still open at its due_by; resolve() can later
  // turn a missed task into completed / dismissed (closed_at moves, missed_at stays). One OPEN task per lead at a time,
  // but each touch (connection timer, agent/call_tasks.py open_task) and each Days 1-7 half-day
  // (scheduler/daily_call_tasks.py, up to 2 per lead per workday) opens a new one, so an unworked lead adds a missed
  // task per touch / half-day - many per lead, by design, not duplicates of one task. The Call Tasks page's Missed
  // list (app/api/dealer-ai/call-tasks -> AI service api/staff_view.py list_call_tasks view=missed) shows tasks whose
  // status is STILL 'missed', by closed_at in the picked dealer-local days (300 rows at most per list). This KPI
  // counts exactly that list's rows (without the 300 cap). Tasks missed and later completed are not in it (the page's
  // per-agent "missed in 30 days", missed_by_agent, counts those too: missed_at, rolling 30 days); the reconcile
  // script prints both.
  taskKpi('bdc.call_tasks_missed', 'Missed call tasks', 'Call tasks whose status is missed (still open at their due '
    + 'time, agentic-upsell agent/call_tasks.py mark_missed) closed in the range - the Call Tasks page\'s Missed list for '
    + 'the same days. A missed task staff later completed or dismissed leaves the Missed list and this count.',
  'missed', { status: 'missed' }, 'closed_at', 'ai_call_tasks.closed_at (= missed_at for a missed task)',
  { exclusions: 'Missed tasks later completed / dismissed (they moved to Done / Cancelled). Each touch or half-day '
    + 'opens its own task, so one lead can have several. No real dial counts: there is no phone-system call log.' }),
  taskKpi('bdc.call_tasks_overdue', 'Open call tasks past due', 'Call tasks still open whose due time (due_by) is in '
    + 'the range and already passed.', 'overdue', { status: 'open' }, 'due_by',
  'ai_call_tasks.due_by', {}, { beforeNow: true }),
  {
    id: 'bdc.appointments_by_owner', label: 'Appointments set (by lead owner)', dashboard: D, grain: 'booking',
    kind: KIND.COUNT, dateBasis: 'Booking.createdAt',
    numerator: 'Bookings set in the range, credited to the lead\'s current owner (not to the person who booked: '
      + 'bookings do not record that yet).', denominator: null, inclusions: 'As appointments.set.',
    exclusions: 'Duplicate bookings.', source: ['bookings', 'leads'], filters: BOOKING_FILTERS,
    breakdowns: ['staff', 'creator'], columns: BOOKING_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await shared.apptSetRows(args, ctx) }),
  },
  notYet(STATE.NEEDS_DATA, {
    id: 'bdc.appointments_by_rep', label: 'Appointments set by rep', dashboard: D, grain: 'booking',
    dateBasis: 'Booking.createdAt', numerator: 'Bookings set by each staff member.', denominator: null,
    exclusions: 'n/a', source: ['bookings'],
    reason: 'Bookings do not record which staff member created them (created_by_user_id, P1 item 3).',
  }),
  notYet(STATE.NEEDS_DATA, {
    id: 'bdc.shows_by_rep', label: 'Shows by rep', dashboard: D, grain: 'booking', dateBasis: 'Booking.bookingDate',
    numerator: 'Shows of the bookings each staff member set.', denominator: null, exclusions: 'n/a',
    source: ['bookings'], reason: 'Needs created_by_user_id on bookings (P1 item 3).',
  }),
  notYet(STATE.NEEDS_DATA, {
    id: 'bdc.assigned_as_of', label: 'Assigned leads (owner at the time)', dashboard: D, grain: 'lead',
    dateBasis: 'Lead.createdAt', numerator: 'Leads credited to the owner they had when the event happened.',
    denominator: null, exclusions: 'n/a', source: ['leads'],
    reason: 'Lead assignment changes are not logged yet (api/leads/[id] and lib/customerResolver.js).',
  }),
  notYet(STATE.NEEDS_DATA, {
    id: 'bdc.overdue_followups', label: 'Overdue follow-ups', dashboard: D, grain: 'lead',
    dateBasis: 'the dated next step', numerator: 'Leads in "Contacted - Specific Follow-up" past their dated next '
      + 'step.', denominator: null, exclusions: 'n/a', source: ['ai_lead_state', 'scheduled_followups'],
    reason: 'Where the dated next step is stored (ai_lead_state or scheduled_followups) is not confirmed yet.',
  }),
  notYet(STATE.BLOCKED, {
    id: 'bdc.dial_attempts', label: 'Dial attempts', dashboard: D, grain: 'call', dateBasis: 'call time',
    numerator: 'Phone calls dialled by each staff member.', denominator: null, exclusions: 'n/a', source: [],
    reason: 'No phone system / call log integration; call tasks are the only call record.',
  }),
];
