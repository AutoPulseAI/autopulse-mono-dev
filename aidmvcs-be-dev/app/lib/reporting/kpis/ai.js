// AI operations report (SOW 8 Deliverable F, gap G-039; KPI dictionary A-F 3.6). Messages come from the CRM
// conversation (emails, ai_generated); the AI's own records (ai_lead_state, ai_touches) are written by the AI service
// into the same database and only read here. The AI Insights numbers (agentic-upsell learning/insights.py) are
// recomputed on dealer-local days instead of a rolling UTC window. n8n / legacy auto replies never count as AI.
import {
  BOOKING_COLUMNS, BOOKING_FILTERS, KIND, LEAD_COLUMNS, LEAD_FILTERS, MESSAGE_COLUMNS, MESSAGE_FILTERS, REPLY_FILTERS,
  STATE, collection, dealerForms, isOid, leadRowsForIds, leadsByIds, localDateTime, localDay, memo, messageFilterMatch,
  messageRows, messagesInWindow, notYet, oid, outboundMatch, passingLeads, replies, windowFor,
} from './common.js';
import { shared } from './executive.js';
import { normalizeProvider } from '../normalize.js';

const D = 'ai';

// Start of the handoff reasons that need a manager (agentic-upsell agent/escalation.py MANAGER_ESCALATIONS, read
// only; keep in step with it).
export const MANAGER_ESCALATIONS = Object.freeze([
  ['Customer is clearly upset', 'Upset customer'],
  ['The customer is confused or frustrated', 'Frustrated customer'],
  ['Declined a visit more than once', 'Declined a visit more than once'],
  ['Customer asked for a person', 'Asked for a person'],
  ['Customer asked for a call', 'Asked for a call'],
  ['Customer asked for a text from a person', 'Asked for a text from a person'],
  ["Customer asked for something the AI can't supply", 'Asked for something only staff can provide'],
  ['AI stuck in a loop', 'AI going round in circles'],
  ["Customer says they're not interested any more", 'Not interested any more'],
]);

export function escalationLabel(reason) {
  const r = String(reason || '');
  const hit = MANAGER_ESCALATIONS.find(([prefix]) => r.startsWith(prefix));
  return hit ? hit[1] : null;
}

const aiOutbound = (args) => ({ ...outboundMatch(), ...messageFilterMatch({ spec: { channel: args.spec?.channel } }),
  ai_generated: true });

async function aiMessages(args, ctx) {
  return memo(ctx, 'ai_messages', async () => messagesInWindow(args, aiOutbound(args)));
}

// The AI's own SMS delivered report / an email the mail service took (app/lib/contactedLeads.js messageActivity).
const delivered = (m) => (m.communication_type === 'sms' ? m.status === 'delivered'
  : ['sent', 'delivered'].includes(m.status));

async function handoffRows(args, ctx) {
  return memo(ctx, 'handoffs', async () => {
    const w = await windowFor(args);
    let states = await collection('ai_lead_state').find({ dealer_id: { $in: dealerForms(args.dealerId) },
      status: 'handoff', status_at: { $gte: w.start, $lte: w.end } },
    { projection: { lead_id: 1, status_reason: 1, status_at: 1 } }).sort({ status_at: 1, _id: 1 }).toArray();
    const pass = await passingLeads(args, states.map((s) => String(s.lead_id)));
    if (pass) states = states.filter((s) => pass.has(String(s.lead_id)));
    const byLead = new Map(states.map((s) => [String(s.lead_id), s]));
    const rows = await leadRowsForIds([...byLead.keys()], args, ctx, (l) => {
      const s = byLead.get(String(l._id));
      const label = escalationLabel(s.status_reason);
      return { handoff_at: localDateTime(s.status_at, w.tz), reason: s.status_reason || '',
        escalation: label || '' };
    });
    for (const r of rows) {
      const s = byLead.get(r.id);
      r._day = localDay(s.status_at, w.tz);
      r._g.reason = escalationLabel(s.status_reason) || 'Other handoff';
    }
    return rows;
  });
}

async function touchRows(args, ctx) {
  return memo(ctx, 'ai_touches', async () => {
    const w = await windowFor(args);
    let docs = await collection('ai_touches').find({ dealer_id: { $in: dealerForms(args.dealerId) },
      sent_at: { $gte: w.start, $lte: w.end } }).sort({ sent_at: 1, _id: 1 }).toArray();
    const pass = await passingLeads(args, docs.map((d) => String(d.lead_id || '')));
    if (pass) docs = docs.filter((d) => pass.has(String(d.lead_id)));
    const leads = await leadsByIds(docs.map((d) => String(d.lead_id || '')).filter(isOid), ctx);
    const now = args.now ? new Date(args.now) : new Date();
    const age = (d) => (d.sent_at ? now - new Date(d.sent_at) : 0);
    return docs.map((d) => {
      const lead = leads.get(String(d.lead_id)) || null;
      const provider = lead ? normalizeProvider(lead.lead_source, lead.source) : 'Unknown';
      return {
        id: String(d.touch_id || d._id), touch_id: String(d.touch_id || d._id),
        lead_id: d.lead_id ? String(d.lead_id) : '', customer: lead?.name || '', kind: d.kind || '',
        sent_at: localDateTime(d.sent_at, w.tz), replied_24h: d.replied_24h ? 'yes' : 'no',
        replied_72h: d.replied_72h ? 'yes' : 'no', meaningful: d.meaningful_reply ? 'yes' : 'no',
        appointment_7d: d.appointment_7d ? 'yes' : 'no', opted_out: d.opted_out_at ? 'yes' : 'no',
        _day: localDay(d.sent_at, w.tz), _g: { lead_source: provider, kind: d.kind || 'unknown' },
        _settled24: age(d) >= 24 * 3600e3, _settled72: age(d) >= 72 * 3600e3, _settled7d: age(d) >= 7 * 24 * 3600e3,
      };
    });
  });
}

const TOUCH_COLUMNS = [['touch_id', 'Touch ID'], ['lead_id', 'Lead ID'], ['customer', 'Customer'], ['kind', 'Kind'],
  ['sent_at', 'Sent'], ['replied_24h', 'Replied in 24h'], ['replied_72h', 'Replied in 3 days'],
  ['meaningful', 'Real reply'], ['appointment_7d', 'Appointment in 7 days'], ['opted_out', 'Opted out']];

const touchRate = (id, label, numerator, denominator, settledKey, hit) => ({
  id, label, dashboard: D, grain: 'ai_touch', kind: KIND.RATE, unit: '%',
  dateBasis: 'ai_touches.sent_at (dealer-local days)', numerator, denominator,
  inclusions: 'Every outbound AI touch the AI service recorded (first replies, follow-ups, reminders).',
  exclusions: 'Touches too new to have had their chance are left out of the denominator (as AI Insights).',
  source: ['ai_touches'], filters: LEAD_FILTERS, breakdowns: ['kind'], columns: TOUCH_COLUMNS,
  evaluate: async (args, ctx) => {
    const rows = await touchRows(args, ctx);
    const den = settledKey ? rows.filter((r) => r[settledKey]) : rows;
    return { rows: den.filter(hit), denominatorRows: den };
  },
});

export const AI_KPIS = [
  {
    id: 'ai.conversations', label: 'AI conversations', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: 'emails.timestamp', numerator: 'Leads that got at least one AI message (ai_generated) in the range.',
    denominator: null, inclusions: 'Any delivery status.', exclusions: 'Notes; n8n / automatic messages (not AI).',
    source: ['emails', 'leads'], filters: MESSAGE_FILTERS, breakdowns: ['lead_source', 'staff'], columns: LEAD_COLUMNS,
    evaluate: async (args, ctx) => {
      const msgs = await aiMessages(args, ctx);
      return { rows: await leadRowsForIds([...new Set(msgs.map((m) => String(m.lead_id)).filter(isOid))], args, ctx) };
    },
  },
  {
    id: 'ai.messages_sent', label: 'AI messages sent', dashboard: D, grain: 'message', kind: KIND.COUNT,
    dateBasis: 'emails.timestamp', numerator: 'Outbound AI messages (ai_generated) in the range.', denominator: null,
    inclusions: 'Any delivery status, failed included.', exclusions: 'Notes, inbound, automatic (n8n) messages.',
    source: ['emails'], filters: MESSAGE_FILTERS, breakdowns: ['channel'], trend: true, columns: MESSAGE_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await messageRows(await aiMessages(args, ctx), args, ctx) }),
  },
  {
    id: 'ai.messages_delivered', label: 'AI messages delivered', dashboard: D, grain: 'message', kind: KIND.COUNT,
    dateBasis: 'emails.timestamp', numerator: 'AI messages in the range that reached the customer: a text whose '
      + 'delivery report says delivered, an email the mail service accepted (sent / delivered).', denominator: null,
    inclusions: 'As app/lib/contactedLeads.js messageActivity "delivered".', exclusions: 'Failed, undelivered, bounced.',
    source: ['emails'], filters: MESSAGE_FILTERS, breakdowns: ['channel'], columns: MESSAGE_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await messageRows((await aiMessages(args, ctx)).filter(delivered), args,
      ctx) }),
  },
  {
    id: 'ai.response_time', label: 'AI response time', dashboard: D, grain: 'message', kind: KIND.MEDIAN,
    unit: 'minutes', dateBasis: 'emails.timestamp of the customer\'s reply',
    numerator: 'Median minutes from a customer reply to the AI\'s answer, over the replies the AI answered (handler '
      + '"ai" in app/lib/reporting/replyCohorts.js: the first outbound message after the reply, before the next '
      + 'inbound one and before the end of the reply\'s day + 24 h, was AI-written).',
    denominator: 'Replies in the range the AI answered (the count).',
    inclusions: 'Qualifying inbound replies (as Customers replied).', exclusions: 'Replies answered by staff or '
      + 'automatic messages, or not answered.', source: ['emails'], filters: REPLY_FILTERS, breakdowns: ['channel'],
    columns: [['reply_id', 'Reply message ID'], ['lead_id', 'Lead ID'], ['customer', 'Customer'],
      ['reply_at', 'Reply'], ['answered_at', 'AI answered'], ['minutes', 'Minutes'], ['channel', 'Channel']],
    evaluate: async (args, ctx) => {
      const w = await windowFor(args);
      const report = await replies(args, ctx);
      const answered = report.rows.filter((r) => r.handler === 'ai' && r.lead_id);
      if (!answered.length) return { rows: [] };
      const minAt = new Date(Math.min(...answered.map((r) => new Date(r.reply_at).getTime())));
      const ai = await collection('emails').find({ lead_id: { $in: [...new Set(answered.map((r) => r.lead_id))]
        .map(oid) }, ai_generated: true, timestamp: { $gte: minAt }, ...outboundMatch() },
      { projection: { lead_id: 1, timestamp: 1 } }).sort({ timestamp: 1, _id: 1 }).toArray();
      const byLead = new Map();
      for (const m of ai) {
        const k = String(m.lead_id);
        if (!byLead.has(k)) byLead.set(k, []);
        byLead.get(k).push(m);
      }
      const leads = await leadsByIds(answered.map((r) => r.lead_id), ctx);
      const rows = [];
      for (const r of answered) {
        const next = (byLead.get(String(r.lead_id)) || []).find((m) => new Date(m.timestamp) >= new Date(r.reply_at));
        if (!next) continue;
        const lead = leads.get(String(r.lead_id));
        rows.push({ id: r.email_id, reply_id: r.email_id, lead_id: r.lead_id, customer: lead?.name || '',
          reply_at: localDateTime(r.reply_at, w.tz), answered_at: localDateTime(next.timestamp, w.tz),
          minutes: Math.round((new Date(next.timestamp) - new Date(r.reply_at)) / 6000) / 10, channel: r.channel,
          _day: r.local_day, _g: { channel: r.channel === 'sms' ? 'SMS' : 'Email' } });
      }
      return { rows };
    },
  },
  {
    id: 'ai.handoffs', label: 'Handoffs to staff', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: 'ai_lead_state.status_at', numerator: 'Leads the AI handed to staff (ai_lead_state.status = handoff) '
      + 'with the handoff time in the range.', denominator: null,
    inclusions: 'The lead\'s CURRENT AI state: a lead handed off and later taken back is not counted.',
    exclusions: 'Earlier handoffs of the same lead (only the latest is stored).', source: ['ai_lead_state', 'leads'],
    filters: LEAD_FILTERS, breakdowns: ['reason'],
    columns: [...LEAD_COLUMNS, ['handoff_at', 'Handed off'], ['reason', 'Reason'], ['escalation', 'Manager reason']],
    evaluate: async (args, ctx) => ({ rows: await handoffRows(args, ctx) }),
  },
  {
    id: 'ai.manager_escalations', label: 'Manager escalations', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: 'ai_lead_state.status_at', numerator: 'Handoffs whose reason needs a manager (agentic-upsell '
      + 'agent/escalation.py MANAGER_ESCALATIONS: upset or frustrated customer, declined a visit twice, asked for a '
      + 'person / call / text from a person, asked for something only staff can provide, AI going in circles, not '
      + 'interested).', denominator: null, inclusions: 'As ai.handoffs.', exclusions: 'Soft handoffs the AI takes back.',
    source: ['ai_lead_state'], filters: LEAD_FILTERS, breakdowns: ['reason'],
    columns: [...LEAD_COLUMNS, ['handoff_at', 'Handed off'], ['escalation', 'Manager reason']],
    evaluate: async (args, ctx) => ({ rows: (await handoffRows(args, ctx)).filter((r) => r.escalation) }),
  },
  {
    id: 'ai.appointments_ai', label: 'AI-created appointments', dashboard: D, grain: 'booking', kind: KIND.COUNT,
    dateBasis: 'Booking.createdAt', numerator: 'Bookings set in the range by the AI (created_by = ai).',
    denominator: null, inclusions: 'Any status.', exclusions: 'Duplicates; public booking page bookings (unknown).',
    source: ['bookings'], filters: BOOKING_FILTERS, breakdowns: ['department'], columns: BOOKING_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: (await shared.apptSetRows(args, ctx)).filter((r) => r.made_by === 'AI') }),
  },
  {
    id: 'ai.appointments_assisted', label: 'AI-assisted appointments', dashboard: D, grain: 'booking',
    kind: KIND.COUNT, dateBasis: 'Booking.createdAt', numerator: 'Bookings staff set in the range after the AI had '
      + 'messaged the same lead.', denominator: null, inclusions: 'Any status.', exclusions: 'Duplicates.',
    source: ['bookings', 'emails'], filters: BOOKING_FILTERS, breakdowns: ['department'], columns: BOOKING_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: (await shared.apptSetRows(args, ctx))
      .filter((r) => r.made_by === 'AI-assisted') }),
  },
  {
    id: 'ai.staff_takeovers', label: 'Staff turned the AI off', dashboard: D, grain: 'activity', kind: KIND.COUNT,
    dateBasis: 'ActivityLog.at', numerator: 'Times staff turned the AI off for a lead in the range (ActivityLog '
      + 'action ai_turned_off, app/api/dealer-ai/leads/[id]/pause).', denominator: null,
    inclusions: 'Each switch-off once.', exclusions: 'Status changes that pause the AI without the switch '
      + '(not logged as a takeover).', source: ['activitylogs', 'leads'], filters: LEAD_FILTERS, breakdowns: ['staff'],
    columns: [['log_id', 'Log ID'], ['lead_id', 'Lead ID'], ['customer', 'Customer'], ['by', 'By'], ['at', 'When']],
    evaluate: async (args, ctx) => {
      const w = await windowFor(args);
      let logs = await collection('activitylogs').find({ dealer_id: { $in: dealerForms(args.dealerId) },
        action: 'ai_turned_off', at: { $gte: w.start, $lte: w.end } }).sort({ at: 1, _id: 1 }).toArray();
      const pass = await passingLeads(args, logs.map((l) => String(l.lead_id || '')));
      if (pass) logs = logs.filter((l) => pass.has(String(l.lead_id)));
      const leads = await leadsByIds(logs.map((l) => String(l.lead_id || '')).filter(isOid), ctx);
      return { rows: logs.map((l) => ({ id: String(l._id), log_id: String(l._id),
        lead_id: l.lead_id ? String(l.lead_id) : '', customer: leads.get(String(l.lead_id))?.name || '',
        by: l.actor_name || '', at: localDateTime(l.at, w.tz), _day: localDay(l.at, w.tz),
        _g: { staff: l.actor_name || 'Unknown' } })) };
    },
  },
  {
    id: 'ai.touches', label: 'AI touches', dashboard: D, grain: 'ai_touch', kind: KIND.COUNT,
    dateBasis: 'ai_touches.sent_at (dealer-local days)', numerator: 'Outbound AI touches the AI service recorded in '
      + 'the range (the "AI messages sent" of AI Insights).', denominator: null, inclusions: 'Every kind.',
    exclusions: 'None.', source: ['ai_touches'], filters: LEAD_FILTERS, breakdowns: ['kind'], columns: TOUCH_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await touchRows(args, ctx) }),
  },
  touchRate('ai.reply_rate_24h', 'Replied within 24 hours', 'Touches with a reply within 24 h (replied_24h).',
    'Touches sent at least 24 h ago.', '_settled24', (r) => r.replied_24h === 'yes'),
  touchRate('ai.reply_rate_72h', 'Replied within 3 days', 'Touches with a reply within 72 h (replied_72h).',
    'Touches sent at least 72 h ago.', '_settled72', (r) => r.replied_72h === 'yes'),
  touchRate('ai.meaningful_rate', 'Real replies', 'Touches with a meaningful reply (not just an emoji or STOP).',
    'Touches sent at least 72 h ago.', '_settled72', (r) => r.meaningful === 'yes'),
  touchRate('ai.appointment_rate_7d', 'Appointment within 7 days', 'Touches followed by an appointment within 7 days.',
    'Touches sent at least 7 days ago.', '_settled7d', (r) => r.appointment_7d === 'yes'),
  touchRate('ai.opt_out_rate', 'Opted out after a touch', 'Touches after which the customer opted out.',
    'Every touch in the range.', null, (r) => r.opted_out === 'yes'),
  notYet(STATE.NEEDS_DATA, {
    id: 'ai.fallbacks_cost', label: 'AI fallbacks, guard failures and cost', dashboard: D, grain: 'ai_turn',
    dateBasis: 'ai_turn_log.created_at', numerator: 'AI turns that fell back / failed a guard, and their cost.',
    denominator: null, exclusions: 'n/a', source: ['ai_turn_log'],
    reason: 'Kept by the AI service (GET /v1/metrics, UTC days, 90-day turn log) for AutoPulse admins; not read by '
      + 'the CRM yet.',
  }),
  notYet(STATE.NEEDS_DATA, {
    id: 'ai.handoff_history', label: 'Handoffs (full history)', dashboard: D, grain: 'handoff_event',
    dateBasis: 'handoff time', numerator: 'Every handoff, including leads handed back later.', denominator: null,
    exclusions: 'n/a', source: ['ai_turn_log'],
    reason: 'Only the current AI state is stored; a handoff event log (or nightly snapshot) is needed.',
  }),
];
