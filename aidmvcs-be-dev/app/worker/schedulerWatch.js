// Emails AutoPulse when a scheduled job has stopped reaching the CRM (20 Nov 2026: the campaign job pointed at the
// wrong port and no scheduled campaign started). Runs in the worker, which pm2 keeps up independently of the crontab;
// checks every 15 minutes, one email a day per silent job. Who to tell: DEALERVAULT_ALERT_EMAIL / ADMIN_EMAIL.
import { heartbeatStatus } from '../lib/cronHeartbeat.js';
import { sendEmail } from '../lib/email.js';

const EVERY_MS = 15 * 60000;
const DAY_MS = 86400000;

export function setupSchedulerWatch() {
  const told = new Map();
  setInterval(async () => {
    try {
      const to = process.env.DEALERVAULT_ALERT_EMAIL || process.env.ADMIN_EMAIL;
      if (!to) return;
      for (const job of await heartbeatStatus()) {
        // "never": no call recorded yet (e.g. right after this was deployed) - only a job that ran and then stopped alerts.
        if (job.state !== 'late' || Date.now() - (told.get(job.name) || 0) < DAY_MS) continue;
        told.set(job.name, Date.now());
        await sendEmail(to, `Scheduled job not running: ${job.label}`,
          `The server's "${job.label}" job (${job.path}, every ${job.every_min} min) last reached the CRM ${job.age_min} minutes ago.\n\n`
          + `What stops: ${job.stops}.\n\nCheck the server crontab (crontab -l): the URL must reach the CRM `
          + '(http://localhost:3001 or https://www.autopulse.ai). Admin > Integration health shows every job.').catch(() => null);
      }
    } catch { /* next round */ }
  }, EVERY_MS).unref?.();
}
