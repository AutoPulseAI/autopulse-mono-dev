// Daily performance email worker (app/lib/reports/dailyReport.js). One queue, two job names:
//   daily-report-tick  repeatable, every 5 minutes (BullMQ job scheduler; one schedule however many workers start)
//   daily-report       one dealer + one day, jobId daily:<dealer>:<date>, retried with backoff
// Nothing is sent for a dealer whose daily_email_mode is 'off' (the default for every dealer).
import { Queue, Worker } from 'bullmq';
import dbConnect from '../lib/mongodb.js';
import {
  DAILY_REPORT_QUEUE, SEND_JOB, SEND_JOB_OPTIONS, TICK_EVERY_MS, TICK_JOB, dailyReportTick, runDailyReport,
} from '../lib/reports/dailyReport.js';

export function setupDailyReportWorker(redis) {
  const queue = new Queue(DAILY_REPORT_QUEUE, { connection: redis });
  const enqueue = (data, jobId) => queue.add(SEND_JOB, data, { ...SEND_JOB_OPTIONS, jobId });

  const worker = new Worker(DAILY_REPORT_QUEUE, async (job) => {
    await dbConnect();
    if (job.name === TICK_JOB) return dailyReportTick({ enqueue });
    if (job.name === SEND_JOB) return runDailyReport({ dealerId: job.data?.dealerId, reportDate: job.data?.reportDate });
    return { skipped: `unknown job ${job.name}` };
  }, { connection: redis, concurrency: 2 });

  worker.on('failed', (job, err) => {
    console.error(`[${DAILY_REPORT_QUEUE}] ${job?.name} ${job?.id} failed (attempt ${job?.attemptsMade}):`, err?.message);
  });

  queue.upsertJobScheduler(TICK_JOB, { every: TICK_EVERY_MS }, {
    name: TICK_JOB, data: {}, opts: { attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
  }).catch((error) => console.error('[daily-report] could not register the 5-minute tick', error?.message));

  console.log(`Daily report worker started (${DAILY_REPORT_QUEUE}, tick every ${TICK_EVERY_MS / 60000} min)`);
  return { queue, worker };
}
