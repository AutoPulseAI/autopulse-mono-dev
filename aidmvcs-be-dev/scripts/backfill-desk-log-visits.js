#!/usr/bin/env node
// Puts the visits recorded elsewhere before 18 Nov 2026 on the Desk Log (from that day the CRM does it as they happen,
// app/lib/deskLog/sync.js). Two kinds, oldest first:
//   - an appointment marked showed (Appointments page / Dashboard) -> a visit that day (created_via 'appointments');
//   - a lead set to Visited / Sold Pending / Sold Delivered / Unsold on the Leads page -> a visit that day with its
//     outcome (created_via 'leads_page'); a Sold Delivered lead whose Sold Pending visit is on the Desk Log gets that
//     visit delivered, as the live sync does.
// A lead with a Desk Log visit that dealer-local day keeps it (only a missing outcome is filled in). Nothing is sent to
// anyone and no status changes: only Desk Log rows are written. Past deals get no delivery checklist.
// Dry run by default (lists what it would write).
//   --apply              write
//   --dealer=<id>        one dealer only
//   --since=YYYY-MM-DD   from this day (UTC); default 30 days ago
//   --uri=<mongodb uri>  default: $MONGODB_URI. Only localhost / 127.0.0.1 unless --allow-remote is passed.
// Usage: node scripts/backfill-desk-log-visits.js --uri="$URI" --allow-remote [--since=2026-11-01] [--apply]
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './dedupe-active-bookings.js';
import { dealerTimezone } from '../app/lib/bookingService.js';

const DAY = 864e5;
const VISIT_STATUSES = ['Visited', 'Sold Pending', 'Sold Delivered', 'Unsold'];
const OUTCOME = { 'Sold Pending': 'SOLD PENDING', 'Sold Delivered': 'SOLD DELIVERED', Unsold: 'UNSOLD' };
const oid = (id) => (mongoose.isValidObjectId(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null);

export async function backfillDeskLogVisits(db, { apply = false, dealerId = null, since, logger = console } = {}) {
  const dealerMatch = dealerId ? { dealer_id: { $in: [String(dealerId), oid(dealerId)].filter(Boolean) } } : {};
  const showed = await db.collection('bookings').find({ ...dealerMatch, showed: true, booking_status: { $ne: 'cancelled' },
    bookingDate: { $gte: since } }, { projection: { lead_id: 1, bookingDate: 1, showed_at: 1 } }).toArray();
  const statused = await db.collection('leads').find({ ...dealerMatch, fe_lead_status: { $in: VISIT_STATUSES },
    statusChangedAt: { $gte: since } }, { projection: { _id: 1, fe_lead_status: 1, statusChangedAt: 1, unsold_reason: 1 } }).toArray();
  const events = [
    ...showed.map((b) => ({ leadId: oid(b.lead_id), at: new Date(b.showed_at || b.bookingDate), via: 'appointments', status: null })),
    ...statused.map((l) => ({ leadId: l._id, at: new Date(l.statusChangedAt), via: 'leads_page', status: l.fe_lead_status,
      reason: l.fe_lead_status === 'Unsold' ? l.unsold_reason || null : null })),
  ].filter((e) => e.leadId && !Number.isNaN(e.at.getTime()) && e.at <= new Date()).sort((a, b) => a.at - b.at);

  const tzOf = new Map();
  let created = 0; let outcomes = 0; let kept = 0;
  for (const e of events) {
    const lead = await db.collection('leads').findOne({ _id: e.leadId },
      { projection: { dealer_id: 1, customer_id: 1, department: 1, assigned_to: 1, name: 1 } });
    if (!lead) continue;
    const dealer = String(lead.dealer_id);
    if (!tzOf.has(dealer)) {
      const user = oid(dealer) ? await db.collection('users').findOne({ _id: oid(dealer) }, { projection: { dealer_account_information: 1 } }) : null;
      tzOf.set(dealer, dealerTimezone(user));
    }
    const tz = tzOf.get(dealer);
    const dayStart = moment(e.at).tz(tz).startOf('day').toDate();
    const dayEnd = moment(e.at).tz(tz).endOf('day').toDate();
    const outcome = OUTCOME[e.status] || null;
    // The visit this event belongs to: one that day; or (as the live sync) an open one from the 7 days before; or the
    // Sold Pending visit (60 days) a delivery completes.
    const latest = await db.collection('desklogentries').findOne({ lead_id: lead._id,
      checked_in_at: { $gte: new Date(e.at.getTime() - 60 * DAY), $lte: dayEnd } }, { sort: { checked_in_at: -1, _id: -1 } });
    const current = latest && (latest.checked_in_at >= dayStart
      || (!latest.outcome && latest.checked_in_at >= new Date(e.at.getTime() - 7 * DAY))
      || (outcome === 'SOLD DELIVERED' && latest.outcome === 'SOLD PENDING'));
    const when = moment(e.at).tz(tz).format('YYYY-MM-DD HH:mm');
    const who = `dealer ${dealer} lead ${lead._id} (${lead.name || 'no name'})`;
    if (!current) {
      logger.log(`${who}: add visit ${when} (${e.via}${outcome ? `, ${outcome}${e.reason ? ` ${e.reason}` : ''}` : ''})`);
      created += 1;
      if (apply) {
        await db.collection('desklogentries').insertOne({
          dealer_id: dealer, lead_id: lead._id, customer_id: lead.customer_id || null,
          department: ['service', 'parts'].includes(lead.department) ? 'service' : 'sales', checked_in_at: e.at,
          created_by: null, created_via: e.via, bdc_agent_id: lead.assigned_to || null,
          ...(outcome ? { outcome, unsold_reason: e.reason || null, outcome_at: e.at } : {}),
          history: [{ field: 'checked_in', from: null, to: e.at, at: e.at, by: null, by_name: 'Backfill' },
            ...(outcome ? [{ field: 'outcome', from: null, to: outcome, at: e.at, by: null, by_name: 'Backfill' }] : [])],
          createdAt: new Date(), updatedAt: new Date(),
        });
      }
      continue;
    }
    // A visit already there: an outcome set on the Leads page goes on it unless it has a later one already.
    if (outcome && latest.outcome !== outcome && !(latest.outcome_at && latest.outcome_at > e.at)) {
      logger.log(`${who}: visit ${moment(latest.checked_in_at).tz(tz).format('YYYY-MM-DD HH:mm')} outcome ${latest.outcome || '-'} -> ${outcome}`);
      outcomes += 1;
      if (apply) {
        await db.collection('desklogentries').updateOne({ _id: latest._id }, {
          $set: { outcome, unsold_reason: e.reason || null, outcome_at: e.at, updatedAt: new Date() },
          $push: { history: { field: 'outcome', from: latest.outcome || null, to: outcome, at: e.at, by: null, by_name: 'Backfill' } } });
      }
    } else kept += 1;
  }
  logger.log(`${events.length} event(s) since ${since.toISOString().slice(0, 10)}: ${created} visit(s) to add, `
    + `${outcomes} outcome(s) to set, ${kept} already on the Desk Log`);
  logger.log(apply ? 'written' : 'dry run: nothing changed (pass --apply to write)');
  return { events: events.length, created, outcomes, kept };
}

async function main() {
  const argv = process.argv.slice(2);
  const sinceArg = argv.find((a) => a.startsWith('--since='));
  const opts = parseArgs(argv.filter((a) => a !== sinceArg));
  const since = sinceArg ? new Date(`${sinceArg.slice(8)}T00:00:00Z`) : new Date(Date.now() - 30 * DAY);
  if (Number.isNaN(since.getTime())) opts.errors.push('--since must be YYYY-MM-DD');
  if (opts.errors.length) {
    console.error(opts.errors.join('\n'));
    console.error('Usage: node scripts/backfill-desk-log-visits.js [--uri=...] [--dealer=<id>] [--since=YYYY-MM-DD] [--apply] [--allow-remote]');
    process.exitCode = 1;
    return;
  }
  const connection = mongoose.createConnection(opts.uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  try {
    await connection.asPromise();
    console.log(`${opts.apply ? 'APPLY' : 'DRY RUN'} on ${connection.name}${opts.dealerId ? `, dealer ${opts.dealerId}` : ''}`);
    await backfillDeskLogVisits(connection.db, { apply: opts.apply, dealerId: opts.dealerId, since });
  } catch (error) {
    console.error('BACKFILL_FAILED:', error?.message);
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
