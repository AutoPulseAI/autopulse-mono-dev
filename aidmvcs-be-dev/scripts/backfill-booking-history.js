#!/usr/bin/env node
// Gives older bookings the 'created' history entry new bookings get when they are written (P1 item 3), built from
// what the booking already has: at = createdAt (else the _id's time), actor_type = created_by (else 'unknown'),
// via 'backfill'. It is put first in `history` (an existing history - e.g. a move recorded after the deploy - is
// kept after it). Bookings that already have a 'created' entry are skipped. created_by and every other field are
// never written. Dry run by default.
//   --apply          write the entries
//   --dealer=<id>    one dealer only
//   --uri=<mongodb uri>   default: $MONGODB_URI. Only localhost / 127.0.0.1 unless --allow-remote is passed.
// Usage: node scripts/backfill-booking-history.js --uri=mongodb://127.0.0.1:27018/autopulse_local [--apply]
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './dedupe-active-bookings.js';

const ACTORS = ['ai', 'staff', 'customer'];
const BATCH = 500;

export function createdEntry(booking) {
  const at = booking.createdAt ? new Date(booking.createdAt)
    : (booking._id?.getTimestamp ? booking._id.getTimestamp() : null);
  return { at, action: 'created', actor_type: ACTORS.includes(booking.created_by) ? booking.created_by : 'unknown',
    via: 'backfill' };
}

export async function backfillBookingHistory(db, { apply = false, dealerId = null, logger = console } = {}) {
  const filter = { 'history.action': { $ne: 'created' } };
  if (dealerId) filter.dealer_id = String(dealerId);
  const bookings = db.collection('bookings');
  const total = await bookings.countDocuments(filter);
  const byActor = {};
  let written = 0;
  let failed = 0;
  let ops = [];
  const flush = async () => {
    if (!ops.length) return;
    try {
      const res = await bookings.bulkWrite(ops, { ordered: false });
      written += res.modifiedCount;
    } catch (error) {
      // e.g. a `history` that isn't an array: those rows are reported and left as they are.
      written += error?.result?.modifiedCount ?? error?.result?.nModified ?? 0;
      failed += error?.writeErrors?.length ?? 0;
      logger.error(`some rows were not written: ${error?.message}`);
    }
    ops = [];
  };
  const cursor = bookings.find(filter, { projection: { _id: 1, created_by: 1, createdAt: 1 } });
  for await (const b of cursor) {
    const entry = createdEntry(b);
    byActor[entry.actor_type] = (byActor[entry.actor_type] || 0) + 1;
    if (!apply) continue;
    // Guarded again, so a re-run or a booking given a 'created' entry since the read is left alone.
    ops.push({ updateOne: { filter: { _id: b._id, 'history.action': { $ne: 'created' } },
      update: { $push: { history: { $each: [entry], $position: 0 } } } } });
    if (ops.length >= BATCH) await flush();
  }
  await flush();
  logger.log(`${total} booking(s) without a 'created' history entry; by created_by: ${JSON.stringify(byActor)}`);
  logger.log(apply ? `wrote ${written}, failed ${failed}` : 'dry run: nothing changed (pass --apply to write)');
  return { total, byActor, written, failed };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.errors.length) {
    console.error(opts.errors.join('\n'));
    console.error('Usage: node scripts/backfill-booking-history.js [--uri=...] [--dealer=<id>] [--apply] [--allow-remote]');
    process.exitCode = 1;
    return;
  }
  const connection = mongoose.createConnection(opts.uri, { autoIndex: false, autoCreate: false,
    serverSelectionTimeoutMS: 10000 });
  try {
    await connection.asPromise();
    console.log(`${opts.apply ? 'APPLY' : 'DRY RUN'} on ${connection.name}${opts.dealerId ? `, dealer ${opts.dealerId}` : ''}`);
    await backfillBookingHistory(connection.db, { apply: opts.apply, dealerId: opts.dealerId });
  } catch (error) {
    console.error('BACKFILL_FAILED:', error?.message);
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
