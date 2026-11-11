#!/usr/bin/env node
// Reports reconciliation (read-only): checks every number of the admin Reports page against the Dashboard and against
// plain database counts, for one dealer and a range of dealer-local days.
//
// For every KPI in the registry (app/lib/reporting/registry.js, kpis/*) it prints one line:
//   status, KPI id, label, Reports value (rates: numerator / denominator), the definition's source tables, and where
//   one exists:
//     dash=   the Dashboard's number, from the same library functions the Dashboard calls
//             (app/api/leads/stats/route.js, app/api/leads/message-activity/route.js: appointmentFunnel,
//             repliedLeadIds, the lead count, messageActivity),
//     raw=    an independent count of the KPI's written definition, from plain driver queries in THIS file (section
//             "raw counts" below). It never calls the KPI code; it only shares the status / source vocabulary tables
//             (app/lib/reporting/normalize.js), the booking-time parser (app/lib/bookingService.js parseTimeOfDay) and
//             the Dashboard's "came" statuses (app/lib/appointmentFunnel.js CAME_STATUSES). Rates: numerator and
//             denominator; medians: the count and the median.
//     drill=  the distinct leads the Leads list shows for ?report_kpi=<id> (drillLeads.js reportKpiLeads, as
//             app/api/leads/route.js does).
//   OK          every comparable value equals the Reports value
//   DIFF        at least one differs: the difference and the known reason are shown
//   NO-COMPARE  nothing to compare against (a one-line reason is printed)
//   BLOCKED     the KPI is not live (blocked / needs data): it has no number
// Some KPIs also print indented "why" lines: an item-by-item account of a difference with the Dashboard (inbound
// messages) or with another screen (missed call tasks), so no difference is unexplained (SOW 8 acceptance).
//
// Usage:
//   node scripts/reports-reconcile.js --uri "<mongodb uri>" --dealer <dealer_id> --from YYYY-MM-DD --to YYYY-MM-DD
//     [--allow-remote]      needed for any host other than localhost / 127.0.0.1 / ::1
//
// Never writes: indexes and collections are not created (autoIndex / autoCreate off), reads go to a secondary when
// there is one, and every driver write method throws while the check runs.
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import { pathToFileURL } from 'node:url';
import { isLocalUri } from './normalize-legacy-statuses.js';

mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const { getDealerTimezone, isValidLocalDate, localDayRange } = await import('../app/lib/reporting/time.js');
const { evaluateKpi, isLeadLinked, listKpis } = await import('../app/lib/reporting/registry.js');
const { REPORTS, parseFilterSpec } = await import('../app/lib/reporting/filters.js');
const { reportKpiLeads } = await import('../app/lib/reporting/drillLeads.js');
const { GOVERNED_STATUSES, statusRegexFor } = await import('../app/lib/reporting/normalize.js');
const { parseTimeOfDay } = await import('../app/lib/bookingService.js');
const { appointmentFunnel, CAME_STATUSES } = await import('../app/lib/appointmentFunnel.js');
const { repliedLeadIds, messageActivity } = await import('../app/lib/contactedLeads.js');
const { default: Lead } = await import('../app/models/Lead.js');

const USAGE = 'Usage: node scripts/reports-reconcile.js --uri "<mongodb uri>" --dealer <dealer_id> --from YYYY-MM-DD '
  + '--to YYYY-MM-DD [--allow-remote]';

// ---- read-only guard ---------------------------------------------------------------------------------------------
const WRITES = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
  'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'bulkWrite', 'createIndex', 'createIndexes',
  'dropIndex', 'dropIndexes', 'drop', 'rename'];
const DB_WRITES = ['createCollection', 'dropCollection', 'dropDatabase', 'renameCollection'];

function blockWrites() {
  const saved = [];
  const block = (proto, names) => {
    for (const name of names) {
      if (typeof proto[name] !== 'function') continue;
      saved.push([proto, name, proto[name]]);
      proto[name] = function readOnly() { throw new Error(`reports-reconcile is read-only: ${name} refused`); };
    }
  };
  block(mongoose.mongo.Collection.prototype, WRITES);
  block(mongoose.mongo.Db.prototype, DB_WRITES);
  return () => { for (const [proto, name, fn] of saved) proto[name] = fn; };
}

// ---- what each KPI is compared with on the Dashboard -------------------------------------------------------------
// dash: key of the Dashboard numbers below. note: why a difference with the Dashboard is expected.
const DEDUP = 'Reports (and raw) count duplicate bookings (same lead, day and time, not cancelled) once; the Dashboard '
  + 'counts each.';
const PUBLIC_PAGE = 'The Dashboard counts public booking page bookings (created_by customer) as AI; Reports puts them '
  + 'under Unknown (SOW 8A, owner 9 Nov 2026). ';
const DASH = {
  'leads.received': { dash: 'leads' },
  'exec.leads_received': { dash: 'leads' },
  'source.leads': { dash: 'leads' },
  'appt.made': { dash: 'made' },
  'appt.attr.total': { dash: 'made', note: DEDUP },
  'exec.appointments_set': { dash: 'made', note: DEDUP },
  'appointments.set': { dash: 'made', note: DEDUP },
  'source.appointments': { dash: 'made', note: DEDUP },
  'bdc.appointments_by_owner': { dash: 'made', note: DEDUP },
  'appt.scheduled': { dash: 'scheduled' },
  'exec.appointments_scheduled': { dash: 'scheduled', note: DEDUP },
  'appointments.scheduled': { dash: 'scheduled', note: DEDUP },
  'appt.shown': { dash: 'shown' },
  'exec.shown': { dash: 'shown', note: DEDUP },
  'appointments.shown': { dash: 'shown', note: DEDUP },
  'source.shown': { dash: 'shown', note: DEDUP },
  'exec.show_rate': { dash: 'shown', note: DEDUP },
  'appointments.show_rate': { dash: 'shown', note: DEDUP },
  'appt.attr.ai': { dash: 'made_ai', note: PUBLIC_PAGE + DEDUP },
  'appointments.by_ai': { dash: 'made_ai', note: PUBLIC_PAGE + DEDUP },
  'ai.appointments_ai': { dash: 'made_ai', note: PUBLIC_PAGE + DEDUP },
  'replies.leads_replied': { dash: 'replied_leads' },
  'source.replied_leads': { dash: 'replied_leads', note: 'Reports selects the messages by emails.dealer_id and leaves '
    + 'out message_id "lead-..." / arrival rows; the Dashboard selects by the dealer\'s lead ids (see the why lines of '
    + 'replies.inbound_messages).' },
  'exec.customers_replied': { dash: 'replied_leads', note: 'Reports counts customers (several leads of one customer '
    + 'are one; a message with no lead is keyed by its sender); the Dashboard card counts leads.' },
  'ai.messages_sent': { dash: 'ai_sent', note: 'Reports selects messages by emails.dealer_id, the Dashboard by the '
    + 'dealer\'s lead ids; Reports also leaves out drafts and ADF bodies.' },
  'replies.inbound_messages': { dash: 'received', note: 'Same population (the dealer\'s leads); Reports leaves out '
    + 'more. Item by item in the why lines.' },
  'dq.failed_sends': { dash: 'failed', note: 'Reports selects messages by emails.dealer_id, the Dashboard by the '
    + 'dealer\'s lead ids.' },
};

// A KPI whose raw count is not equal to its Reports value by design: why.
const FORMS = 'raw matches dealer_id stored as a string or an ObjectId; this older Dashboard-rule KPI only the string '
  + '(rows with an ObjectId dealer_id were written by raw inserts).';
const RAW_NOTE = { 'leads.received': FORMS, 'appt.made': FORMS, 'appt.scheduled': FORMS, 'appt.shown': FORMS };

// The Dashboard's numbers: the same calls app/api/leads/stats/route.js and message-activity/route.js make.
async function dashboardNumbers(dealerId, start, end) {
  const dealer_id = String(dealerId);
  const leads = await Lead.countDocuments({ dealer_id, createdAt: { $gte: start, $lte: end } });
  const funnel = await appointmentFunnel({ dealerId: dealer_id, start, end });
  const allLeads = await Lead.find({ dealer_id }).select('_id createdAt').lean();
  const ids = allLeads.map((l) => l._id);
  const replied = await repliedLeadIds(ids, start, end);
  const activity = await messageActivity(ids, start, end);
  return { leads, made: funnel.made.total, made_ai: funnel.made.ai, scheduled: funnel.scheduled.total,
    shown: funnel.showed.total, replied_leads: replied.length, ai_sent: activity.sent.ai,
    received: activity.received.total, failed: activity.sent.failed };
}

// ---- raw counts --------------------------------------------------------------------------------------------------
// Each KPI's written definition (the Definitions tab), counted again from plain driver queries. Written apart from
// the KPI code on purpose: the same answer from two implementations is the check.
const INBOUND = ['received', 'incoming'];
const ADF = /<\?adf|<adf[\s>]/i;
const FAILED = ['failed', 'undelivered', 'bounced', 'error'];
const AI_SENT = ['sent', 'delivered'];
// agentic-upsell agent/escalation.py MANAGER_ESCALATIONS (the AI service's own list; read, not changed).
const MANAGER_PREFIXES = ['Customer is clearly upset', 'The customer is confused or frustrated',
  'Declined a visit more than once', 'Customer asked for a person', 'Customer asked for a call',
  'Customer asked for a text from a person', "Customer asked for something the AI can't supply", 'AI stuck in a loop',
  "Customer says they're not interested any more"];
const SOLD_RE = statusRegexFor(['SOLD_PENDING', 'SOLD_DELIVERED', 'SOLD_UNSPECIFIED']);
const HEX24 = /^[0-9a-f]{24}$/i;
const str = (v) => (v == null ? '' : String(v));
const toOid = (id) => new mongoose.Types.ObjectId(String(id));
const isOutbound = (m) => !INBOUND.includes(m.status) && !['note', 'draft'].includes(m.status) && m.is_note !== true
  && m.is_lead_email !== true && m.communication_type !== 'note'
  && !(typeof m.mail_content === 'string' && ADF.test(m.mail_content));
const medianOf = (values) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

async function rawCounts(db, { dealerId, start, end, tz, now }) {
  const d = String(dealerId);
  const forms = HEX24.test(d) ? [d, toOid(d)] : [d];
  const inRange = (at) => at && new Date(at) >= start && new Date(at) <= end;
  const range = { $gte: start, $lte: end };
  const col = (name) => db.collection(name);
  const leadById = new Map();
  const loadLeads = async (ids) => {
    const want = [...new Set(ids.map(str).filter((id) => HEX24.test(id) && !leadById.has(id)))];
    if (!want.length) return;
    for (const l of await col('leads').find({ _id: { $in: want.map(toOid) } }).toArray()) leadById.set(String(l._id), l);
    for (const id of want) if (!leadById.has(id)) leadById.set(id, null);
  };
  const ownLead = (id) => { const l = leadById.get(str(id)); return l && str(l.dealer_id) === d ? l : null; };
  const R = {};

  // Leads received.
  const cohort = await col('leads').find({ dealer_id: { $in: forms }, createdAt: range }).toArray();
  for (const l of cohort) leadById.set(String(l._id), l);
  const cohortIds = cohort.map((l) => String(l._id));
  R['leads.received'] = R['exec.leads_received'] = R['source.leads'] = cohort.length;
  R['bdc.assigned_leads'] = cohort.filter((l) => l.assigned_to).length;
  R['bdc.unassigned_leads'] = cohort.filter((l) => !l.assigned_to).length;
  R['dq.leads_no_customer'] = cohort.filter((l) => !l.customer_id).length;
  R['dq.unmapped_source'] = cohort.filter((l) => l.lead_source == null || /^\s*(unknown)?\s*$/i.test(str(l.lead_source)))
    .length;
  R['dq.legacy_status'] = cohort.filter((l) => !GOVERNED_STATUSES.includes(l.fe_lead_status)).length;
  R['source.campaign_leads'] = cohort.filter((l) => /^campaign_/i.test(str(l.lead_source))).length;
  const custIds = [...new Set(cohort.map((l) => str(l.customer_id)).filter((id) => HEX24.test(id)))];
  const custDocs = custIds.length ? await col('customers').find({ _id: { $in: custIds.map(toOid) } }).toArray() : [];
  const mergedInto = new Map(custDocs.map((c) => [String(c._id), c.merged_into ? String(c.merged_into) : null]));
  R['exec.unique_customers'] = new Set(cohort.filter((l) => l.customer_id)
    .map((l) => mergedInto.get(str(l.customer_id)) || str(l.customer_id))).size;

  // Bookings: created in the range / scheduled for it, each (lead, day, time) of the active ones once (lowest _id).
  const created = await col('bookings').find({ dealer_id: { $in: forms }, createdAt: range }).toArray();
  const scheduled = await col('bookings').find({ dealer_id: { $in: forms }, bookingDate: range,
    booking_status: { $ne: 'cancelled' } }).toArray();
  const bookingLeads = [...new Set([...created, ...scheduled].map((b) => str(b.lead_id)))];
  const active = bookingLeads.length ? await col('bookings').find({ dealer_id: { $in: forms },
    lead_id: { $in: bookingLeads }, booking_status: { $ne: 'cancelled' } }).toArray() : [];
  const keptOf = new Map();
  for (const b of active.sort((x, y) => String(x._id).localeCompare(String(y._id)))) {
    const k = `${str(b.lead_id)}|${b.bookingDate ? new Date(b.bookingDate).toISOString() : ''}|${b.bookingTime || ''}`;
    if (!keptOf.has(k)) keptOf.set(k, String(b._id));
    else keptOf.set(`dup:${b._id}`, true);
  }
  const isDup = (b) => keptOf.has(`dup:${b._id}`);
  const made = created.filter((b) => !isDup(b));
  const sched = scheduled.filter((b) => !isDup(b));
  await loadLeads([...made, ...sched].map((b) => b.lead_id));
  R['dq.duplicate_bookings'] = created.filter(isDup).length;
  // Who made it (SOW 8A, owner 9 Nov 2026): ai; customer / missing -> unknown; staff on a gone lead -> unknown;
  // staff after an AI message that went out on the same lead -> AI-assisted; else human only.
  const staffLeads = [...new Set(made.filter((b) => b.created_by === 'staff' && ownLead(b.lead_id))
    .map((b) => str(b.lead_id)))];
  const firstAi = new Map();
  if (staffLeads.length) {
    const msgs = await col('emails').find({ lead_id: { $in: staffLeads.map(toOid) }, ai_generated: true,
      communication_type: { $in: ['sms', 'email'] }, status: { $in: AI_SENT } }).toArray();
    for (const m of msgs) {
      if (m.is_note === true) continue;
      const k = str(m.lead_id);
      if (!firstAi.has(k) || new Date(m.timestamp) < firstAi.get(k)) firstAi.set(k, new Date(m.timestamp));
    }
  }
  const madeBy = (b) => {
    if (b.created_by === 'ai') return 'ai';
    if (b.created_by !== 'staff' || !ownLead(b.lead_id)) return 'unknown';
    const ai = firstAi.get(str(b.lead_id));
    return ai && b.createdAt && ai < new Date(b.createdAt) ? 'ai_assisted' : 'human_only';
  };
  const by = (cat) => made.filter((b) => madeBy(b) === cat).length;
  // appt.made / appt.scheduled / appt.shown are the old Dashboard rule: every booking, duplicates included.
  R['appt.made'] = created.length;
  R['appt.attr.total'] = R['exec.appointments_set'] = R['appointments.set'] = made.length;
  R['source.appointments'] = R['bdc.appointments_by_owner'] = made.length;
  R['appt.attr.ai'] = R['appointments.by_ai'] = R['ai.appointments_ai'] = by('ai');
  R['appt.attr.ai_assisted'] = R['appointments.ai_assisted'] = R['ai.appointments_assisted'] = by('ai_assisted');
  R['appt.attr.human_only'] = R['appointments.human_only'] = by('human_only');
  R['appt.attr.unknown'] = R['appointments.unknown_creator'] = by('unknown');
  R['appt.attr.ai_influenced'] = R['appointments.ai_influenced'] = by('ai') + by('ai_assisted');
  R['appointments.confirmed'] = made.filter((b) => b.booking_status === 'confirmed').length;
  R['appointments.cancelled'] = made.filter((b) => b.booking_status === 'cancelled').length;
  R['appointments.service'] = R['service.appointments_set'] = made.filter((b) => b.appointment_type === 'service')
    .length;
  R['appointments.sales'] = made.filter((b) => b.appointment_type !== 'service').length;
  // Outcomes of the scheduled ones: recorded show / marked no-show / past with no outcome / still ahead.
  const startsAt = (b) => {
    const dayLocal = moment(b.bookingDate).tz(tz).format('YYYY-MM-DD');
    const minutes = parseTimeOfDay(b.bookingTime);
    const local = moment.tz(dayLocal, 'YYYY-MM-DD', tz);
    return (minutes == null ? local.endOf('day') : local.add(minutes, 'minutes')).toDate();
  };
  const outcome = (b) => {
    const lead = leadById.get(str(b.lead_id));
    if (b.showed === true || b.booking_status === 'completed' || CAME_STATUSES.includes(lead?.fe_lead_status)) {
      return 'shown';
    }
    if (b.showed === false) return 'no_show';
    return b.bookingDate && startsAt(b) <= now ? 'not_recorded' : 'upcoming';
  };
  await loadLeads(scheduled.map((b) => b.lead_id));
  const out = (o) => sched.filter((b) => outcome(b) === o).length;
  R['appt.scheduled'] = scheduled.length;
  R['appt.shown'] = scheduled.filter((b) => outcome(b) === 'shown').length;
  R['exec.appointments_scheduled'] = R['appointments.scheduled'] = sched.length;
  R['exec.shown'] = R['appointments.shown'] = R['source.shown'] = out('shown');
  R['appointments.no_show'] = out('no_show');
  R['appointments.not_recorded'] = out('not_recorded');
  R['appointments.upcoming'] = out('upcoming');
  R['exec.show_rate'] = R['appointments.show_rate'] = { num: out('shown'),
    den: out('shown') + out('no_show') + out('not_recorded') };
  const bookedLeads = new Set((cohortIds.length ? await col('bookings').distinct('lead_id', { dealer_id: { $in: forms },
    lead_id: { $in: cohortIds }, booking_status: { $ne: 'cancelled' } }) : []).map(str));
  R['exec.lead_to_appt'] = { num: cohortIds.filter((id) => bookedLeads.has(id)).length, den: cohort.length };

  // Status changes (ActivityLog): leads whose FIRST change into the status falls in the range.
  const logs = await col('activitylogs').find({ dealer_id: { $in: forms }, action: 'status_changed',
    lead_id: { $ne: null } }, { projection: { lead_id: 1, to: 1, at: 1 } }).toArray();
  await loadLeads(logs.map((l) => l.lead_id));
  const firstInto = (re) => {
    const first = new Map();
    for (const l of logs) {
      if (!re.test(str(l.to))) continue;
      const k = str(l.lead_id);
      if (!first.has(k) || new Date(l.at) < first.get(k)) first.set(k, new Date(l.at));
    }
    return [...first.entries()].filter(([k, at]) => inRange(at) && leadById.get(k)).length;
  };
  R['exec.crm_sold'] = R['source.crm_sold'] = firstInto(SOLD_RE);
  R['sales.proxy_visits'] = firstInto(statusRegexFor(['VISITED']));
  R['sales.proxy_unsold'] = firstInto(statusRegexFor(['UNSOLD']));
  R['sales.proxy_sold_pending'] = firstInto(statusRegexFor(['SOLD_PENDING']));
  R['sales.proxy_sold_delivered'] = firstInto(statusRegexFor(['SOLD_DELIVERED']));
  // Desk Log visits: checked in during the range, on a lead that still exists. "Reached" a stage = it is the current
  // stage or a stage change went to it.
  const desk = await col('desklogentries').find({ dealer_id: { $in: forms }, checked_in_at: { $gte: start, $lte: end } })
    .toArray();
  await loadLeads(desk.map((v) => v.lead_id));
  const visits = desk.filter((v) => leadById.get(str(v.lead_id)));
  const reachedAt = (v, stage) => {
    const times = (v.history || []).filter((h) => h.field === 'stage' && h.to === stage).map((h) => new Date(h.at));
    if (v.stage === stage) times.push(new Date(v.stage_at || v.checked_in_at));
    return times.length ? Math.min(...times) : null;
  };
  R['sales.showroom_visits'] = visits.length;
  R['sales.to_rate'] = { num: visits.filter((v) => reachedAt(v, 'T.O.') != null).length, den: visits.length };
  const appraised = visits.filter((v) => reachedAt(v, 'APPRAISAL') != null);
  R['sales.appraisals'] = appraised.length;
  R['sales.appraisal_to_proposal'] = { num: appraised.filter((v) => reachedAt(v, 'PROPOSAL') != null
    && reachedAt(v, 'PROPOSAL') >= reachedAt(v, 'APPRAISAL')).length, den: appraised.length };
  R['sales.unsold_reasons'] = visits.filter((v) => v.outcome === 'UNSOLD').length;
  R['sales.pending_delivered'] = visits.filter((v) => ['SOLD PENDING', 'SOLD DELIVERED'].includes(v.outcome)).length;

  const soldEver = new Set(logs.filter((l) => SOLD_RE.test(str(l.to))).map((l) => str(l.lead_id)));
  R['exec.lead_to_sold'] = { num: cohort.filter((l) => soldEver.has(String(l._id)) || SOLD_RE.test(str(l.fe_lead_status)))
    .length, den: cohort.length };

  // Customer messages. One query for every inbound row of the window that either screen could count: the dealer's
  // own (emails.dealer_id) or on one of its leads (the Dashboard's selection). Then each screen's rule in plain JS.
  const dealerLeadIds = (await col('leads').find({ dealer_id: d }, { projection: { _id: 1 } }).toArray())
    .map((l) => l._id);
  const inbound = await col('emails').find({ status: { $in: INBOUND }, timestamp: range,
    $or: [{ dealer_id: { $in: forms } }, { lead_id: { $in: dealerLeadIds } }] }).toArray();
  await loadLeads(inbound.map((m) => m.lead_id));
  const dealerLeadSet = new Set(dealerLeadIds.map(String));
  const isAdf = (m) => typeof m.mail_content === 'string' && ADF.test(m.mail_content);
  const arrival = (m) => {
    if (m.status !== 'incoming' || m.parent_message_id !== null || m.parent_conversation !== null) return false;
    const lead = leadById.get(str(m.lead_id));
    if (!lead?.createdAt || !m.timestamp) return false;
    const gap = new Date(m.timestamp) - new Date(lead.createdAt);
    return gap >= -1000 && gap <= 30000;
  };
  const leadPrefix = (m) => /^lead-/.test(str(m.message_id));
  // The Dashboard's Messages card "received" (contactedLeads.js messageActivity): lead_id (an ObjectId) is one of the
  // dealer's leads; not a note, not the portal lead email, not an ADF body.
  const dashRow = (m) => m.lead_id?._bsontype === 'ObjectId' && dealerLeadSet.has(String(m.lead_id))
    && m.is_note !== true && m.status !== 'note' && m.is_lead_email !== true && !isAdf(m);
  // Reports' qualifying reply (SOW 8B): the dealer's message, not a note / lead email / ADF / "lead-" / arrival row.
  const replyRow = (m) => forms.some((f) => str(f) === str(m.dealer_id)) && m.is_note !== true
    && m.is_lead_email !== true && m.communication_type !== 'note' && !leadPrefix(m) && !isAdf(m) && !arrival(m);
  const replies = inbound.filter(replyRow);
  const linked = replies.filter((m) => ownLead(m.lead_id));
  const dashRows = inbound.filter(dashRow);
  R['replies.inbound_messages'] = linked.length;
  R['replies.unlinked_messages'] = replies.length - linked.length;
  R['replies.leads_replied'] = new Set(dashRows.filter((m) => !leadPrefix(m) && !arrival(m)).map((m) => str(m.lead_id)))
    .size;
  R['source.replied_leads'] = new Set(linked.map((m) => str(m.lead_id))).size;
  // Item by item: why the Dashboard's received count and Reports' differ.
  const linkedIds = new Set(linked.map((m) => String(m._id)));
  const dashIds = new Set(dashRows.map((m) => String(m._id)));
  const tally = (rows, reasonOf) => {
    const t = new Map();
    for (const m of rows) { const k = reasonOf(m); t.set(k, (t.get(k) || 0) + 1); }
    return [...t.entries()].sort((a, b) => b[1] - a[1]);
  };
  const why = [];
  const onlyDash = dashRows.filter((m) => !linkedIds.has(String(m._id)));
  const onlyReports = linked.filter((m) => !dashIds.has(String(m._id)));
  why.push(`Dashboard "received" ${dashRows.length} = Reports ${linked.length} + ${onlyDash.length} the Dashboard `
    + `counts and Reports leaves out - ${onlyReports.length} Reports counts and the Dashboard can't see:`);
  for (const [k, n] of tally(onlyDash, (m) => {
    if (!forms.some((f) => str(f) === str(m.dealer_id))) return 'emails.dealer_id is not this dealer (or missing)';
    if (leadPrefix(m)) return 'message_id "lead-..." (the lead\'s own arrival, AI dealers)';
    if (arrival(m)) return 'the non-AI lead arrival row (contactedLeads.js isLeadArrivalRow)';
    if (m.communication_type === 'note') return 'communication_type "note" (a note not flagged is_note)';
    return 'other';
  })) why.push(`  - ${n} ${k}`);
  for (const [k, n] of tally(onlyReports, (m) => (typeof m.lead_id === 'string'
    ? 'lead_id stored as a string (the Dashboard matches ObjectIds only)' : 'other'))) why.push(`  + ${n} ${k}`);
  why.push(`Not in either number (Reports "Inbound messages not on one of the dealer's leads", customer-days in needs `
    + `review): ${replies.length - linked.length}`);
  for (const [k, n] of tally(replies.filter((m) => !ownLead(m.lead_id)), (m) => {
    if (!m.lead_id) return 'no lead_id';
    if (!leadById.get(str(m.lead_id))) return 'lead_id is not a lead (deleted / never existed)';
    return 'a lead of another dealer';
  })) why.push(`    ${n} ${k}`);
  const ignored = inbound.filter((m) => forms.some((f) => str(f) === str(m.dealer_id)) && !replyRow(m));
  why.push(`The dealer's inbound rows that are not replies at all: ${ignored.length}`);
  for (const [k, n] of tally(ignored, (m) => {
    if (m.is_note === true || m.communication_type === 'note') return 'notes';
    if (m.is_lead_email === true) return 'portal lead email (is_lead_email)';
    if (isAdf(m)) return 'ADF lead body';
    if (leadPrefix(m)) return 'message_id "lead-..."';
    return 'lead arrival row';
  })) why.push(`    ${n} ${k}`);
  const WHY = { 'replies.inbound_messages': why };

  // Customer-days and distinct customers (SOW 8B, the owner's 9 Nov / 10 Nov rules), computed again here.
  const custOfLead = new Map();
  const replyLeadCust = [...new Set(replies.map((m) => str(leadById.get(str(m.lead_id))?.customer_id))
    .filter((id) => HEX24.test(id)))];
  for (const c of replyLeadCust.length ? await col('customers').find({ _id: { $in: replyLeadCust.map(toOid) } },
    { projection: { merged_into: 1 } }).toArray() : []) custOfLead.set(String(c._id), c.merged_into ? str(c.merged_into) : null);
  const localDay = (at) => moment(at).tz(tz).format('YYYY-MM-DD');
  const units = new Map();
  for (const m of replies) {
    const lead = leadById.get(str(m.lead_id));
    let key;
    let group;
    if (!m.lead_id) {
      const s = str(m.sender).trim().toLowerCase();
      const digits = s.replace(/\D/g, '');
      key = !s ? 'sender:unknown' : s.includes('@') ? `sender:${s}`
        : `sender:${digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits || s}`;
      group = 'review';
    } else if (!lead) {
      key = `lead:${m.lead_id}`;
      group = 'review';
    } else {
      key = (lead.customer_id && custOfLead.get(str(lead.customer_id))) || (lead.customer_id ? str(lead.customer_id)
        : `lead:${lead._id}`);
      const age = lead.createdAt ? moment.utc(localDay(m.timestamp)).diff(moment.utc(localDay(lead.createdAt)), 'days')
        : -1;
      if (str(lead.dealer_id) !== d || age < 0) group = 'review';
      else if (age === 0) group = '0';
      else if (age <= 6) group = '1-6';
      else if (age <= 14) group = '7-14';
      else if (age <= 29) group = '15-29';
      else if (age <= 59) group = '30-59';
      else if (age <= 90) group = '60-90';
      else group = '91+';
    }
    const uk = `${key}|${localDay(m.timestamp)}`;
    if (!units.has(uk)) units.set(uk, { key, groups: new Set() });
    units.get(uk).groups.add(group);
  }
  const unitGroups = [...units.values()].map((u) => (u.groups.size === 1 ? [...u.groups][0] : 'review'));
  const g = (...names) => unitGroups.filter((x) => names.includes(x)).length;
  R['replies.customers'] = unitGroups.length;
  R['replies.todays_leads'] = g('0');
  R['replies.past_leads'] = g('1-6', '7-14', '15-29', '30-59', '60-90', '91+');
  R['replies.needs_review'] = g('review');
  R['replies.age_7_plus'] = g('7-14', '15-29', '30-59', '60-90', '91+');
  R['replies.age_15_plus'] = g('15-29', '30-59', '60-90', '91+');
  R['replies.age_30_plus'] = g('30-59', '60-90', '91+');
  R['replies.age_60_plus'] = g('60-90', '91+');
  R['replies.age_60_90'] = g('60-90');
  R['replies.age_over_90'] = g('91+');
  R['replies.distinct_customers'] = R['exec.customers_replied'] = new Set([...units.values()].map((u) => u.key)).size;

  // AI response time: replies whose first answer that went out (sent / delivered; before the next customer message and
  // the end of the reply's local day + 24 h) was AI-written, timed to the first AI message at or after the reply.
  const answeredLeads = [...new Set(replies.filter((m) => m.lead_id).map((m) => str(m.lead_id)))]
    .filter((id) => HEX24.test(id));
  const minAt = replies.length ? new Date(Math.min(...replies.map((m) => new Date(m.timestamp).getTime()))) : null;
  const convo = answeredLeads.length ? await col('emails').find({ lead_id: { $in: answeredLeads.map(toOid) },
    timestamp: { $gte: minAt } }).toArray() : [];
  const byLead = new Map();
  for (const m of convo.sort((a, b) => (new Date(a.timestamp) - new Date(b.timestamp))
    || String(a._id).localeCompare(String(b._id)))) {
    if (!byLead.has(str(m.lead_id))) byLead.set(str(m.lead_id), []);
    byLead.get(str(m.lead_id)).push(m);
  }
  const minutes = [];
  for (const r of replies.filter((m) => m.lead_id)) {
    const list = byLead.get(str(r.lead_id)) || [];
    const t0 = new Date(r.timestamp);
    const cap = moment(t0).tz(tz).endOf('day').add(24, 'hours').toDate();
    let aiAnswered = false;
    for (const m of list) {
      const t = new Date(m.timestamp);
      if (String(m._id) === String(r._id)) continue;
      if (t < t0 || (t.getTime() === t0.getTime() && String(m._id) < String(r._id))) continue;
      if (t > cap || INBOUND.includes(m.status)) break;
      if (m.is_note === true || m.communication_type === 'note' || ['note', 'draft'].includes(m.status)) continue;
      if (!AI_SENT.includes(m.status)) continue;
      aiAnswered = m.ai_generated === true;
      break;
    }
    if (!aiAnswered) continue;
    const next = list.find((m) => m.ai_generated === true && isOutbound(m) && new Date(m.timestamp) >= t0);
    if (next) minutes.push(Math.round((new Date(next.timestamp) - t0) / 6000) / 10);
  }
  R['ai.response_time'] = { count: minutes.length, value: medianOf(minutes) };

  // Outbound messages of the dealer in the range.
  const outbound = (await col('emails').find({ dealer_id: { $in: forms }, timestamp: range,
    status: { $nin: [...INBOUND, 'note', 'draft'] } }).toArray()).filter(isOutbound);
  const aiOut = outbound.filter((m) => m.ai_generated === true);
  await loadLeads(aiOut.map((m) => m.lead_id));
  R['ai.messages_sent'] = aiOut.length;
  R['ai.messages_delivered'] = aiOut.filter((m) => (m.communication_type === 'sms' ? m.status === 'delivered'
    : AI_SENT.includes(m.status))).length;
  R['ai.conversations'] = new Set(aiOut.map((m) => str(m.lead_id)).filter((id) => leadById.get(id))).size;
  const staffOut = outbound.filter((m) => m.message_by != null && m.ai_generated !== true);
  R['bdc.staff_texts'] = staffOut.filter((m) => m.communication_type === 'sms').length;
  R['bdc.staff_emails'] = staffOut.filter((m) => m.communication_type === 'email').length;
  R['dq.failed_sends'] = outbound.filter((m) => FAILED.includes(m.status)).length;

  // Speed to lead: first outbound message at or after the Lead Date, per lead received.
  const cohortMsgs = cohort.length ? (await col('emails').find({ lead_id: { $in: cohort.map((l) => l._id) },
    status: { $nin: [...INBOUND, 'note', 'draft'] } }).toArray()).filter(isOutbound) : [];
  const firstReply = (human) => {
    const first = new Map();
    for (const m of cohortMsgs) {
      if (human && (m.message_by == null || m.ai_generated === true)) continue;
      const lead = leadById.get(str(m.lead_id));
      if (!m.timestamp || (lead?.createdAt && new Date(m.timestamp) < new Date(lead.createdAt))) continue;
      const k = str(m.lead_id);
      if (!first.has(k) || new Date(m.timestamp) < first.get(k)) first.set(k, new Date(m.timestamp));
    }
    const mins = [...first.entries()].map(([k, at]) => Math.round((at - new Date(leadById.get(k).createdAt)) / 6000) / 10);
    return { count: first.size, value: medianOf(mins), leads: first };
  };
  const anyReply = firstReply(false);
  R['bdc.speed_to_lead'] = { count: anyReply.count, value: anyReply.value };
  const human = firstReply(true);
  R['bdc.speed_to_human'] = { count: human.count, value: human.value };
  R['bdc.no_response'] = cohort.length - anyReply.count;

  // AI state, touches and activity logs.
  const handoffs = await col('ai_lead_state').find({ dealer_id: { $in: forms }, status: 'handoff', status_at: range })
    .toArray();
  await loadLeads(handoffs.map((s) => s.lead_id));
  const handoffLeads = new Map(handoffs.filter((s) => leadById.get(str(s.lead_id))).map((s) => [str(s.lead_id), s]));
  R['ai.handoffs'] = handoffLeads.size;
  R['ai.manager_escalations'] = [...handoffLeads.values()]
    .filter((s) => MANAGER_PREFIXES.some((p) => str(s.status_reason).startsWith(p))).length;
  R['ai.staff_takeovers'] = await col('activitylogs').countDocuments({ dealer_id: { $in: forms },
    action: 'ai_turned_off', at: range });
  const touches = await col('ai_touches').find({ dealer_id: { $in: forms }, sent_at: range }).toArray();
  const settled = (t, ms) => t.sent_at && now - new Date(t.sent_at) >= ms;
  const H = 3600e3;
  const rate = (den, hit) => ({ num: den.filter(hit).length, den: den.length });
  R['ai.touches'] = touches.length;
  R['ai.reply_rate_24h'] = rate(touches.filter((t) => settled(t, 24 * H)), (t) => Boolean(t.replied_24h));
  R['ai.reply_rate_72h'] = rate(touches.filter((t) => settled(t, 72 * H)), (t) => Boolean(t.replied_72h));
  R['ai.meaningful_rate'] = rate(touches.filter((t) => settled(t, 72 * H)), (t) => Boolean(t.meaningful_reply));
  R['ai.appointment_rate_7d'] = rate(touches.filter((t) => settled(t, 168 * H)), (t) => Boolean(t.appointment_7d));
  R['ai.opt_out_rate'] = rate(touches, (t) => Boolean(t.opted_out_at));

  // Clicks.
  for (const [id, c] of [['source.vdp_clicks', 'vehicleclicks'], ['source.website_clicks', 'dealerwebsiteclicks']]) {
    R[id] = await col(c).countDocuments({ dealer_id: { $in: forms }, isBot: { $ne: true }, clickedAt: range });
  }

  // Call tasks (agentic-upsell agent/call_tasks.py).
  const tasks = (q) => col('ai_call_tasks').countDocuments({ dealer_id: { $in: forms }, ...q });
  R['bdc.call_tasks_completed'] = await tasks({ status: 'completed', closed_at: range });
  R['bdc.meaningful_contacts'] = await tasks({ status: 'completed', outcome: 'connected', closed_at: range });
  R['bdc.call_tasks_missed'] = await tasks({ status: 'missed', closed_at: range });
  R['bdc.call_tasks_overdue'] = await tasks({ status: 'open', due_by: { $gte: start, $lte: now < end ? now : end } });
  const everMissed = await col('ai_call_tasks').find({ dealer_id: { $in: forms }, missed_at: range },
    { projection: { status: 1, lead_id: 1, missed_at: 1, source: 1 } }).toArray();
  const missedNow = everMissed.filter((t) => t.status === 'missed');
  const thirtyAgo = new Date(now.getTime() - 30 * 24 * H);
  WHY['bdc.call_tasks_missed'] = [
    `Call Tasks page, Missed list for these days (status still missed, by closed_at): ${R['bdc.call_tasks_missed']} `
      + '(the page shows 300 rows at most per list).',
    `Missed at some point in these days (missed_at, any status now - the old count): ${everMissed.length}; `
      + `${everMissed.length - missedNow.length} of them were completed or dismissed later (on the page under Done / `
      + 'Cancelled).',
    `Distinct leads: ${new Set(missedNow.map((t) => str(t.lead_id))).size}; distinct lead-days: `
      + `${new Set(missedNow.map((t) => `${str(t.lead_id)}|${localDay(t.missed_at)}`)).size} - each touch (source `
      + `connection_timer: ${missedNow.filter((t) => t.source !== 'daily').length}) and each Days 1-7 half-day (source `
      + `daily: ${missedNow.filter((t) => t.source === 'daily').length}) opens its own task, so one lead can miss several.`,
    `The page's per-agent "missed in the last 30 days" (missed_at since now - 30 days, any status): `
      + `${await tasks({ missed_at: { $gte: thirtyAgo } })} - a rolling window, not these days.`,
  ];

  // Service (current states, no date range).
  const distinctCustomers = async (c, q) => new Set((await col(c).find({ dealer_id: { $in: forms }, ...q },
    { projection: { customer_id: 1 } }).toArray()).map((x) => str(x.customer_id)).filter(Boolean)).size;
  R['service.active_customers'] = await distinctCustomers('ai_customer_status', { customer_status: 'ACTIVE' });
  R['service.inactive_customers'] = await distinctCustomers('ai_customer_status', { customer_status: 'INACTIVE' });
  R['service.vehicles_on_file'] = await distinctCustomers('ai_vehicle_ownership', { ownership_status: 'ACTIVE' });
  R['service.reminders_sent'] = await col('ai_service_events').countDocuments({ dealer_id: { $in: forms },
    customer_facing: true, created_at: range });

  // Data quality.
  const customers = await col('customers').find({ dealer_id: { $in: forms } },
    { projection: { emails: 1, phones: 1, createdAt: 1, merged_into: 1, merge_history: 1 } }).toArray();
  const live = customers.filter((c) => c.merged_into == null);
  const owners = new Map();
  const keysOf = (c) => new Set([
    ...(c.emails || []).map((e) => str(e?.value).trim().toLowerCase()).filter(Boolean).map((e) => `e:${e}`),
    ...(c.phones || []).map((p) => str(p?.value).replace(/\D/g, '').slice(-10)).filter((x) => x.length === 10)
      .map((x) => `p:${x}`)]);
  for (const c of live) for (const k of keysOf(c)) owners.set(k, (owners.get(k) || 0) + 1);
  R['dq.duplicate_customers'] = live.filter((c) => inRange(c.createdAt) && [...keysOf(c)].some((k) => owners.get(k) > 1))
    .length;
  R['dq.merged_customers'] = new Set(customers.flatMap((c) => (c.merge_history || [])
    .filter((h) => inRange(h?.merged_at)).map((h) => `${c._id}:${h.merged_customer_id}`))).size;
  R['dq.dms_import_errors'] = await col('dealervaultimportbatches').countDocuments({ dealer_id: { $in: forms },
    status: { $in: ['failed', 'completed_with_errors'] }, createdAt: range });
  R['dq.opt_outs'] = await col('ai_consent').countDocuments({ dealer_id: { $in: forms }, consent_type: 'opt_out',
    consent_status: 'opted_out', recorded_at: range });
  R['dq.send_blocks'] = await col('ai_compliance_log').countDocuments({ dealer_id: { $in: forms }, decision: 'BLOCK',
    at: range });
  R['dq.campaign_blocked'] = await col('campaignleads').countDocuments({ dealer_id: { $in: forms }, status: 'blocked',
    updatedAt: range });
  return { R, WHY };
}

// ---- comparing ---------------------------------------------------------------------------------------------------
// The leads ?report_kpi=<id> lists: the KPI's rows -> their leads -> those that are the dealer's leads.
async function drillLeadCount(rows, dealerId) {
  const got = reportKpiLeads(rows);
  const oids = got.lead_ids.filter((id) => mongoose.isValidObjectId(id));
  if (!oids.length) return 0;
  return Lead.countDocuments({ _id: { $in: oids }, dealer_id: String(dealerId) });
}

function reportsValue(def, ev) {
  if (ev.kind === 'rate') return `${ev.numerator.count} / ${ev.denominator.count} = ${ev.value ?? '-'}%`;
  if (ev.kind === 'median') return `${ev.value ?? '-'} ${def.unit || ''} (n=${ev.count})`.replace(/ {2}/, ' ');
  return String(ev.value);
}

function rawText(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  if ('num' in raw) return `${raw.num} / ${raw.den}`;
  return `${raw.value ?? '-'} (n=${raw.count})`;
}

// [name, reports value, other value] pairs to compare.
function comparisons(ev, raw, dash, drill, grain) {
  const out = [];
  const main = ev.kind === 'median' ? ev.count : ev.kind === 'rate' ? ev.numerator.count : ev.value;
  if (dash != null) out.push(['dashboard', main, dash]);
  if (raw != null) {
    if (typeof raw === 'number') out.push(['raw', main, raw]);
    else if ('num' in raw) out.push(['raw numerator', ev.numerator.count, raw.num],
      ['raw denominator', ev.denominator.count, raw.den]);
    else out.push(['raw count', ev.count, raw.count], ['raw median', ev.value, raw.value]);
  }
  if (grain === 'lead' && drill != null) out.push(['drill', main, drill]);
  return out;
}

/**
 * Reconcile one dealer's Reports numbers. Needs an open mongoose connection.
 * @param {{dealerId: string, from: string, to: string, now?: Date, log?: (line: string) => void}} opts
 * @returns {Promise<{tz: string, results: object[], summary: Record<string, number>, diffs: object[]}>}
 */
export async function reconcile({ dealerId, from, to, now = new Date(), log = () => {} }) {
  const tz = await getDealerTimezone(dealerId);
  const { start, end } = localDayRange(from, to, tz);
  const parsed = parseFilterSpec(new URLSearchParams({ from, to }), { report: REPORTS.KPI_REPORTS, tz });
  if (!parsed.ok) throw new Error(`bad range: ${parsed.errors.join('; ')}`);
  const args = { dealerId: String(dealerId), from: parsed.spec.from, to: parsed.spec.to, tz, spec: parsed.spec, now };
  const dash = await dashboardNumbers(dealerId, start, end);
  const { R: raw, WHY } = await rawCounts(mongoose.connection.db, { dealerId, start, end, tz, now: new Date(now) });
  log(`Dealer ${dealerId}  ${from} .. ${to}  (${tz}: ${start.toISOString()} .. ${end.toISOString()})`);

  const ctx = {};
  const results = [];
  for (const def of listKpis()) {
    const r = { id: def.id, label: def.label, tab: def.dashboard || 'registry', source: (def.source || []).join('+'),
      reports: null, dash: null, raw: null, drill: null, status: null, reason: null, why: WHY[def.id] || null };
    if (def.state !== 'live') {
      r.status = 'BLOCKED';
      r.reports = def.state;
      r.reason = def.reason || null;
    } else {
      const ev = await evaluateKpi(def.id, args, ctx);
      const cmp = DASH[def.id] || {};
      r.reports = reportsValue(def, ev);
      if (cmp.dash) r.dash = dash[cmp.dash];
      r.rawValue = raw[def.id] ?? null;
      r.raw = rawText(r.rawValue);
      if (isLeadLinked(def)) r.drill = await drillLeadCount(ev.rows, dealerId);
      // A lead-grain number is its leads: the list must show exactly that many. Other grains (several bookings or
      // messages on one lead) only print the list's size.
      const compared = comparisons(ev, r.rawValue, r.dash, r.drill, def.grain);
      const off = compared.filter(([, a, b]) => a !== b);
      if (!compared.length) {
        r.status = 'NO-COMPARE';
        r.reason = 'No Dashboard number, raw count or lead list for this KPI.';
      } else if (!off.length) r.status = 'OK';
      else {
        r.status = 'DIFF';
        r.diff = off.map(([name, a, b]) => (typeof a === 'number' && typeof b === 'number'
          ? `reports ${a} vs ${name} ${b} (${a - b >= 0 ? '+' : ''}${a - b})` : `reports ${a} vs ${name} ${b}`))
          .join('; ');
        const rawOff = off.some(([name]) => name.startsWith('raw'));
        const dashOff = off.some(([name]) => name === 'dashboard');
        r.reason = [dashOff && cmp.note, rawOff && (RAW_NOTE[def.id]
          || 'Reports and the independent raw count disagree: a defect to investigate.'),
        off.some(([name]) => name === 'drill') && 'The Leads list shows a different number of leads.',
        def.exclusions && `Definition excludes: ${def.exclusions}`].filter(Boolean).join(' ')
          || 'No reason stated in the definition.';
      }
    }
    results.push(r);
    log(formatLine(r));
    if (r.status === 'DIFF') log(`    ${r.diff}. ${r.reason}`);
    if (r.status === 'NO-COMPARE') log(`    ${r.reason}`);
    if (r.why && r.status !== 'BLOCKED') for (const line of r.why) log(`    why: ${line}`);
  }

  const summary = { OK: 0, DIFF: 0, 'NO-COMPARE': 0, BLOCKED: 0 };
  for (const r of results) summary[r.status] += 1;
  const diffs = results.filter((r) => r.status === 'DIFF');
  const withRaw = results.filter((r) => r.raw != null).length;
  log('');
  log(`Summary: ${results.length} KPIs  ${Object.entries(summary).map(([k, v]) => `${k} ${v}`).join('  ')}  `
    + `(raw count on ${withRaw} of ${results.length - summary.BLOCKED} live)`);
  if (diffs.length) {
    log('Differences:');
    for (const r of diffs) log(`  ${r.id}: ${r.diff}. ${r.reason}`);
  }
  return { tz, results, summary, diffs };
}

function formatLine(r) {
  const parts = [`${r.status.padEnd(10)} ${r.id.padEnd(30)} ${JSON.stringify(r.label).padEnd(44)} reports=${r.reports}`];
  if (r.dash != null) parts.push(`dash=${r.dash}`);
  if (r.raw != null) parts.push(`raw=${r.raw}`);
  if (r.drill != null) parts.push(`drill=${r.drill} leads`);
  parts.push(`src=${r.source || '-'}`);
  if (r.status === 'BLOCKED' && r.reason) parts.push(`(${r.reason})`);
  return parts.join('  ');
}

function parseArgs(argv) {
  const out = { allowRemote: false };
  const names = { '--uri': 'uri', '--dealer': 'dealer', '--from': 'from', '--to': 'to' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--allow-remote') out.allowRemote = true;
    else if (names[argv[i]] && argv[i + 1] != null) out[names[argv[i]]] = argv[++i];
    else return { error: `unknown argument ${argv[i]}` };
  }
  if (!out.uri || !out.dealer || !out.from || !out.to) return { error: 'missing --uri, --dealer, --from or --to' };
  if (!isValidLocalDate(out.from) || !isValidLocalDate(out.to) || out.to < out.from) {
    return { error: '--from / --to must be YYYY-MM-DD, from <= to' };
  }
  if (!mongoose.isValidObjectId(out.dealer)) return { error: '--dealer must be a dealer id' };
  return out;
}

/**
 * Parse the arguments, connect read-only, reconcile, disconnect.
 * @returns {Promise<{error?: string} & Partial<Awaited<ReturnType<typeof reconcile>>>>}
 */
export async function main(argv = process.argv.slice(2), { log = (l) => console.log(l), now } = {}) {
  const opts = parseArgs(argv);
  if (opts.error) return { error: `${opts.error}\n${USAGE}` };
  if (!isLocalUri(opts.uri) && !opts.allowRemote) {
    return { error: 'Refusing a non-local database. Add --allow-remote if you really mean it.' };
  }
  const restore = blockWrites();
  try {
    await mongoose.connect(opts.uri, { autoIndex: false, autoCreate: false, readPreference: 'secondaryPreferred',
      serverSelectionTimeoutMS: 10000 });
    return await reconcile({ dealerId: opts.dealer, from: opts.from, to: opts.to, now, log });
  } finally {
    await mongoose.disconnect();
    restore();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const out = await main();
    if (out.error) {
      console.error(out.error);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('reports-reconcile failed:', error?.stack || error);
    process.exitCode = 1;
  }
}
