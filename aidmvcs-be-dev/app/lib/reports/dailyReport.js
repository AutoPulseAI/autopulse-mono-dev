// Daily performance email pipeline (P1 plan item 6; gaps G-048, G-052, G-053). Replaces the old in-memory report
// loop (app/lib/reportCronService.js, now a no-op).
//
//   tick (BullMQ repeatable job, every 5 minutes, app/worker/dailyReportWorker.js)
//     for each dealer whose daily_email_mode is not 'off' and whose local send time has passed today, and whose
//     report for yesterday (dealer-local) has not reached every recipient yet:
//       queue job "daily-report" with jobId daily:<dealer>:<date>  (BullMQ drops a second add of the same id)
//   job
//     re-reads the dealer's mode (switched off meanwhile -> nothing is sent), builds or loads the saved snapshot,
//     renders it once, then per recipient claims the delivery row (insert-if-absent, then queued|failed -> sending)
//     before sending. Already-sent recipients are skipped; failed ones make the job throw so BullMQ retries them
//     with backoff. Each dealer is its own job: one dealer failing never blocks another.
//
// Sends go through app/lib/email.js sendEmail, so PROVIDER_SEND_STUB (app/lib/providerStub.js) applies.
// Imports are relative so the worker (plain Node) can load this module.
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import DailyReportDelivery from '../../models/DailyReportDelivery.js';
import User from '../../models/User.js';
import { dealerTimezone, isValidLocalDate } from '../reporting/time.js';
import { computeDailySnapshot, findSnapshot, getOrBuildSnapshot } from './dailySnapshot.js';
import { renderDailyEmail } from './dailyEmail.js';
import {
  MODES, dailyEmailMode, dealerRecipients, resolveRecipients, sendTimeFor, sendTimePassed, yesterdayLocal,
} from './settings.js';

export const DAILY_REPORT_QUEUE = 'dailyReportQueue';
export const TICK_JOB = 'daily-report-tick';
export const SEND_JOB = 'daily-report';
export const TICK_EVERY_MS = 5 * 60_000;
export const SEND_JOB_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  // Completed jobs are removed so the id frees up (the delivery rows are the record); a job that used up its
  // retries stays for 3 days, which also stops the tick from re-queuing that day.
  removeOnComplete: true,
  removeOnFail: { age: 3 * 24 * 3600 },
});
export const jobIdFor = (dealerId, reportDate) => `daily:${dealerId}:${reportDate}`;

const DEALER_FIELDS = 'name email type parent_id report_schedule_settings dealer_account_information branding_information';
const DONE = ['sent', 'sending', 'bounced'];

export function dashboardUrl(env = process.env) {
  const base = env.DAILY_REPORT_DASHBOARD_URL || env.NEXT_PUBLIC_APP_URL || env.APP_URL || env.NEXT_PUBLIC_BASE_URL;
  if (!base || !/^https?:\/\//i.test(base)) return null;
  return `${String(base).replace(/\/+$/, '')}/dealer/dashboard`;
}

export function fromAddress(env = process.env) {
  return env.DAILY_REPORT_FROM || env.EMAIL_FROM || 'support@autopulse.ai';
}

// The real sender: app/lib/email.js sendEmail (SES raw / SMTP; stubbed when PROVIDER_SEND_STUB is on outside
// production). Returns the provider message id.
export async function defaultSend({ to, subject, html, env = process.env }) {
  const { sendEmail } = await import('../email.js');
  return sendEmail(to, subject, html, fromAddress(env), null, null);
}

function isFinishedDay(reportDate, tz, now) {
  return reportDate < moment(now).tz(tz).format('YYYY-MM-DD');
}

async function loadDealer(dealerId) {
  if (!mongoose.isValidObjectId(dealerId)) return null;
  const dealer = await User.findById(String(dealerId)).select(DEALER_FIELDS).lean();
  return dealer && dealer.type === 'dealer' && !dealer.parent_id ? dealer : null; // the dealership, not a staff user
}

// Claim the row, send, record. Never sends a recipient whose row is already sent / sending / bounced.
async function deliverOne({ key, base, rendered, send, env }) {
  let row;
  try {
    row = await DailyReportDelivery.findOneAndUpdate(key, { $setOnInsert: { ...key, ...base, status: 'queued' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  } catch (error) {
    if (error?.code !== 11000) throw error;
    row = await DailyReportDelivery.findOne(key).lean();
  }
  const claimed = await DailyReportDelivery.findOneAndUpdate(
    { _id: row._id, status: { $in: ['queued', 'failed'] } },
    { $set: { status: 'sending', last_error: null, subject: rendered.subject }, $inc: { attempts: 1 } },
    { new: true },
  ).lean();
  if (!claimed) return { recipient: key.recipient, status: row.status, skipped: true, delivery_id: String(row._id) };
  try {
    const providerId = await send({ to: key.recipient, subject: rendered.subject, html: rendered.html,
      text: rendered.text, env });
    await DailyReportDelivery.updateOne({ _id: claimed._id }, { $set: { status: 'sent', sent_at: new Date(),
      provider_message_id: providerId ? String(providerId) : null } });
    return { recipient: key.recipient, status: 'sent', delivery_id: String(claimed._id) };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    await DailyReportDelivery.updateOne({ _id: claimed._id }, { $set: { status: 'failed', last_error: message } });
    return { recipient: key.recipient, status: 'failed', error: message, delivery_id: String(claimed._id) };
  }
}

/**
 * The "daily-report" job: send one dealer's report for one finished local day to its recipients, once each.
 * Throws when a recipient failed (BullMQ retries; sent recipients are skipped next time).
 */
export async function runDailyReport({ dealerId, reportDate, now = new Date(), env = process.env,
  send = defaultSend, logger = console } = {}) {
  const dealer = await loadDealer(dealerId);
  if (!dealer) return { status: 'skipped', reason: 'dealer_not_found' };
  const mode = dailyEmailMode(dealer);
  if (mode === 'off') return { status: 'skipped', reason: 'mode_off' };
  const tz = dealerTimezone(dealer);
  if (!isValidLocalDate(reportDate) || !isFinishedDay(reportDate, tz, now)) {
    return { status: 'skipped', reason: 'day_not_finished' };
  }
  const recipients = resolveRecipients(dealer, { env, mode });
  if (!recipients.length) {
    logger.warn?.(`[daily-report] ${dealerId} ${reportDate}: mode ${mode} but no recipients`);
    return { status: 'skipped', reason: 'no_recipients' };
  }
  const snapshot = await getOrBuildSnapshot({ dealerId, reportDate, now, dealer });
  const rendered = renderDailyEmail({ snapshot, dealer, dashboardUrl: dashboardUrl(env), mode,
    liveRecipientCount: dealerRecipients(dealer).length });

  const results = [];
  for (const recipient of recipients) {
    // Kill switch: the admin can switch the dealer off (or change mode) while a job is running.
    const current = await User.findById(String(dealerId)).select('report_schedule_settings.daily_email_mode').lean();
    if (dailyEmailMode(current) !== mode) {
      results.push({ recipient, status: 'skipped', reason: 'mode_changed' });
      continue;
    }
    results.push(await deliverOne({
      key: { dealer_id: dealer._id, report_date: reportDate, recipient, resend_of: null },
      base: { snapshot_id: snapshot._id, mode },
      rendered, send, env,
    }));
  }
  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length) {
    const err = new Error(`daily report ${dealerId} ${reportDate}: ${failed.length} of ${results.length} recipient(s) failed`);
    err.results = results;
    throw err;
  }
  return { status: 'done', mode, snapshot_id: String(snapshot._id), results };
}

/**
 * Admin resend: send a finished day again, to the recipients of the dealer's CURRENT mode (never when off), from the
 * same saved snapshot. Each call is one audited request: new delivery rows with resend_of = the request id and
 * requested_by = the admin.
 */
export async function resendDailyReport({ dealerId, reportDate, requestedBy, now = new Date(), env = process.env,
  send = defaultSend } = {}) {
  const dealer = await loadDealer(dealerId);
  if (!dealer) return { ok: false, status: 404, message: 'Dealer not found' };
  const mode = dailyEmailMode(dealer);
  if (mode === 'off') return { ok: false, status: 409, message: 'Daily email is off for this dealer; set it to internal or live first' };
  const tz = dealerTimezone(dealer);
  if (!isValidLocalDate(reportDate) || !isFinishedDay(reportDate, tz, now)) {
    return { ok: false, status: 400, message: 'date must be a finished day (YYYY-MM-DD, before today in the dealer time zone)' };
  }
  const recipients = resolveRecipients(dealer, { env, mode });
  if (!recipients.length) return { ok: false, status: 409, message: 'No recipients for this dealer in its current mode' };
  const snapshot = await getOrBuildSnapshot({ dealerId, reportDate, now, dealer });
  const rendered = renderDailyEmail({ snapshot, dealer, dashboardUrl: dashboardUrl(env), mode,
    liveRecipientCount: dealerRecipients(dealer).length });
  const requestId = `resend-${new mongoose.Types.ObjectId()}`;
  const originals = await DailyReportDelivery.find({ dealer_id: dealer._id, report_date: reportDate,
    resend_of: null }).select('_id recipient').lean();
  const originalBy = new Map(originals.map((o) => [o.recipient, o._id]));
  const results = [];
  for (const recipient of recipients) {
    results.push(await deliverOne({
      key: { dealer_id: dealer._id, report_date: reportDate, recipient, resend_of: requestId },
      base: { snapshot_id: snapshot._id, mode, requested_by: requestedBy || null,
        original_delivery_id: originalBy.get(recipient) || null },
      rendered, send, env,
    }));
  }
  return { ok: true, request_id: requestId, mode, snapshot_id: String(snapshot._id), results };
}

/** Admin preview: the HTML a dealer would get for a day. Sends nothing and saves nothing new. */
export async function previewDailyReport({ dealerId, reportDate, now = new Date(), env = process.env } = {}) {
  const dealer = await loadDealer(dealerId);
  if (!dealer) return { ok: false, status: 404, message: 'Dealer not found' };
  if (!isValidLocalDate(reportDate)) return { ok: false, status: 400, message: 'date must be YYYY-MM-DD' };
  const saved = await findSnapshot(dealerId, reportDate);
  const snapshot = saved || await computeDailySnapshot({ dealerId, reportDate, now, dealer });
  const mode = dailyEmailMode(dealer);
  const rendered = renderDailyEmail({ snapshot, dealer, dashboardUrl: dashboardUrl(env),
    mode: mode === 'internal' ? 'internal' : 'live', liveRecipientCount: dealerRecipients(dealer).length });
  return { ok: true, ...rendered, mode, snapshot_saved: Boolean(saved),
    day_finished: isFinishedDay(reportDate, dealerTimezone(dealer), now),
    recipients: resolveRecipients(dealer, { env, mode }) };
}

/**
 * The 5-minute tick. `enqueue(data, jobId)` adds the "daily-report" job (BullMQ in the worker; a stub in tests).
 * Per-dealer errors are logged and skipped.
 */
export async function dailyReportTick({ now = new Date(), env = process.env, enqueue, logger = console } = {}) {
  const dealers = await User.find({ type: 'dealer', parent_id: null,
    'report_schedule_settings.daily_email_mode': { $in: MODES.filter((m) => m !== 'off') } })
    .select(DEALER_FIELDS).lean();
  const enqueued = [];
  for (const dealer of dealers) {
    try {
      const tz = dealerTimezone(dealer);
      if (!sendTimePassed(now, tz, sendTimeFor(dealer))) continue;
      const reportDate = yesterdayLocal(now, tz);
      const recipients = resolveRecipients(dealer, { env });
      if (!recipients.length) continue;
      const done = await DailyReportDelivery.countDocuments({ dealer_id: dealer._id, report_date: reportDate,
        resend_of: null, recipient: { $in: recipients }, status: { $in: DONE } });
      if (done >= recipients.length) continue;
      const jobId = jobIdFor(dealer._id, reportDate);
      await enqueue({ dealerId: String(dealer._id), reportDate }, jobId);
      enqueued.push(jobId);
    } catch (error) {
      logger.error?.(`[daily-report] tick: dealer ${dealer._id} skipped`, error?.message);
    }
  }
  return { checked: dealers.length, enqueued };
}

/** Admin: set a dealer's mode. */
export async function setDailyEmailMode({ dealerId, mode, updatedBy }) {
  if (!MODES.includes(mode)) return { ok: false, status: 400, message: `mode must be one of ${MODES.join(', ')}` };
  if (!mongoose.isValidObjectId(dealerId)) return { ok: false, status: 400, message: 'dealer_id is invalid' };
  const updated = await User.findOneAndUpdate({ _id: String(dealerId), type: 'dealer', parent_id: null }, { $set: {
    'report_schedule_settings.daily_email_mode': mode,
    'report_schedule_settings.daily_email_mode_updated_at': new Date(),
    'report_schedule_settings.daily_email_mode_updated_by': updatedBy || null,
  } }, { new: true }).select(DEALER_FIELDS).lean();
  if (!updated) return { ok: false, status: 404, message: 'Dealer not found' };
  return { ok: true, dealer: updated };
}
