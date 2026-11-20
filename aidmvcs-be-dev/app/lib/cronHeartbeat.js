// Scheduled jobs' heartbeats (20 Nov 2026: the server's campaign job called http://localhost:3000 while the CRM listens
// on 3001, so no scheduled campaign ever started and nothing said so). Every scheduled route records each call that
// reached it; Admin > Integration health shows each job's last call, and the worker emails when one has been silent
// for more than STALE_FACTOR x its interval (worker/schedulerWatch.js). Nothing here changes what a job does.
import mongoose from 'mongoose';
import dbConnect from './mongodb.js';

export const HEARTBEATS = 'cron_heartbeats';
export const STALE_FACTOR = 3;

// The jobs the server's crontab runs, with how often (minutes) and what stops when one is silent.
export const SCHEDULED_JOBS = Object.freeze([
  { name: 'campaigns', label: 'Campaign sender', every_min: 10, path: '/api/cron/campaigns',
    stops: 'Scheduled campaigns never start (they stay "scheduled" / pending)' },
  { name: 'appointment-reminders', label: 'Appointment reminders', every_min: 5, path: '/api/cron/appointment-reminders',
    stops: 'Appointment reminders are not processed' },
  { name: 'inventory-import', label: 'Inventory import', every_min: 720, path: '/api/import',
    stops: 'Vehicle inventory is not refreshed (prices, stock, photos the AI shares)' },
]);

/** Records that a scheduled call reached the app. Best effort: never fails the job. */
export async function beat(name) {
  try {
    await dbConnect();
    await mongoose.connection.collection(HEARTBEATS).updateOne({ name },
      { $set: { name, last_at: new Date() }, $inc: { calls: 1 } }, { upsert: true });
  } catch { /* the job still runs */ }
}

/** Each job with its last call and state: ok | late | never. */
export async function heartbeatStatus(now = new Date()) {
  await dbConnect();
  const rows = await mongoose.connection.collection(HEARTBEATS).find({}).toArray().catch(() => []);
  const last = new Map(rows.map((r) => [r.name, r.last_at]));
  return SCHEDULED_JOBS.map((job) => {
    const at = last.get(job.name) || null;
    const ageMin = at ? (now - new Date(at)) / 60000 : null;
    const state = !at ? 'never' : ageMin > job.every_min * STALE_FACTOR ? 'late' : 'ok';
    return { ...job, last_at: at, age_min: ageMin == null ? null : Math.round(ageMin), state };
  });
}
