#!/usr/bin/env node
// Leads with more than one active (pending / confirmed) booking of the same appointment type (P1 item 3, G-049).
// Before the POST /api/booking fix a rebooking at another time added a second active booking instead of moving the
// first. Dry run by default: prints every lead, the booking kept and the ones that would be cancelled.
//   --apply          cancel the extras: the most recently updated booking stays active, the others get
//                    booking_status 'cancelled', cancelled_by 'system' and a history entry 'deduplicated'. Nothing is
//                    ever deleted.
//   --dealer=<id>    one dealer only
//   --uri=<mongodb uri>   default: $MONGODB_URI. Only localhost / 127.0.0.1 unless --allow-remote is passed.
// Usage: node scripts/dedupe-active-bookings.js --uri=mongodb://127.0.0.1:27018/autopulse_local [--apply]
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';

const HISTORY_LIMIT = 100;
const ACTIVE = ['pending', 'confirmed'];
const typeOf = (b) => (b.appointment_type === 'service' ? 'service' : 'sales');

export function isLocalMongoUri(uri) {
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/.exec(String(uri || ''));
  if (!m) return false;
  return m[1].split(',').every((h) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h));
}

// Pure. Groups of (dealer, lead, type) with more than one active booking: {keep, cancel[]}. The most recently
// updated booking is kept (ties: the newest _id).
export function duplicateGroups(bookings) {
  const groups = new Map();
  for (const b of bookings) {
    if (!ACTIVE.includes(b.booking_status ?? 'pending')) continue;
    const key = `${b.dealer_id}|${b.lead_id}|${typeOf(b)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const time = (b) => new Date(b.updatedAt || b.createdAt || 0).getTime();
    list.sort((a, b) => (time(b) - time(a)) || String(b._id).localeCompare(String(a._id)));
    out.push({ dealer_id: String(list[0].dealer_id), lead_id: String(list[0].lead_id), appointment_type: typeOf(list[0]),
      keep: list[0], cancel: list.slice(1) });
  }
  return out.sort((a, b) => `${a.dealer_id}|${a.lead_id}`.localeCompare(`${b.dealer_id}|${b.lead_id}`));
}

const describe = (b) => `${b._id} ${b.bookingDate ? new Date(b.bookingDate).toISOString().slice(0, 10) : '?'} `
  + `${b.bookingTime || '?'} ${b.booking_status || 'pending'} (updated ${b.updatedAt ? new Date(b.updatedAt).toISOString() : '?'})`;

export async function dedupeActiveBookings(db, { apply = false, dealerId = null, now = new Date(), logger = console } = {}) {
  const filter = { booking_status: { $in: ACTIVE } };
  if (dealerId) filter.dealer_id = String(dealerId);
  const bookings = await db.collection('bookings').find(filter, { projection: { _id: 1, dealer_id: 1, lead_id: 1,
    appointment_type: 1, booking_status: 1, bookingDate: 1, bookingTime: 1, updatedAt: 1, createdAt: 1 } }).toArray();
  const groups = duplicateGroups(bookings);
  const extras = groups.reduce((n, g) => n + g.cancel.length, 0);
  logger.log(`${groups.length} lead(s) with more than one active booking of the same type; ${extras} booking(s) to cancel`);
  for (const g of groups) {
    logger.log(`dealer ${g.dealer_id} lead ${g.lead_id} ${g.appointment_type}: keep ${describe(g.keep)}`);
    for (const b of g.cancel) logger.log(`  ${apply ? 'cancel' : 'would cancel'} ${describe(b)}`);
  }
  let cancelled = 0;
  if (apply) {
    for (const g of groups) {
      for (const b of g.cancel) {
        // Guarded on still being active, so a re-run (or a change since the read) is never overwritten.
        const guard = { _id: b._id, booking_status: { $in: ACTIVE } };
        const set = { booking_status: 'cancelled', statusChangedAt: now, cancelled_at: now, cancelled_by: 'system',
          updatedAt: now };
        let res;
        try {
          res = await db.collection('bookings').updateOne(guard, { $set: set,
            $push: { history: { $each: [{ at: now, action: 'deduplicated', actor_type: 'system',
              via: 'dedupe-active-bookings', from: { booking_status: b.booking_status || 'pending' },
              to: { booking_status: 'cancelled', kept_booking_id: String(g.keep._id) } }], $slice: -HISTORY_LIMIT } } });
        } catch (error) {
          // A history field that isn't an array: cancel without the entry rather than leave the duplicate active.
          logger.error(`  ${b._id}: history not recorded (${error?.message}); cancelling without it`);
          res = await db.collection('bookings').updateOne(guard, { $set: set });
        }
        cancelled += res.modifiedCount;
      }
    }
    logger.log(`cancelled ${cancelled} booking(s)`);
  } else {
    logger.log('dry run: nothing changed (pass --apply to cancel the extras)');
  }
  return { groups: groups.length, extras, cancelled,
    plan: groups.map((g) => ({ lead_id: g.lead_id, dealer_id: g.dealer_id, appointment_type: g.appointment_type,
      keep: String(g.keep._id), cancel: g.cancel.map((b) => String(b._id)) })) };
}

export function parseArgs(argv, env = process.env) {
  const opts = { apply: false, allowRemote: false, dealerId: null, uri: env.MONGODB_URI || null, errors: [] };
  for (const arg of argv) {
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--allow-remote') opts.allowRemote = true;
    else if (arg.startsWith('--dealer=')) opts.dealerId = arg.slice(9);
    else if (arg.startsWith('--uri=')) opts.uri = arg.slice(6);
    else opts.errors.push(`unknown argument ${arg}`);
  }
  if (!opts.uri) opts.errors.push('no database: pass --uri=... or set MONGODB_URI');
  else if (!isLocalMongoUri(opts.uri) && !opts.allowRemote) {
    opts.errors.push('refusing a non-local database; pass --allow-remote to run against it on purpose');
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.errors.length) {
    console.error(opts.errors.join('\n'));
    console.error('Usage: node scripts/dedupe-active-bookings.js [--uri=...] [--dealer=<id>] [--apply] [--allow-remote]');
    process.exitCode = 1;
    return;
  }
  const connection = mongoose.createConnection(opts.uri, { autoIndex: false, autoCreate: false,
    serverSelectionTimeoutMS: 10000 });
  try {
    await connection.asPromise();
    console.log(`${opts.apply ? 'APPLY' : 'DRY RUN'} on ${connection.name}${opts.dealerId ? `, dealer ${opts.dealerId}` : ''}`);
    await dedupeActiveBookings(connection.db, { apply: opts.apply, dealerId: opts.dealerId });
  } catch (error) {
    console.error('DEDUPE_FAILED:', error?.message);
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
