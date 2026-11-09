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
//     raw=    a plain countDocuments / find written out below,
//     drill=  the distinct leads the Leads list shows for ?report_kpi=<id> (drillLeads.js reportKpiLeads, as
//             app/api/leads/route.js does).
//   OK          every comparable value equals the Reports value
//   DIFF        at least one differs: the difference and the definition's own exclusions (the known reason) are shown
//   NO-COMPARE  nothing to compare against
//   BLOCKED     the KPI is not live (blocked / needs data): it has no number
//
// Usage:
//   node scripts/reports-reconcile.js --uri "<mongodb uri>" --dealer <dealer_id> --from YYYY-MM-DD --to YYYY-MM-DD
//     [--allow-remote]      needed for any host other than localhost / 127.0.0.1 / ::1
//
// Never writes: indexes and collections are not created (autoIndex / autoCreate off), reads go to a secondary when
// there is one, and every driver write method throws while the check runs.
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { isLocalUri } from './normalize-legacy-statuses.js';

mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const { getDealerTimezone, isValidLocalDate, localDayRange } = await import('../app/lib/reporting/time.js');
const { evaluateKpi, isLeadLinked, listKpis } = await import('../app/lib/reporting/registry.js');
const { REPORTS, parseFilterSpec } = await import('../app/lib/reporting/filters.js');
const { reportKpiLeads } = await import('../app/lib/reporting/drillLeads.js');
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

// ---- what each KPI is compared with ------------------------------------------------------------------------------
// dash / raw: keys of the numbers computed once below. num: compare the rate's numerator. note: why a difference is
// expected, beyond the definition's own exclusions.
const DEDUP = 'Reports counts duplicate bookings (same lead, day and time) once; the Dashboard and raw count each.';
const COMPARE = {
  'leads.received': { dash: 'leads', raw: 'leads' },
  'exec.leads_received': { dash: 'leads', raw: 'leads' },
  'source.leads': { dash: 'leads', raw: 'leads' },
  'appt.made': { dash: 'made', raw: 'made' },
  'appt.attr.total': { dash: 'made', raw: 'made', note: DEDUP },
  'exec.appointments_set': { dash: 'made', raw: 'made', note: DEDUP },
  'appointments.set': { dash: 'made', raw: 'made', note: DEDUP },
  'source.appointments': { dash: 'made', raw: 'made', note: DEDUP },
  'bdc.appointments_by_owner': { dash: 'made', raw: 'made', note: DEDUP },
  'appointments.cancelled': { raw: 'cancelled' },
  'appt.scheduled': { dash: 'scheduled', raw: 'scheduled' },
  'exec.appointments_scheduled': { dash: 'scheduled', raw: 'scheduled', note: DEDUP },
  'appointments.scheduled': { dash: 'scheduled', raw: 'scheduled', note: DEDUP },
  'appt.shown': { dash: 'shown', raw: 'shown' },
  'exec.shown': { dash: 'shown', raw: 'shown', note: DEDUP },
  'appointments.shown': { dash: 'shown', raw: 'shown', note: DEDUP },
  'source.shown': { dash: 'shown', raw: 'shown', note: DEDUP },
  'exec.show_rate': { dash: 'shown', raw: 'shown', num: true, note: DEDUP },
  'appointments.show_rate': { dash: 'shown', raw: 'shown', num: true, note: DEDUP },
  'appt.attr.ai': { dash: 'made_ai', note: 'The Dashboard counts public booking page bookings (created_by customer) '
    + 'as AI; Reports puts them under Unknown. ' + DEDUP },
  'appointments.by_ai': { dash: 'made_ai', note: 'The Dashboard counts public booking page bookings (created_by '
    + 'customer) as AI; Reports puts them under Unknown. ' + DEDUP },
  'ai.appointments_ai': { dash: 'made_ai', note: 'The Dashboard counts public booking page bookings (created_by '
    + 'customer) as AI; Reports puts them under Unknown. ' + DEDUP },
  'replies.leads_replied': { dash: 'replied_leads' },
  'source.replied_leads': { dash: 'replied_leads', note: 'Reports matches the messages by emails.dealer_id, the '
    + 'Dashboard by the dealer\'s leads.' },
  'exec.customers_replied': { dash: 'replied_leads', note: 'Reports counts customers (several leads of one customer '
    + 'are one); the Dashboard card counts leads.' },
  'ai.messages_sent': { dash: 'ai_sent', raw: 'ai_sent', note: 'Reports matches messages by emails.dealer_id, the '
    + 'Dashboard by the dealer\'s leads; Reports also leaves out drafts and ADF bodies.' },
  'replies.inbound_messages': { dash: 'received', raw: 'received', note: 'Reports also leaves out the lead\'s own '
    + 'arrival row and delivery receipts.' },
  'dq.failed_sends': { dash: 'failed', note: 'Reports matches messages by emails.dealer_id, the Dashboard by the '
    + 'dealer\'s leads.' },
};

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

// Plain database counts, written out.
async function rawNumbers(db, dealerId, start, end) {
  const dealer_id = String(dealerId);
  const range = { $gte: start, $lte: end };
  const leads = await db.collection('leads').countDocuments({ dealer_id, createdAt: range });
  const made = await db.collection('bookings').countDocuments({ dealer_id, createdAt: range });
  const cancelled = await db.collection('bookings').countDocuments({ dealer_id, createdAt: range,
    booking_status: 'cancelled' });
  const scheduledDocs = await db.collection('bookings').find({ dealer_id, bookingDate: range,
    booking_status: { $ne: 'cancelled' } }, { projection: { lead_id: 1, showed: 1, booking_status: 1 } }).toArray();
  // Shown: marked showed, completed, or the lead's status is now Visited / Unsold / Sold*.
  const leadIds = [...new Set(scheduledDocs.map((b) => String(b.lead_id)))].filter((id) => /^[0-9a-f]{24}$/i.test(id));
  const came = new Set((await db.collection('leads').find({ _id: { $in: leadIds.map((id) => new mongoose.Types.ObjectId(id)) },
    fe_lead_status: { $in: CAME_STATUSES } }, { projection: { _id: 1 } }).toArray()).map((l) => String(l._id)));
  const shown = scheduledDocs.filter((b) => b.showed === true || b.booking_status === 'completed'
    || came.has(String(b.lead_id))).length;
  const notNote = { is_note: { $ne: true }, is_lead_email: { $ne: true } };
  const ai_sent = await db.collection('emails').countDocuments({ dealer_id, timestamp: range, ai_generated: true,
    status: { $nin: ['received', 'incoming', 'note', 'draft'] }, ...notNote });
  const received = await db.collection('emails').countDocuments({ dealer_id, timestamp: range,
    status: { $in: ['received', 'incoming'] }, ...notNote });
  return { leads, made, cancelled, scheduled: scheduledDocs.length, shown, ai_sent, received };
}

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
  const raw = await rawNumbers(mongoose.connection.db, dealerId, start, end);
  log(`Dealer ${dealerId}  ${from} .. ${to}  (${tz}: ${start.toISOString()} .. ${end.toISOString()})`);

  const ctx = {};
  const results = [];
  for (const def of listKpis()) {
    const r = { id: def.id, label: def.label, tab: def.dashboard || 'registry', source: (def.source || []).join('+'),
      reports: null, dash: null, raw: null, drill: null, status: null, reason: null };
    if (def.state !== 'live') {
      r.status = 'BLOCKED';
      r.reports = def.state;
      r.reason = def.reason || null;
    } else {
      const ev = await evaluateKpi(def.id, args, ctx);
      const cmp = COMPARE[def.id] || {};
      const value = ev.kind === 'median' ? ev.count : cmp.num || ev.kind === 'rate' ? ev.numerator.count : ev.value;
      r.reports = reportsValue(def, ev);
      if (cmp.dash) r.dash = dash[cmp.dash];
      if (cmp.raw) r.raw = raw[cmp.raw];
      if (isLeadLinked(def)) r.drill = await drillLeadCount(ev.rows, dealerId);
      // A lead-grain number is its leads: the list must show exactly that many. Other grains (several bookings or
      // messages on one lead) only print the list's size.
      const compared = [['dashboard', r.dash], ['raw', r.raw], ...(def.grain === 'lead' && r.drill != null
        ? [['drill', r.drill]] : [])].filter(([, v]) => v != null);
      const off = compared.filter(([, v]) => v !== value);
      if (!compared.length) r.status = 'NO-COMPARE';
      else if (!off.length) r.status = 'OK';
      else {
        r.status = 'DIFF';
        r.diff = off.map(([name, v]) => `reports ${value} vs ${name} ${v} (${value - v >= 0 ? '+' : ''}${value - v})`)
          .join('; ');
        r.reason = [cmp.note, def.exclusions && `Definition excludes: ${def.exclusions}`].filter(Boolean).join(' ')
          || 'No reason stated in the definition.';
      }
    }
    results.push(r);
    log(formatLine(r));
    if (r.status === 'DIFF') log(`    ${r.diff}. ${r.reason}`);
  }

  const summary = { OK: 0, DIFF: 0, 'NO-COMPARE': 0, BLOCKED: 0 };
  for (const r of results) summary[r.status] += 1;
  const diffs = results.filter((r) => r.status === 'DIFF');
  log('');
  log(`Summary: ${results.length} KPIs  ${Object.entries(summary).map(([k, v]) => `${k} ${v}`).join('  ')}`);
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
