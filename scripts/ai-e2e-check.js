#!/usr/bin/env node
// End-to-end check of the platform <-> AI wiring (MASTER_PLAN_1 Stage 5 "done
// when"), driven exactly the way real traffic arrives:
//
//   1. New lead for a `live` dealer, queued like POST /api/leads does ->
//      leadworker (no n8n) -> AI service -> template reply -> recorded back
//      as an AI Email in the dealer's conversation.
//   2. The customer texts back through the Twilio webhook (/api/system/sms)
//      -> threaded to the lead by the AI message's phone pair -> processSms
//      (live) -> AI service -> second AI Email.
//   3. A brand-new customer emails the dealer (/api/system) -> emailWorker
//      (live) creates the lead -> AI replies by email.
//   4. The internal endpoints: delivery-status update, and auth required.
//   5. No double messaging and staff takeover (Stage 11): 24h pass with no
//      answer -> the AI switches to email; a staff member replies by hand
//      (/api/conversations/reply) -> the AI pauses and stays silent; the
//      lead has exactly the AI's messages and nothing from n8n (tripwire)
//      or FollowUpJob; an admin hands it back and the AI answers again; a
//      FollowUpJob fired by n8n for a live dealer sends nothing; switching a
//      dealer to live clears its pending FollowUpJobs.
//   6. Shadow (Stage 13): a new lead for the shadow dealer goes to n8n as
//      today; the AI drafts a reply that is never sent, never shown in the
//      dealer's conversation and never followed up, and the Shadow comparison
//      pairs it with what n8n sent.
//   7. Rollback (Stage 13): switching a live dealer to off takes effect within
//      the platform's 60s cache: the next lead goes to n8n, the AI hears
//      nothing. The dealer is switched back to live afterwards.
//
// Prerequisites: `make ai-seed`, then `make dev-full` running (AI stack with
// PLATFORM_CLIENT=live + platform web + workers).  Run: `make ai-e2e`.
import mongoose from 'mongoose';
import { Queue } from 'bullmq';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import jwt from 'jsonwebtoken';

import Email from '../app/models/Email.js';
import FollowUpJob from '../app/models/FollowUpJob.js';
import Lead from '../app/models/Lead.js';
import User from '../app/models/User.js';

// `--crm-local` (make crm-e2e): the checks in crmLocal() below, against a
// running `make crm-local` (its own database, ports and AI service).
const CRM_LOCAL = process.argv.includes('--crm-local');
const MONGODB_URI = CRM_LOCAL
  ? (process.env.CRM_LOCAL_MONGODB_URI || 'mongodb://localhost:27018/autopulse_local')
  : (process.env.AI_DEV_MONGODB_URI || 'mongodb://localhost:27018/pulse');
const PLATFORM = process.env.PLATFORM_URL || `http://localhost:${CRM_LOCAL ? (process.env.CRM_LOCAL_WEB_PORT || 3100) : 3000}`;
const REDIS = CRM_LOCAL
  ? { host: 'localhost', port: Number(process.env.CRM_LOCAL_REDIS_PORT || 6380), db: Number(process.env.CRM_LOCAL_REDIS_DB || 4) }
  : { host: 'localhost', port: Number(process.env.AI_DEV_REDIS_PORT || 6380) };
const LIVE_DEALER = '66f0000000000000000000a1'; // seeded Sunrise Motors (dev), ai_mode live
const ROLLBACK_DEALER = '66f0000000000000000000b2'; // Lakeside Auto (dev), live; switched off and back in section 7
const SHADOW_DEALER = '66f0000000000000000000c3'; // Hillside Cars (dev), ai_mode shadow
const DEALER_MAILBOX = 'sales@sunrise-motors.dev.test';
const TIMEOUT_MS = 30_000;
const AI = process.env.AI_URL || `http://localhost:${CRM_LOCAL ? (process.env.CRM_LOCAL_AI_PORT || 8110) : 8100}`;
const N8N_TRIPWIRE = `http://localhost:${process.env.AI_DEV_N8N_PORT || (CRM_LOCAL ? 3998 : 3999)}/hits`;
// Same default as scripts/ai-dev-full.js, so tokens signed here are accepted there.
const JWT_SECRET = process.env.JWT_SECRET || 'autopulse-local-dev-jwt-secret';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function sharedSecret() {
  if (process.env.UPSELL_SERVICE_SHARED_SECRET) return process.env.UPSELL_SERVICE_SHARED_SECRET;
  if (CRM_LOCAL) return 'autopulse-local-dev-shared-secret'; // scripts/ai-dev-full.js LOCAL_DEV_SECRET
  const file = path.resolve(root, '../agentic-upsell/.env');
  const line = existsSync(file) && readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('UPSELL_SERVICE_SHARED_SECRET='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `  - ${detail}` : ''}`);
  return ok;
}

async function waitFor(what, fn, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const aiLeadState = (leadId) => mongoose.connection.db.collection('ai_lead_state')
  .findOne({ dealer_id: LIVE_DEALER, lead_id: String(leadId) });
const aiFollowups = (leadId) => mongoose.connection.db.collection('scheduled_followups')
  .find({ dealer_id: LIVE_DEALER, lead_id: String(leadId) }).toArray();

async function textIn(phone, dealerSms, body, tag) {
  const sid = `SM${tag}${Math.random().toString(16).slice(2, 10)}`;
  const form = new URLSearchParams({ From: phone, To: dealerSms, Body: body, MessageSid: sid, AccountSid: 'ACe2e',
    NumMedia: '0', SmsStatus: 'received' });
  const response = await fetch(`${PLATFORM}/api/system/sms`, { method: 'POST', body: form,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return { response, sid };
}

async function queueLead(dealer, fields) {
  const queue = new Queue('leadProcessingQueue', { connection: REDIS });
  await queue.add('processLead', {
    leadData: { followup_preference: 'sms', source: 'website', dealer_id: String(dealer._id), ...fields },
    action: 'create', dealer,
    jobData: { currentSMS: { mail_content: fields.comments, dealer_id: String(dealer._id) } },
  }, { attempts: 1 });
  await queue.close();
}

async function setMode(adminToken, dealerId, mode) {
  const response = await fetch(`${PLATFORM}/api/admin/ai-mode`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ dealer_id: dealerId, ai_mode: mode }) });
  return { response, body: await response.json().catch(() => ({})) };
}

async function n8nHits() {
  const response = await fetch(N8N_TRIPWIRE).catch(() => null);
  return response?.ok ? response.json() : null;
}

async function main() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3_000 });
  const dealer = await User.findById(LIVE_DEALER).lean();
  if (!dealer) throw new Error('Seeded dev dealer not found - run `make ai-seed` first.');
  if (dealer.ai_mode !== 'live') throw new Error(`Dev dealer ${LIVE_DEALER} is ai_mode=${dealer.ai_mode}, expected live.`);
  const dealerSms = dealer.dealer_account_information.sms_conversion_phone;
  const run = Date.now().toString().slice(-7);
  const phone = `+1555${run}`;
  const email = `e2e-${run}@example.test`;

  // --- 1. New lead via the platform's lead queue ---------------------------------
  const queue = new Queue('leadProcessingQueue', { connection: REDIS });
  const createdAt = Date.now();
  await queue.add('processLead', {
    leadData: { name: `E2E Customer ${run}`, email, phone, followup_preference: 'sms', source: 'website',
      comments: 'Hi, is the 2024 RAV4 hybrid still available?', dealer_id: LIVE_DEALER },
    action: 'create',
    dealer,
    jobData: { currentSMS: { mail_content: 'Hi, is the 2024 RAV4 hybrid still available?', dealer_id: LIVE_DEALER } },
  }, { attempts: 1 });
  await queue.close();

  const lead = await waitFor('the lead to be created', () => Lead.findOne({ dealer_id: LIVE_DEALER, email }).lean());
  check('1a. leadworker created the lead and linked a customer', Boolean(lead.customer_id));
  const firstReply = await waitFor('the AI first reply to be recorded',
    () => Email.findOne({ lead_id: lead._id, ai_generated: true }).lean());
  check('1b. AI first reply recorded in the conversation', true,
    `${Date.now() - createdAt}ms after the lead was queued: "${firstReply.mail_content.slice(0, 60)}..."`);
  check('1c. sent by SMS from the dealer number to the lead phone',
    firstReply.communication_type === 'sms' && firstReply.sender === dealerSms && firstReply.recipient === phone,
    `${firstReply.sender} -> ${firstReply.recipient}`);
  const n8nStyle = await Email.countDocuments({ lead_id: lead._id, ai_generated: { $ne: true }, status: { $in: ['sent', 'failed', 'draft'] } });
  check('1d. no n8n / platform auto-reply for a live dealer', n8nStyle === 0, `${n8nStyle} non-AI outbound record(s)`);
  const leadMessage = await Email.findOne({ lead_id: lead._id, status: 'incoming' }).lean();
  check('1e. the lead\'s own message is in the conversation', Boolean(leadMessage));

  // --- 2. Customer texts back through the Twilio webhook ----------------------------
  const sid = `SM${run}e2e${Math.random().toString(16).slice(2, 8)}`;
  const form = new URLSearchParams({ From: phone, To: dealerSms, Body: 'Yes! Do you have it in blue?', MessageSid: sid,
    AccountSid: 'ACe2e', NumMedia: '0', SmsStatus: 'received' });
  const webhook = await fetch(`${PLATFORM}/api/system/sms`, { method: 'POST', body: form,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  check('2a. Twilio webhook accepted the reply', webhook.ok, `HTTP ${webhook.status}`);
  const inbound = await waitFor('the inbound SMS to be saved', () => Email.findOne({ message_id: sid }).lean());
  check('2b. the reply was threaded to the lead (via the AI message\'s phone pair)',
    String(inbound.lead_id) === String(lead._id));
  const secondReply = await waitFor('the AI answer to the reply', async () => {
    const replies = await Email.find({ lead_id: lead._id, ai_generated: true }).lean();
    return replies.length >= 2 ? replies.find((r) => String(r._id) !== String(firstReply._id)) : null;
  });
  check('2c. AI answered the reply and it is in the conversation', true, `"${secondReply.mail_content.slice(0, 60)}..."`);

  // --- 3. A new customer emails the dealer --------------------------------------------
  const fromEmail = `newcomer-${run}@example.test`;
  const emailResp = await fetch(`${PLATFORM}/api/system`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: `Nia Newcomer <${fromEmail}>`, recipient: DEALER_MAILBOX, subject: 'Service question',
      message_id: `<e2e-${run}@mail.test>`, date: new Date().toISOString(), body: 'Can I book an oil change for my Civic?' }),
  });
  check('3a. inbound email accepted by /api/system', emailResp.ok, `HTTP ${emailResp.status}`);
  const emailLead = await waitFor('the email lead to be created', () => Lead.findOne({ dealer_id: LIVE_DEALER, email: fromEmail }).lean());
  check('3b. emailWorker (live) created the lead from the From header', emailLead.name === 'Nia Newcomer');
  const emailReply = await waitFor('the AI email reply', () => Email.findOne({ lead_id: emailLead._id, ai_generated: true }).lean());
  check('3c. AI replied by email from the dealer mailbox',
    emailReply.communication_type === 'email' && emailReply.sender === DEALER_MAILBOX && emailReply.recipient === fromEmail,
    `${emailReply.sender} -> ${emailReply.recipient}, subject "${emailReply.subject}"`);

  // --- 4. Internal endpoints ------------------------------------------------------------
  const secret = sharedSecret();
  const status = await fetch(`${PLATFORM}/api/internal/ai/messages/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ dealer_id: LIVE_DEALER, provider_id: firstReply.message_id, status: 'delivered' }),
  });
  const statusBody = await status.json().catch(() => ({}));
  const afterStatus = await Email.findById(firstReply._id).lean();
  check('4a. delivery status update reaches the conversation record',
    status.ok && statusBody.updated === true && afterStatus.ai_delivery_status === 'delivered',
    `HTTP ${status.status}, ai_delivery_status=${afterStatus.ai_delivery_status}`);
  const noAuth = await fetch(`${PLATFORM}/api/internal/ai/messages`, { method: 'POST', body: '{}',
    headers: { 'Content-Type': 'application/json' } });
  check('4b. internal endpoint rejects calls without the shared secret', noAuth.status === 401, `HTTP ${noAuth.status}`);

  // --- 5. No double messaging and staff takeover (Stage 11) -----------------------------
  // 5a. The customer doesn't answer the AI's last SMS for a day.
  const aiBefore = await Email.countDocuments({ lead_id: lead._id, ai_generated: true });
  const advanced = await fetch(`${AI}/dev/clock/advance`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seconds: 24 * 3600 + 120 }) });
  try {
    const switched = await waitFor('the 24h channel switch to email', () => Email.findOne({
      lead_id: lead._id, ai_generated: true, ai_fallback: true, communication_type: 'email' }).lean());
    check('5a. 24h without an answer: the AI sent the same message by email', advanced.ok && switched.recipient === email,
      `"${(switched.subject || '').slice(0, 40)}" -> ${switched.recipient}`);
  } finally {
    await fetch(`${AI}/dev/clock/reset`, { method: 'POST' });
  }

  // 5b. A salesperson replies by hand from the conversation screen.
  const staffToken = jwt.sign({ userId: LIVE_DEALER, type: 'dealer' }, JWT_SECRET, { expiresIn: '10m' });
  const staffReply = await fetch(`${PLATFORM}/api/conversations/reply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({ parent_message_id: sid, content: 'Hi, this is Sam from Sunrise Motors - calling you shortly!',
      communicationType: 'sms' }),
  });
  // The local Twilio credentials are placeholders, so the SMS itself fails
  // (HTTP 500) - the staff message is still recorded and the AI still pauses.
  const staffRecord = await waitFor('the staff message record', () => Email.findOne({
    lead_id: lead._id, message_by: { $ne: null }, mail_content: /Sam from Sunrise/ }).lean());
  check('5b. staff reply recorded in the conversation', Boolean(staffRecord), `HTTP ${staffReply.status}, status ${staffRecord.status}`);
  const paused = await waitFor('the AI to pause the lead', async () => {
    const state = await aiLeadState(lead._id);
    return state?.status === 'paused' ? state : null;
  });
  check('5c. the AI paused the lead because staff replied', true, paused.status_reason);
  const pending = (await aiFollowups(lead._id)).filter((f) => f.status === 'pending');
  check('5d. no AI follow-up left pending after the takeover', pending.length === 0, `${pending.length} pending`);

  // 5e. The customer texts again: saved, not answered by the AI.
  const aiAfterStaff = await Email.countDocuments({ lead_id: lead._id, ai_generated: true });
  const later = await textIn(phone, dealerSms, 'Great, talk soon', run);
  await waitFor('the customer\'s message to be saved', () => Email.findOne({ message_id: later.sid }).lean());
  await sleep(4_000);
  const aiNow = await Email.countDocuments({ lead_id: lead._id, ai_generated: true });
  check('5e. the AI stays silent on a paused lead', aiNow === aiAfterStaff, `${aiNow - aiAfterStaff} new AI message(s)`);

  // 5f. The lead's whole conversation: only AI messages and the staff reply went out.
  const outbound = await Email.find({ lead_id: lead._id, status: { $nin: ['incoming', 'received'] } }).lean();
  const unexpected = outbound.filter((m) => !m.ai_generated && String(m._id) !== String(staffRecord._id));
  check('5f. exactly the AI\'s messages (+ the staff reply) went to this customer', unexpected.length === 0,
    `${aiNow} AI message(s) (${aiBefore} before the switch), ${unexpected.length} other`);
  const jobs = await FollowUpJob.countDocuments({ leadId: lead._id });
  check('5g. no rule-based FollowUpJob for this lead', jobs === 0, `${jobs} job(s)`);
  const hits = await n8nHits();
  const leadHits = hits?.filter((h) => h.body.includes(run)) ?? [];
  check('5h. n8n was never called for this live lead (tripwire)', hits !== null && leadHits.length === 0,
    hits === null ? 'tripwire not reachable - run `make dev-full`' : `${leadHits.length} of ${hits.length} tripwire call(s)`);

  // 5i. An admin hands the lead back; the next message gets an AI answer.
  const adminToken = jwt.sign({ userId: 'e2e-admin', type: 'admin' }, JWT_SECRET, { expiresIn: '10m' });
  const resume = await fetch(`${PLATFORM}/api/admin/ai/leads/${lead._id}/resume`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
  const active = await waitFor('the AI to resume the lead', async () => {
    const state = await aiLeadState(lead._id);
    return state?.status === 'active' ? state : null;
  });
  check('5i. admin "hand back to AI" resumes the lead', resume.ok && Boolean(active), `HTTP ${resume.status}`);
  await textIn(phone, dealerSms, 'Actually, can you text me the price?', run);
  await waitFor('the AI to answer after resume',
    async () => (await Email.countDocuments({ lead_id: lead._id, ai_generated: true })) > aiNow);
  check('5j. after hand-back the AI answers again', true);
  const profile = await fetch(`${PLATFORM}/api/admin/ai/leads/${lead._id}/profile`,
    { headers: { Authorization: `Bearer ${adminToken}` } });
  const profileBody = await profile.json().catch(() => ({}));
  check('5k. admin can read what the AI knows about the lead', profile.ok && profileBody.lead?.id === String(lead._id),
    `status ${profileBody.lead?.status}, ${profileBody.required?.filled}/${profileBody.required?.total} required`);
  const forbidden = await fetch(`${PLATFORM}/api/admin/ai/leads/${lead._id}/resume`,
    { method: 'POST', headers: { Authorization: `Bearer ${staffToken}` } });
  check('5l. admin AI routes refuse a dealer token', forbidden.status === 403, `HTTP ${forbidden.status}`);

  // 5m. n8n fires an old rule-based FollowUpJob for a live dealer: nothing is sent.
  const job = await FollowUpJob.create({ leadId: lead._id, ruleId: 'e2e-rule', dealer_id: LIVE_DEALER, runIndex: 1,
    status: 'pending', scheduledAt: new Date() });
  const before = await Email.countDocuments({ lead_id: lead._id });
  const fired = await fetch(`${PLATFORM}/api/conversations/followup`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ followup_id: String(job._id), response: 'Just checking in!', source: 'n8n' }) });
  const firedBody = await fired.json().catch(() => ({}));
  const jobAfter = await FollowUpJob.findById(job._id).lean();
  check('5m. a FollowUpJob for a live dealer sends nothing', firedBody.skipped === true
    && jobAfter.status === 'completed' && (await Email.countDocuments({ lead_id: lead._id })) === before,
    `HTTP ${fired.status}: ${firedBody.reason ?? firedBody.error}`);

  // 5n. Switching a dealer to live clears its pending FollowUpJobs.
  await FollowUpJob.create({ leadId: lead._id, ruleId: 'e2e-rule', dealer_id: LIVE_DEALER, runIndex: 2,
    status: 'pending', scheduledAt: new Date(Date.now() + 86_400_000) });
  const mode = await fetch(`${PLATFORM}/api/admin/ai-mode`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ dealer_id: LIVE_DEALER, ai_mode: 'live' }) });
  const modeBody = await mode.json().catch(() => ({}));
  const leftover = await FollowUpJob.countDocuments({ dealer_id: LIVE_DEALER, status: 'pending' });
  check('5n. switching a dealer to live clears its pending FollowUpJobs',
    mode.ok && modeBody.follow_up_jobs_cleared >= 1 && leftover === 0,
    `cleared ${modeBody.follow_up_jobs_cleared}, ${leftover} left`);

  // --- 6. Shadow dealer (Stage 13) ---------------------------------------------------------
  const shadowDealer = await User.findById(SHADOW_DEALER).lean();
  if (!shadowDealer || shadowDealer.ai_mode !== 'shadow') {
    check('6. shadow dealer seeded', false, 'run `make ai-seed` (creates Hillside Cars, ai_mode shadow)');
  } else {
    const shadowPhone = `+1556${run}`;
    await queueLead(shadowDealer, { name: `Shadow Customer ${run}`, phone: shadowPhone, email: `shadow-${run}@example.test`,
      comments: `Do you have the Tacoma in stock? (${run})` });
    const shadowLead = await waitFor('the shadow dealer\'s lead', () => Lead.findOne({ dealer_id: SHADOW_DEALER, phone: shadowPhone }).lean());
    const draft = await waitFor('the AI shadow draft', () => mongoose.connection.db.collection('ai_messages').findOne(
      { dealer_id: SHADOW_DEALER, lead_id: String(shadowLead._id), direction: 'outbound' }));
    check('6a. the AI drafted a reply for the shadow dealer and did not send it', draft.status === 'shadow',
      `status ${draft.status}: "${(draft.text || '').slice(0, 60)}..."`);
    const shadowHits = ((await n8nHits()) ?? []).filter((h) => h.body.includes(run) && h.body.includes('Tacoma'));
    check('6b. n8n still handled the shadow dealer\'s lead, as today', shadowHits.length >= 1, `${shadowHits.length} n8n call(s)`);
    await sleep(3_000);
    const aiRecords = await Email.countDocuments({ lead_id: shadowLead._id, ai_generated: true });
    check('6c. no AI message in the dealer\'s conversation screen', aiRecords === 0, `${aiRecords} AI record(s)`);
    const shadowFollowups = await mongoose.connection.db.collection('scheduled_followups')
      .countDocuments({ dealer_id: SHADOW_DEALER, lead_id: String(shadowLead._id) });
    check('6d. no follow-up scheduled in shadow mode', shadowFollowups === 0, `${shadowFollowups} follow-up(s)`);
    const comparison = await fetch(`${AI}/dev/shadow?dealer_id=${SHADOW_DEALER}&days=1`).then((r) => r.json());
    const pair = comparison.pairs?.find((p) => p.lead_id === String(shadowLead._id));
    check('6e. the Shadow comparison shows the draft next to what n8n sent', Boolean(pair?.ai?.text) && Boolean(pair?.actual),
      pair?.actual ? `n8n: "${pair.actual.text.slice(0, 50)}..."` : 'no platform reply paired');
  }

  // --- 7. Rollback: live -> off (Stage 13) ----------------------------------------------------
  const rollbackDealer = await User.findById(ROLLBACK_DEALER).lean();
  const off = await setMode(adminToken, ROLLBACK_DEALER, 'off');
  try {
    check('7a. admin switched the dealer to off', off.response.ok && off.body.effective_mode === 'off',
      `HTTP ${off.response.status}`);
    // The workers cache each dealer's mode for 60s (aiMode.js): wait it out.
    await sleep(61_000);
    const offPhone = `+1557${run}`;
    await queueLead({ ...rollbackDealer, ai_mode: 'off' }, { name: `Rollback Customer ${run}`, phone: offPhone,
      email: `rollback-${run}@example.test`, comments: `Rollback check (${run})` });
    const offLead = await waitFor('the lead after rollback', () => Lead.findOne({ dealer_id: ROLLBACK_DEALER, phone: offPhone }).lean());
    await sleep(4_000);
    const offHits = ((await n8nHits()) ?? []).filter((h) => h.body.includes(`Rollback check (${run})`));
    const aiState = await mongoose.connection.db.collection('ai_lead_state')
      .findOne({ dealer_id: ROLLBACK_DEALER, lead_id: String(offLead._id) });
    check('7b. within 60s of rollback the next lead goes to n8n, not the AI', offHits.length >= 1 && !aiState,
      `${offHits.length} n8n call(s), AI ${aiState ? 'DID' : 'did not'} see the lead`);
  } finally {
    const back = await setMode(adminToken, ROLLBACK_DEALER, 'live');
    check('7c. dealer switched back to live', back.response.ok && back.body.effective_mode === 'live');
  }
}

// --- make crm-e2e: the local CRM with the AI sending through it (MASTER_PLAN_4 stream C1) ---
//
//   A. The seeded demo dealer, its login (password + OTP) and what the AI reads
//      from the CRM: dealer profile / hours, stock with photos (/api/car),
//      Customer 360.
//   B. A new lead from each source bucket (Capital One, KBB, CarGurus,
//      Autotrader, website, service) -> the AI's first reply is SENT BY THE CRM
//      (provider stubbed) and is in the lead's conversation; n8n never called;
//      no rule-based FollowUpJob.
//   C. The customer texts back -> the AI answers, again through the CRM.
//   D. Booking through /api/booking with the shared secret: created, no
//      platform confirmation / reminders for the AI dealer, a second booking
//      of the same slot is refused with 409, a staff booking of it too.
//   E. Staff: Visited + Sold Pending -> the AI's stage follows; then
//      Closed - Lost on the Sold Pending lead reaches the AI.
//   F. DND both ways: the customer opts out of everything with the AI -> the
//      CRM lead is DND with a note; staff set DND -> the AI records the opt-out.
//   G. Photos: a send with media_urls reaches the provider call (stub outbox)
//      and the conversation; AI internal note endpoint.
async function crmLocal() {
  const { DEMO_DEALER_ID, DEMO_DEALER_SMS, DEMO_MAILBOX, DEMO_PASSWORD, DEMO_LEADS } = await import('./seed-local-crm.js');
  const Booking = (await import('../app/models/Booking.js')).default;
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3_000 });
  const db = mongoose.connection.db;
  const dealer = await User.findById(DEMO_DEALER_ID).lean();
  if (!dealer) throw new Error('Demo dealer not found - run `make crm-seed` (or `make crm-local`) first.');
  const secret = sharedSecret();
  const internal = { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` };
  const run = Date.now().toString().slice(-7);
  const state = (leadId) => db.collection('ai_lead_state').findOne({ dealer_id: DEMO_DEALER_ID, lead_id: String(leadId) });
  const aiReplies = (leadId) => Email.find({ lead_id: leadId, ai_generated: true, is_note: { $ne: true } })
    .sort({ timestamp: 1 }).lean();
  const jsonOf = (response) => response.json().catch(() => ({}));

  // --- A. Seed, login, read-only sources ----------------------------------------------------
  const info = dealer.dealer_account_information || {};
  check('A1. demo dealer seeded in the CRM\'s shape (hours, timezone, address, SMS number, mailbox)',
    dealer.ai_mode === 'live' && Boolean(info.weekly_availability?.monday?.active) && Boolean(info.time_zone)
      && Boolean(info.store_address) && info.sms_conversion_phone === DEMO_DEALER_SMS,
    `${info.store_name}, ${info.time_zone}`);
  const login = await fetch(`${PLATFORM}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo-dealer@autopulse.local', password: DEMO_PASSWORD, type: 'dealer' }) });
  const loginBody = await jsonOf(login);
  const otp = await fetch(`${PLATFORM}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo-dealer@autopulse.local', otp: loginBody.otp, type: 'dealer' }) });
  const otpBody = await jsonOf(otp);
  check('A2. the documented login works (password, then the OTP; the OTP mail is stubbed)',
    login.ok && loginBody.otp_sent === true && otp.ok && Boolean(otpBody.token), `HTTP ${login.status} / ${otp.status}`);
  const staffToken = otpBody.token || jwt.sign({ userId: DEMO_DEALER_ID, type: 'dealer' }, JWT_SECRET, { expiresIn: '30m' });
  const staff = { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` };

  const profile = await fetch(`${AI}/dev/dealers/${DEMO_DEALER_ID}/profile`).then(jsonOf).catch(() => ({}));
  const car = await fetch(`${PLATFORM}/api/car?dealer_id=${DEMO_DEALER_ID}&limit=50`).then(jsonOf);
  const listings = car.listings || [];
  const withPhotos = listings.filter((l) => (l.media?.photo_links || []).length > 0);
  check('A3. stock is served by /api/car with photos (the AI\'s inventory source)',
    listings.length === 14 && withPhotos.length === listings.length,
    `${listings.length} vehicles, ${withPhotos.length} with photos`);
  const history = await db.collection('customers').findOne({ dealer_id: DEMO_DEALER_ID, name: 'Hannah Weber' });
  const c360 = await fetch(`${PLATFORM}/api/customers/${history._id}/360?dealer_id=${DEMO_DEALER_ID}`, { headers: internal });
  const c360Body = await jsonOf(c360);
  check('A4. Customer 360 with the shared secret: the customer\'s deal and vehicle',
    c360.ok && c360Body.data?.deals?.length === 1 && c360Body.data?.vehicles?.length >= 1,
    `HTTP ${c360.status}, ${c360Body.data?.deals?.length ?? 0} deal(s), ${c360Body.data?.vehicles?.length ?? 0} vehicle(s)`);
  const no360 = await fetch(`${PLATFORM}/api/customers/${history._id}/360?dealer_id=${DEMO_DEALER_ID}`);
  check('A5. Customer 360 refuses a call without the secret', no360.status === 401, `HTTP ${no360.status}`);
  if (profile?.name || profile?.hours) {
    check('A6. the AI reads the dealer profile / hours from the CRM record', true, JSON.stringify(profile).slice(0, 120));
  }

  // --- B. A new lead per source bucket ---------------------------------------------------------
  const created = {};
  for (const [i, spec] of DEMO_LEADS.entries()) {
    const phone = `+1555${String(i)}${run.slice(-6)}`;
    const email = `e2e-${spec.key}-${run}@example.test`;
    await queueLead(dealer, { name: spec.name, phone, email, source: spec.source,
      lead_source: spec.source, followup_preference: spec.channel, comments: `${spec.comments} (${run})` });
    created[spec.key] = { spec, phone, email };
  }
  for (const [key, entry] of Object.entries(created)) {
    try {
      entry.lead = await waitFor(`the ${key} lead`, () => Lead.findOne({ dealer_id: DEMO_DEALER_ID, email: entry.email }).lean());
      const [reply] = await waitFor(`the AI first reply to the ${key} lead`, async () => {
        const replies = await aiReplies(entry.lead._id);
        return replies.length ? replies : null;
      });
      entry.firstReply = reply;
      const viaCrm = reply.ai_sent_via_platform === true
        && reply.sender === (reply.communication_type === 'sms' ? DEMO_DEALER_SMS : DEMO_MAILBOX);
      const stubbed = await db.collection('dev_provider_outbox').findOne({ provider_id: reply.message_id });
      check(`B. ${entry.spec.source}: first reply sent by the CRM and recorded in the conversation`,
        viaCrm && Boolean(stubbed) && reply.status === 'sent',
        `${reply.communication_type} ${reply.sender} -> ${reply.recipient}: "${reply.mail_content.slice(0, 50)}..."`);
    } catch (error) {
      check(`B. ${entry.spec.source}: first reply sent by the CRM and recorded in the conversation`, false, error.message);
    }
  }
  const leadIds = Object.values(created).map((e) => e.lead?._id).filter(Boolean);
  const hits = await n8nHits();
  const ourHits = hits?.filter((h) => h.body.includes(run)) ?? [];
  check('B7. n8n was never called for the AI dealer\'s leads (tripwire)', hits !== null && ourHits.length === 0,
    hits === null ? 'tripwire not reachable' : `${ourHits.length} call(s)`);
  const jobs = await FollowUpJob.countDocuments({ leadId: { $in: leadIds } });
  check('B8. no rule-based FollowUpJob for the AI dealer\'s leads', jobs === 0, `${jobs} job(s)`);
  const nonAi = await Email.countDocuments({ lead_id: { $in: leadIds }, ai_generated: { $ne: true },
    status: { $in: ['sent', 'failed', 'draft'] } });
  check('B9. nothing but the AI\'s messages went to these customers', nonAi === 0, `${nonAi} other outbound record(s)`);

  // --- C. The customer texts back ---------------------------------------------------------------
  const sms = created.cargurus;
  const before = (await aiReplies(sms.lead._id)).length;
  const inbound = await textIn(sms.phone, DEMO_DEALER_SMS, 'Yes, still interested. Do you have it in gray?', run);
  check('C1. Twilio webhook accepted the customer\'s reply', inbound.response.ok, `HTTP ${inbound.response.status}`);
  const answer = await waitFor('the AI answer', async () => {
    const replies = await aiReplies(sms.lead._id);
    return replies.length > before ? replies.at(-1) : null;
  });
  check('C2. the AI answered through the CRM, in the same conversation', answer.ai_sent_via_platform === true,
    `"${answer.mail_content.slice(0, 60)}..."`);
  const delivered = await fetch(`${PLATFORM}/api/internal/ai/messages/status`, { method: 'POST', headers: internal,
    body: JSON.stringify({ dealer_id: DEMO_DEALER_ID, provider_id: answer.message_id, status: 'delivered' }) });
  check('C3. a delivery status reaches the CRM record', (await jsonOf(delivered)).updated === true
    && (await Email.findById(answer._id).lean()).ai_delivery_status === 'delivered');

  // --- D. Booking through /api/booking ------------------------------------------------------------
  const tz = info.time_zone;
  const day = await (async () => {
    for (let ahead = 4; ahead < 12; ahead += 1) {
      const date = new Date(Date.now() + ahead * 86_400_000).toLocaleDateString('en-CA', { timeZone: tz });
      const slots = await fetch(`${PLATFORM}/api/booking?dealer_id=${DEMO_DEALER_ID}&date=${date}`).then(jsonOf);
      if (slots.slots?.find((s) => s.time === '11:00' && s.available)) return date;
    }
    throw new Error('no free 11:00 slot in the next days');
  })();
  const bookingBody = (entry, time = '11:00') => JSON.stringify({ dealer_id: DEMO_DEALER_ID, lead_id: String(entry.lead._id),
    customerName: entry.lead.name, email: entry.email, phone: entry.phone, bookingDate: day, bookingTime: time,
    notes: 'e2e' });
  const emailsBefore = await Email.countDocuments({ lead_id: sms.lead._id });
  const booked = await fetch(`${PLATFORM}/api/booking`, { method: 'POST', headers: internal, body: bookingBody(sms) });
  const bookedBody = await jsonOf(booked);
  const bookingId = bookedBody.bookingId;
  const leadAfter = await Lead.findById(sms.lead._id).lean();
  check('D1. the AI service booked through /api/booking (shared secret)',
    booked.status === 201 && Boolean(bookingId) && leadAfter.fe_lead_status === 'Appointment Booked'
      && bookedBody.booking?.created_by === 'ai',
    `HTTP ${booked.status}, ${day} 11:00 ${tz}`);
  await sleep(1_500);
  const notices = await Email.countDocuments({ lead_id: sms.lead._id, is_appointment_notification: true });
  const reminders = await db.collection('appointmentreminders').countDocuments({ lead_id: sms.lead._id });
  check('D2. no platform confirmation or reminders for the AI dealer (the AI sends its own)',
    notices === 0 && reminders === 0, `${notices} notification(s), ${reminders} reminder(s), ${emailsBefore} messages before`);
  const again = await fetch(`${PLATFORM}/api/booking`, { method: 'POST', headers: internal, body: bookingBody(sms) });
  check('D3. the same booking again is answered with the existing one (no duplicate)',
    again.ok && (await jsonOf(again)).duplicate === true && (await Booking.countDocuments({ lead_id: String(sms.lead._id) })) === 1);
  const clash = await fetch(`${PLATFORM}/api/booking`, { method: 'POST', headers: internal, body: bookingBody(created.website, '11:15') });
  const clashBody = await jsonOf(clash);
  check('D4. another lead in the same slot gets a clear 409 with free times', clash.status === 409
    && clashBody.error === 'slot_taken' && clashBody.alternatives?.length > 0 && !clashBody.alternatives.includes('11:00'),
    `HTTP ${clash.status}: ${clashBody.message}`);
  const staffClash = await fetch(`${PLATFORM}/api/conversations/lead/status`, { method: 'PUT', headers: staff,
    body: JSON.stringify({ id: String(created.website.lead._id), status: 'Appointment Booked', booking_date: day,
      booking_time: '11:00' }) });
  check('D5. staff booking the taken slot from the lead screen get the same 409', staffClash.status === 409,
    `HTTP ${staffClash.status}: ${(await jsonOf(staffClash)).message}`);
  const closed = await fetch(`${PLATFORM}/api/booking`, { method: 'POST', headers: internal, body: bookingBody(created.website, '06:00') });
  check('D6. a time outside opening hours is refused (422)', closed.status === 422, `HTTP ${closed.status}`);
  const staffOk = await fetch(`${PLATFORM}/api/conversations/lead/status`, { method: 'PUT', headers: staff,
    body: JSON.stringify({ id: String(created.website.lead._id), status: 'Appointment Booked', booking_date: day,
      booking_time: '12:00' }) });
  const staffBooking = await Booking.findOne({ lead_id: String(created.website.lead._id) }).lean();
  const staffNotices = await Email.countDocuments({ lead_id: created.website.lead._id, is_appointment_notification: true });
  check('D7. a staff booking of a free slot is saved as a Booking, with no platform confirmation for the AI dealer',
    staffOk.ok && staffBooking?.bookingTime === '12:00' && staffBooking?.created_by === 'staff' && staffNotices === 0,
    `HTTP ${staffOk.status}`);
  const staffStage = await waitFor('the AI to set the staff-booked lead to Appointment Set', async () => {
    const s = await state(created.website.lead._id);
    return s?.stage === 'appointment_set' ? s : null;
  }).catch(() => null);
  check('D8. the AI was told about the staff booking (stage Appointment Set)', Boolean(staffStage));
  const moved = await fetch(`${PLATFORM}/api/booking`, { method: 'PUT', headers: internal,
    body: JSON.stringify({ bookingId, booking_status: 'confirmed', booking_time: '12:00' }) });
  check('D9. moving a booking onto a taken slot is refused (409)', moved.status === 409, `HTTP ${moved.status}`);
  const fetched = await fetch(`${PLATFORM}/api/booking?booking_id=${bookingId}`, { headers: internal }).then(jsonOf);
  check('D10. GET /api/booking returns the booking to the AI service', fetched.booking?.bookingTime === '11:00');

  // --- E. Staff: Visited + Sold Pending, then Closed - Lost -----------------------------------------
  const visited = await fetch(`${PLATFORM}/api/conversations/lead/status`, { method: 'PUT', headers: staff,
    body: JSON.stringify({ id: String(sms.lead._id), status: 'Visited', manager_outcome: 'Sold Pending' }) });
  const afterVisit = await Lead.findById(sms.lead._id).lean();
  check('E1. staff set Visited with the outcome Sold Pending', visited.ok && afterVisit.fe_lead_status === 'Sold Pending',
    `HTTP ${visited.status}, CRM status ${afterVisit.fe_lead_status}`);
  const soldPending = await waitFor('the AI stage Sold Pending', async () => {
    const s = await state(sms.lead._id);
    return s?.stage === 'sold_pending' ? s : null;
  }).catch(() => null);
  check('E2. the AI\'s stage follows: Sold Pending', Boolean(soldPending), soldPending?.stage_label);
  const showed = await fetch(`${PLATFORM}/api/booking`, { method: 'PUT', headers: internal,
    body: JSON.stringify({ bookingId, booking_status: 'completed', showed: true }) });
  check('E3. the booking records that the customer showed', showed.ok && (await Booking.findById(bookingId).lean()).showed === true);
  const list = await fetch(`${PLATFORM}/api/leads?dealer_id=${DEMO_DEALER_ID}&limit=50`, { headers: staff }).then(jsonOf);
  const row = (list.data || []).find((l) => String(l._id) === String(sms.lead._id));
  check('E4. the lead list shows the AI stage read only', row?.ai_stage_label === 'Sold Pending',
    row ? `ai_stage_label ${row.ai_stage_label}` : 'lead not in the list response');
  const lost = await fetch(`${PLATFORM}/api/conversations/lead/status`, { method: 'PUT', headers: staff,
    body: JSON.stringify({ id: String(sms.lead._id), status: 'Closed - Lost' }) });
  const closedLost = await waitFor('the AI stage Closed - Lost', async () => {
    const s = await state(sms.lead._id);
    return s?.stage === 'closed_lost' ? s : null;
  }).catch(() => null);
  check('E5. Closed - Lost on a Sold Pending lead reaches the AI', lost.ok && Boolean(closedLost), closedLost?.stage_label);
  const delivered2 = created['capital-one'];
  await fetch(`${PLATFORM}/api/conversations/lead/status`, { method: 'PUT', headers: staff,
    body: JSON.stringify({ id: String(delivered2.lead._id), status: 'Visited', manager_outcome: 'Sold Pending' }) });
  await fetch(`${PLATFORM}/api/conversations/lead/status`, { method: 'PUT', headers: staff,
    body: JSON.stringify({ id: String(delivered2.lead._id), status: 'Sold Delivered' }) });
  const soldDelivered = await waitFor('the AI stage Sold - Delivered', async () => {
    const s = await state(delivered2.lead._id);
    return s?.stage === 'sold_delivered' ? s : null;
  }).catch(() => null);
  check('E6. Sold Delivered on a Sold Pending lead reaches the AI', Boolean(soldDelivered), soldDelivered?.stage_label);

  // --- F. DND both ways ----------------------------------------------------------------------------
  const optOut = created.service;
  await textIn(optOut.phone, DEMO_DEALER_SMS, 'Please stop contacting me, remove me from all your lists.', run);
  const dnd = await waitFor('the CRM lead to become DND', async () => {
    const lead = await Lead.findById(optOut.lead._id).lean();
    return lead.fe_lead_status === 'DND' ? lead : null;
  }).catch(() => null);
  const note = dnd && await Email.findOne({ lead_id: optOut.lead._id, is_note: true, ai_generated: true }).lean();
  check('F1. the customer opted out of everything with the AI: the CRM lead is DND, with a note',
    Boolean(dnd) && Boolean(note), note ? `"${note.mail_content.slice(0, 80)}"` : 'lead not DND');
  const staffDnd = created.kbb;
  await fetch(`${PLATFORM}/api/conversations/lead/status`, { method: 'PUT', headers: staff,
    body: JSON.stringify({ id: String(staffDnd.lead._id), status: 'DND' }) });
  const optedOut = await waitFor('the AI stage Opted Out', async () => {
    const s = await state(staffDnd.lead._id);
    return s?.stage === 'opted_out' ? s : null;
  }).catch(() => null);
  check('F2. staff set DND in the CRM: the AI marks the lead opted out', Boolean(optedOut), optedOut?.stage_label);

  // --- G. Photos and notes through the CRM -----------------------------------------------------------
  const target = created.autotrader;
  const photoUrl = withPhotos[0]?.media?.photo_links?.[0] || 'https://placehold.co/600x400/jpg';
  const send = (channel, to, key) => fetch(`${PLATFORM}/api/internal/ai/messages/send`, { method: 'POST', headers: internal,
    body: JSON.stringify({ dealer_id: DEMO_DEALER_ID, lead_id: String(target.lead._id), customer_id: String(target.lead.customer_id || ''),
      channel, to, text: 'Here is a photo of the F-150 Lariat.', subject: 'Your F-150 Lariat', idempotency_key: key,
      media_urls: [photoUrl] }) });
  const mms = await send('sms', target.phone, `e2e-${run}:sms`).then(jsonOf);
  const mmsStub = await db.collection('dev_provider_outbox').findOne({ provider_id: mms.provider_id });
  const mmsRecord = mms.id ? await Email.findById(mms.id).lean() : null;
  check('G1. an AI text with a photo: Twilio MediaUrl set (stub) and shown in the conversation',
    mmsStub?.media_urls?.[0] === photoUrl && mmsRecord?.attachments?.[0]?.url === photoUrl, `provider id ${mms.provider_id}`);
  const mail = await send('email', target.email, `e2e-${run}:email`).then(jsonOf);
  const mailStub = await db.collection('dev_provider_outbox').findOne({ provider_id: mail.provider_id });
  check('G2. an AI email with a photo: inline image, from the dealer mailbox',
    mailStub?.from === DEMO_MAILBOX && String(mailStub?.text || '').includes('<img'), `provider id ${mail.provider_id}`);
  const repeat = await send('sms', target.phone, `e2e-${run}:sms`).then(jsonOf);
  check('G3. the same send again is not sent twice', repeat.duplicate === true && repeat.provider_id === mms.provider_id);
  const noAuth = await fetch(`${PLATFORM}/api/internal/ai/messages/send`, { method: 'POST', body: '{}',
    headers: { 'Content-Type': 'application/json' } });
  check('G4. the send endpoint rejects calls without the shared secret', noAuth.status === 401, `HTTP ${noAuth.status}`);
  const noted = await fetch(`${PLATFORM}/api/internal/ai/leads/notes`, { method: 'POST', headers: internal,
    body: JSON.stringify({ dealer_id: DEMO_DEALER_ID, lead_id: String(target.lead._id), kind: 'service_request',
      text: 'Service request: oil change, prefers Tuesday morning.' }) }).then(jsonOf);
  check('G5. the AI can leave an internal note on the lead', noted.created === true);
}

(CRM_LOCAL ? crmLocal() : main())
  .catch((error) => {
    check('end-to-end run', false, error.message);
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  });
