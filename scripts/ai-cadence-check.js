#!/usr/bin/env node
// `make crm-cadence-check` (MASTER_PLAN_4 stream F): every client cadence, end to end, on a running
// `make crm-local` (CRM web :3100, AI API :8110, database autopulse_local). Leads come in through the CRM's
// real intake (the lead queue, the Twilio webhook, the staff status route); the AI's dev clock is walked
// forward one due follow-up at a time; each step's message is checked where it really lands: the CRM's
// conversation record (Email, ai_sent_via_platform) and the stubbed provider outbox (dev_provider_outbox).
//
//   1. New lead Days 1-7: Touch 1's structure, Touch 2 "{FirstName}?" at +3h, Touches 3-8 one a day with the
//      PDF's themes, text AND email, a 60-minute call-task timer after each touch, cancelled by a reply.
//   2. Days 8-30 weekly, Days 31-90 monthly, Day 91 -> Closed - Lost.
//   3. A reply stops queued touches; "call me Friday" fires on Friday; no reply in 24h -> No Contact Made ->
//      Short-Term again without resetting the Day 91 clock.
//   4. Appointment: countdown, day-before Y/N, Y confirms, N offers new times, no-show +1h / +24h / back to
//      the cadence; Sales Visit marks showed and stops everything.
//   5. Manager outcomes: Sold Pending weekly x4 then every 2 weeks (weeks 6 and 8), never expires; Unsold ->
//      90 days of follow-up; Closed - Lost stops; Sold Delivered: Day-3 check-in, birthday, ownership
//      anniversary YES and NO, customer ACTIVE / INACTIVE.
//   6. After-hours lead: the choice message, "now" vs "next business day".
//   7. Opt-out mid-cadence stops that channel; the other carries on.
//   8. Per-state hours: a touch due at night for a Kentucky / Texas customer is held to that state's window.
//
// The dev clock is shared by the whole AI service, so the run first parks every other lead's pending
// follow-ups (status `held_by_cadence_check`) and puts them back at the end, then resets the clock. Leads of
// other runs still go through the AI's own Day 91 sweep as the clock passes it: `make crm-seed` restores the
// demo data afterwards if you need it fresh.
import mongoose from 'mongoose';
import { Queue } from 'bullmq';
import jwt from 'jsonwebtoken';

import Email from '../app/models/Email.js';
import Lead from '../app/models/Lead.js';
import User from '../app/models/User.js';

const MONGODB_URI = process.env.CRM_LOCAL_MONGODB_URI || 'mongodb://localhost:27018/autopulse_local';
const PLATFORM = process.env.PLATFORM_URL || `http://localhost:${process.env.CRM_LOCAL_WEB_PORT || 3100}`;
const AI = process.env.AI_URL || `http://localhost:${process.env.CRM_LOCAL_AI_PORT || 8110}`;
const REDIS = { host: 'localhost', port: Number(process.env.CRM_LOCAL_REDIS_PORT || 6380),
  db: Number(process.env.CRM_LOCAL_REDIS_DB || 4) };
const SECRET = process.env.UPSELL_SERVICE_SHARED_SECRET || 'autopulse-local-dev-shared-secret';
const JWT_SECRET = process.env.JWT_SECRET || 'autopulse-local-dev-jwt-secret';
const TZ = 'America/Chicago';
// A second dealer, open 7:00-23:00 every day, so a state's own window (not the dealer's hours) is what holds
// a touch in section 8.
const LATE_DEALER_ID = '66f00000000000000000d0f8';
const LATE_DEALER_SMS = '+15550100108';
const LATE_MAILBOX = 'sales@late-motors.autopulse.local';
const HELD = 'held_by_cadence_check';
const ONLY = (process.env.CADENCE_ONLY || '').split(',').filter(Boolean);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `  - ${detail}` : ''}`);
  return ok;
}
function info(name, detail) {
  console.log(`\x1b[36mINFO\x1b[0m  ${name}${detail ? `  - ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(300);
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}`);
}
const quiet = (p) => p.catch(() => null);
const clip = (s, n = 70) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

let db;
const col = (name) => db.collection(name);
const json = (r) => r.json().catch(() => ({}));

// --- Clock --------------------------------------------------------------------------------------------------------
const aiNow = async () => new Date((await fetch(`${AI}/dev/clock`).then(json)).now);
const local = (d, opts = {}) => new Date(d).toLocaleString('en-US', { timeZone: opts.tz || TZ, weekday: 'short',
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const localParts = (d, tz = TZ) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
    .formatToParts(new Date(d)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
    weekday: parts.weekday, hour: Number(parts.hour === '24' ? 0 : parts.hour) };
};
const localDate = (d, tz) => localParts(d, tz).date;
const dayDiff = (a, b) => Math.round((Date.parse(`${localDate(b)}T00:00:00Z`) - Date.parse(`${localDate(a)}T00:00:00Z`)) / 86_400_000);
async function advance(seconds) {
  let left = seconds;
  while (left > 0) {
    const step = Math.min(left, 29 * 86_400);
    const response = await fetch(`${AI}/dev/clock/advance`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: Math.max(step, 1) }) });
    if (!response.ok) throw new Error(`clock advance failed: HTTP ${response.status}`);
    left -= step;
    if (left > 0) await settle();
  }
}

// --- The leads this run follows, and the walk ----------------------------------------------------------------------
const tracked = new Set();
const leadOf = {}; // key -> { lead, phone, email, first }
async function holdForeign() {
  // Every pending follow-up that isn't one of this run's leads waits until the run is over.
  await col('scheduled_followups').updateMany({ status: 'pending', lead_id: { $nin: [...tracked] } },
    { $set: { status: HELD } });
}
async function busy() {
  const now = await aiNow();
  return col('scheduled_followups').findOne({ lead_id: { $in: [...tracked] },
    $or: [{ status: 'claimed' }, { status: 'pending', due_at: { $lte: now } }] });
}
async function settle(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let nudged = Date.now();
  await sleep(250);
  while (Date.now() < deadline) {
    const doc = await busy();
    if (!doc) return;
    if (Date.now() - nudged > 6_000 && doc.status === 'pending') {
      await advance(1); // fire the follow-ups again (a busy retry, a cron that hasn't come round)
      nudged = Date.now();
    }
    await sleep(300);
  }
  const stuck = await busy();
  if (stuck) info('walk', `still busy after ${timeoutMs / 1000}s: ${stuck.kind} ${stuck.status} for ${stuck.lead_id}`);
}
// Walk the dev clock to `target`, stopping at every pending follow-up of the tracked leads on the way (a big
// jump would let a touch plan its successor from a clock that is already past it).
async function walkTo(target, { quietSteps = false } = {}) {
  const goal = new Date(target);
  for (let steps = 0; steps < 2000; steps += 1) {
    await holdForeign();
    const now = await aiNow();
    const [next] = await col('scheduled_followups').find({ lead_id: { $in: [...tracked] }, status: 'pending',
      due_at: { $lte: goal } }).sort({ due_at: 1 }).limit(1).toArray();
    const stop = next ? new Date(Math.max(next.due_at.getTime() + 20_000, now.getTime() + 1_000)) : goal;
    if (stop > now) await advance((stop - now) / 1000);
    await settle();
    if (!next) return;
    if (!quietSteps && process.env.CADENCE_VERBOSE) info('step', `${local(stop)} ${next.kind} ${next.lead_id}`);
  }
}
async function toLocal(dayOffset, hm, from) {
  // The dealer-local `hm` on the day `dayOffset` days after `from` (a Date).
  const [h, m] = hm.split(':').map(Number);
  const base = localParts(from);
  // Find the UTC instant whose Chicago-local time is base.date + dayOffset at h:m (DST-safe by search).
  const guess = new Date(Date.parse(`${base.date}T12:00:00Z`) + dayOffset * 86_400_000);
  for (let off = 4; off <= 7; off += 1) {
    const at = new Date(Date.UTC(guess.getUTCFullYear(), guess.getUTCMonth(), guess.getUTCDate(), h + off, m));
    const p = localParts(at);
    if (p.hm === `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` && p.date === localDate(guess)) return at;
  }
  throw new Error(`could not place ${hm} on day +${dayOffset}`);
}

// --- CRM intake and staff actions --------------------------------------------------------------------------------
let dealer;
let lateDealer;
let staffHeaders;
const runNum = Number(Date.now().toString().slice(-6));
let phoneSeq = 0;
const phone = (area) => `+1${area}${String((runNum * 10 + (phoneSeq += 1) * 7919) % 10_000_000).padStart(7, '0')}`;

async function newLead(key, { name, area = '217', source = 'Dealer Website', channel = 'sms', comments,
  forDealer = dealer } = {}) {
  const p = phone(area);
  const email = `cadence-${key}-${runNum}@example.test`;
  const queue = new Queue('leadProcessingQueue', { connection: REDIS });
  await queue.add('processLead', {
    leadData: { name, email, phone: p, followup_preference: channel, source, lead_source: source,
      dealer_id: String(forDealer._id), comments },
    action: 'create', dealer: forDealer,
    jobData: { currentSMS: { mail_content: comments, dealer_id: String(forDealer._id) } },
  }, { attempts: 1 });
  await queue.close();
  const lead = await waitFor(`the ${key} lead`, () => Lead.findOne({ dealer_id: String(forDealer._id), email }).lean());
  tracked.add(String(lead._id));
  leadOf[key] = { key, lead, phone: p, email, first: name.split(' ')[0], dealerId: String(forDealer._id),
    dealerSms: forDealer.dealer_account_information.sms_conversion_phone };
  return leadOf[key];
}
const state = (l) => col('ai_lead_state').findOne({ lead_id: String(l.lead._id) });
const outbound = (l, extra = {}) => col('ai_messages').find({ lead_id: String(l.lead._id), direction: 'outbound',
  ...extra }).sort({ created_at: 1 }).toArray();
const followups = (l, kind, extra = {}) => col('scheduled_followups').find({ lead_id: String(l.lead._id),
  ...(kind ? { kind } : {}), ...extra }).sort({ due_at: 1, created_at: 1 }).toArray();
async function firstReply(l) {
  return waitFor(`the first reply to ${l.key}`, async () => {
    const rows = await outbound(l, { status: 'sent' });
    return rows.length ? rows : null;
  });
}
async function textIn(l, body) {
  const sid = `SMcad${runNum}${Math.random().toString(16).slice(2, 10)}`;
  const form = new URLSearchParams({ From: l.phone, To: l.dealerSms, Body: body, MessageSid: sid, AccountSid: 'ACcad',
    NumMedia: '0', SmsStatus: 'received' });
  const response = await fetch(`${PLATFORM}/api/system/sms`, { method: 'POST', body: form,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!response.ok) throw new Error(`Twilio webhook HTTP ${response.status}`);
  await waitFor(`the ${l.key} inbound message in the AI`, () => col('ai_messages').findOne({ lead_id: String(l.lead._id),
    direction: 'inbound', text: body }), 30_000);
  return sid;
}
async function replyAndWait(l, body) {
  const before = (await outbound(l)).length;
  await textIn(l, body);
  await waitFor(`the AI's answer to ${l.key}`, async () => (await col('ai_turn_log').findOne({ lead_id: String(l.lead._id),
    trigger: 'inbound_message', inbound_text: body })) || (await outbound(l)).length > before, 30_000).catch(() => null);
  await sleep(1500);
  const rows = await outbound(l);
  return rows.slice(before);
}
async function staffStatus(l, body) {
  const response = await fetch(`${PLATFORM}/api/conversations/lead/status`, { method: 'PUT', headers: staffHeaders,
    body: JSON.stringify({ id: String(l.lead._id), ...body }) });
  return { status: response.status, body: await json(response) };
}
async function stageIs(l, stage, timeoutMs = 20_000) {
  return waitFor(`${l.key} at ${stage}`, async () => {
    const s = await state(l);
    return s?.stage === stage ? s : null;
  }, timeoutMs).catch(() => null);
}
// Which of the AI's sent messages reached the CRM: an Email record sent by the CRM and the stubbed provider call.
async function delivered(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.status !== 'sent') continue;
    const record = await Email.findOne({ message_id: m.provider_id, ai_generated: true }).lean();
    const stub = await col('dev_provider_outbox').findOne({ provider_id: m.provider_id });
    if (record?.ai_sent_via_platform && stub) out.push({ ...m, record, stub });
  }
  return out;
}
const channels = (msgs) => [...new Set(msgs.map((m) => m.channel))].sort().join('+');
const msgsFor = async (l, followup) => outbound(l, { turn_id: { $regex: String(followup._id) } });
async function bothChannels(l, followup) {
  const msgs = await msgsFor(l, followup);
  const ok = await delivered(msgs);
  return { msgs, ok, both: channels(ok) === 'email+sms',
    sms: ok.find((m) => m.channel === 'sms'), email: ok.find((m) => m.channel === 'email') };
}
const callTimerAfter = async (l, turnId) => col('scheduled_followups').findOne({ lead_id: String(l.lead._id),
  kind: 'call_task', source_turn_id: turnId });
async function completeOpenCallTasks(l) {
  const open = await col('ai_call_tasks').find({ lead_id: String(l.lead._id), status: 'open' }).toArray();
  for (const t of open) {
    await fetch(`${PLATFORM}/api/dealer-ai/call-tasks/${t._id}`, { method: 'POST', headers: staffHeaders,
      body: JSON.stringify({ action: 'complete', outcome: 'no_answer', dealer_id: String(dealer._id) }) });
  }
  return open.length;
}

// --- Setup --------------------------------------------------------------------------------------------------------
async function ensureLateDealer() {
  const existing = await User.findById(LATE_DEALER_ID).lean();
  if (existing) return existing;
  const base = await User.collection.findOne({ _id: dealer._id });
  const open = { active: true, start: '7:00 AM', end: '11:00 PM' };
  const hours = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    .map((d) => [d, open]));
  await User.collection.insertOne({ ...base, _id: new mongoose.Types.ObjectId(LATE_DEALER_ID),
    email: 'late-dealer@autopulse.local', name: 'Late Hours Motors',
    dealer_account_information: { ...base.dealer_account_information, store_name: 'Late Hours Motors',
      name: 'Late Hours Motors', weekly_availability: hours, sms_conversion_phone: LATE_DEALER_SMS,
      store_contact_mail: LATE_MAILBOX, domain_name: 'late-motors', sanitized_domain: 'late-motors' },
    cadence_check_dealer: true });
  const mailbox = await col('emailaccounts').findOne({ dealer_id: String(dealer._id) })
    || await col('emailaccounts').findOne({ dealer_id: dealer._id });
  if (mailbox) {
    const { _id, ...rest } = mailbox;
    await col('emailaccounts').insertOne({ ...rest, dealer_id: typeof mailbox.dealer_id === 'string' ? LATE_DEALER_ID
      : new mongoose.Types.ObjectId(LATE_DEALER_ID), email: LATE_MAILBOX, email_address: LATE_MAILBOX,
      cadence_check_dealer: true });
  }
  return User.findById(LATE_DEALER_ID).lean();
}

async function main() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3_000 });
  db = mongoose.connection.db;
  const { DEMO_DEALER_ID } = await import('./seed-local-crm.js');
  dealer = await User.findById(DEMO_DEALER_ID).lean();
  if (!dealer) throw new Error('Demo dealer not found - run `make crm-seed` (or `make crm-local`) first.');
  const health = await fetch(`${AI}/health`).then(json).catch(() => ({}));
  if (health.status !== 'ok') throw new Error(`AI service not up on ${AI} - run \`make crm-local\``);
  lateDealer = await ensureLateDealer();
  const token = jwt.sign({ userId: DEMO_DEALER_ID, type: 'dealer' }, JWT_SECRET, { expiresIn: '3h' });
  staffHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  await fetch(`${AI}/dev/clock/reset`, { method: 'POST' });
  await holdForeign();
  // A known start: the next Monday, 09:30 at the dealer.
  for (let i = 0; i < 7; i += 1) {
    const r = await fetch(`${AI}/dev/clock/to-dealer-time`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealer_id: DEMO_DEALER_ID, time: '09:30', weekdays_only: true }) }).then(json);
    if (String(r.dealer_time).startsWith('Mon')) break;
  }
  const t0 = await aiNow();
  info('start', `dev clock at ${local(t0)} (dealer time), run ${runNum}`);

  try {
    await scenario(t0);
  } finally {
    // This run's leads stop here; everyone else's follow-ups go back to pending; the clock goes back to now.
    await col('scheduled_followups').updateMany({ lead_id: { $in: [...tracked] }, status: 'pending' },
      { $set: { status: 'cancelled', reason: 'crm-cadence-check finished', closed_at: await aiNow() } });
    await col('scheduled_followups').updateMany({ status: HELD }, { $set: { status: 'pending' } });
    await fetch(`${AI}/dev/clock/reset`, { method: 'POST' });
  }
}

// --- The run --------------------------------------------------------------------------------------------------------
async function scenario(t0) {
  const want = (n) => !ONLY.length || ONLY.includes(String(n));
  const L = {};
  // Day 1, 09:30 Monday: the morning's leads.
  L.a = await newLead('a', { name: 'Avery Walker', comments: 'Is the 2023 Toyota Tacoma SR5 still available?' });
  L.tradein = await newLead('tradein', { name: 'Ken Trader', source: 'KBB Instant Cash Offer',
    comments: 'Got a KBB instant offer for my 2018 Honda Accord, want to trade it in for the 2022 RAV4 XLE.' });
  L.b = await newLead('b', { name: 'Bella Reply', comments: 'Interested in the 2025 Toyota Camry SE.' });
  L.c = await newLead('c', { name: 'Carl Yes', comments: 'Looking at the 2022 Ford F-150 XLT.' });
  L.n = await newLead('n', { name: 'Nora No', comments: 'Looking at the 2024 Toyota Highlander Limited.' });
  L.i = await newLead('i', { name: 'Ian Optout', comments: 'Interested in the 2021 Toyota Camry LE.' });
  L.sp = await newLead('sp', { name: 'Sam Pending', comments: 'Interested in the 2023 Honda CR-V EX.' });
  L.un = await newLead('un', { name: 'Uma Unsold', comments: 'Interested in the 2022 Ford Mustang GT.' });
  L.lost = await newLead('lost', { name: 'Lola Lost', comments: 'Interested in the 2021 Honda Civic LX.' });
  L.sd = await newLead('sd', { name: 'Dana Delivered', comments: 'Interested in the 2025 Toyota RAV4 XLE Hybrid.' });
  L.sd2 = await newLead('sd2', { name: 'Ned Nolonger', comments: 'Interested in the 2023 Chrysler Pacifica Touring.' });
  for (const l of Object.values(L)) await quiet(firstReply(l));

  // ---- 1a. Touch 1 ------------------------------------------------------------------------------------------------
  const t1 = await delivered(await outbound(L.a, { status: 'sent' }));
  const touch1 = t1[0];
  const t1Text = touch1?.record?.mail_content || touch1?.text || '';
  check('1a. Touch 1 sent through the CRM with the required structure and ends "what are you driving now?"',
    Boolean(touch1) && /^(Hi Avery,\s+)?Hello Avery, this is \S+ from Autopulse Demo Motors in Springfield, IL\. Thank you for your interest in our 2023 Toyota Tacoma.*I am excited to help you with your purchase\./s.test(t1Text)
      && /Tell me, what are you driving now\?\s*$/.test(t1Text),
    `${touch1?.channel}: "${clip(t1Text, 160)}"`);
  info('1a. Touch 1 channels', `${channels(t1) || 'none'} (Touch 1 is the reply to the lead, on its own channel)`);
  const tradeT1 = (await delivered(await outbound(L.tradein, { status: 'sent' })))[0];
  const tradeText = tradeT1?.record?.mail_content || '';
  check('1b. a trade-in lead\'s Touch 1 does not ask "what are you driving now?"',
    Boolean(tradeT1) && !/what are you driving now/i.test(tradeText), `"${clip(tradeText, 120)}"`);
  const timer1 = touch1 && await callTimerAfter(L.a, touch1.turn_id);
  check('1c. a 60-minute call-task timer starts after Touch 1',
    Boolean(timer1) && Math.abs(timer1.due_at - (touch1.sent_at || touch1.created_at) - 3_600_000) < 120_000,
    timer1 ? `due ${local(timer1.due_at)}` : 'no call_task timer');

  // Staff move four leads right away: Sold Pending, Unsold, two Sold Delivered (with a DealerVault birth date).
  const bday = new Date(t0.getTime() + 10 * 86_400_000);
  const bdayMDY = `${Number(localDate(bday).slice(5, 7))}/${Number(localDate(bday).slice(8, 10))}/1984`;
  await col('deals').insertOne({ dealer_id: String(dealer._id), deal_number: `CAD-${runNum}`, customer_id: L.sd.lead.customer_id,
    'Birth Date': bdayMDY, Year: '2025', Make: 'Toyota', Model: 'RAV4', cadence_check: true, createdAt: new Date() });
  const sp = await staffStatus(L.sp, { status: 'Visited', manager_outcome: 'Sold Pending' });
  const un = await staffStatus(L.un, { status: 'Visited', manager_outcome: 'Unsold' });
  const sd = await staffStatus(L.sd, { status: 'Visited', manager_outcome: 'Sold Delivered' });
  const sd2 = await staffStatus(L.sd2, { status: 'Visited', manager_outcome: 'Sold Delivered' });
  info('staff outcomes', `HTTP ${sp.status}/${un.status}/${sd.status}/${sd2.status}`);
  const spState = await stageIs(L.sp, 'sold_pending');
  const unState = await stageIs(L.un, 'contact_made_no_next_action') || await state(L.un);
  const sdState = await stageIs(L.sd, 'sold_delivered');
  await stageIs(L.sd2, 'sold_delivered');

  // ---- 3a. A reply within the hour: no name nudge, no call task, the queued touch is replaced --------------------
  const bTouch1 = (await outbound(L.b, { status: 'sent' }))[0];
  await walkTo(new Date(t0.getTime() + 10 * 60_000));
  const bPendingBefore = await followups(L.b, 'cadence_touch', { status: 'pending' });
  const bAnswer = await replyAndWait(L.b, 'Yes, still interested. What colors does it come in?');
  const bTimer = bTouch1 && await callTimerAfter(L.b, bTouch1.turn_id);
  const bPendingAfter = await followups(L.b, 'cadence_touch', { status: 'pending' });
  check('3a. a reply within the hour cancels the call-task timer',
    bTimer?.status === 'cancelled', bTimer ? `timer ${bTimer.status}: ${bTimer.reason}` : 'no timer');
  check('3b. a reply stops the queued touch: Touch 2 (the name nudge) is replaced by Touch 3 on Day 2',
    bPendingBefore[0]?.touch?.touch_number === 2 && bPendingAfter.length === 1 && bPendingAfter[0].touch?.touch_number === 3
      && dayDiff(t0, bPendingAfter[0].due_at) === 1,
    `before: touch ${bPendingBefore[0]?.touch?.touch_number} ${bPendingBefore[0] && local(bPendingBefore[0].due_at)}; after: `
      + bPendingAfter.map((f) => `touch ${f.touch?.touch_number} ${local(f.due_at)}`).join(', ')
      + `; AI answered: "${clip(bAnswer.at(-1)?.text, 60)}"`);

  // ---- 7a. Opt-out of texts right after Touch 1 ----------------------------------------------------------------
  await replyAndWait(L.i, 'STOP');
  // Closed - Lost by staff while a touch is queued.
  const lostQueued = await followups(L.lost, 'cadence_touch', { status: 'pending' });
  const lost = await staffStatus(L.lost, { status: 'Closed - Lost' });
  const lostState = await stageIs(L.lost, 'closed_lost');
  const lostAfter = await followups(L.lost, null, { status: 'pending' });
  check('5h. Closed - Lost stops the lead: the queued touch is cancelled, nothing left pending',
    lost.status === 200 && Boolean(lostState) && lostQueued.length >= 1 && lostAfter.length === 0,
    `HTTP ${lost.status}, ${lostQueued.length} queued before, ${lostAfter.length} pending after`);
  const tradeLost = await staffStatus(L.tradein, { status: 'Closed - Lost' });
  if (tradeLost.status !== 200) info('trade-in lead', `Closed - Lost HTTP ${tradeLost.status}`);

  // Appointments: staff book Thursday 14:00 (C, will say Y and not show) and Thursday 11:00 (N, says N, visits).
  const thu = localDate(await toLocal(3, '12:00', t0));
  const cBook = await staffStatus(L.c, { status: 'Appointment Booked', booking_date: thu, booking_time: '14:00' });
  const nBook = await staffStatus(L.n, { status: 'Appointment Booked', booking_date: thu, booking_time: '13:00' });
  const cAppt = await stageIs(L.c, 'appointment_set');
  await stageIs(L.n, 'appointment_set');
  await sleep(1000);
  const cSteps = await followups(L.c, null, { status: 'pending', kind: { $regex: '^appointment_' } });
  check('4a. bookings made in the CRM plan the appointment messages the appointment messages: countdown, day-before confirmation, +1h check',
    cBook.status === 200 && nBook.status === 200 && Boolean(cAppt)
      && cSteps.some((f) => f.kind === 'appointment_countdown' && localParts(f.due_at).weekday === 'Tue')
      && cSteps.some((f) => f.kind === 'appointment_confirm' && localParts(f.due_at).weekday === 'Wed')
      && cSteps.some((f) => f.kind === 'appointment_no_show_check' && localParts(f.due_at).hm === '15:00'),
    `HTTP ${cBook.status}/${nBook.status}: ${cSteps.map((f) => `${f.kind.replace('appointment_', '')} ${local(f.due_at)}`).join(', ')}`);
  const cCadence = await followups(L.c, 'cadence_touch', { status: 'pending' });
  check('4b. Appointment Set stops the Short-Term cadence (no touch queued)', cCadence.length === 0,
    `${cCadence.length} pending cadence touch(es)`);

  // ---- 2pm-ish: after Touch 2 ---------------------------------------------------------------------------------------
  await completeOpenCallTasks(L.a);
  await walkTo(await toLocal(0, '13:00', t0));
  const aT2 = (await followups(L.a, 'cadence_touch')).find((f) => f.touch?.touch_number === 2);
  const aT2Sent = aT2 && await bothChannels(L.a, aT2);
  const sentAt = aT2Sent?.sms?.sent_at || aT2Sent?.email?.sent_at;
  check('1d. Touch 2 is exactly "{FirstName}?" 3 hours after Touch 1, on text AND email',
    aT2?.status === 'sent' && aT2Sent.both && aT2Sent.sms.text.trim() === 'Avery?'
      && Math.abs(new Date(sentAt) - new Date(touch1.sent_at) - 3 * 3_600_000) < 5 * 60_000,
    aT2 ? `${aT2.status} ${local(sentAt || aT2.due_at)}: sms "${clip(aT2Sent?.sms?.text, 30)}", email "${clip(aT2Sent?.email?.text, 40)}"`
      : 'no Touch 2');
  const aAfterT2 = await state(L.a);
  check('1e. Touch 1 + Touch 2 unanswered: the lead is No Contact Made', aAfterT2?.stage === 'no_contact_made',
    aAfterT2?.stage_label);
  const iT2 = (await followups(L.i, 'cadence_touch')).find((f) => f.touch?.touch_number === 2);
  const iT2Sent = iT2 && await bothChannels(L.i, iT2);
  const iState = await state(L.i);
  check('7a. after STOP by text, Touch 2 goes by email only, and the lead is not Opted Out',
    iT2?.status === 'sent' && Boolean(iT2Sent?.email) && !iT2Sent?.sms && iState?.stage !== 'opted_out'
      && !(iT2Sent.msgs.some((m) => m.channel === 'sms' && m.status === 'sent')),
    `touch 2 ${iT2?.status}: ${iT2Sent?.msgs.map((m) => `${m.channel} ${m.status}`).join(', ')}; stage ${iState?.stage}`);

  // ---- Section 8: per-state hours, on the late dealer --------------------------------------------------------------
  if (want(8)) {
    await walkTo(await toLocal(0, '17:45', t0));
    L.ky = await newLead('ky', { name: 'Kara Kentucky', area: '502', comments: 'Interested in the 2023 Toyota Tacoma SR5.',
      forDealer: lateDealer });
    L.tx = await newLead('tx', { name: 'Tex Texas', area: '214', comments: 'Interested in the 2023 Toyota Tacoma SR5.',
      forDealer: lateDealer });
    await quiet(firstReply(L.ky));
    await quiet(firstReply(L.tx));
    const kyT2 = (await followups(L.ky, 'cadence_touch')).find((f) => f.touch?.touch_number === 2);
    const txT2 = (await followups(L.tx, 'cadence_touch')).find((f) => f.touch?.touch_number === 2);
    check('8a. Kentucky (502): Touch 2 due 20:45 CT = 21:45 ET is held to KY\'s 10:00 ET the next morning',
      Boolean(kyT2) && localParts(kyT2.due_at, 'America/New_York').hm === '10:00' && dayDiff(t0, kyT2.due_at) === 1,
      kyT2 ? `planned ${local(kyT2.touch?.due_at)} CT -> due ${local(kyT2.due_at, { tz: 'America/New_York' })} ET; ${clip(kyT2.reason, 90)}`
        : 'no Touch 2');
    check('8b. Texas (214): the same 20:45 CT touch is inside TX\'s 9:00-21:00 and is not held',
      Boolean(txT2) && localParts(txT2.due_at).hm === '20:45' && !txT2.reason,
      txT2 ? `due ${local(txT2.due_at)} CT` : 'no Touch 2');
  }

  // ---- Section 6: after-hours leads at 21:30 ------------------------------------------------------------------------
  if (want(6)) {
    await walkTo(await toLocal(0, '21:30', t0));
    L.h1 = await newLead('h1', { name: 'Hana Now', comments: 'Hi, I want a new Toyota RAV4' });
    L.h2 = await newLead('h2', { name: 'Hugo Later', comments: 'Hi, I want a new Toyota RAV4' });
    const h1First = (await quiet(firstReply(L.h1)))?.[0];
    const h2First = (await quiet(firstReply(L.h2)))?.[0];
    const offered = (s) => s?.conversation?.after_hours?.choice;
    check('6a. an after-hours lead gets the choice message (help now, or the team at opening)',
      /9:00|open/i.test(h1First?.text || '') && offered(await state(L.h1)) === 'offered',
      `"${clip(h1First?.text, 150)}"`);
    const h1Answer = await replyAndWait(L.h1, 'now is fine');
    check('6b. "now": the conversation carries on at night, no morning message queued',
      offered(await state(L.h1)) === 'now' && (await followups(L.h1, 'resume_at_opening', { status: 'pending' })).length === 0
        && Boolean(h1Answer.length),
      `"${clip(h1Answer.at(-1)?.text, 80)}"`);
    const h2Answer = await replyAndWait(L.h2, 'tomorrow is fine');
    const resume = (await followups(L.h2, 'resume_at_opening', { status: 'pending' }))[0];
    check('6c. "next business day": a short thank-you, and the morning message is queued for 9:00',
      offered(await state(L.h2)) === 'later' && resume && localParts(resume.due_at).hm === '09:00',
      `"${clip(h2Answer.at(-1)?.text, 70)}"; due ${resume && local(resume.due_at)}`);
    void h2First;
  }

  // ---- Day 2 morning --------------------------------------------------------------------------------------------
  await completeOpenCallTasks(L.a);
  await walkTo(await toLocal(1, '09:05', t0));
  if (want(6)) {
    const resumed = (await followups(L.h2, 'resume_at_opening'))[0];
    const morning = resumed && (await outbound(L.h2, { status: 'sent' })).filter((m) => m.created_at >= resumed.due_at);
    check('6d. at 9:00 the morning message goes out ("the team is in")',
      resumed?.status === 'sent' && morning.some((m) => /team is in|we're open|we are open/i.test(m.text)),
      `${resumed?.status}: "${clip(morning?.[0]?.text, 80)}"`);
  }
  if (want(8)) {
    const kyT2 = (await followups(L.ky, 'cadence_touch')).find((f) => f.touch?.touch_number === 2);
    const txT2 = (await followups(L.tx, 'cadence_touch')).find((f) => f.touch?.touch_number === 2);
    const kySent = kyT2 && await bothChannels(L.ky, kyT2);
    const txSent = txT2 && await bothChannels(L.tx, txT2);
    check('8c. both nudges went out, each inside its own state\'s window (TX the same evening, KY the next morning)',
      Boolean(kySent?.sms) && Boolean(txSent?.sms)
        && localParts(kySent.sms.sent_at, 'America/New_York').hour >= 10 && localParts(txSent.sms.sent_at).hm < '21:00',
      `TX sent ${txSent?.sms && local(txSent.sms.sent_at)} CT, KY sent ${kySent?.sms && local(kySent.sms.sent_at, { tz: 'America/New_York' })} ET`);
  }

  // ---- 3c. Day 2: "call me Friday" -------------------------------------------------------------------------------
  await walkTo(await toLocal(1, '11:00', t0));
  const bFriday = await replyAndWait(L.b, 'I am busy this week, can you call me Friday?');
  const bSpecific = await stageIs(L.b, 'contact_made_specific_followup');
  const bNext = (await followups(L.b, 'next_action', { status: 'pending' }))[0];
  const bQueued = await followups(L.b, 'cadence_touch', { status: 'pending' });
  const bCreated = bSpecific?.opportunity_created_at;
  check('3c. "call me Friday": Specific Follow-Up, the check-back dated Friday, no cadence touch queued',
    Boolean(bSpecific) && bNext && localParts(bNext.due_at).weekday === 'Fri' && bQueued.length === 0,
    `${bSpecific?.stage_label}; next step ${bNext && local(bNext.due_at)}; "${clip(bFriday.at(-1)?.text, 60)}"`);

  // ---- Walk the first week, finishing each call task the way staff would ------------------------------------------
  for (let day = 1; day <= 7; day += 1) {
    // 11:10: the 10:00 touch's call task has opened at 11:00; staff work it, so the next touch starts a new timer.
    await walkTo(await toLocal(day, '11:10', t0));
    await completeOpenCallTasks(L.a);
    if (day === 2) {
      // Wednesday: C says Y to the day-before confirmation, N says N.
      const cConfirm = (await followups(L.c, 'appointment_confirm'))[0];
      const cMsg = cConfirm && await bothChannels(L.c, cConfirm);
      check('4c. the day-before confirmation goes out Wednesday on text AND email with the client\'s wording',
        cConfirm?.status === 'sent' && cMsg.both && /Does this time still work\? Please reply Y for Yes or N for No/.test(cMsg.sms.text),
        `${cConfirm?.status} ${cConfirm && local(cConfirm.due_at)}: "${clip(cMsg?.sms?.text, 120)}"`);
      const cCount = (await followups(L.c, 'appointment_countdown'))[0];
      const cCountMsg = cCount && await bothChannels(L.c, cCount);
      check('4d. the countdown message goes out Tuesday (text + email) with the client\'s wording',
        cCount?.status === 'sent' && cCountMsg.both && /Counting down to our meeting at/.test(cCountMsg.sms.text),
        `${cCount && local(cCount.due_at)}: "${clip(cCountMsg?.sms?.text, 70)}"`);
      info('4d. countdown photo', cCountMsg?.sms?.media_urls?.length ? cCountMsg.sms.media_urls[0]
        : 'GAP: no photo - the vehicle is only known by name (Touch 1 named it; no VIN shown yet), see stream_F.md');
      await replyAndWait(L.c, 'Y');
      const cState = await state(L.c);
      check('4e. "Y" marks the appointment confirmed and keeps Appointment Set',
        cState?.appointment?.confirmed === true && cState?.stage === 'appointment_set',
        `confirmed ${cState?.appointment?.confirmed}, ${cState?.stage_label}`);
      const nAnswer = await replyAndWait(L.n, 'N');
      const nState = await state(L.n);
      check('4f. "N" does not confirm and offers new times',
        nState?.appointment?.confirmed !== true && /\d{1,2}(:\d{2})?\s*(am|pm)|what (day|time)|another (day|time)|reschedul/i.test(nAnswer.map((m) => m.text).join(' ')),
        `"${clip(nAnswer.at(-1)?.text, 120)}"`);
    }
    if (day === 3) {
      // Thursday 11:10: N's customer walks in (before the 13:00 appointment): Sales Visit.
      const visit = await staffStatus(L.n, { status: 'Visited', manager_outcome: 'Unsold' });
      await sleep(2000);
      const booking = await col('bookings').findOne({ lead_id: String(L.n.lead._id) });
      const nLeft = (await followups(L.n, null, { status: 'pending' })).filter((f) => f.kind.startsWith('appointment_'));
      check('4g. Sales Visit marks the appointment showed and stops the appointment messages',
        visit.status === 200 && booking?.showed === true && nLeft.length === 0,
        `HTTP ${visit.status}, showed ${booking?.showed}, ${nLeft.length} appointment step(s) left`);
    }
  }
  // ---- 1f-1h. The first week's touches --------------------------------------------------------------------------
  const aTouches = (await followups(L.a, 'cadence_touch')).filter((f) => f.status === 'sent');
  const themes = ['vehicle_visual', 'financing_help', 'trade_in', 'vehicle_value', 'appointment_value', 'direct_close'];
  const themeWords = { vehicle_visual: /tacoma|photo|picture|look|color|colour|see it/i, financing_help: /financ|payment/i,
    trade_in: /trade|apprais|driving now|current (car|vehicle)|put (it )?towards/i, vehicle_value: /feature|mile|trim|SR5|equipped|tacoma/i,
    appointment_value: /visit|come in|coming in|stop by|appointment|in person|test drive/i,
    direct_close: /still (considering|interested|thinking)|what day|which day|time works|set a time/i };
  const week = [];
  for (const n of [3, 4, 5, 6, 7, 8]) {
    const f = aTouches.find((x) => x.touch?.touch_number === n);
    const m = f && await bothChannels(L.a, f);
    week.push({ n, f, m, day: f && dayDiff(t0, m?.sms?.sent_at || m?.email?.sent_at || f.due_at) + 1 });
  }
  const days = week.map((w) => w.day);
  check('1f. Touches 3-8 go out one a day (Days 2-7, a closed Sunday moves to Monday), never two on one day',
    week.every((w) => w.f) && new Set(days).size === days.length && days.every((d, i) => i === 0 || d > days[i - 1])
      && days[0] === 2,
    week.map((w) => `T${w.n} day ${w.day ?? '-'} ${w.f ? localParts(w.m?.sms?.sent_at || w.f.due_at).weekday : ''}`).join(', '));
  check('1g. each of Touches 3-8 goes on text AND email through the CRM',
    week.every((w) => w.m?.both), week.map((w) => `T${w.n} ${w.m ? channels(w.m.ok) : 'none'}`).join(', '));
  const themeOk = week.map((w, i) => w.f?.touch?.theme === themes[i]
    && themeWords[themes[i]].test(`${w.m?.sms?.text || ''} ${w.m?.email?.text || ''}`));
  check('1h. the touches follow the PDF\'s themes in order: visual, financing, trade-in, feature, visit, close',
    themeOk.every(Boolean), week.map((w, i) => `T${w.n} ${w.f?.touch?.theme}${themeOk[i] ? '' : ' (!)'}: "${clip(w.m?.sms?.text, 50)}"`).join(' | '));
  const photoTouch = week[0].m?.sms;
  info('1h. Touch 3 (vehicle visual) photo', photoTouch?.media_urls?.length ? photoTouch.media_urls[0] : 'no photo attached');
  const timers = [];
  for (const w of week) {
    const turn = w.m?.ok?.[0]?.turn_id;
    const timer = turn && await callTimerAfter(L.a, turn);
    timers.push({ n: w.n, timer, sent: w.m?.ok?.[0]?.sent_at });
  }
  check('1i. every touch starts a 60-minute call-task timer, which opens a staff call task with no reply',
    timers.every((t) => t.timer && Math.abs(t.timer.due_at - new Date(t.sent) - 3_600_000) < 120_000
      && ['activated', 'superseded'].includes(t.timer.status)),
    timers.map((t) => `T${t.n} ${t.timer ? `${t.timer.status} ${localParts(t.timer.due_at).hm}` : 'none'}`).join(', '));
  const tasksA = await col('ai_call_tasks').countDocuments({ lead_id: String(L.a.lead._id) });
  info('1i. staff call tasks opened for lead A', `${tasksA}`);

  // ---- 7b. opt-out: the rest of the week by email only ---------------------------------------------------------
  const iTouches = (await followups(L.i, 'cadence_touch')).filter((f) => f.status === 'sent');
  const iMsgs = await outbound(L.i, { status: 'sent' });
  const iFirst = iMsgs[0];
  const iSmsAfter = iMsgs.filter((m) => m.channel === 'sms' && m.created_at > iFirst.created_at
    && !/unsubscribed|opted out|won't (text|receive)|no more texts|STOP/i.test(m.text));
  check('7b. after the text opt-out the cadence carries on by email (no marketing text sent)',
    iTouches.length >= 6 && iSmsAfter.length === 0,
    `${iTouches.length} touches by ${channels(await delivered(iMsgs.filter((m) => m.created_at > iFirst.created_at)))}; `
      + `${iSmsAfter.length} text(s) after STOP`);

  // ---- 3d-3e. Friday's check-back, then no reply ------------------------------------------------------------------
  const bAction = (await followups(L.b, 'next_action'))[0];
  const bActionMsg = bAction && await bothChannels(L.b, bAction);
  check('3d. the specific follow-up fires on Friday, on text AND email',
    bAction?.status === 'sent' && localParts(bActionMsg?.ok?.[0]?.sent_at || bAction.due_at).weekday === 'Fri' && bActionMsg.both,
    `${bAction?.status} ${bAction && local(bAction.due_at)}: ${bActionMsg ? channels(bActionMsg.ok) : '-'} "${clip(bActionMsg?.ok?.[0]?.text, 60)}"`);
  const bTimer2 = bActionMsg?.ok?.[0] && await callTimerAfter(L.b, bActionMsg.ok[0].turn_id);
  check('3e. the specific follow-up also starts a 60-minute call-task timer', Boolean(bTimer2),
    bTimer2 ? `${bTimer2.status} ${local(bTimer2.due_at)}` : 'none');
  const bCheck = (await followups(L.b, 'next_action_check'))[0];
  const bAfter = await state(L.b);
  const bRestart = (await followups(L.b, 'cadence_touch')).filter((f) => f.created_at > (bAction?.due_at || 0));
  check('3f. no reply within 24h: No Contact Made, back into Short-Term, the Day 91 clock not reset',
    bCheck?.status === 'done' && ['no_contact_made'].includes(bAfter?.stage) && bRestart.length >= 1
      && String(bAfter?.opportunity_created_at) === String(bCreated)
      && new Date(bAfter?.cadence?.started_at) > new Date(t0),
    `${bAfter?.stage_label}; cadence restarted ${bAfter?.cadence?.started_at && local(bAfter.cadence.started_at)}; `
      + `opportunity created ${bAfter?.opportunity_created_at?.toISOString?.()} (was ${bCreated?.toISOString?.()})`);

  // ---- 4h-4j. C's no-show --------------------------------------------------------------------------------------
  const noShow = (await followups(L.c, 'appointment_no_show_check'))[0];
  const ns1 = (await followups(L.c, 'appointment_no_show_followup'))[0];
  const ns1Step = await followups(L.c, null, { kind: { $regex: '^appointment_no_show' } });
  const step1 = noShow && await bothChannels(L.c, noShow);
  check('4h. no Sales Visit by appointment + 1h: No Show, and "looking for you in the showroom" on text AND email',
    noShow?.status === 'sent' && localParts(noShow.due_at).hm === '15:00' && step1.both
      && /looking for you in the showroom/i.test(step1.sms.text),
    `${noShow?.status} ${noShow && local(noShow.due_at)}: "${clip(step1?.sms?.text, 90)}"`);
  const step2 = ns1 && await bothChannels(L.c, ns1);
  check('4i. 24 hours later, no reply: "How did everything go when you came in?" on text AND email',
    ns1?.status === 'sent' && step2.both && /How did everything go/i.test(step2.sms.text)
      && Math.abs(ns1.due_at - noShow.due_at - 86_400_000) < 120_000,
    `${ns1?.status} ${ns1 && local(ns1.due_at)}: "${clip(step2?.sms?.text, 90)}"`);
  const cClose = ns1Step.find((f) => f.kind === 'appointment_no_show_close');
  const cNow = await state(L.c);
  check('4j. no reply after step 2: Contact Made - No Next Action, back into the Short-Term cadence',
    cClose?.status && cClose.status !== 'pending' && cNow?.stage === 'contact_made_no_next_action'
      && (await followups(L.c, 'cadence_touch')).some((f) => f.created_at >= cClose.due_at),
    `${cNow?.stage_label}; close step ${cClose?.status} ${cClose && local(cClose.due_at)}`);

  // ---- 5. Unsold, Sold Pending, Sold Delivered so far ---------------------------------------------------------------
  const unNow = await state(L.un);
  check('5a. Unsold: the lead goes back into follow-up (Short-Term cadence, its own 90-day clock)',
    ['contact_made_no_next_action', 'no_contact_made'].includes(unState?.stage)
      && (await followups(L.un, 'cadence_touch')).some((f) => f.status === 'sent'),
    `${unState?.stage_label}; day91_anchor ${unNow?.day91_anchor ? local(unNow.day91_anchor) : 'none'}; `
      + `${(await followups(L.un, 'cadence_touch', { status: 'sent' })).length} touch(es) sent`);
  const checkin = (await followups(L.sd, 'post_delivery_checkin'))[0];
  const checkinMsg = checkin && await bothChannels(L.sd, checkin);
  check('5d. Sold Delivered: the Day-3 check-in goes out on Day 3 (text AND email) and offers the first service',
    Boolean(sdState) && checkin?.status === 'sent' && dayDiff(t0, checkin.due_at) === 3 && checkinMsg.both
      && /enjoying your new/i.test(checkinMsg.sms.text) && /service/i.test(checkinMsg.sms.text),
    `${checkin?.status} ${checkin && local(checkin.due_at)}: "${clip(checkinMsg?.sms?.text, 110)}"`);

  // ---- Walk on to day 91 --------------------------------------------------------------------------------------------
  await walkTo(await toLocal(12, '12:00', t0));
  const birthday = (await followups(L.sd, 'birthday'))[0];
  const bdayMsg = birthday && await bothChannels(L.sd, birthday);
  check('5e. the birthday message goes out on the DealerVault birth date (month/day), text AND email',
    birthday?.status === 'sent' && localDate(birthday.due_at).slice(5) === localDate(bday).slice(5)
      && /Happy Birthday, Dana/i.test(bdayMsg?.sms?.text || ''),
    `${birthday?.status} ${birthday && local(birthday.due_at)} (birth date ${bdayMDY}): "${clip(bdayMsg?.sms?.text, 80)}" `
      + `${bdayMsg ? channels(bdayMsg.ok) : ''}`);

  for (const target of [30, 60, 92]) {
    await walkTo(await toLocal(target, '12:00', t0));
    await completeOpenCallTasks(L.a);
  }
  const aAll = (await followups(L.a, 'cadence_touch')).filter((f) => f.status === 'sent');
  const extended = [];
  for (const f of aAll.filter((x) => x.touch?.touch_number > 8)) {
    const m = await bothChannels(L.a, f);
    extended.push({ f, m, day: dayDiff(t0, m.ok[0]?.sent_at || f.due_at) + 1 });
  }
  const weekly = extended.filter((e) => e.day >= 8 && e.day <= 30).map((e) => e.day);
  const monthly = extended.filter((e) => e.day > 30 && e.day <= 90).map((e) => e.day);
  check('2a. Days 8-30: one touch a week, text AND email',
    weekly.length === 3 && weekly.every((d, i) => i === 0 || d - weekly[i - 1] === 7)
      && extended.filter((e) => e.day <= 30).every((e) => e.m.both),
    `days ${weekly.join(', ')}: ${extended.filter((e) => e.day <= 30).map((e) => `${e.f.touch?.theme} ${channels(e.m.ok)}`).join('; ')}`);
  check('2b. Days 31-90: one touch a month, text AND email',
    monthly.length === 2 && monthly[1] - monthly[0] === 30 && extended.filter((e) => e.day > 30).every((e) => e.m.both),
    `days ${monthly.join(', ')}: ${extended.filter((e) => e.day > 30).map((e) => `${e.f.touch?.theme} ${channels(e.m.ok)}`).join('; ')}`);
  const aEnd = await state(L.a);
  const aLead = await Lead.findById(L.a.lead._id).lean();
  const after91 = (await outbound(L.a, { status: 'sent' })).filter((m) => new Date(m.created_at)
    > new Date(aEnd?.stage_at || aEnd?.closed_at || Date.now() * 2));
  check('2c. Day 91: the lead is Closed - Lost (no response), nothing sent after',
    aEnd?.stage === 'closed_lost' && after91.length === 0 && (await followups(L.a, null, { status: 'pending' })).length === 0,
    `${aEnd?.stage_label} at ${aEnd?.stage_at && local(aEnd.stage_at)} (opportunity created ${local(aEnd?.opportunity_created_at)}); `
      + `CRM status ${aLead?.fe_lead_status}`);
  const spTouches = (await followups(L.sp, 'sold_pending_touch')).filter((f) => f.status === 'sent');
  const spDays = spTouches.map((f) => dayDiff(t0, f.fired_at || f.due_at));
  const spMsgs = [];
  for (const f of spTouches) spMsgs.push(await bothChannels(L.sp, f));
  check('5b. Sold Pending: weeks 1-4 weekly, then every 2 weeks (week 6, week 8, ...), text AND email',
    Boolean(spState) && spDays.slice(0, 6).join(',') === '1,8,15,22,36,50' && spMsgs.every((m) => m.both),
    `days ${spDays.join(', ')}; weeks ${spTouches.map((f) => f.touch?.week).join(', ')}; "${clip(spMsgs[0]?.sms?.text, 70)}"`);
  const spEnd = await state(L.sp);
  check('5c. Sold Pending never expires: still Sold Pending past Day 91, next touch planned',
    spEnd?.stage === 'sold_pending' && (await followups(L.sp, 'sold_pending_touch', { status: 'pending' })).length === 1,
    `${spEnd?.stage_label}; next ${spEnd?.sold_pending?.next_followup_at && local(spEnd.sold_pending.next_followup_at)}`);
  const unEnd = await state(L.un);
  info('5a. Unsold lead at day 92', `${unEnd?.stage_label}`);

  // ---- Anniversary, year 1 ---------------------------------------------------------------------------------------
  // Stop the leads that are done, so the year's walk is only the ownership lifecycle.
  for (const key of Object.keys(L)) if (!['sd', 'sd2'].includes(key)) tracked.delete(String(L[key].lead._id));
  await col('scheduled_followups').updateMany({ lead_id: { $in: Object.keys(L).filter((k) => !['sd', 'sd2'].includes(k))
    .map((k) => String(L[k].lead._id)) }, status: 'pending' }, { $set: { status: 'cancelled', reason: 'crm-cadence-check: done with this lead' } });
  const ann = (await followups(L.sd, 'ownership_anniversary', { status: 'pending' }))[0];
  if (ann) await walkTo(new Date(ann.due_at.getTime() + 60_000));
  const ann1 = (await followups(L.sd, 'ownership_anniversary'))[0];
  const ann2 = (await followups(L.sd2, 'ownership_anniversary'))[0];
  const annMsg = ann1 && await bothChannels(L.sd, ann1);
  check('5f. the ownership anniversary, year 1, goes out a year after delivery: "Do you still have your ...? Reply YES or NO"',
    ann1?.status === 'sent' && ann1.year === 1 && dayDiff(t0, ann1.due_at) >= 365
      && annMsg.ok.every((m) => /Reply YES or NO/i.test(m.text)) && Boolean(annMsg.email)
      && annMsg.msgs.every((m) => m.status === 'sent' || /^BLOCK/.test(m.reason || '')),
    `${ann1?.status} ${ann1 && local(ann1.due_at)}: "${clip(annMsg?.ok?.[0]?.text, 110)}"; `
      + annMsg?.msgs.map((m) => `${m.channel} ${m.status}${m.reason ? ` (${clip(m.reason, 60)})` : ''}`).join(', '));
  await replyAndWait(L.sd, 'YES');
  const yes = await state(L.sd);
  const yesVehicle = await col('ai_vehicle_ownership').findOne({ lead_id: String(L.sd.lead._id) });
  const yesCustomer = await col('ai_customer_status').findOne({ customer_id: String(L.sd.lead.customer_id) });
  check('5g. YES: stays Sold - Delivered, the vehicle ACTIVE (ownership confirmed), the customer ACTIVE, year 2 planned',
    yes?.stage === 'sold_delivered' && yesVehicle?.ownership_status === 'ACTIVE' && Boolean(yesVehicle?.ownership_confirmed_at)
      && yesCustomer?.customer_status === 'ACTIVE'
      && (await followups(L.sd, 'ownership_anniversary', { status: 'pending' })).some((f) => f.year === 2),
    `${yes?.stage_label}, vehicle ${yesVehicle?.ownership_status}, customer ${yesCustomer?.customer_status}`);
  const noAnswer = ann2?.status === 'sent' ? await replyAndWait(L.sd2, 'No, I sold it last month') : [];
  const no = await state(L.sd2);
  const noVehicle = await col('ai_vehicle_ownership').findOne({ lead_id: String(L.sd2.lead._id) });
  const noCustomer = await col('ai_customer_status').findOne({ customer_id: String(L.sd2.lead.customer_id) });
  check('5h. NO: Closed - No Longer Owns, vehicle NO_LONGER_OWNED, "What are you driving now?", customer INACTIVE',
    no?.stage === 'closed_no_longer_owns' && noVehicle?.ownership_status === 'NO_LONGER_OWNED'
      && /what are you driving now/i.test(noAnswer.map((m) => m.text).join(' ')) && noCustomer?.customer_status === 'INACTIVE'
      && (await followups(L.sd2, 'ownership_anniversary', { status: 'pending' })).length === 0,
    `${no?.stage_label}, vehicle ${noVehicle?.ownership_status}, customer ${noCustomer?.customer_status}: "${clip(noAnswer.at(-1)?.text, 70)}"`);
}

main()
  .catch((error) => {
    check('cadence run', false, error.stack?.split('\n').slice(0, 3).join(' | ') || error.message);
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  });
