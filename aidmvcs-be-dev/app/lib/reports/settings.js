// Daily performance email: who gets it and when (P1 plan item 6). Pure helpers; no database access.
//
// Rollout switch, per dealer, on User.report_schedule_settings.daily_email_mode (set only by a super admin):
//   off       (default for every dealer) nothing is sent
//   internal  sent only to the addresses in env DAILY_REPORT_INTERNAL_RECIPIENTS (comma-separated), never to the dealer
//   live      sent to the dealer's Report Schedule recipients (report_schedule_settings.default_email, comma list;
//             when empty, the dealer account's own email - the same fallback the Report Schedule page shows)
// Send time: the time of the dealer's Report Schedule "daily" row (an active one first), else 09:00, dealer-local.
import moment from 'moment-timezone';

export const MODES = Object.freeze(['off', 'internal', 'live']);
export const DEFAULT_SEND_TIME = '09:00';
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function dailyEmailMode(dealer) {
  const mode = dealer?.report_schedule_settings?.daily_email_mode;
  return MODES.includes(mode) ? mode : 'off';
}

export function parseEmailList(value) {
  const out = [];
  for (const raw of String(value || '').split(/[,;\s]+/)) {
    const e = raw.trim().toLowerCase();
    if (e && EMAIL.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

export function internalRecipients(env = process.env) {
  return parseEmailList(env.DAILY_REPORT_INTERNAL_RECIPIENTS);
}

export function dealerRecipients(dealer) {
  const configured = parseEmailList(dealer?.report_schedule_settings?.default_email);
  if (configured.length) return configured;
  return parseEmailList(dealer?.email);
}

// The addresses this dealer's daily email goes to in its current mode ([] when off).
export function resolveRecipients(dealer, { env = process.env, mode = dailyEmailMode(dealer) } = {}) {
  if (mode === 'internal') return internalRecipients(env);
  if (mode === 'live') return dealerRecipients(dealer);
  return [];
}

export function sendTimeFor(dealer) {
  const schedules = dealer?.report_schedule_settings?.schedules || [];
  const daily = schedules.filter((s) => (s?.frequency || s?.reportType) === 'daily' && HHMM.test(String(s?.time || '')));
  const pick = daily.find((s) => s.active) || daily[0];
  if (!pick) return DEFAULT_SEND_TIME;
  const [, h, m] = String(pick.time).match(HHMM);
  return `${h.padStart(2, '0')}:${m}`;
}

// The dealer-local day before `now`'s local day.
export function yesterdayLocal(now, tz) {
  return moment(now).tz(tz).subtract(1, 'day').format('YYYY-MM-DD');
}

// True once today's local send time has passed in `tz`.
export function sendTimePassed(now, tz, sendTime = DEFAULT_SEND_TIME) {
  const local = moment(now).tz(tz);
  const due = moment.tz(`${local.format('YYYY-MM-DD')} ${sendTime}`, 'YYYY-MM-DD HH:mm', tz);
  return !local.isBefore(due);
}
