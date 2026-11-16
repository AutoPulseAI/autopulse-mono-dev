#!/usr/bin/env node
// Repairs the check-ins made before the Desk Log was connected to appointments (13 Nov 2026 meeting: a customer
// checked in on the Desk Log for their appointment still showed "Appointment booked"). For every Desk Log check-in
// whose lead had an appointment (not cancelled) on the same dealer-local day that isn't marked showed:
//   - the booking is marked showed / completed, with a history line (via 'desk_log_backfill', the check-in's time)
//   - the lead gets appointment_showed_at (it then reads "Appointment Showed" until a manager outcome)
// Past visits only: the AI is not messaged. Leads, statuses and bookings already showed are left as they are.
// Dry run by default (lists what it would change).
//   --apply          write
//   --dealer=<id>    one dealer only
//   --uri=<mongodb uri>   default: $MONGODB_URI. Only localhost / 127.0.0.1 unless --allow-remote is passed.
// Usage: node scripts/backfill-desk-log-showed.js --uri="$URI" --allow-remote [--apply]
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './dedupe-active-bookings.js';
import { ACTIVE_BOOKING_STATUSES, dealerTimezone } from '../app/lib/bookingService.js';

export async function backfillDeskLogShowed(db, { apply = false, dealerId = null, logger = console } = {}) {
  const entries = await db.collection('desklogentries').find(dealerId ? { dealer_id: String(dealerId) } : {},
    { projection: { dealer_id: 1, lead_id: 1, checked_in_at: 1, created_by: 1 } }).sort({ checked_in_at: 1 }).toArray();
  const tzOf = new Map();
  let found = 0; let written = 0;
  for (const e of entries) {
    if (!e.lead_id || !e.checked_in_at) continue;
    if (!tzOf.has(e.dealer_id)) {
      const dealer = mongoose.isValidObjectId(e.dealer_id) ? await db.collection('users')
        .findOne({ _id: new mongoose.Types.ObjectId(e.dealer_id) }, { projection: { dealer_account_information: 1 } }) : null;
      tzOf.set(e.dealer_id, dealerTimezone(dealer));
    }
    const start = moment(e.checked_in_at).tz(tzOf.get(e.dealer_id)).startOf('day');
    const booking = await db.collection('bookings').findOne({ lead_id: String(e.lead_id),
      booking_status: { $in: ACTIVE_BOOKING_STATUSES }, showed: { $ne: true },
      bookingDate: { $gte: start.clone().utc().toDate(), $lt: start.clone().add(1, 'day').utc().toDate() } });
    if (!booking) continue;
    found += 1;
    logger.log(`dealer ${e.dealer_id} lead ${e.lead_id}: booking ${booking._id} (${booking.booking_status}) on `
      + `${start.format('YYYY-MM-DD')} -> showed (checked in ${moment(e.checked_in_at).tz(tzOf.get(e.dealer_id)).format('HH:mm')})`);
    if (!apply) continue;
    const at = new Date(e.checked_in_at);
    const changed = booking.booking_status !== 'completed';
    await db.collection('bookings').updateOne({ _id: booking._id, showed: { $ne: true } }, {
      $set: { showed: true, showed_at: at, booking_status: 'completed', ...(changed ? { statusChangedAt: at } : {}) },
      $push: { history: { $each: [{ at, action: 'showed', actor_type: 'staff', ...(e.created_by ? { actor_id: String(e.created_by) } : {}),
        via: 'desk_log_backfill', ...(changed ? { from: { booking_status: booking.booking_status }, to: { booking_status: 'completed' } } : {}) }],
        $slice: -100 } } });
    await db.collection('leads').updateOne({ _id: e.lead_id }, { $set: { appointment_showed_at: at, appointment_showed_booking: booking._id } });
    written += 1;
  }
  logger.log(`${entries.length} check-in(s); ${found} with an appointment that day not marked showed`);
  logger.log(apply ? `fixed ${written}` : 'dry run: nothing changed (pass --apply to write)');
  return { entries: entries.length, found, written };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.errors.length) {
    console.error(opts.errors.join('\n'));
    console.error('Usage: node scripts/backfill-desk-log-showed.js [--uri=...] [--dealer=<id>] [--apply] [--allow-remote]');
    process.exitCode = 1;
    return;
  }
  const connection = mongoose.createConnection(opts.uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  try {
    await connection.asPromise();
    console.log(`${opts.apply ? 'APPLY' : 'DRY RUN'} on ${connection.name}${opts.dealerId ? `, dealer ${opts.dealerId}` : ''}`);
    await backfillDeskLogShowed(connection.db, { apply: opts.apply, dealerId: opts.dealerId });
  } catch (error) {
    console.error('BACKFILL_FAILED:', error?.message);
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
