// Contact Eligibility & Suppression (SOW Deliverable L, G-068 to G-071). One check before every text and email to a
// customer - AI, staff, reminders, campaigns - at the time of sending, not only when the lead came in. It runs inside
// sendSMS / sendEmail (app/lib/sms.js, app/lib/email.js), so no sender can skip it.
//
// The checks, in the SOW's order:
//   1. the number / address, normalised;
//   2. consent: a phone marked "SMS opt-in: no" on the customer (an explicit no; AutoTrader's TCPAOptIn is never read -
//      memory rule "form no does not block text");
//   3. the dealer's internal Do-Not-Contact list (app/models/ContactSuppression.js, also 'platform' entries) and the
//      customer's opt-outs: DND status on their lead, a Text / Email stop (app/lib/ai/stopLabels.js) - per channel,
//      a text stop never stops email;
//   4. the national / state Do Not Call registry: not connected (needs a vendor and the dealer's subscription);
//   5. the FCC reassigned-numbers database: not connected (needs an RND account);
//   6. the dealer's contact window in its own time zone (default 8:00-21:00) for outreach we start; a reply to the
//      customer's own message is not held.
// Decision: block if any check fails, else allow. Every decision is stored (ContactEligibilityDecision).
// Mode (app/models/ContactPolicy.js): 'log_only' (default, the user 18 Nov 2026) records and never stops a send;
// 'enforce' stops a blocked send - and, failing closed, a send whose checks could not run.
// Messages to staff (alerts, department emails) match no lead or customer of the dealer and are not checked or logged.
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import Lead from '../../models/Lead.js';
import Customer from '../../models/Customer.js';
import User from '../../models/User.js';
import ContactSuppression from '../../models/ContactSuppression.js';
import ContactPolicy from '../../models/ContactPolicy.js';
import ContactEligibilityDecision from '../../models/ContactEligibilityDecision.js';
import Email from '../../models/Email.js';
import { normalizeEmail, normalizePhone } from '../customerResolver.js';
import { stopsForLeads } from '../ai/stopLabels.js';

const DND_STATUSES = ['DND'];

export function phoneVariants(digits) {
  if (!digits) return [];
  const d = String(digits);
  return [d, `1${d}`, `+1${d}`, `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`];
}

const dealerForms = (id) => (mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(String(id))
  ? [String(id), new mongoose.Types.ObjectId(String(id))] : [String(id)]);

/** Inside the window? hh:mm strings, the dealer's local time. */
export function insideWindow(now, tz, start = '08:00', end = '21:00') {
  const local = moment(now).tz(tz || 'America/New_York');
  const mins = local.hours() * 60 + local.minutes();
  const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const a = toMin(start); const b = toMin(end);
  return a <= b ? mins >= a && mins < b : mins >= a || mins < b;
}

export async function policyFor(dealerId) {
  const p = await ContactPolicy.findOne({ dealer_id: String(dealerId) }).lean();
  return { mode: 'log_only', window_start: '08:00', window_end: '21:00', registry: 'not_connected', reassigned_numbers: 'not_connected', ...(p || {}) };
}

/**
 * @param {{ dealerId, channel: 'sms'|'email'|'call', to, origin?, reply?, leadId?, now? }} req
 * @returns {Promise<{ checked: boolean, decision: 'allow'|'block'|'review', reasons: string[], stop: boolean, mode }>}
 *   stop: true only in 'enforce' mode, when the send must not go out.
 */
export async function checkEligibility({ dealerId, channel, to, origin = 'unknown', reply = false, leadId = null, now = new Date() }) {
  if (!dealerId) return { checked: false, decision: 'allow', reasons: [], stop: false, mode: 'log_only' };
  const dealer = String(dealerId);
  let policy = { mode: 'log_only' };
  const checks = {}; const reasons = [];
  let value = null; let matched = false;
  try {
    policy = await policyFor(dealer);
    const isPhone = channel !== 'email';
    value = isPhone ? normalizePhone(to) : normalizeEmail(to);
    if (!value) return { checked: false, decision: 'allow', reasons: [], stop: false, mode: policy.mode };
    const forms = dealerForms(dealer);

    const leads = await Lead.find({ dealer_id: { $in: forms }, ...(isPhone ? { phone: { $in: phoneVariants(value) } }
      : { email: { $regex: `^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, $options: 'i' } }) })
      .select('_id fe_lead_status customer_id').limit(50).lean();
    const customers = await Customer.find({ dealer_id: dealer, ...(isPhone ? { 'phones.value': { $in: phoneVariants(value) } }
      : { 'emails.value': value }) }).select('phones').limit(20).lean();
    const suppressed = await ContactSuppression.findOne({ dealer_id: { $in: [dealer, 'platform'] }, kind: isPhone ? 'phone' : 'email',
      value, removed_at: null }).lean();
    matched = leads.length > 0 || customers.length > 0 || Boolean(suppressed);
    if (!matched) return { checked: false, decision: 'allow', reasons: [], stop: false, mode: policy.mode };

    // 2. consent: an explicit "no" on the phone
    if (channel === 'sms') {
      const no = customers.some((c) => (c.phones || []).some((p) => phoneVariants(value).includes(p.value) && p.sms_opt_in === false));
      checks.consent = no ? 'fail' : 'pass';
      if (no) reasons.push('sms_opt_in_no');
    }
    // 3. internal list and opt-outs
    checks.internal_dnc = suppressed ? 'fail' : 'pass';
    if (suppressed) reasons.push(suppressed.dealer_id === 'platform' ? 'platform_dnc' : 'internal_dnc');
    const dnd = leads.some((l) => DND_STATUSES.includes(l.fe_lead_status));
    const stops = leads.length ? await stopsForLeads(leads.map((l) => String(l._id))) : {};
    const stopped = Object.values(stops).some((s) => (channel === 'email' ? s.email : s.sms));
    checks.opt_out = dnd || stopped ? 'fail' : 'pass';
    if (dnd) reasons.push('dnd');
    if (stopped) reasons.push(channel === 'email' ? 'email_stop' : 'text_stop');
    // 4. / 5. vendor checks
    if (isPhone) {
      checks.dnc_registry = policy.registry === 'connected' ? 'error' : 'not_connected';
      checks.reassigned_numbers = policy.reassigned_numbers === 'connected' ? 'error' : 'not_connected';
    }
    // 6. contact window (outreach we start). Not told it is a reply: it is one when the newest message on the
    //    customer's leads is theirs, from the last 24 hours (the after-hours rule: an after-hours message is answered).
    if (isPhone && !reply && leads.length) {
      const last = await Email.findOne({ lead_id: { $in: leads.map((l) => l._id) } }).sort({ timestamp: -1 })
        .select('status timestamp').lean();
      if (last && ['received', 'incoming'].includes(last.status) && now - new Date(last.timestamp) < 24 * 3600 * 1000) reply = true;
    }
    if (isPhone && !reply) {
      const dealerUser = mongoose.isValidObjectId(dealer) ? await User.findById(dealer).select('timezone').lean() : null;
      const ok = insideWindow(now, dealerUser?.timezone, policy.window_start, policy.window_end);
      checks.contact_window = ok ? 'pass' : 'fail';
      if (!ok) reasons.push('outside_contact_window');
    }
  } catch (e) {
    checks.error = String(e?.message || e).slice(0, 200);
    reasons.push('check_failed');
  }
  const failedToRun = reasons.includes('check_failed');
  const decision = failedToRun ? 'review' : reasons.length ? 'block' : 'allow';
  const stop = policy.mode === 'enforce' && decision !== 'allow';
  if (value && (matched || failedToRun)) {
    await ContactEligibilityDecision.create({ dealer_id: dealer, channel, to: value, origin, reply: Boolean(reply), lead_id: leadId ? String(leadId) : null,
      decision, reasons, checks, mode: policy.mode, enforced: stop, at: now }).catch(() => null);
  }
  return { checked: true, decision, reasons, stop, mode: policy.mode };
}

export const REASON_TEXT = Object.freeze({
  sms_opt_in_no: 'The phone is marked "SMS opt-in: no"',
  internal_dnc: "On the dealership's Do-Not-Contact list",
  platform_dnc: 'On the AutoPulse Do-Not-Contact list',
  dnd: 'The customer is DND',
  text_stop: 'The customer stopped texts',
  email_stop: 'The customer stopped emails',
  outside_contact_window: "Outside the dealership's contact hours",
  check_failed: 'The check could not run',
});

// The check as senders use it (sendSMS / sendEmail). In 'log_only' mode it runs beside the send and never delays or
// stops it; in 'enforce' mode the send waits for it. A dealer's mode is re-read at most once a minute.
const modeCache = new Map();
async function modeFor(dealerId) {
  const hit = modeCache.get(dealerId);
  if (hit && Date.now() - hit.at < 60000) return hit.mode;
  const mode = (await ContactPolicy.findOne({ dealer_id: dealerId }).select('mode').lean().catch(() => null))?.mode || 'log_only';
  modeCache.set(dealerId, { mode, at: Date.now() });
  return mode;
}

export async function contactGate(req) {
  if (!req?.dealerId) return { stop: false };
  const mode = await modeFor(String(req.dealerId));
  if (mode !== 'enforce') {
    checkEligibility(req).catch(() => null);
    return { stop: false };
  }
  return checkEligibility(req);
}

export function blockedError(result) {
  const err = new Error(`Not sent: ${(result.reasons || []).map((r) => REASON_TEXT[r] || r).join('; ') || 'contact not eligible'}`);
  err.code = 'CONTACT_BLOCKED'; err.retryable = false; err.reason = 'contact_blocked'; err.eligibility = result;
  return err;
}
