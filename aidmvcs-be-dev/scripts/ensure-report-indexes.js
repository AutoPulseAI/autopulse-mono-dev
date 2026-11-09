#!/usr/bin/env node
// Indexes the reports and the appointment attribution read by (P1 items 1-3). Mongoose never builds them on its own
// (the booking ones are declared with _autoIndex: false in app/models/Booking.js, the others are not declared in a
// model), so a deploy changes nothing on the live database; run this on purpose. Dry run by default: prints the plan
// and which indexes already exist (same key, any name).
//   --apply          create the missing ones (one at a time; MongoDB 4.2+ builds without blocking the collection)
//   --uri=<mongodb uri>   default: $MONGODB_URI. Only localhost / 127.0.0.1 unless --allow-remote is passed.
// Usage: node scripts/ensure-report-indexes.js --uri=mongodb://127.0.0.1:27018/autopulse_local [--apply]
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { BOOKING_REPORT_INDEXES } from '../app/models/Booking.js';
import { parseArgs } from './dedupe-active-bookings.js';

export const REPORT_INDEXES = Object.freeze([
  ...BOOKING_REPORT_INDEXES.map((i) => ({ collection: 'bookings', ...i })),
  // Messages per dealer by status and time (emails has no timestamps option; its time is `timestamp`).
  { collection: 'emails', key: { dealer_id: 1, status: 1, timestamp: -1 },
    options: { name: 'dealer_id_1_status_1_timestamp_-1' } },
  { collection: 'leads', key: { dealer_id: 1, createdAt: -1 }, options: { name: 'dealer_id_1_createdAt_-1' } },
  // ActivityLog (app/models/ActivityLog.js): dealer_id + `at` (it has no createdAt). The existing
  // {dealer_id, customer_id, at} index can't serve a dealer-wide time range.
  { collection: 'activitylogs', key: { dealer_id: 1, at: -1 }, options: { name: 'dealer_id_1_at_-1' } },
]);

const sameKey = (a, b) => {
  const ea = Object.entries(a || {});
  const eb = Object.entries(b || {});
  return ea.length === eb.length && ea.every(([f, d], i) => f === eb[i][0] && d === eb[i][1]);
};

export async function ensureReportIndexes(db, { apply = false, logger = console, indexes = REPORT_INDEXES } = {}) {
  const result = { present: [], missing: [], created: [], failed: [] };
  for (const spec of indexes) {
    let existing = [];
    try {
      existing = await db.collection(spec.collection).listIndexes().toArray();
    } catch (error) {
      if (error?.code !== 26) throw error; // 26: the collection doesn't exist yet
    }
    const label = `${spec.collection} ${JSON.stringify(spec.key)}`;
    const found = existing.find((i) => sameKey(i.key, spec.key));
    if (found) {
      result.present.push(label);
      logger.log(`present  ${label} (as ${found.name})`);
      continue;
    }
    result.missing.push(label);
    if (!apply) {
      logger.log(`missing  ${label} -> would create ${spec.options.name}`);
      continue;
    }
    try {
      await db.collection(spec.collection).createIndex(spec.key, { ...spec.options, background: true });
      result.created.push(label);
      logger.log(`created  ${label} as ${spec.options.name}`);
    } catch (error) {
      result.failed.push(label);
      logger.error(`FAILED   ${label}: ${error?.message}`);
    }
  }
  if (!apply) logger.log(`dry run: ${result.missing.length} missing, nothing changed (pass --apply to create them)`);
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.errors.length) {
    console.error(opts.errors.join('\n'));
    console.error('Usage: node scripts/ensure-report-indexes.js [--uri=...] [--apply] [--allow-remote]');
    process.exitCode = 1;
    return;
  }
  const connection = mongoose.createConnection(opts.uri, { autoIndex: false, autoCreate: false,
    serverSelectionTimeoutMS: 10000 });
  try {
    await connection.asPromise();
    console.log(`${opts.apply ? 'APPLY' : 'DRY RUN'} on ${connection.name}`);
    const r = await ensureReportIndexes(connection.db, { apply: opts.apply });
    if (r.failed.length) process.exitCode = 1;
  } catch (error) {
    console.error('INDEX_CHECK_FAILED:', error?.message);
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
