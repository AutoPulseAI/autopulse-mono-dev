// No double messaging (agentic-upsell MASTER_PLAN_1 Stage 11, BPLAN Phase 4),
// proven on the real worker code against a real MongoDB:
//
//   - n8n is never called for a `live` dealer's lead or reply. Every N8N_* URL
//     points at a local "tripwire" server that records any call; an `off`
//     dealer run through the same code is the control that shows the tripwire
//     does catch calls.
//   - Rule-based FollowUpJobs are never created for a `live` dealer's lead,
//     and pending ones are cleared.
//   - Staff actions reach the AI service as `lead-paused` events.
//
// Uses its own database (pulse_ai_nodouble_test), wiped before each test.
// Skipped when no MongoDB is reachable.   Run: node --test test-ai-no-double-messaging.js
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const URI = process.env.AI_TEST_MONGODB_URI || 'mongodb://localhost:27017/pulse_ai_nodouble_test';
const LIVE = '66f0000000000000000000c1';
const OFF = '66f0000000000000000000c2';
const quiet = { info() {}, warn() {}, error() {}, log() {} };

// Local HTTP servers standing in for n8n (must never be called for LIVE) and
// for the AI service (records the events the platform sends).
function recordingServer(status, body) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      let parsed = data;
      try { parsed = JSON.parse(data); } catch { /* keep raw */ }
      hits.push({ path: req.url, body: parsed });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return { hits, server };
}
const n8n = recordingServer(503, { error: 'n8n tripwire' });
const ai = recordingServer(202, { status: 'queued' });
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

let connected = false;
let mongoose, User, Lead, FollowUpJob, EmailAccount, processSMS, processLead, onLeadStatusChange;
let clearAiModeCache, notifyAiOfStaffReply;

before(async () => {
  const n8nPort = await listen(n8n.server);
  const aiPort = await listen(ai.server);
  Object.assign(process.env, {
    MONGODB_URI: URI,
    N8N_SMS_API: `http://127.0.0.1:${n8nPort}/sms`,
    N8N_EMAIL_API: `http://127.0.0.1:${n8nPort}/email`,
    N8N_LEAD_API: `http://127.0.0.1:${n8nPort}/lead`,
    N8N_WRITE_WITH_AI_API: `http://127.0.0.1:${n8nPort}/write-with-ai`,
    UPSELL_AGENT_API_URL: `http://127.0.0.1:${aiPort}`,
    UPSELL_SERVICE_SHARED_SECRET: 'test-secret',
    // The workers build Mailgun and Twilio clients when they load.
    MAILGUN_API_KEY: 'test-placeholder', MAILGUN_DOMAIN: 'test.invalid',
    TWILIO_ACCOUNT_SID: `AC${'0'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'test-placeholder',
  });
  mongoose = (await import('mongoose')).default;
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 2_000 });
    connected = true;
  } catch {
    return;
  }
  User = (await import('./app/models/User.js')).default;
  Lead = (await import('./app/models/Lead.js')).default;
  FollowUpJob = (await import('./app/models/FollowUpJob.js')).default;
  EmailAccount = (await import('./app/models/EmailAccount.js')).default;
  ({ processSMS } = await import('./app/worker/processSms.js'));
  ({ processLead } = await import('./app/worker/leadworker.js'));
  ({ onLeadStatusChange } = await import('./app/lib/followupService.js'));
  ({ clearAiModeCache } = await import('./app/lib/ai/aiMode.js'));
  ({ notifyAiOfStaffReply } = await import('./app/lib/ai/aiStaff.js'));
});

after(async () => {
  n8n.server.close();
  ai.server.close();
  if (connected) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

// A rule-based follow-up rule for new leads, so an `off` dealer's lead gets a FollowUpJob.
const RULES = [{ id: 'rule-1', active: true, leadStatus: 'Lead', frequencyValue: 1, stopAfter: 30 }];

async function seedDealer(id, mode, sms) {
  await User.collection.insertOne({
    _id: new mongoose.Types.ObjectId(id), email: `d-${id.slice(-2)}@test.invalid`, name: `Dealer ${mode}`,
    password: '!test', type: 'dealer', ai_mode: mode,
    setting: { autoReplyEnabled: true, rules: RULES },
    dealer_account_information: { sms_conversion_phone: sms, time_zone: 'America/New_York' },
  });
  await EmailAccount.collection.insertOne({ dealer_id: new mongoose.Types.ObjectId(id), email_address: `sales-${id.slice(-2)}@test.invalid`,
    account_name: 'Sales', event_type: 'Sales', email_password: '!test', active: true });
}

beforeEach(async () => {
  if (!connected) return;
  await mongoose.connection.dropDatabase();
  clearAiModeCache();
  n8n.hits.length = 0;
  ai.hits.length = 0;
  await seedDealer(LIVE, 'live', '+15550001001');
  await seedDealer(OFF, 'off', '+15550001002');
});

const maybe = (name, fn) => test(name, async (t) => {
  if (!connected) return t.skip(`MongoDB not reachable at ${URI}`);
  const log = console.log;
  console.log = () => {}; // the workers are chatty
  try {
    return await fn(t);
  } finally {
    console.log = log;
  }
});

async function runLead(dealerId, run) {
  const dealer = await User.findById(dealerId).lean();
  const comments = `Is the RAV4 still available? (${run})`;
  await processLead({ data: {
    action: 'create', dealer,
    leadData: { name: `Test ${run}`, email: `${run}@example.test`, phone: `+1555${run}`, followup_preference: 'sms',
      source: 'website', comments, dealer_id: dealerId },
    jobData: { currentSMS: { mail_content: comments, dealer_id: dealerId } },
  } });
  return Lead.findOne({ email: `${run}@example.test` }).lean();
}

function smsJob(dealerId, dealerSms, from, text) {
  return { data: { currentSMS: {
    message_id: `SM${Math.random().toString(16).slice(2)}`, sender: from, recipient: dealerSms, mail_content: text,
    status: 'received', dealer_id: dealerId, communication_type: 'sms', date: new Date(), NumMedia: 0,
  } } };
}

const n8nHitsMentioning = (needle) => n8n.hits.filter((h) => JSON.stringify(h.body).includes(needle));

maybe('a live dealer\'s new lead never reaches n8n and gets no FollowUpJob; the AI gets lead-created', async () => {
  const lead = await runLead(LIVE, '1110001');
  assert.ok(lead, 'lead created');
  assert.deepEqual(n8n.hits, [], 'n8n was called for a live dealer');
  assert.equal(await FollowUpJob.countDocuments({ leadId: lead._id }), 0);
  const events = ai.hits.filter((h) => h.path === '/v1/events/lead-created');
  assert.equal(events.length, 1);
  assert.equal(events[0].body.lead_id, String(lead._id));
});

maybe('control: the same lead for an off dealer does go to n8n (the tripwire works)', async () => {
  // The old path throws when n8n answers 503; the call is what matters here.
  await runLead(OFF, '1110002').catch(() => {});
  assert.ok(n8nHitsMentioning('1110002').length >= 1, 'expected the off dealer to call n8n');
  assert.equal(ai.hits.length, 0, 'an off dealer sends the AI nothing');
});

maybe('a live dealer\'s inbound SMS never reaches n8n; the AI gets it', async () => {
  await processSMS(smsJob(LIVE, '+15550001001', '+15557770001', 'Do you have it in blue?'));
  assert.deepEqual(n8n.hits, [], 'n8n was called for a live dealer');
  assert.equal(ai.hits.length, 1);
  assert.equal(ai.hits[0].path, '/v1/events/lead-created'); // a new number starts a lead
  assert.equal(await FollowUpJob.countDocuments({}), 0);
});

maybe('control: an off dealer\'s inbound SMS goes to n8n', async () => {
  await processSMS(smsJob(OFF, '+15550001002', '+15557770002', 'Hello there'));
  assert.ok(n8nHitsMentioning('Hello there').length >= 1);
  assert.equal(ai.hits.length, 0);
});

maybe('rule-based follow-ups: none for a live dealer (pending ones cleared), scheduled as before for off', async () => {
  const liveLead = await Lead.create({ name: 'Live', phone: '+15550009991', dealer_id: LIVE, fe_lead_status: 'Lead' });
  await FollowUpJob.create({ leadId: liveLead._id, ruleId: 'rule-1', dealer_id: LIVE, runIndex: 1, status: 'pending',
    scheduledAt: new Date(Date.now() + 86_400_000) });
  await onLeadStatusChange(liveLead._id);
  await new Promise((r) => setTimeout(r, 300)); // onLeadStatusChange schedules without awaiting
  assert.equal(await FollowUpJob.countDocuments({ leadId: liveLead._id }), 0);

  const offLead = await Lead.create({ name: 'Off', phone: '+15550009992', dealer_id: OFF, fe_lead_status: 'Lead' });
  await onLeadStatusChange(offLead._id);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await FollowUpJob.countDocuments({ leadId: offLead._id, status: 'pending' }), 1);
});

maybe('a staff reply reaches the AI as lead-paused (live), and not at all for off', async () => {
  const lead = await Lead.create({ name: 'Live', phone: '+15550009993', dealer_id: LIVE });
  await notifyAiOfStaffReply({ leadId: lead._id, dealerId: LIVE, emailRecordId: 'rec1', staffName: 'Sam', logger: quiet });
  await notifyAiOfStaffReply({ leadId: lead._id, dealerId: OFF, emailRecordId: 'rec2', logger: quiet });
  assert.equal(ai.hits.length, 1);
  assert.equal(ai.hits[0].path, '/v1/events/lead-paused');
  assert.deepEqual(ai.hits[0].body, { event_id: 'staff-reply-rec1', dealer_id: LIVE, lead_id: String(lead._id),
    reason: 'Staff replied by hand (Sam)' });
});
