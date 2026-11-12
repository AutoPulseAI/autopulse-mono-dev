// Executive / store report (SOW 8 Deliverable F, gap G-034; KPI dictionary A-F 3.1).
import Customer from '../../../models/Customer.js';
import { normalizeProvider, statusRegexFor } from '../normalize.js';
import {
  BOOKING_COLUMNS, BOOKING_FILTERS, KIND, LEAD_COLUMNS, LEAD_FILTERS, REPLY_FILTERS, STATE, attribution, bookingRows,
  collection, dealerForms, firstStatusChangeLeads, isOid, leadRows, leadsReceived, localDateTime, localDay, memo, notYet,
  oid, replies,
} from './common.js';

const D = 'executive';
const SOLD_GROUPS = ['SOLD_PENDING', 'SOLD_DELIVERED', 'SOLD_UNSPECIFIED'];
export const SOLD_REGEX = statusRegexFor(SOLD_GROUPS);

// Shared building blocks (other tabs reuse them, so the same number means the same thing everywhere).
export const shared = {
  async leadsReceivedRows(args, ctx) {
    return memo(ctx, 'rows:leads_received', async () => leadRows(await leadsReceived(args, ctx), args, ctx));
  },
  async apptSetRows(args, ctx) {
    return memo(ctx, 'rows:appt_set', async () => bookingRows((await attribution(args, ctx, 'created')).rows, args, ctx));
  },
  // Bookings moved / cancelled in the range (the booking history, recorded from 10 Nov 2026), one row per booking:
  // its latest change of that kind in the range, with who made it. kind: 'rescheduled' | 'cancelled'.
  async apptChangeRows(args, ctx, kind) {
    return memo(ctx, `rows:appt_${kind}`, async () => {
      const att = await attribution(args, ctx, 'created');
      const events = att.changes?.[kind]?.events || [];
      if (!events.length) return [];
      const docs = await collection('bookings').find({ _id: { $in: events.map((e) => e.booking_id).filter(isOid)
        .map(oid) } }).toArray();
      const byId = new Map(docs.map((d) => [String(d._id), d]));
      const known = new Map(att.rows.map((r) => [r.booking_id, r]));
      const MADE = { ai: 'ai', staff: 'Staff', customer: 'Customer' };
      const attrRows = events.filter((e) => byId.has(e.booking_id)).map((e) => {
        const b = byId.get(e.booking_id);
        return known.get(e.booking_id) || { booking_id: e.booking_id, lead_id: String(b.lead_id),
          category: MADE[b.created_by] || 'unknown', created_at: b.createdAt || null, booking_date: b.bookingDate,
          booking_time: b.bookingTime, appointment_type: b.appointment_type === 'service' ? 'service' : 'sales',
          booking_status: b.booking_status || null, showed: b.showed ?? null,
          created_by_user_id: b.created_by_user_id ? String(b.created_by_user_id) : null,
          created_by_name: b.created_by_name || null };
      });
      const rows = await bookingRows(attrRows, args, ctx);
      const ACTOR = { ai: 'AI', staff: 'Staff', customer: 'Customer', system: 'System', unknown: 'Unknown' };
      const w = att.tz;
      return rows.map((r, i) => {
        const e = events.find((x) => x.booking_id === attrRows[i].booking_id);
        const who = ACTOR[e.actor] || 'Unknown';
        return { ...r, changed_by: e.actor_name ? `${who} (${e.actor_name})` : who,
          changed_at: e.at ? localDateTime(e.at, w) : '', _day: e.at ? localDay(e.at, w) : r._day,
          _g: { ...r._g, actor: who } };
      });
    });
  },
  async apptScheduledRows(args, ctx) {
    return memo(ctx, 'rows:appt_scheduled', async () => bookingRows((await attribution(args, ctx, 'scheduled')).rows,
      args, ctx));
  },
  // Shown / No-show / Show rate: ONE definition everywhere (the Dashboard's "Appointments Showed" card, the daily
  // email via appointmentAttribution.outcomes()). Of the scheduled appointments (not cancelled):
  //   shown         RECORDED shows: marked shown, completed, or the lead is now Visited / Unsold / Sold*
  //                 (appointmentFunnel.bookingShowed)
  //   no-show       staff marked it a no-show (Booking.showed === false) and it is not shown
  //   not recorded  its date and time have passed (dealer time zone), not shown, not marked a no-show: nobody
  //                 recorded an outcome (owner, 10 Nov 2026: this is not a no-show)
  //   due           shown + no-show + not recorded;  upcoming: not passed yet, no outcome
  //   show rate     shown / due, labelled "(recorded)"
  async shownRows(args, ctx) {
    return (await shared.apptScheduledRows(args, ctx)).filter((r) => r._shown);
  },
  async dueRows(args, ctx) {
    return (await shared.apptScheduledRows(args, ctx)).filter((r) => r._shown || r._noshow || r._past);
  },
  async noShowRows(args, ctx) {
    return (await shared.apptScheduledRows(args, ctx)).filter((r) => !r._shown && r._noshow);
  },
  async notRecordedRows(args, ctx) {
    return (await shared.apptScheduledRows(args, ctx)).filter((r) => r._past && !r._shown && !r._noshow);
  },
  async upcomingRows(args, ctx) {
    return (await shared.apptScheduledRows(args, ctx)).filter((r) => !r._past && !r._shown && !r._noshow);
  },
  async soldRows(args, ctx) {
    return firstStatusChangeLeads(args, ctx, 'sold', SOLD_REGEX);
  },
  async repliedCustomerRows(args, ctx) {
    return memo(ctx, 'rows:replied_customers', async () => {
      const report = await replies(args, ctx);
      const byCustomer = new Map();
      for (const row of report.rows) {
        const cur = byCustomer.get(row.customer_key) || { first: row, messages: 0, leads: new Set(), days: new Set() };
        cur.messages += 1;
        if (row.lead_id) cur.leads.add(row.lead_id);
        cur.days.add(row.local_day);
        if (new Date(row.reply_at) < new Date(cur.first.reply_at)) cur.first = row;
        byCustomer.set(row.customer_key, cur);
      }
      const leadIds = [...byCustomer.values()].map((c) => c.first.lead_id).filter(isOid);
      const leadDocs = leadIds.length ? await collection('leads').find({ _id: { $in: leadIds.map(oid) } },
        { projection: { name: 1, lead_source: 1, source: 1 } }).toArray() : [];
      const leadName = new Map(leadDocs.map((l) => [String(l._id), l.name]));
      const leadSrc = new Map(leadDocs.map((l) => [String(l._id), normalizeProvider(l.lead_source, l.source)]));
      return [...byCustomer.entries()].map(([key, c]) => ({
        id: key,
        customer_key: key,
        customer: leadName.get(String(c.first.lead_id)) || '',
        first_reply_at: c.first.reply_at ? new Date(c.first.reply_at).toISOString() : '',
        first_reply_local: c.first.local_day,
        lead_ids: [...c.leads].join(' '),
        reply_messages: c.messages,
        lead_age_days: c.first.age_days ?? '',
        lead_source: leadSrc.get(String(c.first.lead_id)) || 'Unknown',
        _day: c.first.local_day,
        _g: { lead_source: leadSrc.get(String(c.first.lead_id)) || 'Unknown' },
      })).sort((a, b) => a.first_reply_at.localeCompare(b.first_reply_at));
    });
  },
};

// The definition texts of Shown / No-show / Show rate, shared by the Executive, Appointments and Lead source tabs.
// "Shown" counts RECORDED shows only: a customer who came but nobody recorded it is not in it (owner, 10 Nov 2026).
export const SHOWN_TEXT = 'Recorded shows: appointments scheduled in the range (not cancelled) that staff recorded as '
  + 'shown - marked showed (Booking.showed = true), completed, or the lead was moved to Visited / Unsold / Sold / Sold '
  + 'Pending / Sold Delivered - the same rule as the Dashboard card "Appointments Showed". A visit nobody recorded is '
  + 'not counted.';
export const NO_SHOW_TEXT = 'Appointments scheduled in the range that staff marked as a no-show (Booking.showed = '
  + 'false), not cancelled and not shown. A past appointment with no outcome recorded is NOT a no-show (see "No '
  + 'outcome recorded").';
export const NOT_RECORDED_TEXT = 'Appointments scheduled in the range whose date and time have passed (dealer time '
  + 'zone), not cancelled, with no outcome recorded: not marked shown or no-show, not completed, and the lead not moved '
  + 'to Visited / Sold.';
export const SHOW_RATE_DENOMINATOR = 'Appointments scheduled in the range that are past or already decided, not '
  + 'cancelled: recorded shows + no-shows + no outcome recorded. Future appointments with no outcome are not counted. '
  + '(An appointment already marked shown or no-show counts even if its time is later that day.)';
export const SHOWN_BASIS = 'Dashboard card "Appointments Showed" (app/lib/appointmentFunnel.js bookingShowed); SOW §8 '
  + 'Deliverable F: "Show rates ... must not change meaning across dashboards".';

const REPLIED_COLUMNS = [['customer_key', 'Customer key'], ['customer', 'Customer'], ['first_reply_local', 'First reply day'],
  ['lead_ids', 'Lead IDs'], ['reply_messages', 'Reply messages'], ['lead_age_days', 'Lead age (days)'],
  ['lead_source', 'Lead source']];

export const EXECUTIVE_KPIS = [
  {
    id: 'exec.leads_received', label: 'Leads received', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: 'Lead.createdAt (the CRM "Lead Date"; CSV imports write the original lead date there)',
    numerator: 'Leads of the dealer whose Lead Date is in the range.', denominator: null,
    inclusions: 'Every status, every source.', exclusions: 'None (no test-lead flag exists yet).',
    source: ['leads'], filters: LEAD_FILTERS, breakdowns: ['lead_source', 'staff'], trend: true,
    columns: LEAD_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await shared.leadsReceivedRows(args, ctx) }),
  },
  {
    id: 'exec.unique_customers', label: 'Unique customers with a lead', dashboard: D, grain: 'customer',
    kind: KIND.COUNT, dateBasis: 'Lead.createdAt',
    numerator: 'Distinct customers (Lead.customer_id, following Customer.merged_into to the surviving customer) of '
      + 'the leads received in the range.', denominator: null,
    inclusions: 'Leads linked to a customer.',
    exclusions: 'Leads with no customer link (counted in Data quality "Leads without a customer").',
    source: ['leads', 'customers'], filters: LEAD_FILTERS, breakdowns: ['lead_source'],
    columns: [['customer_id', 'Customer ID'], ['customer', 'Customer'], ['leads', 'Leads in range'],
      ['lead_ids', 'Lead IDs'], ['lead_source', 'First lead source']],
    evaluate: async (args, ctx) => {
      const leads = await shared.leadsReceivedRows(args, ctx);
      const raw = await leadsReceived(args, ctx);
      const custOf = new Map(raw.filter((l) => l.customer_id).map((l) => [String(l._id), String(l.customer_id)]));
      const custIds = [...new Set(custOf.values())].filter(isOid);
      const docs = custIds.length ? await Customer.collection.find({ _id: { $in: custIds.map(oid) } },
        { projection: { name: 1, merged_into: 1 } }).toArray() : [];
      const merged = new Map(docs.map((c) => [String(c._id), c.merged_into ? String(c.merged_into) : null]));
      const names = new Map(docs.map((c) => [String(c._id), c.name]));
      const survivors = [...new Set([...merged.values()].filter(Boolean))].filter((id) => !names.has(id));
      if (survivors.length) {
        for (const c of await Customer.collection.find({ _id: { $in: survivors.map(oid) } },
          { projection: { name: 1 } }).toArray()) names.set(String(c._id), c.name);
      }
      const byCustomer = new Map();
      for (const row of leads) {
        const c = custOf.get(row.id);
        if (!c) continue;
        const key = merged.get(c) || c;
        const cur = byCustomer.get(key) || { leads: [], first: row };
        cur.leads.push(row.id);
        byCustomer.set(key, cur);
      }
      return { rows: [...byCustomer.entries()].map(([id, c]) => ({
        id, customer_id: id, customer: names.get(id) || c.first.customer, leads: c.leads.length,
        lead_ids: c.leads.join(' '), lead_source: c.first.lead_source, _day: c.first._day,
        _g: { lead_source: c.first.lead_source },
      })) };
    },
  },
  {
    id: 'exec.customers_replied', label: 'Customers replied (distinct)', dashboard: D, grain: 'customer',
    kind: KIND.COUNT, dateBasis: 'emails.timestamp of the customer\'s message (dealer-local day)',
    numerator: 'Distinct customers who sent at least one qualifying inbound message in the range, whatever the lead '
      + 'date, each customer ONCE for the whole range (app/lib/reporting/replyCohorts.js; customer = '
      + 'Customer.merged_into ?? Lead.customer_id ?? lead). Not the "Customer-days with a reply" of the dashboard\'s '
      + 'reply-age section, which counts a customer once per day replied (SOW 8B: both bases, each labelled).',
    denominator: null, inclusions: 'Any inbound customer text or email, including STOP.',
    exclusions: 'Notes, the portal/ADF lead email, message_id "lead-..." (the lead\'s own arrival), our own messages.',
    source: ['emails', 'leads', 'customers'], filters: REPLY_FILTERS, breakdowns: ['lead_source'], trend: true,
    columns: REPLIED_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await shared.repliedCustomerRows(args, ctx) }),
  },
  {
    id: 'exec.appointments_set', label: 'Appointments set', dashboard: D, grain: 'booking', kind: KIND.COUNT,
    dateBasis: 'Booking.createdAt (the day it was set)',
    numerator: 'Bookings set in the range, each booking once (app/lib/reporting/appointmentAttribution.js).',
    denominator: null, inclusions: 'Every booking status, cancelled included (it was set that day).',
    exclusions: 'Duplicate bookings (same lead, day and time, not cancelled: the lowest id counts).',
    source: ['bookings', 'leads'], filters: BOOKING_FILTERS, breakdowns: ['creator', 'department', 'lead_source'],
    trend: true, columns: BOOKING_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await shared.apptSetRows(args, ctx) }),
  },
  {
    id: 'exec.appointments_scheduled', label: 'Appointments scheduled for these dates', dashboard: D, grain: 'booking',
    kind: KIND.COUNT, dateBasis: 'Booking.bookingDate (the appointment day)',
    numerator: 'Bookings whose appointment day is in the range, not cancelled.', denominator: null,
    inclusions: 'pending, confirmed, completed.', exclusions: 'Cancelled bookings; duplicates.',
    source: ['bookings'], filters: BOOKING_FILTERS, breakdowns: ['creator', 'department'], columns: BOOKING_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await shared.apptScheduledRows(args, ctx) }),
  },
  {
    id: 'exec.shown', label: 'Shown (recorded)', dashboard: D, grain: 'booking', kind: KIND.COUNT,
    dateBasis: 'Booking.bookingDate (the appointment day)',
    numerator: SHOWN_TEXT, denominator: null,
    inclusions: 'pending, confirmed, completed bookings whose appointment day is in the range.',
    exclusions: 'Cancelled bookings; duplicates (same lead, day and time: counted once).',
    basedOn: SHOWN_BASIS,
    source: ['bookings', 'leads'], filters: BOOKING_FILTERS, breakdowns: ['creator', 'department'], columns: BOOKING_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await shared.shownRows(args, ctx) }),
  },
  {
    id: 'exec.show_rate', label: 'Show rate (recorded)', dashboard: D, grain: 'booking', kind: KIND.RATE, unit: '%',
    dateBasis: 'Booking.bookingDate (the appointment day) and Booking.bookingTime, dealer time zone',
    numerator: 'Recorded shows (exec.shown).', denominator: SHOW_RATE_DENOMINATOR,
    denominatorLabel: 'past appointments', inclusions: 'Appointments scheduled in the range whose time has passed, or '
      + 'already marked shown / no-show.',
    exclusions: 'Cancelled bookings; appointments still ahead (future); duplicates.',
    basedOn: SHOWN_BASIS,
    source: ['bookings', 'leads'], filters: BOOKING_FILTERS, columns: BOOKING_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await shared.shownRows(args, ctx),
      denominatorRows: await shared.dueRows(args, ctx) }),
  },
  {
    id: 'exec.crm_sold', label: 'CRM sold', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: 'ActivityLog.at of the first status change to Sold Pending / Sold Delivered (or legacy "Sold")',
    numerator: 'Leads whose first change to a sold status happened in the range.', denominator: null,
    inclusions: 'Staff status changes (ActivityLog action status_changed); any spelling of the sold statuses '
      + '(app/lib/reporting/normalize.js).',
    exclusions: 'A lead sold again later is counted once, on its first sold day. Status changes made before activity '
      + 'logging existed are not in the log.',
    source: ['activitylogs', 'leads'], filters: LEAD_FILTERS, breakdowns: ['lead_source', 'staff'], trend: true,
    columns: [...LEAD_COLUMNS, ['changed_at', 'Sold on']],
    evaluate: async (args, ctx) => ({ rows: await shared.soldRows(args, ctx) }),
  },
  {
    id: 'exec.lead_to_appt', label: 'Lead to appointment', dashboard: D, grain: 'lead', kind: KIND.RATE, unit: '%',
    dateBasis: 'Lead.createdAt (cohort: leads received in the range)',
    numerator: 'Leads received in the range that have at least one booking that is not cancelled (any booking date, '
      + 'up to now).',
    denominator: 'Leads received in the range.',
    inclusions: 'Bookings of any creator.', exclusions: 'Cancelled bookings.',
    source: ['leads', 'bookings'], filters: LEAD_FILTERS, breakdowns: ['lead_source', 'staff'], columns: LEAD_COLUMNS,
    evaluate: async (args, ctx) => {
      const cohort = await shared.leadsReceivedRows(args, ctx);
      const ids = cohort.map((r) => r.id);
      const booked = ids.length ? await collection('bookings').distinct('lead_id', {
        dealer_id: { $in: dealerForms(args.dealerId) }, lead_id: { $in: ids }, booking_status: { $ne: 'cancelled' } })
        : [];
      const set = new Set(booked.map(String));
      return { rows: cohort.filter((r) => set.has(r.id)), denominatorRows: cohort };
    },
  },
  {
    id: 'exec.lead_to_sold', label: 'Lead to CRM sold', dashboard: D, grain: 'lead', kind: KIND.RATE, unit: '%',
    dateBasis: 'Lead.createdAt (cohort: leads received in the range)',
    numerator: 'Leads received in the range that reached Sold Pending / Sold Delivered (a logged status change on any '
      + 'date, or the current status).',
    denominator: 'Leads received in the range.', inclusions: 'Any spelling of the sold statuses.',
    exclusions: 'DMS deals (not linked to leads yet).',
    source: ['leads', 'activitylogs'], filters: LEAD_FILTERS, breakdowns: ['lead_source', 'staff'],
    columns: LEAD_COLUMNS,
    evaluate: async (args, ctx) => {
      const cohort = await shared.leadsReceivedRows(args, ctx);
      const ids = cohort.map((r) => r.id);
      const logged = ids.length ? await collection('activitylogs').distinct('lead_id', {
        dealer_id: { $in: dealerForms(args.dealerId) }, action: 'status_changed', to: SOLD_REGEX,
        lead_id: { $in: ids.map(oid) } }) : [];
      const set = new Set(logged.map(String));
      return { rows: cohort.filter((r) => set.has(r.id) || SOLD_REGEX.test(r.status || '')), denominatorRows: cohort };
    },
  },
  notYet(STATE.NEEDS_DATA, {
    id: 'exec.dms_delivered', label: 'Delivered (DMS)', dashboard: D, grain: 'deal',
    dateBasis: 'Deal "Delivery Date"', numerator: 'DMS deals delivered in the range.', denominator: null,
    exclusions: 'Void / unwound deals (client to confirm which "Deal Status" values).', source: ['deals'],
    reason: 'DMS dates are stored as M/D/YYYY text ("Delivery Date"); a parsed date field must be written at import '
      + 'before they can be counted by range.',
  }),
  notYet(STATE.NEEDS_DATA, {
    id: 'exec.service_visits', label: 'Service visits (ROs)', dashboard: D, grain: 'repair_order',
    dateBasis: 'RepairOrder "Close Date"', numerator: 'Repair orders closed in the range.', denominator: null,
    exclusions: 'RO types to exclude: client to confirm (customer-pay / warranty / internal).',
    source: ['repairorders'],
    reason: 'RO dates are stored as text ("Open Date" / "Close Date"); a parsed date field is needed.',
  }),
  notYet(STATE.BLOCKED, {
    id: 'exec.by_rooftop', label: 'By-rooftop comparison', dashboard: D, grain: 'dealer',
    dateBasis: 'per KPI', numerator: 'The executive KPIs per rooftop.', denominator: null,
    exclusions: 'n/a', source: [],
    reason: 'No cross-rooftop views (decision 9 Nov 2026): every report is for one dealer.',
  }),
];
